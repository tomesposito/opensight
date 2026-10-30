import assert from 'node:assert/strict';
import test from 'node:test';
import { planVisual } from '@opensight/query-engine';
import { calculation, dimension, measure, request, wells } from './helpers.mjs';

const aggregate = () => ({ name: 'Sales by region', tableName: 'sales_by_region', tableSchema: 'reporting',
  dimensions: [{ columnName: 'region' }], measures: [{ columnName: 'revenue', aggregation: 'SUM' }], countColumn: 'row_count' });

test('aggregate SUM rolls up a dimension subset and preserves SQL filters and dialect schema handling', () => {
  for (const dialect of ['duckdb', 'postgres', 'mysql']) {
    for (const id of ['total-revenue', 'revenue-by-region']) {
      const r = request(id), before = structuredClone(r), declaration = aggregate();
      const p = planVisual(r, { dialect, aggregates: [declaration] });
      assert.deepEqual(p.executionSource, { kind: 'aggregate', name: declaration.name });
      assert.equal(p.tableName, declaration.tableName);
      assert.match(p.sql, dialect === 'mysql' ? /FROM `reporting`.`sales_by_region`/ : dialect === 'postgres' ? /FROM "reporting"."sales_by_region"/ : /FROM "sales_by_region"/);
      assert.match(p.sql, /SUM\(["`]revenue["`]\)/);
      assert.deepEqual(p.parameters, ['East']);
      assert.deepEqual(r, before);
      assert.deepEqual(declaration, aggregate());
    }
  }
});

test('COUNT uses the declared per-grain count column', () => {
  const r = request(); wells(r).Values = [measure('revenue', 'COUNT')];
  const p = planVisual(r, { aggregates: [aggregate()] });
  assert.equal(p.executionSource.kind, 'aggregate');
  assert.match(p.sql, /SUM\("row_count"\) AS "revenue"/);
  const a = aggregate(); delete a.countColumn;
  assert.deepEqual(planVisual(r, { aggregates: [a] }).executionSource, { kind: 'source' });
});

for (const aggregation of ['AVG', 'MIN', 'MAX']) test(`${aggregation} always keeps the source`, () => {
  const r = request(); wells(r).Values = [measure('revenue', aggregation)];
  const a = aggregate(); a.measures[0].aggregation = aggregation;
  assert.deepEqual(planVisual(r, { aggregates: [a] }).executionSource, { kind: 'source' });
});

for (const [name, edit] of [
  ['calculation', r => calculation(r, '{revenue} * 2')],
  ['post-processing', r => calculation(r, 'sumOver(sum({revenue}), [], POST_AGG_FILTER)')],
  ['non-grain filter', r => { r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Column.ColumnName = 'category'; }],
  ['non-grain dimension', r => { r.visualId = 'share-by-category'; }],
]) test(`${name} keeps the source`, () => {
  const r = request(); edit(r);
  const p = planVisual(r, { aggregates: [aggregate()] });
  assert.deepEqual(p.executionSource, { kind: 'source' });
  assert.equal(p.tableName, 'sales');
});

test('date grain must match exactly; matching SQL keeps the existing transform', () => {
  const r = request('revenue-trend'), a = aggregate();
  a.dimensions.push({ columnName: 'order_date', granularity: 'DAY' });
  assert.equal(planVisual(r, { aggregates: [a] }).executionSource.kind, 'source');
  a.dimensions[1].granularity = 'MONTH';
  const p = planVisual(r, { aggregates: [a] });
  assert.equal(p.executionSource.kind, 'aggregate');
  assert.match(p.sql, /strftime\(date_trunc\('month', "order_date"\), '%Y-%m'\)/);
  r.parameterDeclarations = [{ name: 'start', type: 'datetime', multiple: false }];
  r.parameterBindings = { start: ['2025-01-15T00:00:00.000Z'] };
  r.parameterFilters = [{ columnName: 'order_date', parameterName: 'start', operator: 'GREATER_THAN_OR_EQUAL_TO' }];
  assert.equal(planVisual(r, { aggregates: [a] }).executionSource.kind, 'source', 'raw date filters cannot safely target truncated values');
});

for (const [name, edit, code] of [
  ['unknown property', a => { a.sql = 'SELECT 1'; }, 'UNSUPPORTED_FEATURE'],
  ['qualified table', a => { a.tableName = 'public.sales'; }, 'INVALID_INPUT'],
  ['SQL identifier', a => { a.countColumn = 'count(*)'; }, 'INVALID_INPUT'],
  ['unknown source column', a => { a.measures[0].columnName = 'missing'; }, 'UNRESOLVED_BINDING'],
  ['duplicate dimension', a => { a.dimensions.push(a.dimensions[0]); }, 'INVALID_INPUT'],
  ['duplicate measure', a => { a.measures.push(a.measures[0]); }, 'INVALID_INPUT'],
  ['unknown dimension key', a => { a.dimensions[0].extra = true; }, 'UNSUPPORTED_FEATURE'],
  ['invalid granularity', a => { a.dimensions[0].granularity = 'SECOND'; }, 'INVALID_INPUT'],
  ['non-date granularity', a => { a.dimensions[0].granularity = 'MONTH'; }, 'TYPE_MISMATCH'],
]) test(`aggregate validation rejects ${name}`, () => {
  const a = aggregate(); edit(a);
  assert.throws(() => planVisual(request(), { aggregates: [a] }), { code });
});

test('aggregate declarations cannot come from request or imported metadata', () => {
  const r = request(); r.aggregates = [aggregate()];
  assert.throws(() => planVisual(r), { code: 'UNSUPPORTED_FEATURE' });
  delete r.aggregates;
  r.analysis.Definition.aggregates = [aggregate()];
  assert.throws(() => planVisual(r), { code: 'UNSUPPORTED_FEATURE' });
});
