import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, upload, policy } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedDataRoutes } from '../dist/hosted-data-routes.js';
import { HostedDashboards } from '../dist/hosted-dashboards.js';
import { changeDashboard, describeDashboard, dashboardVersion } from '../dist/dashboard-model.js';

const denied = { code: 'DASHBOARD_DATASET_ACCESS_DENIED', status: 403 };
const simple = input => ({ version: 1, input, steps: [] });
const joined = { version: 1, input: { dataset: 'left' }, steps: [
  { id: 'join', kind: 'join', config: { source: { dataset: 'right' }, joinType: 'inner', keys: [{ left: 'region', right: 'region' }], prefix: 'r_' } },
  { id: 'sum', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'amount', aggregation: 'SUM' }] } },
] };
const definition = { dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:sales' }],
  sheets: [{ sheetId: 'sheet', visuals: [{ kpiVisual: { visualId: 'total', chartConfiguration: { fieldWells: { values: [
    { numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'sales', columnName: 'amount' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } },
  ] } } } }] }], calculatedFields: [], filterGroups: [] };

async function fixture(t, { missingRight = false, pipeline = joined } = {}) {
  const f = await sourceFixture(t), data = new HostedData(f.sources, undefined, f.budgets), routes = new HostedDataRoutes(data);
  const login = (user = 'admin', ns = 'one') => f.login(ns, user);
  const file = async (user, id, csv, p = policy, ns = 'one') => {
    const source = await f.sources.upload(await login(user, ns), { ...upload(p), base64: Buffer.from(csv).toString('base64') });
    const c = await login(user, ns), old = await f.metadata.get(c, f.sources.key(c, 'source', source.id));
    await f.metadata.batch(c, [{ key: { kind: 'source', id, ownerId: user }, body: old.body, expectedVersion: 0 }, { key: f.sources.key(c, 'source', source.id), body: null, expectedVersion: 1 }]);
  };
  const save = async (id, pipeline, user = 'admin', ns = 'one') => routes.prep.save(await login(user, ns), id, { name: id, pipeline, expectedVersion: 0 });
  const publish = async (ns = 'one') => {
    const record = changeDashboard(undefined, { kind: 'publish', create: true, dashboardId: 'daily', publishedAt: '2026-10-28T00:00:00.000Z', errors: [],
      source: { id: 'analysis', name: 'Daily', version: 1, definition, datasetBindings: { sales: { kind: 'prepared-dataset', id: 'sales' } } } }, 'admin');
    await f.metadata.put(await login('admin', ns), { kind: 'dashboard', id: 'daily' }, { definition: describeDashboard(record), published: record, folderId: null,
      datasets: [{ kind: 'prepared-dataset', id: 'sales', ownerId: 'admin' }], grants: [{ principal: { type: 'user', id: 'other' }, role: 'viewer' }] });
  };
  const role = async (ns = 'one') => f.metadata.put(await login('admin', ns), { kind: 'user', id: 'other' }, { name: 'Reader', role: 'reader' }, 1);
  await file('admin', 'orders', 'region,amount\neast,1000\nwest,2000\nowner-only,900000\n');
  await file('admin', 'regions', 'region\neast\nwest\nowner-only\n');
  await file('other', 'orders', 'region,amount\neast,4\nwest,6\nreader-unmatched,100\n');
  if (!missingRight) await file('other', 'regions', 'region\neast\nwest\n');
  await save('left', simple('orders')); await save('right', simple('regions')); await save('sales', pipeline);
  await publish(); await role();
  const backend = async (user = 'other', ns = 'one') => {
    const c = await login(user, ns); data.begin(c);
    return new HostedDashboards(routes, c, async () => {});
  };
  const query = async (user = 'other', ns = 'one') => {
    const b = await backend(user, ns), v = dashboardVersion(await b.get('daily'));
    return b.query(v, v.wireDefinition, 'total');
  };
  return { ...f, data, routes, login, file, save, publish, role, backend, query };
}

