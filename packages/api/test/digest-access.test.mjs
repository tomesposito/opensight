import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog } from '../dist/asset-model.js';
import { MetricCatalog, metricRecord } from '../dist/metric-model.js';
import { MetadataError } from '../dist/metadata-db.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { insertResource } from '../dist/metadata-resources.js';
import { TenantMetadata } from '../dist/metadata.js';
import { digestMetricAccess } from '../dist/digest-audience.js';

// #231: digest audience resolution used to run digestMetricAccess inside
// assetTransaction, cloning the whole workspace catalog once per recipient.
// The targeted read must return identical results/errors while loading only
// the principal, groups, metric, dataset and folder chain rows.
const scope = { tenantId: 'tenant', namespaceId: 'workspace' };
const legacy = { kind: 'dataset', id: 'sales' };
const prepared = (id, ownerId = 'owner') => ({ kind: 'prepared-dataset', id, ownerId });
const schema = { columns: [{ name: 'amount', type: 'DECIMAL' }] };
const definition = name => ({ name, expression: '{amount}', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] });
const recipe = (id, ownerId, extra = {}) => ({ kind: 'prepared-dataset', id, ownerId, version: 1, body: { folderId: null, ...extra,
  resource: { resourceType: 'dataset', dataSetId: id, name: id, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'source', steps: [] } } } });

async function fixture(t) {
  const db = new SqliteMetadataDatabase(':memory:'); t.after(() => db.close());
  await initializeMetadata(db);
  const resources = [
    ...['admin', 'owner', 'reader', 'peer'].map(id => ({ kind: 'user', id, version: 1, body: { name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' } })),
    { kind: 'group', id: 'team', version: 1, body: { name: 'team', userIds: ['reader'] } },
    { kind: 'source', id: 'source', ownerId: 'owner', version: 1, body: { binding: {} } },
    { ...legacy, version: 1, body: { definition: { OutputColumns: [{ Name: 'amount', Type: 'DECIMAL' }] }, sources: [{ kind: 'source', id: 'source', ownerId: 'owner' }] } },
    { kind: 'folder', id: 'open-folder', version: 1, body: { name: 'open-folder' } },
    { kind: 'folder', id: 'locked-folder', version: 1, body: { name: 'locked-folder', grants: [{ principal: { type: 'user', id: 'admin' }, role: 'viewer' }] } },
    recipe('prep', 'owner', { folderId: 'open-folder' }),
    recipe('lockedprep', 'owner', { folderId: 'locked-folder' }),
    recipe('grantprep', 'owner', { grants: [{ principal: { type: 'user', id: 'owner' }, role: 'co-owner' }] }),
  ];
  const catalog = userId => new MetricCatalog(new AssetCatalog({ ...scope, userId }, resources));
  const admin = catalog('admin');
  for (const [id, ref] of [['pub-legacy', legacy], ['pub-prep', prepared('prep')], ['pub-locked', prepared('lockedprep')], ['pub-grant', prepared('grantprep')], ['pub-metric-grant', legacy]]) {
    admin.create(id, ref, definition(id), schema); admin.publish(id, 1, schema);
  }
  catalog('owner').create('draft-legacy', legacy, definition('draft-legacy'), schema);
  await db.transaction(async c => {
    await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES (?, 'active', 1)", [scope.tenantId]);
    await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [scope.namespaceId, scope.tenantId, 'Workspace']);
    await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [scope.tenantId, scope.namespaceId]);
    // Prepared-dataset bodies carry folderId/grants beside `resource`, which the
    // insertResource link validation does not model; seed those rows directly
    // (the #172 test seeds its graph rows the same way). Metrics created above
    // were pushed into `resources` by MetricCatalog and insert with the rest.
    for (const { body, version, ...key } of resources) {
      if (key.kind === 'prepared-dataset') await c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [scope.tenantId, scope.namespaceId, key.kind, key.ownerId ?? '', key.id, JSON.stringify(body), version]);
      else await insertResource(c, scope, key, body, version);
    }
    // Metric-level group grant: only the team (reader) may view pub-metric-grant.
    const [row] = await c.query("SELECT body FROM h1_resources WHERE kind = 'metric' AND resource_id = 'pub-metric-grant'");
    const granted = JSON.parse(row.body); granted.grants = [{ principal: { type: 'group', id: 'team' }, role: 'viewer' }];
    await c.query("UPDATE h1_resources SET body = ? WHERE kind = 'metric' AND resource_id = 'pub-metric-grant'", [JSON.stringify(granted)]);
    // A published metric whose dataset has since been removed. The link row
    // would violate the h1_links foreign key, so seed the row directly.
    const ghost = JSON.parse((await c.query("SELECT body FROM h1_resources WHERE kind = 'metric' AND resource_id = 'pub-legacy'"))[0].body);
    ghost.dataset = { kind: 'dataset', id: 'missing' };
    await c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [scope.tenantId, scope.namespaceId, 'metric', '', 'ghost', JSON.stringify(ghost), 2]);
  });
  const reads = [];
  const tracked = { transaction: (work, context) => db.transaction(c => work({ query: async (sql, values) => {
    const rows = await c.query(sql, values); reads.push({ sql, values, rows }); return rows;
  } }), context) };
  const metadata = new TenantMetadata(tracked, db);
  const login = (userId = 'admin') => metadata.authenticate(null, async () => ({ namespaceId: scope.namespaceId, userId }));
  // The pre-#231 implementation, verbatim, as the equivalence oracle.
  const old = (context, metricId) => metadata.assetTransaction(context, false, a => {
    const catalog = new MetricCatalog(a), record = catalog.get(metricId), b = metricRecord(record);
    if (b.publishedVersion === null) throw new MetadataError('METRIC_NOT_PUBLISHED', 409);
    const dataset = catalog.dataset(b.dataset);
    if (dataset.body.folderId != null) a.folder(String(dataset.body.folderId));
    if (!a.allows(record.body.grants) || !a.allows(dataset.body.grants)) throw new MetadataError('DIGEST_VIEW_FORBIDDEN', 403);
    return b.dataset;
  });
  return { db, metadata, login, old, reads };
}

