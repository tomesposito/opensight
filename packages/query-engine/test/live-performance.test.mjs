import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { executeLocal, LiveResultCache, liveDatasetCachePrefix, planVisual, refreshLocal } from '@opensight/query-engine';
import { calculation, measure, read, request, temporaryCsv, wells } from './helpers.mjs';

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
  assert.match(p.sql, /COALESCE\(SUM\("row_count"\), 0\) AS "revenue"/);
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

test('cache isolates rows, records stats, and drops entries at the TTL boundary', () => {
  let now = 1000;
  const cache = new LiveResultCache({ now: () => now });
  assert.equal(cache.get('one'), undefined);
  const rows = [{ total: 1 }];
  cache.set('one', rows, 100);
  rows[0].total = 99;
  const cached = cache.get('one');
  assert.deepEqual(cached, { rows: [{ total: 1 }], cachedAt: new Date(1000).toISOString() });
  cached.rows[0].total = 88;
  now = 1099;
  assert.equal(cache.get('one').rows[0].total, 1);
  now = 1100;
  assert.equal(cache.get('one'), undefined);
  now = 1000;
  assert.equal(cache.get('one'), undefined, 'expired entry was dropped');
  assert.deepEqual(cache.stats(), { hits: 2, misses: 3, stores: 1 });
});

test('cache invalidation is prefix-specific or full and keeps cumulative counters', () => {
  const cache = new LiveResultCache();
  for (const key of ['dataset:a', 'dataset:b', 'other:a']) cache.set(key, [], 1000);
  cache.invalidate('dataset:');
  assert.equal(cache.get('dataset:a'), undefined);
  assert.equal(cache.get('dataset:b'), undefined);
  assert.ok(cache.get('other:a'));
  cache.invalidate();
  assert.equal(cache.get('other:a'), undefined);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 3, stores: 3 });
  assert.ok(JSON.stringify(['arn:a', 'visual']).startsWith(liveDatasetCachePrefix('arn:a')));
  assert.ok(!JSON.stringify(['arn:ab', 'visual']).startsWith(liveDatasetCachePrefix('arn:a')));
});

test('bounded cache evicts oldest store, independent of reads, and replaces existing keys', () => {
  const cache = new LiveResultCache({ maxEntries: 2 });
  cache.set('first', [], 1000); cache.set('second', [], 1000);
  cache.get('first'); cache.set('third', [], 1000);
  assert.equal(cache.get('first'), undefined);
  cache.set('second', [{ total: 2 }], 1000);
  assert.ok(cache.get('third'));
  cache.set('fourth', [], 1000);
  assert.equal(cache.get('third'), undefined);
  assert.deepEqual(cache.get('second').rows, [{ total: 2 }]);
  const defaults = new LiveResultCache();
  for (let i = 0; i <= 100; i++) defaults.set(String(i), [], 1000);
  assert.equal(defaults.get('0'), undefined);
  assert.ok(defaults.get('1'));
});

test('cache limits and TTL reject invalid values with named errors', async () => {
  for (const invalid of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) {
    assert.throws(() => new LiveResultCache({ maxEntries: invalid }), { code: 'INVALID_INPUT' });
    const cache = new LiveResultCache();
    assert.throws(() => cache.set('key', [], invalid), { code: 'INVALID_INPUT' });
    await assert.rejects(executeLocal(request(), { dataRoot: '/absent', liveCache: { cache, ttlMs: invalid } }), { code: 'INVALID_INPUT' });
  }
});

