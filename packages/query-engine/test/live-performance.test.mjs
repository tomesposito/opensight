import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { executeLocal, LiveResultCache, liveDatasetCachePrefix, planVisual, refreshLocal } from '@opensight/query-engine';
import { calculation, measure, read, request, temporaryCsv, wells } from './helpers.mjs';

const aggregate = () => ({ name: 'Sales by region', tableName: 'sales_by_region', tableSchema: 'reporting',
  dimensions: [{ columnName: 'region' }], measures: [{ columnName: 'revenue', aggregation: 'SUM' }], countColumn: 'row_count' });
const rowBytes = rows => Buffer.byteLength(JSON.stringify(rows), 'utf8');

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
  assert.equal(cache.stats().retainedBytes, rowBytes(rows));
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
  assert.deepEqual(cache.stats(), { hits: 2, misses: 3, stores: 1, entries: 0, retainedBytes: 0 });
});

test('cache invalidation is prefix-specific or full and keeps cumulative counters', () => {
  const cache = new LiveResultCache();
  cache.set('dataset:a', [{ total: 1 }], 1000);
  cache.set('dataset:b', [{ label: 'longer entry' }], 1000);
  cache.set('other:a', [], 1000);
  cache.invalidate('dataset:');
  assert.equal(cache.stats().entries, 1);
  assert.equal(cache.stats().retainedBytes, rowBytes([]));
  cache.invalidate('absent:');
  assert.equal(cache.stats().retainedBytes, rowBytes([]));
  assert.equal(cache.get('dataset:a'), undefined);
  assert.equal(cache.get('dataset:b'), undefined);
  assert.ok(cache.get('other:a'));
  cache.invalidate();
  assert.equal(cache.get('other:a'), undefined);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 3, stores: 3, entries: 0, retainedBytes: 0 });
  cache.set('after-clear', [], 1000);
  assert.equal(cache.stats().retainedBytes, rowBytes([]));
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
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.stats().retainedBytes, rowBytes([{ total: 2 }]) + rowBytes([]));
  const defaults = new LiveResultCache();
  for (let i = 0; i <= 100; i++) defaults.set(String(i), [], 1000);
  assert.equal(defaults.get('0'), undefined);
  assert.ok(defaults.get('1'));
  assert.equal(defaults.stats().entries, 100);
  assert.equal(defaults.stats().retainedBytes, 100 * rowBytes([]));
});

test('cache evicts heterogeneous rows in store order until the byte budget fits', () => {
  const small = [{ label: 'a' }], medium = [{ label: 'b'.repeat(20) }];
  const newestSmall = [{ label: 'cc' }], large = [{ label: 'd'.repeat(24) }];
  const maxBytes = rowBytes(small) + rowBytes(medium) + rowBytes(newestSmall);
  const cache = new LiveResultCache({ maxBytes, maxEntryBytes: maxBytes });
  let retainedBytes = 0;
  for (const [key, rows] of [['small', small], ['medium', medium], ['newest-small', newestSmall]]) {
    cache.set(key, rows, 1000);
    retainedBytes += rowBytes(rows);
    assert.equal(cache.stats().retainedBytes, retainedBytes);
    assert.ok(cache.stats().retainedBytes <= maxBytes);
  }
  assert.ok(cache.get('small'), 'reads must not change FIFO order');
  cache.set('large', large, 1000);
  assert.equal(cache.get('small'), undefined);
  assert.equal(cache.get('medium'), undefined, 'more than one eviction is needed');
  assert.deepEqual(cache.get('newest-small').rows, newestSmall);
  assert.deepEqual(cache.get('large').rows, large);
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.stats().retainedBytes, rowBytes(newestSmall) + rowBytes(large));
  assert.ok(cache.stats().retainedBytes <= maxBytes);
});

test('cache accounts UTF-8 serialized bytes and accepts exact entry and total limits', () => {
  const rows = [{ label: 'é🙂', total: null }], bytes = rowBytes(rows);
  assert.ok(bytes > JSON.stringify(rows).length, 'UTF-8 bytes differ from JS string length');
  const cache = new LiveResultCache({ maxBytes: bytes * 2, maxEntryBytes: bytes });
  cache.set('one', rows, 1000);
  cache.set('two', rows, 1000);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0, stores: 2, entries: 2, retainedBytes: bytes * 2 });
  assert.deepEqual(cache.get('one').rows, rows);
  assert.deepEqual(cache.get('two').rows, rows);
});

for (const maxBytes of [64, 128]) test(`oversized rows bypass without cloning with total budget ${maxBytes}`, t => {
  const cache = new LiveResultCache({ maxBytes, maxEntryBytes: 64 });
  const rows = [{ label: 'x'.repeat(60) }];
  assert.ok(rowBytes(rows) > 64 && rowBytes(rows) < 128);
  const clone = rows.map = t.mock.fn(() => assert.fail('oversized rows must not be cloned'));
  assert.doesNotThrow(() => cache.set('oversized', rows, 1000));
  rows[0].label = 'changed';
  assert.equal(cache.get('oversized'), undefined);
  assert.equal(clone.mock.callCount(), 0);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 1, stores: 0, entries: 0, retainedBytes: 0 });
});