test('Issue 155: reader executes the publisher recipe, including nested joins and aggregation, on reader sources', async t => {
  const f = await fixture(t);
  // Same-ID reader recipes must NOT replace the publisher's recipe. The recipe
  // above joins away reader-unmatched; this substitution would return 110.
  const c = await f.login('other');
  await f.db.transaction(async db => {
    const owner = await db.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'prepared-dataset' AND owner_id = 'admin' AND resource_id = 'left'", [c.tenantId, c.namespaceId]);
    const body = JSON.parse(owner[0].body); body.resource.dataSetId = 'sales';
    await db.query("INSERT INTO h1_resources (tenant_id,namespace_id,kind,owner_id,resource_id,body,version) VALUES (?,?,'prepared-dataset','other','sales',?,1)", [c.tenantId, c.namespaceId, JSON.stringify(body)]);
  });
  const reads = [], original = f.sources.payload.bind(f.sources);
  f.sources.payload = (c, s) => { reads.push([c.tenantId, c.userId, s.id]); return original(c, s); };
  assert.deepEqual((await f.query()).rows, [{ value: 10 }]);
  assert.deepEqual(reads, [['tenant-one', 'other', 'orders'], ['tenant-one', 'other', 'regions']]);
  await assert.rejects(f.metadata.get(await f.login('other'), { kind: 'prepared-dataset', id: 'sales', ownerId: 'admin' }), { code: 'RESOURCE_NOT_FOUND' });
});

test('Issue 155: one missing joined source denies before payload I/O, with no owner-source fallback', async t => {
  const f = await fixture(t, { missingRight: true });
  f.sources.payload = async () => assert.fail('Denied graphs must not open any source');
  await assert.rejects(f.query(), denied);
});

test('Issue 155: source authorization on unused branches, append inputs and nested step inputs cannot be bypassed', async t => {
  for (const pipeline of [
    { ...simple('orders'), steps: [{ id: 'keep', kind: 'select', config: { columns: ['region', 'amount'] } },
      { id: 'hidden', kind: 'join', config: { source: { dataset: 'right' }, joinType: 'left', keys: [{ left: 'region', right: 'region' }], prefix: 'r_' } }], output: 'keep' },
    { ...simple('regions'), steps: [{ id: 'append', kind: 'append', config: { source: 'regions' } }] },
    { ...joined, steps: [joined.steps[0], { ...joined.steps[1], config: { ...joined.steps[1].config, groupBy: ['region'] } },
      { id: 'branch', from: 'join', kind: 'join', config: { source: { step: 'sum' }, joinType: 'left', keys: [{ left: 'region', right: 'region' }], prefix: 's_' } }] },
  ]) {
    const f = await fixture(t, { missingRight: true, pipeline });
    f.sources.payload = async () => assert.fail('Denied branches must not read payloads');
    await assert.rejects(f.query(), denied);
  }
});

test('Issue 155: owner root and nested Blaze artifacts are populated but never read or refreshed by a reader', async t => {
  const f = await fixture(t);
  await f.routes.prep.configure(await f.login(), 'left', { expectedVersion: 1, mode: 'BLAZE', intervalMinutes: null });
  await f.routes.prep.execute(await f.login(), 'left', 'refresh');
  await f.routes.prep.execute(await f.login(), 'sales', 'refresh');
  assert.equal(f.data.cache.countTenant('tenant-one'), 2);
  assert.deepEqual((await f.query('admin')).rows, [{ value: 903000 }]);
  f.data.cache.read = () => assert.fail('Reader must not consume any cached artifact, including nested outputs');
  f.data.cache.refresh = async () => assert.fail('Reader execution must not write publisher artifacts');
  assert.deepEqual((await f.query()).rows, [{ value: 10 }]);
});

