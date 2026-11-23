import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsToCsv, tableToCsv, tableToSpreadsheetMl, storeVisualTable, storeVisualRows, getVisualTable, getVisualRows, clearVisualRows } from '../build/test/visual-export.js';
import { compileVisual } from '../build/test/compiler.js';
import { authorReducer, emptyDraft, activeSheet, serializeVisual } from '../build/test/authoring.js';

test('issue reproduction: formula-prefixed string is text-marked', () => {
  assert.equal(rowsToCsv([{ region: '=1+1', revenue: 100 }]), "region,revenue\r\n'=1+1,100\r\n");
});

test('all OWASP formula prefixes are defused on strings', () => {
  const rows = [{
    a: '=1+1',
    b: '+1+1',
    c: '-1+1',
    d: '@SUM(A1)',
    e: '\tcmd',
    f: '\rcmd',
  }];
  assert.equal(
    rowsToCsv(rows),
    "a,b,c,d,e,f\r\n'=1+1,'+1+1,'-1+1,'@SUM(A1),'\tcmd,\"'\rcmd\"\r\n"
  );
});

test('formula prefix combined with delimiter/quote escaping', () => {
  assert.equal(
    rowsToCsv([{ cell: '=SUM("a",b)' }]),
    "cell\r\n\"'=SUM(\"\"a\"\",b)\"\r\n"
  );
});

test('actual numeric types are preserved, not defused', () => {
  // A real -5 is data, not a formula: numbers pass through verbatim.
  assert.equal(rowsToCsv([{ n: -5, label: 'ok' }]), "n,label\r\n-5,ok\r\n");
  assert.equal(rowsToCsv([{ n: 1e6 }]), "n\r\n1000000\r\n");
  assert.equal(rowsToCsv([{ b: true }]), "b\r\ntrue\r\n");
});

test('a string "-5" is treated as text, not a formula', () => {
  assert.equal(rowsToCsv([{ n: '-5' }]), "n\r\n'-5\r\n");
});

test('formula-prefixed headers are defused', () => {
  assert.equal(rowsToCsv([{ '=h': 1 }]), "'=h\r\n1\r\n");
});

test('ordinary strings pass through unchanged', () => {
  assert.equal(
    rowsToCsv([{ region: 'East', note: 'a,b "c"\nline2' }]),
    "region,note\r\nEast,\"a,b \"\"c\"\"\nline2\"\r\n"
  );
});

test('null, undefined and empty rows', () => {
  assert.equal(rowsToCsv([]), '');
  assert.equal(rowsToCsv([{ a: null, b: undefined }]), "a,b\r\n,\r\n");
});

// Issue #314: author exports emit the compiled data-view table, not raw rows.
const selectedVisual = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const chartConfig = definition => Object.values(definition)[0].chartConfiguration;
const authorInput = (kind, rows) => {
  const visual = selectedVisual(authorReducer(authorReducer(emptyDraft(), { type: 'add', kind }), { type: 'assign', field: 'region' }));
  return { source: 'bundle', path: '$.export314', bindings: {}, rows, definition: serializeVisual(visual) };
};

test('issue #314 example: descending measure sort + one-category limit reach the CSV export', () => {
  const input = authorInput('bar', [{ region: 'A', revenue: 10 }, { region: 'B', revenue: 50 }, { region: 'C', revenue: 20 }]);
  const config = chartConfig(input.definition);
  config.sortConfiguration = {
    categorySort: [{ aggregationSort: { fieldId: 'region', direction: 'DESC',
      column: { columnName: 'revenue', dataSetIdentifier: 'sales_data' },
      aggregationFunction: { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM' } } } }],
    categoryItemsLimit: { itemsLimit: 1, otherCategories: 'INCLUDE' },
  };
  const compiled = compileVisual(input);
  storeVisualTable('issue-314-bar', { columns: compiled.table.columns, rows: compiled.table.rows });
  // The display shows B=50 and Other=30; the download must contain exactly that, in that order.
  assert.equal(tableToCsv(getVisualTable('issue-314-bar')), 'region,revenue\r\nB,50\r\nOther,30\r\n');
  clearVisualRows('issue-314-bar');
});

test('issue #314: table visual row ordering reaches the export', () => {
  const input = authorInput('table', [{ region: 'C', revenue: 20 }, { region: 'A', revenue: 10 }, { region: 'B', revenue: 50 }]);
  chartConfig(input.definition).sortConfiguration = {
    rowSort: [{ aggregationSort: { fieldId: 'region', direction: 'DESC',
      column: { columnName: 'revenue', dataSetIdentifier: 'sales_data' },
      aggregationFunction: { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM' } } } }],
  };
  const compiled = compileVisual(input);
  assert.equal(tableToCsv({ columns: compiled.table.columns, rows: compiled.table.rows }), 'region,revenue\r\nB,50\r\nC,20\r\nA,10\r\n');
});

test('issue #314: Excel export carries the transformed table in order with numeric typing', () => {
  const xml = tableToSpreadsheetMl({ columns: ['region', 'revenue'], rows: [['B', 50], ['Other', 30]] }, 'Sales');
  assert.ok(xml.indexOf('>B<') < xml.indexOf('>Other<'));
  assert.ok(xml.includes('<Data ss:Type="Number">50</Data>'));
  assert.ok(xml.includes('<Data ss:Type="Number">30</Data>'));
});

test('issue #314: table CSV keeps the formula-injection guard', () => {
  assert.equal(tableToCsv({ columns: ['note'], rows: [['=1+1']] }), "note\r\n'=1+1\r\n");
});

test('issue #314: registry distinguishes not-loaded, loaded-empty and cleared visuals', () => {
  assert.equal(getVisualTable('never-loaded'), undefined);
  storeVisualTable('loaded-null', null);
  assert.equal(getVisualTable('loaded-null'), null);
  storeVisualRows('raw-adapter', [{ region: 'East', revenue: 5 }]);
  assert.deepEqual(getVisualTable('raw-adapter'), { columns: ['region', 'revenue'], rows: [['East', 5]] });
  assert.deepEqual(getVisualRows('raw-adapter'), [{ region: 'East', revenue: 5 }]);
  clearVisualRows('raw-adapter');
  assert.equal(getVisualTable('raw-adapter'), undefined);
  clearVisualRows('loaded-null');
});
