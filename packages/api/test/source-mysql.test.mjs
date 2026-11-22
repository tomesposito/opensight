import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { streamSourceMySql, PrepJoinBudget } from '@opensight/query-engine';
import { sourceFixture, policy } from './source-helpers.mjs';
import { mysqlHarness } from './mysql-harness.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { BlazeTable } from '../dist/blaze.js';

const columns = [{ name: 'tenant', type: 'STRING' }, { name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' },
  { name: 'private', type: 'STRING' }, { name: 'day', type: 'DATETIME' }, { name: 'active', type: 'BOOLEAN' }];
const rows = [['tenant-one', 'east', 10, 'a', '2026-01-01 00:00:00.123', 1], ['tenant-one', 'west', 20, 'b', '2026-01-02 00:00:00.456', 0],
  ['tenant-one', null, 30, 'c', null, null], ['tenant-two', 'east', 999, 'other', '2026-01-01 00:00:00.123', 1]];
const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const principals = [{ type: 'user', id: 'admin' }];
async function fixture(t, connectorId = 'mysql', tenantColumn = 'tenant') {
  const password = randomBytes(24).toString('hex'), harness = await mysqlHarness(t, { columns, rows, password });
  const f = await sourceFixture(t, { endpoints: [{ id: 'reference', connectorId, host: '127.0.0.1', port: harness.port, database: 'opensight', tls: false, ...(tenantColumn ? { tenantColumn } : {}) }] });
  const context = await f.login(), data = new HostedData(f.sources, undefined, f.budgets);
  const create = p => ({ connectorId, endpointId: 'reference', schema: 'opensight', table: 'sales', columns, credentials: { username: 'synthetic', password }, policy: p });
  t.after(() => assert.deepEqual(harness.errors, []));
  return { ...f, context, data, harness, create };
}

for (const connectorId of ['mysql', 'mariadb']) test(`${connectorId} hosted protocol path: discover, schema, direct/cache/visual equality, tenant RLS, CLS and rotation`, async t => {
  const f = await fixture(t, connectorId), { context, data, harness } = f;
  const predicates = [
    { column: 'region', operator: 'eq', value: 'east' },
    { any: [{ column: 'region', operator: 'eq', value: 'west' }, { column: 'region', operator: 'is-null' }] },
    { column: 'day', operator: 'gte', value: '2026-01-02' },
    { column: 'tenant', operator: 'in', values: ['tenant-one', 'tenant-two'] },
    { all: [{ column: 'amount', operator: 'gte', value: 10 }, { column: 'amount', operator: 'lt', value: 30 }] },
  ];
  for (const [i, predicate] of predicates.entries()) {
    const id = `source_${i}`, p = { rowLevel: true, rowRules: [{ id: 'match', principals, predicate }], protectedColumns: ['private'], columnGrants: [] };
    assert.equal((await data.createSource(context, id, f.create(p))).connectorId, connectorId);
    const schema = await data.schema(context, id), discovered = (await data.discover(context)).find(s => s.id === id);
    assert.equal(schema.connectorId, connectorId); assert.equal(discovered.available, true);
    assert.deepEqual(schema.columns, columns.filter(c => c.name !== 'private'));
    assert.deepEqual(discovered.columns, schema.columns);
    const direct = await data.execute(context, id, 'output', {});
    assert.equal(direct.rowCount, [1, 2, 1, 3, 2][i]);
    for (const row of direct.rows) { assert.equal(row.tenant, 'tenant-one'); assert.equal('private' in row, false); }
    assert.equal(JSON.stringify(direct).includes('999'), false);
    await data.refresh(context, id);
    assert.deepEqual(await data.execute(context, id, 'output', { mode: 'BLAZE' }), direct);
    const visual = await data.execute(context, id, 'query', { query });
    assert.deepEqual(await data.execute(context, id, 'query', { query, mode: 'BLAZE' }), visual);
    assert.deepEqual(visual.rows, [{ total: [10, 50, 20, 60, 30][i] }]);
    for (const mode of ['DIRECT_QUERY', 'BLAZE']) {
      const before = harness.queries.length;
      await assert.rejects(data.execute(context, id, 'output', { mode, columns: ['private'] }), { code: 'COLUMN_ACCESS_DENIED' });
      await assert.rejects(data.execute(context, id, 'query', { mode, query: { ...query, calculatedFields: [{ name: 'leak', expression: 'strlen({private})' }], measures: [{ fieldId: 'leak', columnName: 'leak', aggregation: 'SUM' }] } }), { code: 'UNRESOLVED_BINDING' });
      assert.equal(harness.queries.length, before);
    }
    if (i === 0) { assert.equal(direct.rows[0].day, '2026-01-01T00:00:00.123Z'); assert.equal(direct.rows[0].active, true); }
  }
  await data.createSource(context, 'denied', f.create({ rowLevel: true, rowRules: [] }));
  await assert.rejects(data.execute(context, 'denied', 'output', {}), { code: 'ROW_ACCESS_DENIED' });
  await assert.rejects(data.admit(context, 'source_0', 'prep'), { code: 'PREP_SECURITY_REJECTED' });
  const replacement = randomBytes(24).toString('hex');
  await f.sources.rotate(context, 'source_0', { expectedVersion: 1, credentials: { username: 'synthetic', password: replacement } });
  harness.password = replacement;
  await assert.rejects(data.execute(context, 'source_0', 'output', { mode: 'BLAZE' }), { code: 'BLAZE_NOT_READY' });
  assert.deepEqual((await data.execute(context, 'source_0', 'query', { query })).rows, [{ total: 10 }]);
  assert.ok(harness.authentications.every(a => a.accepted));
  assert.ok(harness.sessions.length > 5);
  for (const session of harness.sessions) {
    assert.match(session, /time_zone = '\+00:00'.*STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES,ONLY_FULL_GROUP_BY/);
    assert.match(session, connectorId === 'mysql' ? /utf8mb4_0900_bin.*max_execution_time = 10000/ : /utf8mb4_bin.*max_statement_time = 10/);
  }
  const selects = harness.queries.filter(sql => sql.startsWith('SELECT'));
  for (const sql of selects) {
    assert.match(sql, /`tenant` COLLATE utf8mb4_(?:0900_)?bin = CONVERT\(X'/);
    if (connectorId === 'mariadb') assert.doesNotMatch(sql, /utf8mb4_0900_bin/);
  }
  for (const mode of ['error', 'drop']) {
    harness.mode = mode;
    await assert.rejects(data.execute(context, 'source_0', 'output', {}), error => {
      assert.equal(error.code, 'PREP_EXECUTION_FAILED');
      for (const secret of [replacement, '127.0.0.1', 'synthetic', 'private-host']) assert.equal(String(error).includes(secret), false);
      return true;
    });
  }
});

test('MySQL source can build a dataset and execute its prepared visual through the hosted path', async t => {
  const f = await fixture(t, 'mysql', null), { context, data } = f;
  await data.createSource(context, 'input', f.create(policy));
  const prep = new HostedPrep(data);
  await prep.save(context, 'prepared', { name: 'MySQL dataset', pipeline: { version: 1, input: 'input', steps: [] }, expectedVersion: 0 });
  assert.equal((await prep.get(context, 'prepared')).resource.dataSetId, 'prepared');
  // Hosted prep stages admitted database rows into the shared DuckDB processing path.
  assert.deepEqual((await prep.execute(context, 'prepared', 'query', query)).rows, [{ total: 1059 }]);
});

test('MySQL text binding handles quotes, backslashes, Unicode and question marks as data', async t => {
  const odd = "East'\\ OR 1=1 -- ? ☃", special = [{ name: 'region`?', type: 'STRING' }];
  const harness = await mysqlHarness(t, { columns: special, rows: [[odd], ['other']], password: 'synthetic-password' });
  const read = { source: { id: 'input', connectorId: 'mysql', schema: 'opensight', table: 'sales', columns: special, security: 'protected' }, columns: ['region`?'],
    security: { namespaceId: 'ns', userId: 'admin', users: [{ id: 'admin', namespaceId: 'ns' }], groups: [], policy: { namespaceId: 'ns', dataSetArn: 'input', rowLevel: true, rowRules: [{ id: 'rule', principals, predicate: { column: 'region`?', operator: 'eq', value: odd } }] } } };
  const limits = { maxRows: 5, cellChars: 1000, maxBytes: 100000, datasetBytes: 100000 }, sink = new BlazeTable(limits);
  await streamSourceMySql(read, harness.connection, limits, sink);
  assert.deepEqual(sink.rows(), [{ 'region`?': odd }]);
  assert.equal(harness.queries.some(q => q.includes(odd)), false);
  assert.deepEqual(harness.errors, []);
});

test('MySQL source stream enforces sink bounds, preserves consumer errors, cancels and destroys sockets', async t => {
  const f = await fixture(t), { context, data, harness } = f;
  await data.createSource(context, 'source', f.create(policy));
  const read = data.read(await data.admit(context, 'source', 'query'));
  const limits = { maxRows: 2, cellChars: 1000, maxBytes: 100000, datasetBytes: 100000 };
  for (const mode of ['normal', 'extra-rows', 'oversized']) {
    harness.mode = mode;
    await assert.rejects(streamSourceMySql(read, harness.connection, limits, new BlazeTable(limits)), { code: 'BLAZE_DATASET_TOO_LARGE' });
  }
  harness.mode = 'normal';
  const tiny = { ...limits, maxRows: 10, cellChars: 1 };
  await assert.rejects(streamSourceMySql(read, harness.connection, tiny, new BlazeTable(tiny)), { code: 'BLAZE_DATASET_TOO_LARGE' });
  const sentinel = new Error('sink failure');
  await assert.rejects(streamSourceMySql(read, harness.connection, { ...limits, maxRows: 10 }, { start() {}, row() { throw sentinel; }, oversized() { throw sentinel; } }), e => e === sentinel);
  harness.mode = 'stall';
  const abort = new AbortController(), running = streamSourceMySql(read, harness.connection, limits, new BlazeTable(limits), { signal: abort.signal });
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(running, { code: 'EXECUTION_CANCELLED' });
  await assert.rejects(streamSourceMySql(read, harness.connection, limits, new BlazeTable(limits), { executionMs: 30 }), { code: 'EXECUTION_CANCELLED' });
  const before = harness.authentications.length;
  await assert.rejects(streamSourceMySql(read, harness.connection, limits, new BlazeTable(limits), { signal: abort.signal }), { code: 'EXECUTION_CANCELLED' });
  assert.equal(harness.authentications.length, before);
  for (let i = 0; i < 20 && harness.sockets.size; i++) await delay(5);
  assert.equal(harness.sockets.size, 0);
});

test('MySQL probe contract: diagnostics sample of 10,000 rows plus its probe row passes; dataset reads still oversize on it', async t => {
  const bigColumns = [{ name: 'region', type: 'STRING' }];
  const bigRows = Array.from({ length: 10_001 }, (_, i) => [`region-${i}`]);
  const harness = await mysqlHarness(t, { columns: bigColumns, rows: bigRows, password: 'synthetic-password' });
  const read = { source: { id: 'input', connectorId: 'mysql', schema: 'opensight', table: 'sales', columns: bigColumns, security: 'unrestricted' }, columns: ['region'],
    security: { namespaceId: 'ns', userId: 'admin', users: [{ id: 'admin', namespaceId: 'ns' }], groups: [], policy: { namespaceId: 'ns', dataSetArn: 'input', rowLevel: false, rowRules: [] } } };
  const collecting = () => ({ rows: [], start() {}, row(values) { this.rows.push(values); }, oversized() { throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' }); } });
  const sampled = collecting();
  await streamSourceMySql(read, harness.connection, { maxRows: 10_000, cellChars: 1000, allowProbeRow: true }, sampled);
  assert.equal(sampled.rows.length, 10_001, 'sample rows plus the probe row reach the diagnostics sink');
  await assert.rejects(streamSourceMySql(read, harness.connection, { maxRows: 10_000, cellChars: 1000 }, collecting()), e => e.code === 'TOO_LARGE');
  harness.mode = 'extra-rows';
  await assert.rejects(streamSourceMySql(read, harness.connection, { maxRows: 2, cellChars: 1000, allowProbeRow: true }, collecting()), e => e.code === 'TOO_LARGE', 'a row beyond the probe is still oversized');
  assert.deepEqual(harness.errors, []);
});

test('Hosted join diagnostics bounded sample returns 10,001 rows from a larger MySQL source', async t => {
  const password = randomBytes(24).toString('hex');
  const bigColumns = [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }];
  const bigRows = Array.from({ length: 10_001 }, (_, i) => [`region-${i % 7}`, i]);
  const harness = await mysqlHarness(t, { columns: bigColumns, rows: bigRows, password });
  const f = await sourceFixture(t, { endpoints: [{ id: 'reference', connectorId: 'mysql', host: '127.0.0.1', port: harness.port, database: 'opensight', tls: false }] });
  const context = await f.login(), data = new HostedData(f.sources, undefined, f.budgets);
  await data.createSource(context, 'big', { connectorId: 'mysql', endpointId: 'reference', schema: 'opensight', table: 'sales', columns: bigColumns, credentials: { username: 'synthetic', password }, policy });
  const table = await data.boundedSample(context, await data.admit(context, 'big', 'prep'), new PrepJoinBudget());
  assert.equal(table.rowCount, 10_001);
  assert.deepEqual(harness.errors, []);
});

test('MySQL execution deadline cancels stalled authentication before the independent connection cap', async t => {
  const f = await fixture(t), { context, data, harness } = f;
  await data.createSource(context, 'source', f.create(policy));
  const read = data.read(await data.admit(context, 'source', 'query'));
  const limits = { maxRows: 10, cellChars: 1000, maxBytes: 100000, datasetBytes: 100000 };
  harness.mode = 'stall-auth';
  for (let i = 0; i < 3; i++) {
    await assert.rejects(streamSourceMySql(read, harness.connection, limits, new BlazeTable(limits), { executionMs: 30 }), { code: 'EXECUTION_CANCELLED' });
  }
  assert.equal(harness.queries.length, 0);
  assert.ok(harness.authentications.every(a => a.accepted));
});