test('local execution caches only by opt-in, replans hits, and refresh invalidates every dataset visual', async t => {
  const r = request(), file = read('sales.csv'), options = temporaryCsv(t, file);
  const cache = new LiveResultCache({ now: () => 1000 });
  options.liveCache = { cache, ttlMs: 1000 };
  const first = await executeLocal(r, options);
  assert.deepEqual(first.provenance, { source: 'live' });
  await executeLocal({ ...r, visualId: 'revenue-by-region' }, options);
  cache.set(JSON.stringify(['unrelated-dataset', 'visual']), [], 1000);
  writeFileSync(join(options.dataRoot, 'sales.csv'), file + '9,2025-04-01,East,Hardware,10,2\n');
  const second = await executeLocal(r, options);
  assert.deepEqual(second.rows, first.rows);
  assert.notEqual(second.plan, first.plan);
  assert.deepEqual(second.provenance, { source: 'cache', cachedAt: new Date(1000).toISOString() });
  const invalid = structuredClone(r); wells(invalid).Values[0].NumericalMeasureField.Column.ColumnName = 'missing';
  await assert.rejects(executeLocal(invalid, options), { code: 'UNRESOLVED_BINDING' });
  assert.equal(await refreshLocal(r, options), 9);
  const refreshed = await executeLocal(r, options);
  assert.deepEqual(refreshed.provenance, { source: 'live' });
  assert.deepEqual(refreshed.rows, [{ revenue: 510 }]);
  assert.equal((await executeLocal({ ...r, visualId: 'revenue-by-region' }, options)).provenance.source, 'live');
  assert.ok(cache.get(JSON.stringify(['unrelated-dataset', 'visual'])));
  assert.deepEqual((await executeLocal(r, { dataRoot: options.dataRoot })).provenance, { source: 'live' });
});

test('security contexts never read or populate cache, even without active protections', async t => {
  const r = request(), options = temporaryCsv(t, read('sales.csv'));
  const cache = new LiveResultCache(); options.liveCache = { cache, ttlMs: 1000 };
  await executeLocal(r, options);
  const before = cache.stats();
  r.security = { namespaceId: 'default', userId: 'alice', users: [{ id: 'alice', namespaceId: 'default' }], groups: [],
    policy: { namespaceId: 'default', dataSetArn: r.localData.dataSetArn, rowLevel: false, rowRules: [] } };
  assert.equal(planVisual(r).securityProtected, undefined);
  writeFileSync(join(options.dataRoot, 'sales.csv'), read('sales.csv') + '9,2025-04-01,East,Hardware,10,2\n');
  for (let i = 0; i < 2; i++) {
    const result = await executeLocal(r, options);
    assert.deepEqual(result.provenance, { source: 'live' });
    assert.deepEqual(result.rows, [{ revenue: 510 }]);
  }
  assert.deepEqual(cache.stats(), before);
  r.localData.security.dataset = 'protected';
  r.security.policy.rowLevel = true;
  r.security.policy.rowRules = [{ id: 'east', predicate: { column: 'region', operator: 'eq', value: 'East' }, principals: [{ type: 'user', id: 'alice' }] }];
  assert.equal(planVisual(r, { aggregates: [aggregate()] }).executionSource.kind, 'source');
  assert.equal((await executeLocal(r, options)).provenance.source, 'live');
  assert.deepEqual(cache.stats(), before);
});

test('cached SQL rows use fresh shared post-processing when calculations change', async t => {
  const r = request('revenue-by-region'); r.analysis.Definition.FilterGroups = [];
  calculation(r, 'sumOver(sum({revenue}), [], POST_AGG_FILTER)');
  const cache = new LiveResultCache(), options = { ...temporaryCsv(t, read('sales.csv')), liveCache: { cache, ttlMs: 1000 } };
  const first = await executeLocal(r, options);
  assert.deepEqual(first.rows, [{ region: 'East', calculated: 900 }, { region: 'West', calculated: 900 }]);
  r.analysis.Definition.CalculatedFields.at(-1).Expression = 'sumOver(sum({revenue}), [], POST_AGG_FILTER) * 2';
  const second = await executeLocal(r, options);
  assert.equal(second.plan.sql, first.plan.sql);
  assert.equal(second.provenance.source, 'cache');
  assert.deepEqual(second.rows, [{ region: 'East', calculated: 1800 }, { region: 'West', calculated: 1800 }]);
});

