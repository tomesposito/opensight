import { previewPrepDuckDb, type PrepPreview, type PrepPreviewOptions } from './prep-executor.js';
import type { PrepSource } from './prep.js';
import { randomUUID } from 'node:crypto';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import * as XLSX from 'xlsx';
import { validateConnectorConfig } from './connectors.js';
import { quoteIdentifier as q } from './validation.js';

export type UploadType = 'INTEGER' | 'DECIMAL' | 'STRING' | 'DATETIME' | 'BOOLEAN';
export interface UploadColumn { name: string; type: UploadType }
export interface UploadRequest { config: unknown; data: Uint8Array; columns?: readonly UploadColumn[] }
export interface UploadSummary { id: string; rowCount: number; columns: readonly UploadColumn[]; delimiter?: string; sheet?: string }
type Cell = string | number | boolean | null;
export class UploadError extends Error {
  constructor(readonly code: 'INVALID_UPLOAD' | 'UPLOAD_SCHEMA_MISMATCH' | 'UPLOAD_LIMIT_EXCEEDED' | 'UPLOAD_NOT_FOUND' | 'UPLOAD_STAGING_FAILED', readonly path: string, message: string) {
    super(`${path}: ${message}`); this.name = 'UploadError';
  }
}
const invalid = (path: string, message: string): never => { throw new UploadError('INVALID_UPLOAD', path, message); };
const mismatch = (path: string, message: string): never => { throw new UploadError('UPLOAD_SCHEMA_MISMATCH', path, message); };
const MAX_ROWS = 100_000, MAX_COLUMNS = 256, MAX_BYTES = 8 * 1024 * 1024;
const numeric = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const date = /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)?$/;
function dateValue(value: string): boolean {
  if (!date.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}
function checkNames(names: unknown[]): string[] {
  if (!names.length || names.length > MAX_COLUMNS) invalid('$.columns', 'Expected 1–256 columns');
  const seen = new Set<string>();
  return names.map((name, i) => {
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 128 || /[\x00-\x1f]/.test(name)) invalid(`$.columns[${i}]`, 'Invalid column name');
    const value = name as string, folded = value.toLowerCase();
    if (seen.has(folded)) invalid(`$.columns[${i}]`, 'Duplicate or case-ambiguous column name');
    seen.add(folded); return value;
  });
}
/** Strict RFC-style quoting; newlines and escaped quotes inside cells are retained. */
function delimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false, atStart = true;
  const field = () => { row.push(cell); if (row.length > MAX_COLUMNS) invalid('$.columns', 'Too many columns'); cell = ''; closed = false; atStart = true; };
  const record = () => { field(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.data', 'Too many rows'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) { if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char; continue; }
    if (char === delimiter) { field(); continue; }
    if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; record(); continue; }
    if (closed) invalid('$.data', 'Unexpected character after a closing quote');
    if (char === '"') { if (!atStart) invalid('$.data', 'Quote in an unquoted cell'); quoted = true; atStart = false; }
    else { cell += char; atStart = false; }
  }
  if (quoted) invalid('$.data', 'Unterminated quoted cell');
  if (cell || row.length || closed || !atStart) record();
  if (!rows.length) invalid('$.data', 'File is empty');
  if (rows.some(r => r.length !== rows[0]!.length)) invalid('$.data', 'Inconsistent row width');
  return rows;
}
function sniff(text: string, format: string, delimiter?: string): { rows: string[][]; delimiter: string } {
  if (delimiter || format === 'tsv') { const d = delimiter ?? '\t'; return { rows: delimited(text, d), delimiter: d }; }
  const candidates: { rows: string[][]; delimiter: string }[] = [];
  for (const d of [',', '\t', ';', '|']) {
    try { const rows = delimited(text, d); if (rows[0]!.length > 1) candidates.push({ rows, delimiter: d }); } catch { /* Try the other delimiters; never skip rows. */ }
  }
  if (candidates.length > 1) invalid('$.config.delimiter', 'Ambiguous delimiter; specify it explicitly');
  if (candidates.length) return candidates[0]!;
  if ([',', '\t', ';', '|'].some(d => { try { return delimited(text.split(/\r?\n/)[0]!, d)[0]!.length > 1; } catch { return false; } })) invalid('$.data', 'No delimiter produces consistent rows');
  return { rows: delimited(text, ','), delimiter: ',' };
}
function typeOf(value: Cell, text: boolean): UploadType | undefined {
  if (value === null) return undefined;
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') { if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) mismatch('$.data', 'Nonfinite or unsafe numeric value'); return Number.isInteger(value) ? 'INTEGER' : 'DECIMAL'; }
  if (dateValue(value)) return 'DATETIME';
  if (text && numeric.test(value)) {
    const n = Number(value);
    if (!Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n)) mismatch('$.data', 'Numeric value exceeds safe precision; declare STRING to preserve it');
    return Number.isInteger(n) ? 'INTEGER' : 'DECIMAL';
  }
  if (text && /^(true|false)$/.test(value)) return 'BOOLEAN';
  return 'STRING';
}
function rejectDuplicateJsonKeys(text: string): void {
  const stack: { object: boolean; key: boolean; names: Set<string> }[] = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g)) {
    const token = match[0], top = stack.at(-1);
    if (token === '{' || token === '[') stack.push({ object: token === '{', key: token === '{', names: new Set() });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.object) top.key = true;
    else if (token.startsWith('"') && top?.object && top.key) {
      const key = JSON.parse(token) as string;
      if (top.names.has(key)) invalid('$.data', 'Duplicate JSON object key');
      top.names.add(key); top.key = false;
    }
  }
}
export function parseUpload(request: UploadRequest): { columns: UploadColumn[]; rows: Cell[][]; delimiter?: string; sheet?: string } {
  const config = validateConnectorConfig('file', request?.config);
  if (!(request.data instanceof Uint8Array) || !request.data.byteLength) invalid('$.data', 'Expected nonempty file bytes');
  if (request.data.byteLength > MAX_BYTES) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.data', 'File exceeds 8 MiB');
  let rawRows: unknown[][], names: string[], delimiter: string | undefined, sheet: string | undefined;
  const isText = config.format === 'csv' || config.format === 'tsv';
  if (config.format === 'xls' || config.format === 'xlsx') {
    // Prevent SheetJS's permissive text fallback from treating arbitrary text as Excel.
    const b = request.data;
    if (config.format === 'xlsx' ? !(b[0] === 0x50 && b[1] === 0x4b) : ![0xd0, 0x09].includes(b[0]!)) invalid('$.data', 'File does not match the selected Excel format');
    let workbook: XLSX.WorkBook;
    try { workbook = XLSX.read(b, { type: 'array', cellDates: true, cellFormula: true, sheetRows: MAX_ROWS + 2 }); }
    catch { return invalid('$.data', 'Unable to parse Excel workbook'); }
    sheet = config.sheet;
    if (!sheet) { if (workbook.SheetNames.length !== 1) invalid('$.config.sheet', 'Choose a worksheet for a multi-sheet workbook'); sheet = workbook.SheetNames[0]; }
    const worksheet = sheet ? workbook.Sheets[sheet] : undefined;
    if (!worksheet || !worksheet['!ref']) invalid('$.config.sheet', 'Worksheet is missing or empty');
    const ws = worksheet!;
    if (ws['!merges']?.length) invalid('$.data', 'Merged cells are unsupported');
    const range = XLSX.utils.decode_range(ws['!fullref'] ?? ws['!ref']!);
    if (range.e.r > MAX_ROWS || range.e.c >= MAX_COLUMNS) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.data', 'Worksheet exceeds staging limits');
    if (range.s.r !== 0 || range.s.c !== 0) invalid('$.data', 'Worksheet must start at A1 with a header');
    for (const [key, cell] of Object.entries(ws)) if (!key.startsWith('!') && (cell.f || cell.t === 'e')) invalid('$.data', 'Formula and error cells are unsupported; upload values only');
    rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true, raw: true });
    names = checkNames(rawRows.shift() ?? []);
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(request.data).replace(/^\uFEFF/, ''); } catch { return invalid('$.data', 'Expected UTF-8 data'); }
    if (text.includes('\0')) invalid('$.data', 'NUL characters are unsupported');
    if (isText) {
      const parsed = sniff(text, config.format!, config.delimiter); delimiter = parsed.delimiter;
      names = checkNames(parsed.rows[0]!); rawRows = parsed.rows.slice(1).map(row => row.map(v => v === '' ? null : v));
    } else {
      let records: unknown;
      try { records = JSON.parse(text) as unknown; } catch { return invalid('$.data', 'Invalid JSON'); }
      if (!Array.isArray(records) || !records.length) invalid('$.data', 'JSON must be a nonempty array of flat objects');
      rejectDuplicateJsonKeys(text);
      const array = records as unknown[];
      const first = array[0];
      if (!first || typeof first !== 'object' || Array.isArray(first)) invalid('$.data[0]', 'Expected a flat object');
      names = checkNames(Object.keys(first as object));
      rawRows = array.map((record, i) => {
        if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== names.length || names.some(n => !Object.hasOwn(record, n))) mismatch(`$.data[${i}]`, 'Every row must have exactly the same columns');
        return names.map(n => (record as Record<string, unknown>)[n]);
      });
    }
  }
  if (rawRows.length > MAX_ROWS) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.data', 'Too many rows');
  const rows: Cell[][] = rawRows.map((row, i) => {
    if (row.length !== names.length) mismatch(`$.data[${i}]`, 'Row width must match header');
    return row.map((value, j) => {
      if (value instanceof Date) { if (!Number.isFinite(value.getTime())) mismatch(`$.data[${i}][${j}]`, 'Invalid date'); return value.toISOString(); }
      if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && !value.includes('\0')) return value;
      return mismatch(`$.data[${i}][${j}]`, 'Expected a finite scalar or null');
    });
  });
  const declared = request.columns;
  if (declared !== undefined && (!Array.isArray(declared) || declared.length !== names.length || declared.some((c, i) => !c || Object.keys(c).some(k => !['name', 'type'].includes(k)) || c.name !== names[i] || !['INTEGER', 'DECIMAL', 'STRING', 'DATETIME', 'BOOLEAN'].includes(c.type)))) mismatch('$.columns', 'Declared schema must match names/order and supported types');
  const columns = names.map((name, j): UploadColumn => {
    let type = declared?.[j]?.type;
    if (!type) {
      const types = new Set(rows.map(row => typeOf(row[j]!, isText)).filter(t => t !== undefined));
      if (types.has('INTEGER') && types.has('DECIMAL')) types.delete('INTEGER');
      if (types.size > 1) mismatch(`$.columns[${j}]`, 'Mixed column types; supply a compatible explicit schema');
      type = [...types][0] ?? 'STRING';
    }
    rows.forEach((row, i) => {
      const v = row[j]!; if (v === null) return;
      const p = `$.data[${i}][${j}]`;
      if (type === 'STRING') { if (typeof v !== 'string') mismatch(p, 'Expected string'); }
      else if (type === 'DATETIME') { if (typeof v !== 'string' || !dateValue(v)) mismatch(p, 'Expected an ISO date or UTC timestamp'); }
      else if (type === 'BOOLEAN') { if (typeof v === 'boolean') return; if (!isText || !['true', 'false'].includes(String(v))) mismatch(p, 'Expected boolean'); row[j] = v === 'true'; }
      else {
        if (typeof v !== 'number' && !(isText && typeof v === 'string' && numeric.test(v))) mismatch(p, 'Expected number');
        const n = Number(v);
        if (!Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n) || type === 'INTEGER' && !Number.isSafeInteger(n)) mismatch(p, 'Invalid or unsafe number');
        row[j] = n;
      }
    });
    return { name, type };
  });
  return { columns, rows, ...(delimiter ? { delimiter } : {}), ...(sheet ? { sheet } : {}) };
}

