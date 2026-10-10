import type { Row } from './model.js';

/** Latest rendered rows per visual id, populated by LiveAuthorVisual. Menu actions read from here. */
const rowsByVisualId = new Map<string, Row[] | null>();

export function storeVisualRows(visualId: string, rows: Row[] | null): void {
  rowsByVisualId.set(visualId, rows);
}

export function getVisualRows(visualId: string): Row[] | null | undefined {
  return rowsByVisualId.get(visualId);
}

export function clearVisualRows(visualId: string): void {
  rowsByVisualId.delete(visualId);
}

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function rowsToCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map(h => csvCell(row[h])).join(','));
  return lines.join('\r\n') + '\r\n';
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

export function rowsToSpreadsheetMl(rows: Row[], sheetName: string): string {
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  const cell = (value: unknown, type: string): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return `<Cell><Data ss:Type="${type}">${xmlEscape(stripInvalidXmlChars(text))}</Data></Cell>`;
  };
  const safeSheetName = sanitizeSheetName(sheetName);
  const headerRow = `<Row>${headers.map(h => cell(h, 'String')).join('')}</Row>`;
  const dataRows = rows.map(row => `<Row>${headers.map(h => {
    const value = row[h];
    const type = typeof value === 'number' ? 'Number' : 'String';
    return cell(value, type);
  }).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${xmlEscape(safeSheetName)}"><Table>${headerRow}${dataRows}</Table></Worksheet></Workbook>`;
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
  const rows = getVisualRows(visualId);
  if (rows === undefined) return 'No data has loaded for this visual yet.';
  if (rows === null || !rows.length) return 'This visual has no rows to export.';
  const safe = (title.trim() || visualId).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 64);
  downloadFile(`${safe}.csv`, rowsToCsv(rows), 'text/csv');
  return undefined;
}

export function exportVisualExcel(visualId: string, title: string): string | undefined {
  const rows = getVisualRows(visualId);
  if (rows === undefined) return 'No data has loaded for this visual yet.';
  if (rows === null || !rows.length) return 'This visual has no rows to export.';
  const safe = (title.trim() || visualId).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 64);
  downloadFile(`${safe}.xls`, rowsToSpreadsheetMl(rows, title.trim() || visualId), 'application/vnd.ms-excel');
  return undefined;
}