const attempt = async fn => { try { return { ok: await fn() }; } catch (e) { return { err: e.code, status: e.status }; } };

test('digest access: targeted read matches the whole-catalog result and errors for every principal and metric state', async t => {
  const f = await fixture(t);
  for (const user of ['admin', 'owner', 'reader', 'peer']) {
    const context = await f.login(user);
    for (const metricId of ['pub-legacy', 'pub-prep', 'pub-locked', 'pub-grant', 'pub-metric-grant', 'draft-legacy', 'ghost', 'nope']) {
      assert.deepEqual(await attempt(() => digestMetricAccess(f.metadata, context, { metricId })),
        await attempt(() => f.old(context, metricId)), `${user} / ${metricId}`);
    }
  }
  // Spot-check the headline outcomes so the oracle itself cannot drift silently.
  const reader = await f.login('reader'), peer = await f.login('peer'), owner = await f.login('owner');
  assert.deepEqual(await digestMetricAccess(f.metadata, reader, { metricId: 'pub-metric-grant' }), legacy);
  await assert.rejects(digestMetricAccess(f.metadata, peer, { metricId: 'pub-metric-grant' }), { code: 'DIGEST_VIEW_FORBIDDEN', status: 403 });
  await assert.rejects(digestMetricAccess(f.metadata, reader, { metricId: 'pub-grant' }), { code: 'DIGEST_VIEW_FORBIDDEN', status: 403 });
  await assert.rejects(digestMetricAccess(f.metadata, owner, { metricId: 'pub-locked' }), { code: 'RESOURCE_NOT_FOUND', status: 404 });
  await assert.rejects(digestMetricAccess(f.metadata, owner, { metricId: 'draft-legacy' }), { code: 'METRIC_NOT_PUBLISHED', status: 409 });
  await assert.rejects(digestMetricAccess(f.metadata, reader, { metricId: 'draft-legacy' }), { code: 'METRIC_NOT_FOUND', status: 404 });
});

test('digest access: body reads stay constant per recipient as unrelated catalog grows, even with corrupt JSON elsewhere', async t => {
  const f = await fixture(t);
  const bodies = () => f.reads.flatMap(q => q.rows.filter(r => r.body !== undefined)).map(r => [r.kind ?? 'user', r.resource_id ?? 'principal']);
  const measure = async (user, metricId) => {
    const context = await f.login(user); f.reads.length = 0;
    const result = await digestMetricAccess(f.metadata, context, { metricId });
    return { result, bodies: bodies() };
  };
  const grantBefore = await measure('reader', 'pub-metric-grant');
  assert.deepEqual(grantBefore.bodies, [['user', 'principal'], ['group', 'team'], ['metric', 'pub-metric-grant'], ['dataset', 'sales']]);
  const prepBefore = await measure('owner', 'pub-prep');
  assert.deepEqual(prepBefore.bodies, [['user', 'principal'], ['group', 'team'], ['metric', 'pub-prep'], ['prepared-dataset', 'prep'], ['folder', 'open-folder']]);
  await f.db.transaction(async c => {
    const [row] = await c.query("SELECT body, version FROM h1_resources WHERE kind = 'metric' AND resource_id = 'pub-legacy'");
    for (let n = 0; n < 40; n++) {
      await insertResource(c, scope, { kind: 'metric', id: `unrelated-${n}` }, JSON.parse(row.body), row.version);
      for (const kind of ['analysis', 'dashboard']) await insertResource(c, scope, { kind, id: `unrelated-${n}` }, {
        definition: { [kind === 'analysis' ? 'AnalysisId' : 'DashboardId']: `unrelated-${n}`, Definition: { DataSetIdentifierDeclarations: [], opaque: 'x'.repeat(16000) } }, datasets: [], folderId: null,
      });
    }
  });
  // A full audience sweep (one call per recipient) stays bounded per call.
  for (const user of ['admin', 'owner', 'reader', 'peer']) {
    const context = await f.login(user); f.reads.length = 0;
    await digestMetricAccess(f.metadata, context, { metricId: 'pub-legacy' });
    assert.ok(bodies().length <= 4, `${user} read ${bodies().length} bodies`);
  }
  assert.deepEqual(await measure('reader', 'pub-metric-grant'), grantBefore);
  assert.deepEqual(await measure('owner', 'pub-prep'), prepBefore);
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = 'not JSON' WHERE kind = 'analysis' AND resource_id = 'unrelated-0'"));
  const reader = await f.login('reader');
  await assert.rejects(f.old(reader, 'pub-metric-grant'), SyntaxError);
  assert.deepEqual(await digestMetricAccess(f.metadata, reader, { metricId: 'pub-metric-grant' }), legacy);
});