const sqlTypes: Record<UploadType, string> = { INTEGER: 'BIGINT', DECIMAL: 'DOUBLE', STRING: 'VARCHAR', DATETIME: 'TIMESTAMP', BOOLEAN: 'BOOLEAN' };
/** One staging session per owner. Tables live until close; no paths or SQL from uploads execute. */
export class UploadStaging {
  private readonly uploads = new Map<string, UploadSummary>();
  private constructor(private readonly instance: DuckDBInstance, private readonly connection: DuckDBConnection) {}
  static async create(): Promise<UploadStaging> {
    const instance = await DuckDBInstance.create(':memory:', { enable_external_access: 'false', autoinstall_known_extensions: 'false', autoload_known_extensions: 'false', threads: '1', memory_limit: '256MB', max_temp_directory_size: '0B' });
    try { return new UploadStaging(instance, await instance.connect()); } catch (e) { instance.closeSync(); throw e; }
  }
  async ingest(request: UploadRequest): Promise<UploadSummary> {
    const parsed = parseUpload(request); // Validate every row before creating a table.
    if (this.uploads.size >= 20) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.uploads', 'Staging holds at most 20 uploads per session');
    const id = `upload_${randomUUID().replaceAll('-', '')}`;
    try {
      await this.connection.run(`CREATE TABLE ${q(id)} (${parsed.columns.map(c => `${q(c.name)} ${sqlTypes[c.type]}`).join(', ')})`);
      // Bound batches avoid per-row SQL calls and never interpret file values as SQL.
      for (let i = 0; i < parsed.rows.length; i += 100) {
        const rows = parsed.rows.slice(i, i + 100), values = rows.flat();
        await this.connection.run(`INSERT INTO ${q(id)} VALUES ${rows.map(row => `(${row.map(() => '?').join(', ')})`).join(', ')}`, values);
      }
      const reader = await this.connection.runAndReadAll(`SELECT COUNT(*) FROM ${q(id)}`);
      const rowCount = Number(reader.getRows()[0]![0]);
      const summary: UploadSummary = { id, rowCount, columns: parsed.columns, ...(parsed.delimiter ? { delimiter: parsed.delimiter } : {}), ...(parsed.sheet ? { sheet: parsed.sheet } : {}) };
      this.uploads.set(id, structuredClone(summary)); return summary;
    } catch {
      await this.connection.run(`DROP TABLE IF EXISTS ${q(id)}`).catch(() => undefined);
      throw new UploadError('UPLOAD_STAGING_FAILED', '$.data', 'DuckDB staging failed; no upload was published');
    }
  }
  async preview(id: string): Promise<{ upload: UploadSummary; rows: Record<string, string | number | boolean | null>[] }> {
    const upload = this.uploads.get(id);
    if (!upload) throw new UploadError('UPLOAD_NOT_FOUND', '$.id', 'Upload not found');
    const projection = upload.columns.map(c => c.type === 'DATETIME' ? `strftime(${q(c.name)}, '%Y-%m-%dT%H:%M:%S.%gZ') AS ${q(c.name)}` : q(c.name)).join(', ');
    const reader = await this.connection.runAndReadAll(`SELECT ${projection} FROM ${q(id)} LIMIT 20`);
    return { upload: structuredClone(upload), rows: reader.getRows().map(row => Object.fromEntries(upload.columns.map((c, i) => [c.name, typeof row[i] === 'bigint' ? Number(row[i]) : row[i]]))) as Record<string, string | number | boolean | null>[] };
  }
  prepSources(): PrepSource[] {
    return [...this.uploads.values()].map(upload => ({ id: upload.id, connectorId: 'file', table: upload.id, columns: structuredClone(upload.columns), security: 'unrestricted' }));
  }
  async previewPrep(raw: unknown, options: PrepPreviewOptions = {}): Promise<PrepPreview> {
    return previewPrepDuckDb(this.connection, raw, this.prepSources(), options);
  }
  close(): void { this.connection.closeSync(); this.instance.closeSync(); this.uploads.clear(); }
}