test('cache replacements release old bytes before eviction and use the latest size', () => {
  const old = [{ label: 'x'.repeat(20) }], small = [{ label: 'x' }], other = [{ total: 1 }];
  const maxBytes = rowBytes(old) + rowBytes(other);
  const cache = new LiveResultCache({ maxBytes, maxEntryBytes: maxBytes });
  cache.set('other', other, 1000);
  cache.set('replaced', old, 1000);
  for (const rows of [small, old]) {
    cache.set('replaced', rows, 1000);
    assert.deepEqual(cache.get('replaced').rows, rows);
    assert.deepEqual(cache.get('other').rows, other, 'replacement must not evict a still-fitting entry');
    assert.equal(cache.stats().entries, 2);
    assert.equal(cache.stats().retainedBytes, rowBytes(rows) + rowBytes(other));
  }
  cache.set('replaced', [{ label: 'x'.repeat(maxBytes) }], 1000);
  assert.equal(cache.get('replaced'), undefined, 'oversized replacement must not serve the old value');
  assert.deepEqual(cache.get('other').rows, other, 'bypass must not evict unrelated rows');
  assert.equal(cache.stats().entries, 1);
  assert.equal(cache.stats().retainedBytes, rowBytes(other));
  assert.equal(cache.stats().stores, 4);
});

test('insertion purges every expired entry before eviction without reading its key', () => {
  let now = 1000;
  const rows = [{ total: 1 }], maxBytes = rowBytes(rows) * 3;
  const cache = new LiveResultCache({ now: () => now, maxEntries: 3, maxBytes, maxEntryBytes: maxBytes });
  cache.set('live-oldest', rows, 100);
  cache.set('expired-a', rows, 10);
  cache.set('expired-b', rows, 10);
  now = 1010;
  cache.set('new', rows, 100);
  now = 1000; // Ensure stats/get cannot hide a missing insertion purge by expiring entries themselves.
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0, stores: 4, entries: 2, retainedBytes: rowBytes(rows) * 2 });
  assert.deepEqual(cache.get('live-oldest').rows, rows);
  assert.deepEqual(cache.get('new').rows, rows);
  assert.equal(cache.get('expired-a'), undefined);
  assert.equal(cache.get('expired-b'), undefined);
});

test('oversized insertion still purges expired entries and invalid TTL leaves the cache untouched', () => {
  let now = 1000;
  const cache = new LiveResultCache({ now: () => now, maxBytes: 32, maxEntryBytes: 32 });
  cache.set('expired', [], 10);
  now = 1010;
  assert.throws(() => cache.set('expired', [], 0), { code: 'INVALID_INPUT' });
  now = 1000;
  assert.ok(cache.get('expired'), 'TTL validation precedes maintenance or replacement');
  now = 1010;
  cache.set('oversized', [{ label: 'x'.repeat(32) }], 100);
  now = 1000;
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0, stores: 1, entries: 0, retainedBytes: 0 });
  assert.equal(cache.get('expired'), undefined);
});

test('stats reports only live entries without changing cumulative counters', () => {
  let now = 1000;
  const cache = new LiveResultCache({ now: () => now });
  cache.set('short', [], 10);
  cache.set('long', [{ total: 2 }], 100);
  now = 1010;
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0, stores: 2, entries: 1, retainedBytes: rowBytes([{ total: 2 }]) });
});

test('serialization failures bypass caching without cloning or keeping stale replacements', t => {
  const circular = []; circular.push(circular);
  for (const rows of [circular, [{ total: 1n }], Object.assign([], { toJSON: () => { throw new Error('cannot serialize'); } }),
    Object.assign([], { toJSON: () => undefined })]) {
    const cache = new LiveResultCache();
    cache.set('key', [], 1000);
    const clone = rows.map = t.mock.fn(() => assert.fail('unaccountable rows must not be cloned'));
    assert.doesNotThrow(() => cache.set('key', rows, 1000));
    assert.equal(clone.mock.callCount(), 0);
    assert.equal(cache.get('key'), undefined);
    assert.deepEqual(cache.stats(), { hits: 0, misses: 1, stores: 1, entries: 0, retainedBytes: 0 });
  }
});

test('nonfinite or unsafe byte estimates bypass caching', t => {
  for (const byteLength of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const encode = t.mock.method(TextEncoder.prototype, 'encode', () => ({ byteLength }));
    const cache = new LiveResultCache();
    assert.doesNotThrow(() => cache.set('key', [], 1000));
    assert.equal(cache.get('key'), undefined);
    assert.deepEqual(cache.stats(), { hits: 0, misses: 1, stores: 0, entries: 0, retainedBytes: 0 });
    encode.mock.restore();
  }
});

test('cache limits and TTL reject invalid values with named errors', async () => {
  for (const invalid of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, true, {}]) {
    for (const option of ['maxEntries', 'maxBytes', 'maxEntryBytes']) {
      assert.throws(() => new LiveResultCache({ [option]: invalid }), { code: 'INVALID_INPUT' });
    }
    const cache = new LiveResultCache();
    assert.throws(() => cache.set('key', [], invalid), { code: 'INVALID_INPUT' });
    await assert.rejects(executeLocal(request(), { dataRoot: '/absent', liveCache: { cache, ttlMs: invalid } }), { code: 'INVALID_INPUT' });
  }
});

test('cache per-entry budget must fit the total budget, including defaults', () => {
  assert.throws(() => new LiveResultCache({ maxBytes: 100, maxEntryBytes: 101 }), { code: 'INVALID_INPUT' });
  assert.throws(() => new LiveResultCache({ maxBytes: 8 * 1024 * 1024 - 1 }), { code: 'INVALID_INPUT' });
  assert.throws(() => new LiveResultCache({ maxEntryBytes: 32 * 1024 * 1024 + 1 }), { code: 'INVALID_INPUT' });
  assert.doesNotThrow(() => new LiveResultCache({ maxBytes: 100, maxEntryBytes: 100 }));
  assert.doesNotThrow(() => new LiveResultCache({ maxBytes: 8 * 1024 * 1024 }));
  assert.doesNotThrow(() => new LiveResultCache({ maxEntryBytes: 32 * 1024 * 1024 }));
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
