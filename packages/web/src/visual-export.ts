import type { Cell, Row } from './model.js';

/**
 * The exportable form of a visual: the compiled data-view table (columns in
 * display order, rows already sorted and limited by the compiler), NOT the
 * raw query rows. Author CSV/Excel downloads emit exactly this table, so a
 * download matches what the visual shows — descending measure order, the
 * category limit's "Other" bucket, table/pivot presentation ordering —
 * the same table the hosted dashboard CSV consumes as `output.table`
 * (issue #314).
 */
export interface ExportTable {
  columns: string[];
  rows: Cell[][];
}

/** Latest compiled data-view table per visual id, populated by LiveAuthorVisual. Menu actions read from here. */
const tablesByVisualId = new Map<string, ExportTable | null>();

export function storeVisualTable(visualId: string, table: ExportTable | null): void {
  tablesByVisualId.set(visualId, table);
}

export function getVisualTable(visualId: string): ExportTable | null | undefined {
  return tablesByVisualId.get(visualId);
}

export function rowsToTable(rows: Row[]): ExportTable {
  if (!rows.length) return { columns: [], rows: [] };
  const columns = Object.keys(rows[0]!);
  return { columns, rows: rows.map(row => columns.map(column => (row[column] ?? null) as Cell)) };
}

export function tableToRows(table: ExportTable): Row[] {
  return table.rows.map(cells => Object.fromEntries(table.columns.map((column, index) => [column, cells[index] ?? null])));
}

/** Raw-row adapter kept for callers that only have query rows; new code stores the compiled table via storeVisualTable. */
export function storeVisualRows(visualId: string, rows: Row[] | null): void {
  tablesByVisualId.set(visualId, rows === null ? null : rowsToTable(rows));
}

export function getVisualRows(visualId: string): Row[] | null | undefined {
  const table = tablesByVisualId.get(visualId);
  return table === undefined || table === null ? table : tableToRows(table);
}

export function clearVisualRows(visualId: string): void {
  tablesByVisualId.delete(visualId);
}

/**
 * OWASP CSV Injection: a string cell that begins with one of these
 * characters is interpreted as a formula/command when the CSV is opened
 * in a spreadsheet application. Prefixing with a single quote marks the
 * cell as text, so the value displays literally instead of executing.
 * Numeric types are never prefixed (an actual -5 is data, not a formula);
 * this guard applies to strings only.
 */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const defuseCsvFormula = (text: string): string =>
  CSV_FORMULA_PREFIX.test(text) ? `'${text}` : text;

export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? defuseCsvFormula(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Converts the compiled data-view table to a spreadsheet-safe CSV (CRLF
 * line endings).
 *
 * Every string header and cell is passed through the CSV-injection guard
 * above; actual numbers and booleans are emitted verbatim. The export is
 * intentionally spreadsheet-safe only: OpenSight does not offer a raw,
 * un-sanitized CSV export, because visual exports are meant to be opened
 * directly in spreadsheet applications. Data containing formula-like
 * strings therefore always arrives as text.
 */
export function tableToCsv(table: ExportTable): string {
  if (!table.rows.length) return '';
  const lines = [table.columns.map(csvCell).join(',')];
  for (const cells of table.rows) lines.push(table.columns.map((_, index) => csvCell(cells[index])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function rowsToCsv(rows: Row[]): string {
  return tableToCsv(rowsToTable(rows));
}

const xmlEscape = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  // Quotes must be escaped too: this helper is used inside double-quoted
  // attributes (e.g. ss:Name), where a bare " ends the attribute.
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/**
 * XML 1.0 Char production: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF].
 * Characters outside it cannot appear in an XML 1.0 document at all, so the
 * export boundary strips them from every emitted text value (sheet names,
 * headers, cells) instead of producing a workbook no XML parser can read.
 * This is a format constraint, not data loss by choice: no valid XML
 * representation of these characters exists.
 */
const INVALID_XML_CHARS = /[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
const stripInvalidXmlChars = (text: string): string => text.replace(INVALID_XML_CHARS, '');

/**
 * Worksheet-name validation at the export boundary. Excel sheet names may not
 * exceed 31 characters and may not contain []:*?/\\ or control characters; a
 * blank result falls back to Sheet1 so the workbook always has a valid name.
 */
export function sanitizeSheetName(name: string): string {
  const cleaned = stripInvalidXmlChars(name)
    // Sheet names also reject control characters Excel cannot display
    // (\x7F-\x9F are valid XML 1.0 but not valid in a worksheet name).
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/[\[\]:*?/\\]/g, '')
    .trim()
    .slice(0, 31);
  return cleaned || 'Sheet1';
}

export function tableToSpreadsheetMl(table: ExportTable, sheetName: string): string {
  const cell = (value: unknown, type: string): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return `<Cell><Data ss:Type="${type}">${xmlEscape(stripInvalidXmlChars(text))}</Data></Cell>`;
  };
  const safeSheetName = sanitizeSheetName(sheetName);
  const headerRow = `<Row>${table.columns.map(h => cell(h, 'String')).join('')}</Row>`;
  const dataRows = table.rows.map(cells => `<Row>${table.columns.map((_, index) => {
    const value = cells[index];
    const type = typeof value === 'number' ? 'Number' : 'String';
    return cell(value, type);
  }).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${xmlEscape(safeSheetName)}"><Table>${headerRow}${dataRows}</Table></Worksheet></Workbook>`;
}

export function rowsToSpreadsheetMl(rows: Row[], sheetName: string): string {
  return tableToSpreadsheetMl(rowsToTable(rows), sheetName);
}

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportVisualCsv(visualId: string, title: string): string | undefined {
  const table = getVisualTable(visualId);
  if (table === undefined) return 'No data has loaded for this visual yet.';
  if (table === null || !table.rows.length) return 'This visual has no rows to export.';
  const safe = (title.trim() || visualId).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 64);
  downloadFile(`${safe}.csv`, tableToCsv(table), 'text/csv');
  return undefined;
}

export function exportVisualExcel(visualId: string, title: string): string | undefined {
  const table = getVisualTable(visualId);
  if (table === undefined) return 'No data has loaded for this visual yet.';
  if (table === null || !table.rows.length) return 'This visual has no rows to export.';
  const safe = (title.trim() || visualId).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 64);
  downloadFile(`${safe}.xls`, tableToSpreadsheetMl(table, title.trim() || visualId), 'application/vnd.ms-excel');
  return undefined;
}