test('Issue 155: reader RLS is applied before joins and aggregation; denied columns cannot be recovered through prep', async t => {
  const f = await fixture(t);
  const c = await f.login('other'), key = f.sources.key(c, 'source', 'orders'), source = await f.metadata.get(c, key);
  const rowPolicy = { rowLevel: true, rowRules: [{ id: 'east', principals: [{ type: 'user', id: 'other' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] };
  // Trusted policy administration; readers never get a policy-edit HTTP capability.
  await f.db.transaction(db => db.query("UPDATE h1_resources SET body = ?, version = version + 1 WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source' AND owner_id = 'other' AND resource_id = 'orders'", [JSON.stringify({ ...source.body, policy: rowPolicy }), c.tenantId, c.namespaceId]));
  assert.deepEqual((await f.query()).rows, [{ value: 4 }]);
  await f.db.transaction(db => db.query("UPDATE h1_resources SET body = ?, version = version + 1 WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source' AND owner_id = 'other' AND resource_id = 'orders'", [JSON.stringify({ ...source.body, policy: { ...rowPolicy, protectedColumns: ['amount'], columnGrants: [] } }), c.tenantId, c.namespaceId]));
  await assert.rejects(f.query(), denied);
});

test('Issue 155: revoking a source after publication or during execution denies instead of serving stale/partial data', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.query()).rows, [{ value: 10 }]);
  const c = await f.login('other'), source = await f.metadata.get(c, f.sources.key(c, 'source', 'regions'));
  const revoke = () => f.db.transaction(async db => {
    await db.query("UPDATE h1_resources SET body = ?, version = version + 1 WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source' AND owner_id = 'other' AND resource_id = 'regions'", [JSON.stringify({ ...source.body, policy: { rowLevel: true, rowRules: [] } }), c.tenantId, c.namespaceId]);
    await db.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ? AND namespace_id = ?', [c.tenantId, c.namespaceId]);
  });
  // This mutation is trusted setup; exercise the same source revision/policy
  // update that invalidates all admitted graph snapshots.
  const original = f.sources.payload.bind(f.sources); let revoked = false;
  f.sources.payload = async (context, source) => { const result = await original(context, source); if (!revoked) { revoked = true; await revoke(); } return result; };
  await assert.rejects(f.query(), denied);
  f.sources.payload = original;
  await assert.rejects(f.query(), denied);
});

test('Issue 155: tenant isolation and fabricated published versions remain closed even with identical IDs', async t => {
  const f = await fixture(t), a = await f.backend(), av = dashboardVersion(await a.get('daily'));
  // The other tenant has all the same identities, recipe IDs and dashboard ID,
  // but its reader lacks regions. Tenant A's source/cache cannot fill that gap.
  await f.file('admin', 'orders', 'region,amount\neast,900\n', policy, 'two');
  await f.file('admin', 'regions', 'region\neast\n', policy, 'two');
  await f.file('other', 'orders', 'region,amount\neast,7\n', policy, 'two');
  await f.save('left', simple('orders'), 'admin', 'two'); await f.save('right', simple('regions'), 'admin', 'two'); await f.save('sales', joined, 'admin', 'two');
  await f.publish('two'); await f.role('two');
  const b = await f.backend('other', 'two');
  await assert.rejects(b.query(av, av.wireDefinition, 'total'), denied);
  await assert.rejects(a.query(structuredClone(av), av.wireDefinition, 'total'), denied);
  await assert.rejects(f.query('other', 'two'), denied);
  // A forged TenantContext cannot opt into the other tenant either.
  await assert.rejects(f.routes.prep.readerDashboardVisual({ ...await f.login('other'), tenantId: 'tenant-two' }, 'admin', 'sales', {}, 'total', 'urn:synthetic:sales'), denied);
});

test('Issue 155: unsupported or cyclic stored recipe shapes fail with the dashboard denial', async t => {
  const f = await fixture(t), c = await f.login(), key = { kind: 'prepared-dataset', ownerId: 'admin', id: 'right' }, original = await f.metadata.get(c, key);
  for (const pipeline of [simple({ dataset: 'sales' }), { ...simple('regions'), steps: [{ id: 'unknown', kind: 'customSql', config: { sql: 'select * from owner_data' } }] }]) {
    await f.db.transaction(db => db.query("UPDATE h1_resources SET body = ? WHERE tenant_id = ? AND namespace_id = ? AND kind = 'prepared-dataset' AND owner_id = 'admin' AND resource_id = 'right'", [JSON.stringify({ ...original.body, resource: { ...original.body.resource, opensightPrep: pipeline } }), c.tenantId, c.namespaceId]));
    await assert.rejects(f.query(), denied);
  }
});
