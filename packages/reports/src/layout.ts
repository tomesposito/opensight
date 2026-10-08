import { fail, type ReportDefinition, type RowsByBand, type TextRun, type TextStyle } from './model.js';
import { pageDimensions, validateDefinition, validateRows } from './validation.js';

export const PT_MM = 25.4 / 72;
export const MAX_PAGES = 1000;
const GAP = 4, PAD = 2, EPS = 1e-7;
export type ItemRole = 'header' | 'footer' | 'text' | 'table-header' | 'table-row' | 'table-summary' | 'no-data';
interface ItemBase { x: number; y: number; role: ItemRole; bandId: string }
export interface TextItem extends ItemBase { kind: 'text'; text: string; style: Required<TextStyle> }
export interface RectItem extends ItemBase { kind: 'rect'; width: number; height: number; fill: string }
export type PageItem = TextItem | RectItem;
export interface Page { number: number; totalPages: number; width: number; height: number; items: PageItem[] }
interface Piece { text: string; width: number; style: Required<TextStyle> }
interface Line { pieces: Piece[]; height: number }
const styleFor = (s?: TextStyle, size = 10): Required<TextStyle> => ({ fontSize: size, bold: false, italic: false, color: '#172b4d', ...s });

/** Standard PDF Courier only. Unsupported glyphs fail instead of corrupting export. */
export function checkText(text: string, path: string): void {
  if (/[^\x20-\x7e\xa0-\xff\n]/u.test(text)) fail('REPORT_UNSUPPORTED_TEXT', path, 'Slice 1 supports printable Latin-1 and line feeds with the built-in Courier font');
}
/** Approximate character-width wrapping; deliberately shared with preview/PDF. */
function lines(runs: readonly TextRun[], width: number, path: string, size = 10): Line[] {
  const result: Line[] = [];
  let pieces: Piece[] = [], used = 0, height = size * PT_MM * 1.2;
  const finish = () => { result.push({ pieces, height }); pieces = []; used = 0; height = size * PT_MM * 1.2; };
  for (const run of runs) {
    checkText(run.text, path);
    const style = styleFor(run.style, size), advance = style.fontSize * PT_MM * 0.6;
    if (advance > width + EPS) fail('REPORT_PAGE_OVERFLOW', path, 'Column or page is narrower than one character');
    for (const char of run.text) {
      if (char === '\n') { height = Math.max(height, style.fontSize * PT_MM * 1.2); finish(); continue; }
      if (used + advance > width + EPS) finish();
      height = Math.max(height, style.fontSize * PT_MM * 1.2);
      const last = pieces.at(-1);
      if (last?.style === style) { last.text += char; last.width += advance; }
      else pieces.push({ text: char, width: advance, style });
      used += advance;
    }
  }
  if (pieces.length || runs.at(-1)?.text.endsWith('\n')) finish();
  return result;
}
const heightOf = (ls: readonly Line[]) => ls.reduce((n, l) => n + l.height, 0);
function paintLine(page: Page, line: Line, x: number, y: number, role: ItemRole, bandId: string): void {
  for (const piece of line.pieces) {
    page.items.push({ kind: 'text', text: piece.text, x, y: y + line.height / 1.2, style: piece.style, role, bandId });
    x += piece.width;
  }
}
function paintLines(page: Page, ls: readonly Line[], x: number, y: number, role: ItemRole, bandId: string): void {
  for (const l of ls) { paintLine(page, l, x, y, role, bandId); y += l.height; }
}

