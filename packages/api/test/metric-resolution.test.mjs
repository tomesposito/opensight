import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog } from '../dist/asset-model.js';
import { MetricCatalog } from '../dist/metric-model.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { insertResource } from '../dist/metadata-resources.js';
import { TenantMetadata } from '../dist/metadata.js';

const scope = { tenantId: 'tenant', namespaceId: 'workspace' };
const legacy = { kind: 'dataset', id: 'sales' };
const prepared = (id = 'sales', ownerId = 'owner') => ({ kind: 'prepared-dataset', id, ownerId });
const schema = { columns: [{ name: 'amount', type: 'DECIMAL' }] };
const definition = name => ({ name, expression: '{amount}', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] });
const recipe = (id, input, steps = [], ownerId = 'owner') => ({ ...prepared(id, ownerId), version: 1, body: { resource: {
  resourceType: 'dataset', dataSetId: id, name: id, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input, steps },
} } });

async function fixture(t) {
  const db = new SqliteMetadataDatabase(':memory:'); t.after(() => db.close());
  await initializeMetadata(db);
  const resources = [
    ...['admin', 'owner', 'editor', 'peer', 'reader'].map(id => ({ kind: 'user', id, version: 1, body: { name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' } })),
    { kind: 'source', id: 'source', ownerId: 'owner', version: 1, body: { binding: {} } },
    { ...legacy, version: 1, body: { definition: { OutputColumns: [{ Name: 'amount', Type: 'DECIMAL' }] }, sources: [{ kind: 'source', id: 'source', ownerId: 'owner' }] } },
    { kind: 'dataset', id: 'other', version: 1, body: { definition: {}, sources: [] } },
    recipe('leaf', 'source'),
    recipe('append', { dataset: 'leaf' }, [{ id: 'append', kind: 'append', config: { source: 'source' } }]),
    recipe('joined', { dataset: 'append' }, [{ id: 'join', kind: 'join', config: { source: 'source', joinType: 'left', keys: [{ left: 'amount', right: 'amount' }], prefix: 'r_' } }]),
    recipe('sales', { dataset: 'joined' }),
    recipe('sales', 'source', [], 'peer'),
    { kind: 'source', id: 'source', ownerId: 'peer', version: 1, body: { binding: {} } },
  ];
  const catalog = userId => new MetricCatalog(new AssetCatalog({ ...scope, userId }, resources));
  for (const [suffix, ref] of [['legacy', legacy], ['prepared', prepared()], ['other', { kind: 'dataset', id: 'other' }], ['peer', prepared('sales', 'peer')]]) {
    const c = catalog('admin');
    c.create(`published-${suffix}`, ref, definition(`Published ${suffix}`), schema);
    c.publish(`published-${suffix}`, 1, schema);
    c.edit(`published-${suffix}`, 2, { ...definition(`Published ${suffix}`), expression: '{amount} * 2' }, schema);
    catalog('editor').create(`draft-${suffix}`, ref, definition(`Draft ${suffix}`), schema);
  }
  await db.transaction(async c => {
    await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES (?, 'active', 1)", [scope.tenantId]);
    await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [scope.namespaceId, scope.tenantId, 'Workspace']);
    await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [scope.tenantId, scope.namespaceId]);
    for (const { body, version, ...key } of resources) await insertResource(c, scope, key, body, version);
  });
  const reads = [];
  const tracked = { transaction: (work, context) => db.transaction(c => work({ query: async (sql, values) => {
    const rows = await c.query(sql, values); reads.push({ sql, values, rows }); return rows;
  } }), context) };
  const metadata = new TenantMetadata(tracked, db);
  const login = (userId = 'admin') => metadata.authenticate(null, async () => ({ namespaceId: scope.namespaceId, userId }));
  const old = (context, ref, method) => metadata.assetTransaction(context, false, a => new MetricCatalog(a)[method](ref));
  return { db, metadata, login, old, reads };
}

test('targeted metrics: execution and vocabulary match the full catalog, including drafts, owners and join chains', async t => {
  const f = await fixture(t);
  for (const user of ['admin', 'owner', 'editor', 'peer', 'reader']) {
    const context = await f.login(user);
    for (const ref of [legacy, prepared(), prepared('append'), prepared('sales', 'peer')]) {
      const actual = await f.metadata.metricExecution(context, ref);
      assert.deepEqual(actual, await f.old(context, ref, 'execution'));
      assert.deepEqual(await f.metadata.metricVocabulary(context, ref), await f.old(context, ref, 'vocabulary'));
      assert.equal(actual.unsafeJoin, ref.kind === 'prepared-dataset' && ref.id === 'sales' && ref.ownerId === 'owner');
      assert.ok(actual.metrics.every(m => m.id.startsWith('published-') && m.version === 2 && m.expression === '{amount}'));
    }
  }
  const peer = await f.login('peer');
  await assert.rejects(f.metadata.assetTransaction(peer, false, a => new MetricCatalog(a).get('draft-legacy')), { code: 'METRIC_NOT_FOUND' });
  assert.deepEqual((await f.metadata.metricExecution(peer, legacy)).metrics.map(m => m.id), ['published-legacy']);
});

test('targeted metrics: missing datasets and cyclic prep retain catalog errors and vocabulary short circuits', async t => {
  const f = await fixture(t), context = await f.login();
  for (const ref of [{ kind: 'dataset', id: 'missing' }, prepared('missing')]) {
    await assert.rejects(f.old(context, ref, 'execution'), { code: 'METRIC_DATASET_NOT_FOUND', status: 404 });
    await assert.rejects(f.metadata.metricExecution(context, ref), { code: 'METRIC_DATASET_NOT_FOUND', status: 404 });
    assert.deepEqual(await f.metadata.metricVocabulary(context, ref), await f.old(context, ref, 'vocabulary'));
  }
  await f.db.transaction(async c => {
    for (const { body, version, ...key } of [recipe('cycle-a', { dataset: 'cycle-b' }), recipe('cycle-b', { dataset: 'cycle-a' })]) await insertResource(c, scope, key, body, version);
  });
  await assert.rejects(f.old(context, prepared('cycle-a'), 'execution'), { code: 'METRIC_DATASET_CYCLE', status: 422 });
  await assert.rejects(f.metadata.metricExecution(context, prepared('cycle-a')), { code: 'METRIC_DATASET_CYCLE', status: 422 });
  assert.deepEqual(await f.metadata.metricVocabulary(context, prepared('cycle-a')), []);
});

test('targeted metrics: checked admission rejects forged contexts, revised authorization, removed principals and suspended tenants', async t => {
  const f = await fixture(t), context = await f.login('reader');
  for (const method of ['metricExecution', 'metricVocabulary']) {
    for (const bad of [undefined, null, {}, { ...context }]) await assert.rejects(f.metadata[method](bad, legacy), { code: 'TENANT_CONTEXT_REQUIRED' });
  }
  await f.db.transaction(c => c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1'));
  for (const method of ['metricExecution', 'metricVocabulary']) await assert.rejects(f.metadata[method](context, legacy), { code: 'AUTHORIZATION_REVISED' });
  const fresh = await f.login('reader');
  await f.db.transaction(c => c.query("DELETE FROM h1_resources WHERE kind = 'user' AND resource_id = 'reader'"));
  for (const method of ['metricExecution', 'metricVocabulary']) await assert.rejects(f.metadata[method](fresh, legacy), { code: 'UNKNOWN_PRINCIPAL' });
  const admin = await f.login();
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended'"));
  for (const method of ['metricExecution', 'metricVocabulary']) await assert.rejects(f.metadata[method](admin, legacy), { code: 'TENANT_UNAVAILABLE' });
});

test('targeted metrics: body reads stay constant as unrelated history grows, even with corrupt JSON elsewhere', async t => {
  const f = await fixture(t), context = await f.login('peer');
  const read = async method => {
    f.reads.length = 0;
    const result = await f.metadata[method](context, legacy);
    const bodies = f.reads.flatMap(q => q.rows.filter(r => r.body !== undefined));
    assert.deepEqual(bodies.map(r => [r.kind ?? 'user', r.resource_id ?? 'peer']), [
      ['user', 'peer'], ['dataset', 'sales'], ['metric', 'draft-legacy'], ['metric', 'published-legacy'],
    ]);
    assert.equal(f.reads.length, 5, 'tenant lock, revision, user, dataset and indexed metrics only');
    return { result, bytes: bodies.reduce((sum, r) => sum + Buffer.byteLength(r.body), 0) };
  };
  const before = await read('metricExecution'), vocabulary = await read('metricVocabulary');
  await f.db.transaction(async c => {
    const [row] = await c.query("SELECT body, version FROM h1_resources WHERE kind = 'metric' AND resource_id = 'published-other'");
    const body = JSON.parse(row.body);
    // Large unrelated metric history and analysis/dashboard definitions must not
    // contribute any body bytes to admission for the requested dataset.
    for (let n = 0; n < 40; n++) {
      await insertResource(c, scope, { kind: 'metric', id: `unrelated-${n}` }, body, row.version);
      for (const kind of ['analysis', 'dashboard']) await insertResource(c, scope, { kind, id: `unrelated-${n}` }, {
        definition: { [kind === 'analysis' ? 'AnalysisId' : 'DashboardId']: `unrelated-${n}`, Definition: { DataSetIdentifierDeclarations: [], opaque: 'x'.repeat(16000) } }, datasets: [], folderId: null,
      });
    }
  });
  assert.deepEqual(await f.old(context, legacy, 'execution'), before.result);
  assert.deepEqual(await read('metricExecution'), before);
  assert.deepEqual(await read('metricVocabulary'), vocabulary);
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = 'not JSON' WHERE resource_id = 'unrelated-0'"));
  await assert.rejects(f.old(context, legacy, 'execution'), SyntaxError);
  await assert.rejects(f.old(context, legacy, 'vocabulary'), SyntaxError);
  assert.deepEqual(await read('metricExecution'), before);
  assert.deepEqual(await read('metricVocabulary'), vocabulary);
});

test('targeted metrics: recursive reads use exact owner keys once and never read source bodies or join inputs', async t => {
  const f = await fixture(t), context = await f.login('reader');
  // The current prep writer accepts append source IDs only. Seed object refs at
  // SQL level to exercise the input/append walk that MetricCatalog already supports.
  const root = recipe('graph', { dataset: 'append' }, [
    { id: 'repeat', kind: 'append', config: { source: { dataset: 'leaf' } } },
    { id: 'join-branch', kind: 'append', config: { source: { dataset: 'joined' } } },
  ]);
  await f.db.transaction(c => c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [scope.tenantId, scope.namespaceId, root.kind, root.ownerId, root.id, JSON.stringify(root.body), 1]));
  const expected = await f.old(context, prepared('graph'), 'execution');
  f.reads.length = 0;
  assert.deepEqual(await f.metadata.metricExecution(context, prepared('graph')), expected);
  assert.equal(expected.unsafeJoin, true);
  const rows = f.reads.flatMap(q => q.rows.filter(r => r.kind));
  assert.deepEqual(rows.map(r => [r.kind, r.owner_id, r.resource_id]), ['graph', 'append', 'leaf', 'joined'].map(id => ['prepared-dataset', 'owner', id]));
  for (const read of f.reads.filter(q => q.rows.some(r => r.kind === 'prepared-dataset'))) {
    assert.match(read.sql, /kind = \? AND owner_id = \? AND resource_id = \?/);
    assert.equal(read.rows.length, 1);
  }
  // A genuinely absent reachable input must still raise the catalog's named error.
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = ? WHERE kind = 'prepared-dataset' AND resource_id = 'leaf'", [JSON.stringify(recipe('leaf', { dataset: 'missing' }).body)]));
  await assert.rejects(f.old(context, prepared('append'), 'execution'), { code: 'METRIC_DATASET_NOT_FOUND' });
  await assert.rejects(f.metadata.metricExecution(context, prepared('append')), { code: 'METRIC_DATASET_NOT_FOUND' });
});

test('targeted metrics: tenant isolation and reads leave resources, revisions, links and events unchanged', async t => {
  const f = await fixture(t), context = await f.login();
  await f.db.transaction(async c => {
    await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES ('foreign', 'active', 1)");
    await c.query("INSERT INTO h1_namespaces VALUES ('foreign','foreign','Foreign')");
    await c.query("INSERT INTO h1_revisions VALUES ('foreign','foreign',1,1,1)");
    const foreign = { tenantId: 'foreign', namespaceId: 'foreign' };
    await insertResource(c, foreign, legacy, { definition: {}, sources: [] });
    await c.query("INSERT INTO h1_resources VALUES ('foreign','foreign','metric','','published-legacy','not JSON',1)");
    await c.query("INSERT INTO h1_links VALUES ('foreign','foreign','metric','','published-legacy','dataset','','sales')");
  });
  const snapshot = () => f.db.transaction(async c => {
    const rows = [];
    for (const table of ['tenants', 'resources', 'revisions', 'links', 'outbox']) rows.push(await c.query(`SELECT * FROM h1_${table}`));
    return rows;
  });
  const before = await snapshot();
  const result = await f.metadata.metricExecution(context, legacy);
  assert.deepEqual(result, await f.old(context, legacy, 'execution'));
  result.metrics[0].name = 'Caller mutation';
  assert.equal((await f.metadata.metricVocabulary(context, legacy))[0].name, 'Published legacy');
  assert.deepEqual(await snapshot(), before);
});
