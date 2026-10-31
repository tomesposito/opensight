import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog } from '../dist/asset-model.js';
import { MetricCatalog, metricRecord, validateMetricRecord } from '../dist/metric-model.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { insertResource } from '../dist/metadata-resources.js';
import { TenantMetadata } from '../dist/metadata.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ref = { kind: 'prepared-dataset', id: 'sales', ownerId: 'owner' };
const schema = { columns: [{ name: 'revenue', type: 'DECIMAL' }, { name: 'cost', type: 'DECIMAL' }] };
const definition = { name: 'Net revenue', expression: '{revenue} - {cost}', defaultAggregation: 'SUM', format: { style: 'currency', decimalPlaces: 2, currency: 'USD' }, description: 'Revenue less cost', synonyms: ['net sales'] };
const users = ['owner', 'editor', 'admin', 'reader'].map(id => ({ kind: 'user', id, version: 1, body: { name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' } }));
const resources = () => [...structuredClone(users), { ...ref, version: 1, body: { resource: { resourceType: 'dataset', dataSetId: 'sales', name: 'Sales', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'source', steps: [] } } } }];
const catalog = (entries, userId = 'owner') => new MetricCatalog(new AssetCatalog({ tenantId: 't', namespaceId: 'w', userId }, entries));

test('metrics: editors draft, dataset owner/admin publish; immutable history and follow latest published', () => {
  const entries = resources(), editor = catalog(entries, 'editor'), owner = catalog(entries), admin = catalog(entries, 'admin');
  const r = editor.create('net', ref, definition, schema);
  assert.deepEqual(editor.published(ref), []);
  assert.throws(() => editor.publish('net', 1, schema), { code: 'METRIC_PUBLISH_FORBIDDEN' });
  assert.throws(() => catalog(entries, 'reader').get('net'), { code: 'METRIC_NOT_FOUND' });
  owner.publish('net', 1, schema);
  assert.throws(() => editor.edit('net', 2, definition, schema), { code: 'METRIC_EDIT_FORBIDDEN' });
  owner.edit('net', 2, { ...definition, expression: '{revenue} * 2' }, schema);
  assert.equal(owner.published(ref)[0].expression, definition.expression);
  admin.publish('net', 3, schema);
  assert.equal(owner.published(ref)[0].expression, '{revenue} * 2');
  assert.deepEqual(metricRecord(r).audit.map(a => [a.action, a.actor, a.version]), [['create', 'editor', 1], ['publish', 'owner', 2], ['edit', 'owner', 3], ['publish', 'admin', 4]]);
  assert.equal(metricRecord(r).versions[0].definition.expression, definition.expression);
  assert.equal(validateMetricRecord(r.body), r.body);
  assert.throws(() => owner.edit('net', 2, definition, schema), { code: 'ASSET_PRECONDITION_FAILED' });
});

test('metrics: unknown identities, invalid fields, same dataset name conflicts, forged metadata and reader bypasses fail closed', () => {
  const entries = resources(), c = catalog(entries);
  assert.throws(() => catalog(entries, 'missing').create('a', ref, definition, schema), { code: 'UNKNOWN_PRINCIPAL' });
  assert.throws(() => catalog(entries, 'reader').create('a', ref, definition, schema), { code: 'METADATA_WRITE_FORBIDDEN' });
  assert.throws(() => c.create('a', { ...ref, id: 'unknown' }, definition, schema), { code: 'METRIC_DATASET_NOT_FOUND' });
  assert.throws(() => c.create('a', ref, { ...definition, expression: '{unknown}' }, schema), { code: 'METRIC_UNKNOWN_FIELD' });
  assert.throws(() => c.create('a', ref, { ...definition, expression: 'badFn({revenue})' }, schema), { code: 'METRIC_INVALID_EXPRESSION' });
  assert.throws(() => c.create('a', ref, { ...definition, expression: '${user}' }, schema), { code: 'METRIC_INVALID_EXPRESSION' });
  assert.throws(() => c.create('a', ref, { ...definition, name: 'revenue' }, schema), { code: 'METRIC_NAME_CONFLICT' });
  assert.throws(() => c.create('a', ref, { ...definition, publishedVersion: 1 }, schema), { code: 'METADATA_INVALID' });
  c.create('a', ref, definition, schema);
  assert.throws(() => c.create('b', ref, { ...definition, name: definition.name.toUpperCase() }, schema), { code: 'METRIC_NAME_CONFLICT' });
  assert.throws(() => c.assets.remove(c.dataset(ref)), { code: 'DATASET_DELETE_BLOCKED_BY_METRIC' });
});

test('metrics: durable asset transactions preserve history across reopen and isolate workspaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metric-model-')), path = join(directory, 'metadata.sqlite');
  let db = new SqliteMetadataDatabase(path);
  try {
    await initializeMetadata(db);
    await db.transaction(async c => {
      for (const ns of ['w', 'other']) {
        await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES (?, 'active', 1)", [ns]);
        await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [ns, ns, ns]);
        await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [ns, ns]);
        for (const r of users) await insertResource(c, { tenantId: ns, namespaceId: ns }, { kind: r.kind, id: r.id }, r.body);
        await insertResource(c, { tenantId: ns, namespaceId: ns }, { kind: 'dataset', id: 'legacy' }, { definition: {}, sources: [] });
      }
    });
    let store = new TenantMetadata(db, db), context = await store.authenticate(null, async () => ({ namespaceId: 'w', userId: 'admin' }));
    const dataset = { kind: 'dataset', id: 'legacy' };
    await store.assetTransaction(context, true, a => new MetricCatalog(a).create('net', dataset, definition, schema));
    await store.assetTransaction(context, true, a => new MetricCatalog(a).publish('net', 1, schema));
    assert.equal((await store.revisions(context)).configuration, 3);
    await db.close(); db = new SqliteMetadataDatabase(path); await initializeMetadata(db);
    store = new TenantMetadata(db, db); context = await store.authenticate(null, async () => ({ namespaceId: 'w', userId: 'admin' }));
    assert.equal((await store.assetTransaction(context, false, a => new MetricCatalog(a).published(dataset)))[0].version, 2);
    const other = await store.authenticate(null, async () => ({ namespaceId: 'other', userId: 'admin' }));
    assert.deepEqual(await store.assetTransaction(other, false, a => new MetricCatalog(a).list()), []);
    const events = await db.transaction(c => c.query("SELECT * FROM h1_outbox WHERE event_type = 'assets.changed'"));
    assert.equal(events.length, 2);
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('metrics: legacy SQLite kind constraint upgrades without losing resources or links', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db);
    await db.transaction(async c => {
      const [{ sql }] = await c.query("SELECT sql FROM sqlite_master WHERE name = 'h1_resources'");
      await c.query('DROP TABLE h1_links'); await c.query('DROP TABLE h1_resources');
      await c.query(sql.replaceAll(",'metric'", ''));
    });
    // initialize recreates links before performing the migration; empty legacy DB upgrades too.
    await initializeMetadata(db);
    const [{ sql }] = await db.transaction(c => c.query("SELECT sql FROM sqlite_master WHERE name = 'h1_resources'"));
    assert.match(sql, /'metric'/);
    assert.deepEqual(await db.transaction(c => c.query('PRAGMA foreign_key_check')), []);
  } finally { await db.close(); }
});
