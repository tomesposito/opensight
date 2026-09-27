import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { VisualCard } from '../build/test/VisualCard.js';
const base = () => activeSheet(authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' })).visuals[0];
const input = (v, rows) => ({ ...buildAuthorVisual(v), rows });

test('pivot compiles row and column dimensions, sparse cells, multiple values and grand totals', () => {
  const v = { ...base(), columns: ['category'], measures: ['revenue', 'profit'], totals: true };
  const rows = [{ region: 'East', category: 'Hardware', revenue: 100, profit: null }, { region: 'East', category: 'Software', revenue: 300, profit: 30 }, { region: 'West', category: 'Hardware', revenue: 400, profit: 0 }];
  const result = compileVisual(input(v, rows));
  assert.deepEqual(result.model.rowDimensions.map(f => f.column), ['region']);
  assert.deepEqual(result.model.columnDimensions.map(f => f.column), ['category']);
  assert.deepEqual(result.table.columns, ['region', 'category: Hardware · revenue', 'category: Hardware · profit', 'category: Software · revenue', 'category: Software · profit', 'Grand total · revenue', 'Grand total · profit']);
  assert.deepEqual(result.table.rows, [['East', 100, null, 300, 30, 400, 30], ['West', 400, 0, null, null, 400, 0], ['Grand total', 500, 0, 300, 30, 800, 30]]);
  assert.deepEqual(result.table.rowKinds, ['detail', 'detail', 'total']);
  assert.equal(result.option.series, undefined);
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(v, rows) }));
  assert.match(html, /<table>/); assert.match(html, /scope="col"/); assert.match(html, /class="total"/); assert.doesNotMatch(html, /role="img"/);
});

test('pivot row and column subtotals roll up parent levels exactly once; null and zero remain distinct', () => {
  const v = { ...base(), rows: ['region', 'category'], columns: ['order_date', 'order_id'], subtotals: true, totals: true };
  const rows = [
    { region: 'East', category: 'Hardware', month: '2025-01', order_id: 1, revenue: 100 },
    { region: 'East', category: 'Software', month: '2025-01', order_id: 2, revenue: 300 },
    { region: 'West', category: 'Hardware', month: '2025-01', order_id: 1, revenue: null },
    { region: 'West', category: 'Hardware', month: '2025-02', order_id: 3, revenue: 0 },
  ];
  const result = compileVisual(input(v, rows));
  assert.deepEqual(result.table.rowKinds, ['detail', 'detail', 'subtotal', 'detail', 'subtotal', 'total']);
  assert.deepEqual(result.table.rows[2], ['East', 'Subtotal', 100, 300, 400, null, null, 400]);
  assert.deepEqual(result.table.rows[4], ['West', 'Subtotal', null, null, null, 0, 0, 0]);
  assert.deepEqual(result.table.rows[5], ['Grand total', '', 100, 300, 400, 0, 0, 400]);
  assert.match(result.table.columns[4], /2025-01 \/ Subtotal/);
  const disabled = compileVisual(input({ ...v, totals: false, subtotals: false }, rows));
  assert.deepEqual(disabled.table.rowKinds, ['detail', 'detail', 'detail']);
  assert.equal(disabled.table.columns.length, 5);
});

test('table totals and hierarchical subtotals share pivot SUM and null semantics', () => {
  const v = { ...base(), kind: 'table', rows: ['region', 'category'], totals: true, subtotals: true };
  const result = compileVisual(input(v, [{ region: 'East', category: 'A', revenue: null }, { region: 'East', category: 'B', revenue: null }, { region: 'West', category: 'A', revenue: 0 }]));
  assert.deepEqual(result.table.rows, [['East', 'A', null], ['East', 'B', null], ['East', 'Subtotal', null], ['West', 'A', 0], ['West', 'Subtotal', 0], ['Grand total', '', 0]]);
});

test('column-only and row-only pivots work; empty/unavailable never invent totals', () => {
  const v = { ...base(), dimension: null, rows: [], columns: ['category'], totals: true };
  assert.deepEqual(compileVisual(input(v, [{ category: 'A', revenue: 5 }])).table.rows, [[5, 5]]);
  for (const [rows, state] of [[null, 'unavailable'], [[], 'empty']]) {
    const result = compileVisual(input(base(), rows));
    assert.equal(result.state, state); assert.deepEqual(result.table.rows, []);
    assert.deepEqual(compileVisual(input(v, rows)).table.rows, []);
  }
  const typed = compileVisual(input(base(), [{ region: null, revenue: null }, { region: '(null)', revenue: 1 }]));
  assert.deepEqual(typed.table.rows, [[null, null], ['(null)', 1]]);
});

test('pivot rejects duplicate full groups, malformed wells, measures and total options', () => {
  const v = { ...base(), columns: ['category'] };
  const row = { region: 'East', category: 'A', revenue: 5 };
  assert.throws(() => compileVisual(input(v, [row, row])), /duplicate categories/);
  assert.throws(() => compileVisual(input(v, [{ ...row, revenue: '5' }])), /finite number/);
  const definition = serializeVisual(v);
  definition.pivotTableVisual.chartConfiguration.fieldWells.pivotTableAggregatedFieldWells.columns = [{ categoricalDimensionField: { fieldId: 'region', column: { dataSetIdentifier: 'sales_data', columnName: 'region' } } }];
  assert.throws(() => compileVisual({ ...input(v, []), definition }), /duplicate field IDs/);
  const invalid = serializeVisual(v); invalid.pivotTableVisual.chartConfiguration.totalOptions.rowTotalOptions.totalsVisibility = 'sometimes';
  assert.throws(() => compileVisual({ ...input(v, []), definition: invalid }), /unsupported value/);
});