test('cache keys separate parameter values and datasets; expiry and failed refresh cannot serve stale rows', async t => {
  let now = 1000;
  const cache = new LiveResultCache({ now: () => now });
  const r = request(), options = { ...temporaryCsv(t, read('sales.csv')), liveCache: { cache, ttlMs: 100 } };
  await executeLocal(r, options);
  const west = structuredClone(r);
  west.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['West'];
  const result = await executeLocal(west, options);
  assert.equal(result.provenance.source, 'live');
  assert.deepEqual(result.rows, [{ revenue: 400 }]);
  const other = structuredClone(r), arn = r.localData.dataSetArn + '-other';
  other.localData.dataSetArn = arn;
  other.dataSet.DataSet.Arn = arn;
  other.analysis.Definition.DataSetIdentifierDeclarations[0].DataSetArn = arn;
  assert.equal((await executeLocal(other, options)).provenance.source, 'live');
  writeFileSync(join(options.dataRoot, 'sales.csv'), read('sales.csv') + '9,2025-04-01,East,Hardware,10,2\n');
  now += 100;
  assert.deepEqual((await executeLocal(r, options)).rows, [{ revenue: 510 }]);
  writeFileSync(join(options.dataRoot, 'sales.csv'), 'bad,header\n');
  await assert.rejects(refreshLocal(r, options), { code: 'LOCAL_DATA_ERROR' });
  await assert.rejects(executeLocal(r, options), { code: 'LOCAL_DATA_ERROR' });
});

test('embedded Postgres aggregate results agree with the source across grains, dates, filters and empty COUNT', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE sales (order_id BIGINT, order_date TIMESTAMP, region TEXT, category TEXT, revenue DOUBLE PRECISION, profit DOUBLE PRECISION)');
  for (const line of read('sales.csv').trim().split('\n').slice(1)) await pg.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)', line.split(',').map(v => v === '' ? null : v));
  await pg.exec("CREATE SCHEMA reporting; CREATE TABLE reporting.sales_rollup AS SELECT region, date_trunc('month', order_date) AS order_date, SUM(revenue) AS revenue, COUNT(*) AS row_count FROM sales GROUP BY 1, 2");
  const a = aggregate(); a.tableName = 'sales_rollup'; a.dimensions.push({ columnName: 'order_date', granularity: 'MONTH' });
  for (const visualId of ['total-revenue', 'revenue-by-region', 'revenue-trend']) {
    const r = request(visualId);
    for (const filters of [r.analysis.Definition.FilterGroups, []]) {
      r.analysis.Definition.FilterGroups = filters;
      const source = planVisual(r, { dialect: 'postgres' }), rollup = planVisual(r, { dialect: 'postgres', aggregates: [a] });
      assert.equal(rollup.executionSource.kind, 'aggregate');
      assert.deepEqual((await pg.query(rollup.sql, [...rollup.parameters])).rows, (await pg.query(source.sql, [...source.parameters])).rows);
      assert.deepEqual((await pg.query(rollup.sql, [...rollup.parameters])).rows, (await executeLocal(r, temporaryCsv(t, read('sales.csv')))).rows);
    }
  }
  for (const visualId of ['total-revenue', 'revenue-by-region']) {
    const r = request(visualId); wells(r).Values = [measure('order_id', 'COUNT', 'orders')];
    for (const region of ['East', 'No matching region']) {
      r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = [region];
      const source = planVisual(r, { dialect: 'postgres' }), rollup = planVisual(r, { dialect: 'postgres', aggregates: [a] });
      assert.equal(rollup.executionSource.kind, 'aggregate');
      // PGlite returns NUMERIC SUM(bigint) as text; the executor normalizes safe counts.
      const counts = async plan => (await pg.query(plan.sql, [...plan.parameters])).rows.map(row => ({ ...row, orders: row.orders === null ? null : Number(row.orders) }));
      assert.deepEqual(await counts(rollup), await counts(source));
    }
  }
});