/** Pure: no clock, storage, query execution, network or PDF-library measurement. */
export function layoutReport(definition: ReportDefinition, rowsByBand: RowsByBand): Page[] {
  validateDefinition(definition); validateRows(definition, rowsByBand);
  const [width, height] = pageDimensions(definition), m = definition.pageSetup.margins;
  const contentWidth = width - m.left - m.right;
  const repeated = (which: 'header' | 'footer', pageNumber: number, totalPages: number) => lines(definition[which].runs.map(run => 'text' in run ? run : {
    text: String({ pageNumber, totalPages, date: definition.date, reportTitle: definition.title }[run.field]), style: run.style,
  }), contentWidth, `$.${which}`);
  // Reserve the maximum digit width before pagination so final numbering never repaginates.
  const headerHeight = heightOf(repeated('header', MAX_PAGES, MAX_PAGES));
  const footerHeight = heightOf(repeated('footer', MAX_PAGES, MAX_PAGES));
  const top = m.top + (headerHeight ? headerHeight + GAP : 0);
  const bottom = height - m.bottom - (footerHeight ? footerHeight + GAP : 0);
  const usable = bottom - top;
  if (usable < 10) fail('REPORT_PAGE_OVERFLOW', '$.pageSetup', 'Repeating bands leave less than 10 mm for the body');
  const pages: Page[] = [];
  let page: Page, y = top;
  const newPage = () => {
    if (pages.length >= MAX_PAGES) fail('REPORT_LIMIT_EXCEEDED', '$', 'At most 1000 pages');
    page = { number: pages.length + 1, totalPages: 0, width, height, items: [] };
    pages.push(page); y = top;
  };
  newPage();
  for (const band of definition.body) {
    const path = `$.body.${band.id}`;
    if (band.kind === 'text') {
      const size = band.headingLevel ? [20, 16, 13][band.headingLevel - 1]! : 10;
      const runs = band.runs.map(r => ({ ...r, style: { bold: !!band.headingLevel, ...r.style } }));
      for (const line of lines(runs, contentWidth, path, size)) {
        if (line.height > usable + EPS) fail('REPORT_PAGE_OVERFLOW', path, 'A text line exceeds the usable page');
        if (y + line.height > bottom + EPS) newPage();
        paintLine(page!, line, m.left, y, 'text', band.id); y += line.height;
      }
    } else if (band.kind === 'table') {
      const cellWidth = contentWidth / band.columns.length;
      const measure = (values: readonly (string | number | null)[], header = false) => values.map(v => lines([{ text: String(v ?? ''), style: { ...band.style, ...(header ? { bold: true } : {}) } }], cellWidth - PAD * 2, path));
      const cellHeight = (cells: Line[][]) => Math.max(styleFor(band.style).fontSize * PT_MM * 1.2, ...cells.map(heightOf)) + PAD * 2;
      const headers = measure(band.columns.map(c => c.label), true), hh = cellHeight(headers);
      const draw = (cells: Line[][], h: number, role: ItemRole) => {
        for (const [i, ls] of cells.entries()) {
          const x = m.left + i * cellWidth;
          page!.items.push({ kind: 'rect', x, y, width: cellWidth, height: h, fill: role === 'table-header' ? '#e9eef5' : role === 'table-summary' ? '#f4f6f9' : '#ffffff', role, bandId: band.id });
          paintLines(page!, ls, x + PAD, y + PAD, role, band.id);
        }
        y += h;
      };
      let needsHeader = true;
      const row = (values: readonly (string | number | null)[], role: ItemRole) => {
        const cells = measure(values), h = cellHeight(cells);
        if (hh + h > usable + EPS) fail('REPORT_ROW_OVERFLOW', path, 'One row plus its repeated column header exceeds the usable page');
        if (y + h + (needsHeader ? hh : 0) > bottom + EPS) { newPage(); needsHeader = true; }
        if (needsHeader) { draw(headers, hh, 'table-header'); needsHeader = false; }
        draw(cells, h, role);
      };
      const rows = rowsByBand[band.id]!;
      if (!rows.length) row(band.columns.map((_, i) => i === 0 ? 'no data' : ''), 'no-data');
      for (const values of rows) row(band.columns.map(c => values[c.field.columnName]!), 'table-row');
      if (band.summary) row(band.summary, 'table-summary');
    } else fail('REPORT_UNSUPPORTED_BAND', path, 'Only text and table bands are supported');
    y += GAP;
  }
  for (const p of pages) {
    p.totalPages = pages.length;
    paintLines(p, repeated('header', p.number, pages.length), m.left, m.top, 'header', '$header');
    paintLines(p, repeated('footer', p.number, pages.length), m.left, height - m.bottom - footerHeight, 'footer', '$footer');
  }
  return pages;
}
