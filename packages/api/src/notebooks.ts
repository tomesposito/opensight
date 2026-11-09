import { hasCapability, type Role } from '@opensight/query-engine';
import { validateParameters } from '@opensight/query-engine/parameters';
import { AutomationStore } from './automation-store.js';
import type { Identity } from './security.js';

export const NOTEBOOK_MAX_CELLS = 100;
export const NOTEBOOK_TEXT_LIMIT = 10_000;
export const NOTEBOOK_RUN_RETENTION = 20;
export const NOTEBOOK_SNAPSHOT_LIMIT = 100;
/**
 * Aggregate retained-result byte budgets (#230). The per-cell bounds alone let
 * one notebook retain ~15 GiB (100 cells × 20 runs of individually valid
 * results), so retention is also bounded by the JSON byte size of the result
 * payloads themselves (`data` of run results and snapshots; metadata, cell
 * text and JavaScript object overhead are not counted — the retry-store
 * accounting rule). Defaults: one run may retain as much as the #159 8 MiB
 * cache-entry budget; a notebook (runs + snapshots combined) 64 MiB; the
 * whole store 256 MiB.
 */
export interface NotebookResultLimits { runBytes: number; notebookBytes: number; storeBytes: number }
function positiveLimit(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}
export function notebookResultLimits(env: NodeJS.ProcessEnv = process.env): NotebookResultLimits {
  const limits = { runBytes: positiveLimit(env, 'OPENSIGHT_NOTEBOOK_RUN_BYTES', 8 * 1024 * 1024),
    notebookBytes: positiveLimit(env, 'OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES', 64 * 1024 * 1024),
    storeBytes: positiveLimit(env, 'OPENSIGHT_NOTEBOOK_STORE_BYTES', 256 * 1024 * 1024) };
  if (limits.runBytes > limits.notebookBytes || limits.notebookBytes > limits.storeBytes) throw new Error('Notebook result byte budgets must satisfy run <= notebook <= store');
  return limits;
}
export interface NotebookParameter { name: string; type: 'string' | 'number' | 'date'; default?: string | number }
export interface NotebookChart { type: 'bar' | 'line' | 'pie' | 'table'; dimension: string; measure: string; aggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' }
export type NotebookCell = { id: string; kind: 'markdown'; text: string }
  | { id: string; kind: 'sql'; text: string; datasetRefs: string[] }
  | { id: string; kind: 'visual'; sourceCellId: string; chart: NotebookChart };
export interface Notebook {
  id: string; namespaceId: string; ownerId: string; name: string; published: boolean;
  parameters: NotebookParameter[]; cells: NotebookCell[]; version: number; createdAt: string; updatedAt: string;
}
export type NotebookScalar = string | number | boolean | null;
export interface NotebookData {
  columns: { name: string; type: 'STRING' | 'DECIMAL' | 'INTEGER' | 'DATETIME' | 'BOOLEAN' }[];
  rows: Record<string, NotebookScalar>[]; rowCount: number; truncated: boolean;
}
export interface NotebookCellResult {
  cellId: string; kind: NotebookCell['kind']; executedAt: string; elapsedMs: number;
  datasetRefs: string[]; data?: NotebookData; sourceCellId?: string; error?: { code: string; message: string };
}
export interface NotebookRun {
  id: string; notebookId: string; namespaceId: string; executedBy: string; notebookVersion: number;
  executedAt: string; accessStamp: string; results: NotebookCellResult[];
}
export interface NotebookSnapshot extends NotebookData {
  id: string; notebookId: string; cellId: string; runId: string; namespaceId: string; ownerId: string;
  asOf: string; datasetRefs: string[]; accessStamp: string;
}
export interface NotebookState { version: 1; notebooks: Notebook[]; runs: NotebookRun[]; snapshots: NotebookSnapshot[] }
/** JSON bytes of one retained result payload; the unit every #230 budget counts. */
export function notebookDataBytes(data: NotebookData): number { return Buffer.byteLength(JSON.stringify(data)); }
export function notebookRunBytes(run: NotebookRun): number {
  return run.results.reduce((total, r) => total + (r.data ? notebookDataBytes(r.data) : 0), 0);
}
export function notebookSnapshotBytes(snapshot: NotebookSnapshot): number {
  const { columns, rows, rowCount, truncated } = snapshot;
  return notebookDataBytes({ columns, rows, rowCount, truncated });
}
/** Retained result bytes for one notebook (runs + snapshots), or the whole store when no notebook is named. */
export function notebookRetainedBytes(state: NotebookState, notebookId?: string): number {
  return state.runs.reduce((total, r) => total + (notebookId === undefined || r.notebookId === notebookId ? notebookRunBytes(r) : 0), 0)
    + state.snapshots.reduce((total, s) => total + (notebookId === undefined || s.notebookId === notebookId ? notebookSnapshotBytes(s) : 0), 0);
}
/**
 * Byte-based eviction after a new run is appended (#230). Count retention runs
 * first (caller); this evicts the notebook's oldest runs until its combined
 * runs + snapshots fit the notebook budget, then evicts the store's oldest
 * runs (any notebook; snapshots are explicit saves and are never evicted)
 * until the store fits. If snapshots alone leave no room, the new run is not
 * retained. Returns whether the new run survived.
 */
export function evictNotebookRunsForBytes(draft: NotebookState, limits: NotebookResultLimits, newRun: NotebookRun): boolean {
  const dropOldest = (candidates: NotebookRun[]): boolean => {
    const victim = candidates[0];
    if (!victim) return false;
    draft.runs = draft.runs.filter(r => r !== victim); return true;
  };
  while (notebookRetainedBytes(draft, newRun.notebookId) > limits.notebookBytes) {
    if (!dropOldest(draft.runs.filter(r => r.notebookId === newRun.notebookId && r !== newRun))) break;
  }
  while (notebookRetainedBytes(draft) > limits.storeBytes) {
    if (!dropOldest(draft.runs.filter(r => r !== newRun))) break;
  }
  if (notebookRetainedBytes(draft, newRun.notebookId) > limits.notebookBytes || notebookRetainedBytes(draft) > limits.storeBytes) {
    draft.runs = draft.runs.filter(r => r !== newRun); return false;
  }
  return true;
}
export interface NotebookPrincipal extends Identity { role?: Role }
export class NotebookError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = 'NotebookError'; }
}
export function notebookFail(code: string, message: string, status = 400): never { throw new NotebookError(code, status, message); }
export function notebookObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !keys.includes(k))) notebookFail('NOTEBOOK_INVALID_BODY', 'Expected an object with supported fields.');
  return raw as Record<string, unknown>;
}
function text(raw: unknown, max: number, empty = false): string {
  if (typeof raw !== 'string' || (!empty && !raw.trim()) || raw.length > max || raw.includes('\0')) notebookFail('NOTEBOOK_INVALID_TEXT', `Expected ${empty ? '0' : '1'}–${max} characters without NUL.`);
  return raw;
}
function id(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) notebookFail('NOTEBOOK_INVALID_ID', 'Invalid identifier.');
  return raw;
}
function stamp(raw: unknown): string {
  if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw))) notebookFail('NOTEBOOK_INVALID_TIME', 'Invalid timestamp.');
  return raw;
}
function integer(raw: unknown, min: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min) notebookFail('NOTEBOOK_INVALID_NUMBER', 'Invalid integer.');
  return raw;
}
function boolean(raw: unknown): boolean {
  if (typeof raw !== 'boolean') notebookFail('NOTEBOOK_INVALID_BOOLEAN', 'Expected a boolean.');
  return raw;
}
function array(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) notebookFail('NOTEBOOK_LIMIT_EXCEEDED', `Expected at most ${max} items.`);
  return raw;
}
function refs(raw: unknown): string[] {
  const values = array(raw, 100).map(id);
  if (new Set(values.map(v => v.toLowerCase())).size !== values.length) notebookFail('NOTEBOOK_DUPLICATE_DATASET', 'Dataset references must be unique.');
  return values;
}
export function notebookBindings(parameters: readonly NotebookParameter[], raw: unknown = {}, requireValues = true): Record<string, string | number> {
  let input: Record<string, unknown>;
  try { input = notebookObject(raw, parameters.map(p => p.name)); } catch { return notebookFail('NOTEBOOK_PARAMETER_INVALID', 'Bindings must contain only declared parameter names.'); }
  const values = Object.fromEntries(parameters.map(p => [p.name, Object.hasOwn(input, p.name) ? [input[p.name]] : p.default !== undefined ? [p.default] : []]));
  try {
    validateParameters(parameters.map(p => ({ name: p.name, type: p.type === 'date' ? 'datetime' : p.type, multiple: false })), values);
    if (requireValues && Object.values(values).some(v => v.length !== 1)) throw new Error('Every parameter needs a binding or default.');
  } catch (e) { notebookFail('NOTEBOOK_PARAMETER_INVALID', e instanceof Error ? e.message : 'Invalid parameters.'); }
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.length).map(([k, v]) => [k, v[0] as string | number]));
}
export function validateNotebookContent(raw: unknown): Pick<Notebook, 'name' | 'published' | 'parameters' | 'cells'> {
  const o = notebookObject(raw, ['name', 'published', 'parameters', 'cells']);
  const name = text(o.name, 120), published = boolean(o.published === undefined ? false : o.published);
  const parameters = array(o.parameters === undefined ? [] : o.parameters, 200).map(v => {
    const p = notebookObject(v, ['name', 'type', 'default']);
    if (!['string', 'number', 'date'].includes(String(p.type))) notebookFail('NOTEBOOK_PARAMETER_INVALID', 'Expected string, number or date.');
    return { name: text(p.name, 128), type: p.type as NotebookParameter['type'], ...(p.default === undefined ? {} : { default: p.default as string | number }) };
  });
  notebookBindings(parameters, {}, false);
  const seen = new Set<string>(), sql = new Set<string>();
  const cells = array(o.cells === undefined ? [] : o.cells, NOTEBOOK_MAX_CELLS).map((v): NotebookCell => {
    const c = notebookObject(v, ['id', 'kind', ...(typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'visual' ? ['sourceCellId', 'chart'] : typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'sql' ? ['text', 'datasetRefs'] : ['text'])]);
    const cellId = id(c.id);
    if (seen.has(cellId)) notebookFail('NOTEBOOK_DUPLICATE_CELL', 'Cell IDs must be unique.');
    seen.add(cellId);
    if (c.kind === 'markdown') return { id: cellId, kind: c.kind, text: text(c.text, NOTEBOOK_TEXT_LIMIT, true) };
    if (c.kind === 'sql') { sql.add(cellId); return { id: cellId, kind: c.kind, text: text(c.text, NOTEBOOK_TEXT_LIMIT, true), datasetRefs: refs(c.datasetRefs) }; }
    if (c.kind !== 'visual') notebookFail('NOTEBOOK_INVALID_CELL', 'Expected markdown, sql or visual.');
    const sourceCellId = id(c.sourceCellId);
    if (!sql.has(sourceCellId)) notebookFail('NOTEBOOK_VISUAL_DEPENDENCY_INVALID', 'A visual must reference an earlier SQL cell.');
    const chart = notebookObject(c.chart, ['type', 'dimension', 'measure', 'aggregation']);
    if (!['bar', 'line', 'pie', 'table'].includes(String(chart.type)) || !['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(String(chart.aggregation))) notebookFail('NOTEBOOK_INVALID_CHART', 'Unsupported chart type or aggregation.');
    return { id: cellId, kind: 'visual', sourceCellId, chart: { type: chart.type as NotebookChart['type'], dimension: text(chart.dimension, 128), measure: text(chart.measure, 128), aggregation: chart.aggregation as NotebookChart['aggregation'] } };
  });
  return { name, published, parameters, cells };
}
export const notebookAuthor = (p: NotebookPrincipal): boolean => p.role === undefined || hasCapability(p.role, 'build');
export const canViewNotebook = (p: NotebookPrincipal, n: Notebook): boolean => p.namespaceId === n.namespaceId && (p.userId === n.ownerId || n.published);
export const canManageNotebook = (p: NotebookPrincipal, n: Notebook): boolean => p.namespaceId === n.namespaceId && (p.userId === n.ownerId || p.role !== undefined && hasCapability(p.role, 'admin'));
export const canEditNotebook = (p: NotebookPrincipal, n: Notebook): boolean => notebookAuthor(p) && canManageNotebook(p, n);

function data(raw: unknown): NotebookData {
  const d = notebookObject(raw, ['columns', 'rows', 'rowCount', 'truncated']);
  const columns = array(d.columns, 256).map(v => {
    const c = notebookObject(v, ['name', 'type']);
    if (!['STRING', 'DECIMAL', 'INTEGER', 'DATETIME', 'BOOLEAN'].includes(String(c.type))) notebookFail('NOTEBOOK_INVALID_RESULT', 'Invalid result type.');
    return { name: text(c.name, 128), type: c.type as NotebookData['columns'][number]['type'] };
  });
  if (!columns.length || new Set(columns.map(c => c.name)).size !== columns.length) notebookFail('NOTEBOOK_INVALID_RESULT', 'Invalid result columns.');
  const rows = array(d.rows, 100_000).map(v => {
    const row = notebookObject(v, columns.map(c => c.name));
    if (Object.keys(row).length !== columns.length) notebookFail('NOTEBOOK_INVALID_RESULT', 'Incomplete result row.');
    for (const c of columns) {
      const value = row[c.name];
      if (value !== null && !(c.type === 'BOOLEAN' ? typeof value === 'boolean' : c.type === 'INTEGER' || c.type === 'DECIMAL' ? typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^[+-]?\d+$/.test(value) : typeof value === 'string' && value.length <= 16384 && !value.includes('\0'))) notebookFail('NOTEBOOK_INVALID_RESULT', 'Invalid result scalar.');
    }
    return row as Record<string, NotebookScalar>;
  });
  if (integer(d.rowCount, 0) !== rows.length) notebookFail('NOTEBOOK_INVALID_RESULT', 'Invalid result count.');
  return { columns, rows, rowCount: rows.length, truncated: boolean(d.truncated) };
}
export function validateNotebookState(raw: unknown, limits: NotebookResultLimits = notebookResultLimits()): NotebookState {
  try {
    const s = notebookObject(raw, ['version', 'notebooks', 'runs', 'snapshots']);
    if (s.version !== 1) notebookFail('NOTEBOOK_INVALID_VERSION', 'Unknown store version.');
    const ids = new Set<string>();
    const unique = (value: unknown) => { const key = id(value); if (ids.has(key)) notebookFail('NOTEBOOK_DUPLICATE_ID', 'Duplicate store ID.'); ids.add(key); return key; };
    const notebooks = array(s.notebooks, 1000).map(v => {
      const n = notebookObject(v, ['id', 'namespaceId', 'ownerId', 'name', 'published', 'parameters', 'cells', 'version', 'createdAt', 'updatedAt']);
      if (n.published === undefined || n.cells === undefined || n.parameters === undefined) notebookFail('NOTEBOOK_INVALID_BODY', 'Persisted notebook content is incomplete.');
      return { id: unique(n.id), namespaceId: id(n.namespaceId), ownerId: text(n.ownerId, 512), ...validateNotebookContent({ name: n.name, published: n.published, parameters: n.parameters, cells: n.cells }), version: integer(n.version, 1), createdAt: stamp(n.createdAt), updatedAt: stamp(n.updatedAt) };
    });
    const scope = (notebookId: unknown, namespaceId: unknown): string => {
      const n = notebooks.find(n => n.id === notebookId && n.namespaceId === namespaceId);
      if (!n) notebookFail('NOTEBOOK_INVALID_SCOPE', 'Orphaned run or snapshot.'); return n.id;
    };
    const runs = array(s.runs, 1000 * NOTEBOOK_RUN_RETENTION).map((v): NotebookRun => {
      const r = notebookObject(v, ['id', 'notebookId', 'namespaceId', 'executedBy', 'notebookVersion', 'executedAt', 'accessStamp', 'results']);
      const cellIds = new Set<string>();
      const results = array(r.results, NOTEBOOK_MAX_CELLS).map((v): NotebookCellResult => {
        const c = notebookObject(v, ['cellId', 'kind', 'executedAt', 'elapsedMs', 'datasetRefs', 'data', 'sourceCellId', 'error']);
        if (!['sql', 'markdown', 'visual'].includes(String(c.kind))) notebookFail('NOTEBOOK_INVALID_RESULT', 'Invalid cell kind.');
        const cellId = id(c.cellId); if (cellIds.has(cellId)) notebookFail('NOTEBOOK_INVALID_RESULT', 'Duplicate result.'); cellIds.add(cellId);
        const error = c.error === undefined ? undefined : notebookObject(c.error, ['code', 'message']);
        if (error && c.data !== undefined || c.kind === 'sql' && !error && c.data === undefined || c.kind !== 'sql' && c.data !== undefined || c.kind !== 'visual' && c.sourceCellId !== undefined) notebookFail('NOTEBOOK_INVALID_RESULT', 'Invalid result state.');
        return { cellId, kind: c.kind as NotebookCell['kind'], executedAt: stamp(c.executedAt), elapsedMs: integer(c.elapsedMs, 0), datasetRefs: refs(c.datasetRefs), ...(c.data === undefined ? {} : { data: data(c.data) }), ...(c.sourceCellId === undefined ? {} : { sourceCellId: id(c.sourceCellId) }), ...(error ? { error: { code: text(error.code, 128), message: text(error.message, 1000) } } : {}) };
      });
      return { id: unique(r.id), notebookId: scope(r.notebookId, r.namespaceId), namespaceId: id(r.namespaceId), executedBy: text(r.executedBy, 512), notebookVersion: integer(r.notebookVersion, 1), executedAt: stamp(r.executedAt), accessStamp: text(r.accessStamp, 128), results };
    });
    const snapshots = array(s.snapshots, 1000 * NOTEBOOK_SNAPSHOT_LIMIT).map((v): NotebookSnapshot => {
      const s = notebookObject(v, ['id', 'notebookId', 'cellId', 'runId', 'namespaceId', 'ownerId', 'asOf', 'datasetRefs', 'accessStamp', 'columns', 'rows', 'rowCount', 'truncated']);
      return { id: unique(s.id), notebookId: scope(s.notebookId, s.namespaceId), namespaceId: id(s.namespaceId), cellId: id(s.cellId), runId: id(s.runId), ownerId: text(s.ownerId, 512), asOf: stamp(s.asOf), datasetRefs: refs(s.datasetRefs), accessStamp: text(s.accessStamp, 128), ...data({ columns: s.columns, rows: s.rows, rowCount: s.rowCount, truncated: s.truncated }) };
    });
    for (const n of notebooks) if (runs.filter(r => r.notebookId === n.id).length > NOTEBOOK_RUN_RETENTION || snapshots.filter(s => s.notebookId === n.id).length > NOTEBOOK_SNAPSHOT_LIMIT) notebookFail('NOTEBOOK_LIMIT_EXCEEDED', 'Retention exceeded.');
    // Aggregate byte budgets (#230): each result below is individually valid,
    // so only the summed payload bytes can reject the state here.
    const state: NotebookState = { version: 1, notebooks, runs, snapshots };
    for (const r of runs) if (notebookRunBytes(r) > limits.runBytes) notebookFail('NOTEBOOK_LIMIT_EXCEEDED', 'Run result byte budget exceeded.');
    for (const n of notebooks) if (notebookRetainedBytes(state, n.id) > limits.notebookBytes) notebookFail('NOTEBOOK_LIMIT_EXCEEDED', 'Notebook result byte budget exceeded.');
    if (notebookRetainedBytes(state) > limits.storeBytes) notebookFail('NOTEBOOK_LIMIT_EXCEEDED', 'Store result byte budget exceeded.');
    return state;
  } catch { throw new NotebookError('NOTEBOOK_STORE_CORRUPT', 500, 'NOTEBOOK_STORE_CORRUPT: invalid notebook store.'); }
}
export class NotebookStore {
  readonly limits: NotebookResultLimits;
  private constructor(private readonly store: AutomationStore<NotebookState>, limits: NotebookResultLimits) { this.limits = limits; }
  static async load(path?: string): Promise<NotebookStore> {
    const limits = notebookResultLimits();
    try { return new NotebookStore(await AutomationStore.load<NotebookState>({ version: 1, notebooks: [], runs: [], snapshots: [] }, path, raw => validateNotebookState(raw, limits)), limits); }
    catch { throw new NotebookError('NOTEBOOK_STORE_CORRUPT', 500, 'NOTEBOOK_STORE_CORRUPT: unable to load notebook store.'); }
  }
  read(): NotebookState { return this.store.read(); }
  change<R>(update: (draft: NotebookState) => R): Promise<R> { return this.store.change(draft => { const result = update(draft); validateNotebookState(draft, this.limits); return result; }); }
}
