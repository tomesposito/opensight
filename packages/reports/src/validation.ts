import { validator } from '@exodus/schemasafe';
import { fail, type ReportDefinition, type RowsByBand } from './model.js';

const string = { type: 'string', minLength: 1, maxLength: 256 };
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' };
const style = { type: 'object', additionalProperties: false, properties: {
  fontSize: { type: 'number', minimum: 8, maximum: 32 }, bold: { type: 'boolean' }, italic: { type: 'boolean' },
  color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
} };
const textRun = { type: 'object', additionalProperties: false, required: ['text'], properties: {
  text: { type: 'string', minLength: 1, maxLength: 100000 }, style,
} };
const fieldRun = { type: 'object', additionalProperties: false, required: ['field'], properties: {
  field: { enum: ['pageNumber', 'totalPages', 'date', 'reportTitle'] }, style,
} };
const repeated = { type: 'object', additionalProperties: false, required: ['runs'], properties: {
  runs: { type: 'array', maxItems: 100, items: { oneOf: [textRun, fieldRun] } },
} };
/** Portable JSON Schema, also used by the runtime validator without coercion/defaults. */
export const reportSchema: Parameters<typeof validator>[0] = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object', additionalProperties: false,
  required: ['version', 'id', 'title', 'date', 'pageSetup', 'header', 'footer', 'body'],
  properties: {
    version: { const: 1 }, id, title: string, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    pageSetup: { type: 'object', additionalProperties: false, required: ['size', 'orientation', 'margins'], properties: {
      size: { enum: ['A4', 'Letter', 'Legal'] }, orientation: { enum: ['portrait', 'landscape'] },
      margins: { type: 'object', additionalProperties: false, required: ['top', 'right', 'bottom', 'left'],
        properties: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(k => [k, { type: 'number', minimum: 0, maximum: 150 }])) },
    } },
    header: repeated, footer: repeated,
    body: { type: 'array', minItems: 1, maxItems: 100, items: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['kind', 'id', 'runs'], properties: {
        kind: { const: 'text' }, id, headingLevel: { enum: [1, 2, 3] },
        runs: { type: 'array', minItems: 1, maxItems: 100, items: textRun },
      } },
      { type: 'object', additionalProperties: false, required: ['kind', 'id', 'datasetId', 'columns'], properties: {
        kind: { const: 'table' }, id, datasetId: string, style,
        columns: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', additionalProperties: false, required: ['field', 'type', 'label'], properties: {
            field: { type: 'object', additionalProperties: false, required: ['dataSetIdentifier', 'columnName'], properties: { dataSetIdentifier: string, columnName: string } },
            type: { enum: ['INTEGER', 'DECIMAL', 'STRING', 'DATETIME'] }, label: string,
          },
        } },
        summary: { type: 'array', minItems: 1, maxItems: 20, items: { type: ['string', 'number', 'null'], maxLength: 100000 } },
      } },
    ] } },
  },
};
const schemaValidator = validator(reportSchema, { includeErrors: true });
const validate = (value: unknown): value is ReportDefinition => schemaValidator(value as Parameters<typeof schemaValidator>[0]);
export const pageSizes = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6] } as const;
export function pageDimensions(d: ReportDefinition): [number, number] {
  const [w, h] = pageSizes[d.pageSetup.size];
  return d.pageSetup.orientation === 'portrait' ? [w, h] : [h, w];
}
export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function validateDefinition(value: unknown): asserts value is ReportDefinition {
  if (isRecord(value) && Array.isArray(value.body)) for (const [i, band] of value.body.entries()) {
    if (isRecord(band) && typeof band.kind === 'string' && !['text', 'table'].includes(band.kind)) fail('REPORT_UNSUPPORTED_BAND', `$.body[${i}].kind`, 'Only text and table bands are supported');
  }
  if (!validate(value)) fail('REPORT_INVALID_DEFINITION', schemaValidator.errors?.[0]?.instanceLocation || '$', 'Definition does not match report JSON Schema');
  if (!Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) fail('REPORT_INVALID_DEFINITION', '$.date', 'Expected a valid calendar date');
  const ids = new Set<string>();
  for (const [i, band] of value.body.entries()) {
    const path = `$.body[${i}]`;
    if (ids.has(band.id)) fail('REPORT_INVALID_DEFINITION', path, 'Duplicate band ID');
    ids.add(band.id);
    if (band.kind === 'table') {
      if (band.columns.some(c => c.field.dataSetIdentifier !== band.datasetId)) fail('REPORT_INVALID_DEFINITION', path, 'Column dataset reference must match datasetId');
      if (new Set(band.columns.map(c => c.field.columnName)).size !== band.columns.length) fail('REPORT_INVALID_DEFINITION', path, 'Duplicate table column');
      if (band.summary && band.summary.length !== band.columns.length) fail('REPORT_INVALID_DEFINITION', path, 'Summary must match column count');
    }
  }
  const [w, h] = pageDimensions(value), m = value.pageSetup.margins;
  if (w - m.left - m.right < 20 || h - m.top - m.bottom < 20) fail('REPORT_INVALID_DEFINITION', '$.pageSetup.margins', 'Margins leave less than 20 mm of usable width or height');
}

/** Rows are caller-supplied query results, never dataset access authority. */
export function validateRows(d: ReportDefinition, value: unknown): asserts value is RowsByBand {
  if (!isRecord(value)) fail('REPORT_INVALID_ROWS', '$.rowsByBand', 'Expected rows keyed by table band ID');
  const tables = d.body.filter(b => b.kind === 'table');
  if (Object.keys(value).some(k => !tables.some(b => b.id === k))) fail('REPORT_INVALID_ROWS', '$.rowsByBand', 'Unknown table band');
  let count = 0, chars = 0;
  for (const band of tables) {
    const rows = Object.hasOwn(value, band.id) ? value[band.id] : undefined;
    const path = `$.rowsByBand.${band.id}`;
    if (!Array.isArray(rows)) fail('REPORT_INVALID_ROWS', path, 'Explicit rows required; use [] for no data');
    count += rows.length;
    if (count > 10000) fail('REPORT_LIMIT_EXCEEDED', path, 'At most 10000 supplied rows');
    for (const [i, row] of rows.entries()) {
      if (!isRecord(row)) fail('REPORT_INVALID_ROWS', `${path}[${i}]`, 'Expected a query result row');
      for (const col of band.columns) {
        const v = row[col.field.columnName];
        if (!Object.hasOwn(row, col.field.columnName) || !(v === null || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v))) fail('REPORT_INVALID_ROWS', `${path}[${i}]`, 'Missing or invalid column value');
        if (v !== null && ((col.type === 'INTEGER' && (typeof v !== 'number' || !Number.isInteger(v))) || (col.type === 'DECIMAL' && typeof v !== 'number') || (['STRING', 'DATETIME'].includes(col.type) && typeof v !== 'string'))) fail('REPORT_INVALID_ROWS', `${path}[${i}]`, 'Column value does not match declared query column type');
        chars += String(v ?? '').length;
        if (chars > 2000000) fail('REPORT_LIMIT_EXCEEDED', path, 'At most 2 million displayed characters');
      }
    }
  }
}
