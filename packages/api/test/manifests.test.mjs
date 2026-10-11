import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrateManifests, manifestTables } from '../dist/manifest-schema.js';
import { DurableCoordinator } from '../dist/coordination.js';
import { ManifestStore } from '../dist/manifests.js';
import { TenantMetadata } from '../dist/metadata.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { manifestFixture, syntheticReference, ready } from './manifest-helpers.mjs';

test('SR2c migration is frozen, drained, idempotent and does not activate control or keys', async t => {
  const f = await manifestFixture(t, { manifests: false });
  await assert.rejects(migrateManifests(f.db, 'test', undefined, 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  const control = await f.rows('sr_control');
  await migrateManifests(f.db, 'test', 'frozen', 'sqlite'); await migrateManifests(f.db, 'test', 'frozen', 'sqlite');
  assert.deepEqual(await f.rows('sr_control'), control); assert.deepEqual(await f.rows('h2_keys'), []);
  await f.open(); const handle = await f.admit();
  await assert.rejects(migrateManifests(f.db, 'test', 'frozen', 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  await f.db.transaction(c => c.query("UPDATE sr_control SET state = 'maintenance'"));
  await assert.rejects(migrateManifests(f.db, 'test', 'frozen', 'sqlite'), { code: 'WORKSPACE_DRAIN_REQUIRED' });
  await f.coordinator.release(handle); await migrateManifests(f.db, 'test', 'frozen', 'sqlite');
});

test('SR2c migration refuses partial/foreign schemas and rolls back failed DDL', async t => {
  for (const fault of ['foreign', 'marker', 'failure']) {
    const f = await manifestFixture(t, { manifests: false });
    if (fault === 'foreign') await f.db.transaction(c => c.query('CREATE TABLE sr_manifest (foreign_value TEXT)'));
    if (fault === 'marker') { await migrateManifests(f.db, 'test', 'frozen', 'sqlite'); await f.db.transaction(c => c.query("UPDATE sr_manifest_schema SET checksum = 'changed'")); }
    const db = fault !== 'failure' ? f.db : { durable: true, transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
      if (sql.startsWith('INSERT INTO sr_manifest_schema')) throw Error('private SQL detail'); return c.query(sql, args);
    } })) };
    await assert.rejects(migrateManifests(db, 'test', 'frozen', 'sqlite'), { code: fault === 'failure' ? 'COORDINATION_UNAVAILABLE' : 'MANIFEST_FOREIGN_SCHEMA' });
    if (fault === 'failure') assert.deepEqual((await f.db.transaction(c => c.query("SELECT name FROM sqlite_master WHERE type = 'table'"))).filter(r => manifestTables.includes(r.name)), []);
  }
});

test('SR2c admission callback freezes details and rolls back usage, claims, manifest and outbox together', async t => {
  const f = await manifestFixture(t); await f.open(); const events = await f.rows('h1_outbox');
  const broken = { durable: true, transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
    if (sql.startsWith('INSERT INTO h1_outbox')) throw Error('private SQL detail'); return c.query(sql, args);
  } })) };
  const c = new DurableCoordinator(broken, f.metadata, 'test', 'sqlite'), m = new ManifestStore(c, 'sqlite');
  await assert.rejects(m.admit(f.contexts[0], await f.input(0, true)), { code: 'COORDINATION_UNAVAILABLE' });
  for (const table of ['sr_admission', 'sr_claim', 'sr_manifest', 'h8_usage', 'h8_usage_events']) assert.deepEqual(await f.rows(table), []);
  assert.deepEqual(await f.rows('h1_outbox'), events);
  const attempt = await f.coordinator.admit(f.contexts[0], await f.input(), async (_c, details) => {
    assert.ok(Object.isFrozen(details)); assert.ok(Object.isFrozen(details.input.revisions)); assert.ok(Object.isFrozen(details.limits));
  });
  assert.throws(() => f.coordinator.describe({ ...attempt }), { code: 'ATTEMPT_HANDLE_REQUIRED' }); await f.coordinator.release(attempt);
});

test('SR2c refresh admission removes old readability atomically while retaining immutable history', async t => {
  const f = await manifestFixture(t); await f.open(); await ready(f);
  const history = await f.rows('sr_manifest_versions'), refresh = await f.admit(f.target());
  const current = (await f.rows('sr_manifest'))[0]; assert.equal(current.state, 'running'); assert.equal(JSON.parse(current.body).reference, null);
  assert.deepEqual(await f.rows('sr_manifest_versions'), history);
  await assert.rejects(f.manifests.read(refresh, f.target()), { code: 'BLAZE_REFRESH_IN_PROGRESS' });
  assert.equal((await f.rows('h1_outbox')).at(-1).event_type, 'artifact:running');
  await f.manifests.fail(refresh, 'BLAZE_REFRESH_FAILED');
  await assert.rejects(f.manifests.read(refresh, f.target()), { code: 'BLAZE_REFRESH_FAILED' });
  await assert.rejects(f.manifests.publish(refresh, syntheticReference(f, f.target())), { code: 'MANIFEST_PUBLICATION_LOST' });
  assert.deepEqual(await f.rows('sr_manifest_versions'), history); await f.coordinator.release(refresh);
});

test('SR2c failed completion rolls back ready/history/outbox and obsolete attempts cannot publish', async t => {
  const f = await manifestFixture(t); await f.open(); let reject = false;
  const db = { durable: true, transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
    if (reject && sql.startsWith('INSERT INTO h1_outbox')) throw Error('private SQL detail'); return c.query(sql, args);
  } })) };
  const c = new DurableCoordinator(db, f.metadata, 'test', 'sqlite'), m = new ManifestStore(c, 'sqlite');
  const handle = await m.admit(f.contexts[0], await f.input(0, true)), events = await f.rows('h1_outbox'); reject = true;
  await assert.rejects(m.publish(handle, syntheticReference(f, f.target())), { code: 'COORDINATION_UNAVAILABLE' });
  assert.equal((await f.rows('sr_manifest'))[0].state, 'running'); assert.deepEqual(await f.rows('sr_manifest_versions'), []); assert.deepEqual(await f.rows('h1_outbox'), events);
  reject = false; await c.revoke(handle); await c.release(handle);
  const replacement = await f.admit(f.target()); await f.manifests.publish(replacement, syntheticReference(f, f.target()));
  for (const work of [() => m.fail(handle, 'BLAZE_REFRESH_FAILED'), () => m.publish(handle, syntheticReference(f, f.target()))]) await assert.rejects(work(), { code: 'CLAIM_LOST' });
  assert.equal((await f.rows('sr_manifest'))[0].state, 'ready'); assert.equal((await f.rows('sr_manifest_versions')).length, 1); await f.coordinator.release(replacement);
});

test('SR2c ready manifests survive independent database handles and ordinary producer release', async t => {
  const f = await manifestFixture(t); await f.open(); await ready(f);
  const db = new SqliteMetadataDatabase(f.path); t.after(() => db.close());
  const metadata = new TenantMetadata(db, db), context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  const c = new DurableCoordinator(db, metadata, 'test', 'sqlite'), m = new ManifestStore(c, 'sqlite');
  const attempt = await m.admit(context, { ...await f.input(), attemptId: randomUUID() }), read = await m.read(attempt, f.target());
  assert.equal(read.reference.identity.owner, 'admin'); assert.ok(Object.isFrozen(read.reference.descriptor.columns));
  await m.verify(attempt, [read]);
  await assert.rejects(m.verify(attempt, [{ ...read }]), { code: 'MANIFEST_HANDLE_REQUIRED' });
  await assert.rejects(f.manifests.verify(attempt, [read]), { code: 'MANIFEST_HANDLE_REQUIRED' });
  await c.release(attempt);
  const next = await m.admit(context, await f.input()); await assert.rejects(m.verify(next, [read]), { code: 'MANIFEST_HANDLE_REQUIRED' }); await c.release(next);
});

async function recipes(f, ids) {
  const context = f.contexts[0];
  for (const id of ids) await f.metadata.put(context, { kind: 'prepared-dataset', id, ownerId: context.userId }, {
    resource: { resourceType: 'dataset', dataSetId: id, name: id, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: f.target().id, steps: [] } },
    execution: { mode: 'BLAZE', intervalMinutes: null },
  }, 0);
  return ids.map(id => ({ kind: 'prepared-dataset', id, version: 1 }));
}

test('SR2c flattened certificates invalidate all descendants after upstream refresh without notifications', async t => {
  const f = await manifestFixture(t), [middle, last] = await recipes(f, ['middle', 'last']); await f.open(); await ready(f);
  for (const [target, dependency] of [[middle, f.target()], [last, middle]]) {
    const a = await f.admit(target), read = await f.manifests.read(a, dependency);
    await f.manifests.publish(a, syntheticReference(f, target), [read]); await f.coordinator.release(a);
  }
  const before = (await f.rows('sr_manifest')).find(r => r.resource_id === last.id); assert.equal(JSON.parse(before.body).dependencies.length, 2);
  await f.db.transaction(c => c.query('DELETE FROM h1_outbox')); // Notification loss does not preserve authority.
  const refresh = await f.admit(f.target()); await f.manifests.publish(refresh, syntheticReference(f, f.target())); await f.coordinator.release(refresh);
  const reader = await f.admit();
  await assert.rejects(f.manifests.read(reader, last), { code: 'BLAZE_INVALIDATED' }); await f.coordinator.release(reader);
  assert.equal((await f.rows('sr_manifest')).find(r => r.resource_id === last.id).body, before.body, 'no walker needed to reject it');
});

test('SR2c source expiry, definition change, authority revisions and epochs deny cached reads', async t => {
  for (const change of ['expiry', 'definition', 'recreate', 'policy', 'owner', 'epoch']) {
    const f = await manifestFixture(t), [target] = await recipes(f, ['prepared']); await f.open(); await ready(f);
    const producer = await f.admit(target), source = await f.manifests.read(producer, f.target());
    await f.manifests.publish(producer, syntheticReference(f, target), [source]); await f.coordinator.release(producer);
    const reader = await f.admit(), read = await f.manifests.read(reader, target);
    await f.db.transaction(async c => {
      if (change === 'expiry') {
        const row = (await c.query("SELECT body FROM h1_resources WHERE resource_id = ?", [f.target().id]))[0], body = JSON.parse(row.body);
        body.binding.expiresAt = '2020-01-01T00:00:00.000Z'; await c.query('UPDATE h1_resources SET body = ? WHERE resource_id = ?', [JSON.stringify(body), f.target().id]);
      } else if (change === 'definition') await c.query('UPDATE h1_resources SET version = version + 1 WHERE resource_id = ?', [f.target().id]);
      else if (change === 'recreate') { await c.query('UPDATE h1_revisions SET configuration = configuration + 1'); await c.query('UPDATE sr_claim SET fence = fence + 1 WHERE resource_id = ?', [f.target().id]); }
      else if (change === 'policy') await c.query('UPDATE h1_revisions SET policy = policy + 1');
      else if (change === 'owner') await c.query("UPDATE h2_memberships SET status = 'removed' WHERE namespace_id = 'one'");
      else await c.query('UPDATE sr_control SET epoch = epoch + 1');
    });
    const code = { expiry: 'UPLOAD_EXPIRED', definition: 'BLAZE_INVALIDATED', recreate: 'METADATA_REVISED', policy: 'METADATA_REVISED', owner: 'UNKNOWN_PRINCIPAL', epoch: 'WORKSPACE_MAINTENANCE' }[change];
    await assert.rejects(f.manifests.verify(reader, [read]), { code }); await assert.rejects(f.manifests.read(reader, target), { code }); await f.coordinator.release(reader);
  }
});

test('SR2c foreign identities, forged dependencies, terminal publication and oversized stored metadata fail closed', async t => {
  const f = await manifestFixture(t); await f.open(); const handle = await f.admit(f.target());
  await assert.rejects(f.manifests.publish(handle, syntheticReference(f, f.target(), 1)), { code: 'MANIFEST_INVALID' });
  await assert.rejects(f.manifests.publish(handle, syntheticReference(f, f.target()), [{}]), { code: 'MANIFEST_HANDLE_REQUIRED' });
  await f.manifests.publish(handle, syntheticReference(f, f.target()));
  const self = await f.manifests.read(handle, f.target());
  await assert.rejects(f.manifests.publish(handle, syntheticReference(f, f.target()), [self]), { code: 'MANIFEST_PUBLICATION_LOST' });
  await f.coordinator.release(handle);
  const reader = await f.admit();
  await assert.rejects(f.manifests.read(reader, f.target(1)), { code: 'BLAZE_NOT_READY' });
  await f.db.transaction(c => c.query("UPDATE sr_manifest SET body = ? WHERE namespace_id = 'one'", ['x'.repeat(1048577)]));
  await assert.rejects(f.manifests.read(reader, f.target()), { code: 'BLAZE_NOT_READY' }); await f.coordinator.release(reader);
});

test('SR2c authoritative database outage cannot return a previously read manifest', async t => {
  const f = await manifestFixture(t); await f.open(); await ready(f); let unavailable = false;
  const db = { durable: true, transaction: work => unavailable ? Promise.reject(Error('private database address')) : f.db.transaction(work) };
  const c = new DurableCoordinator(db, f.metadata, 'test', 'sqlite'), m = new ManifestStore(c, 'sqlite');
  const handle = await m.admit(f.contexts[0], await f.input()), read = await m.read(handle, f.target()); unavailable = true;
  await assert.rejects(m.verify(handle, [read]), { code: 'COORDINATION_UNAVAILABLE', message: 'COORDINATION_UNAVAILABLE' });
  unavailable = false; await c.release(handle);
});

test('SR2c identical resource IDs remain isolated across both tenants and owners', async t => {
  const f = await manifestFixture(t), target = { kind: 'source', id: 'same-id', version: 1 };
  await f.db.transaction(async c => {
    await c.query("INSERT INTO h2_identities (subject,email,status) VALUES ('other','other@example.test','active')");
    await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES ('other','tenant-one','one','other','active')");
  });
  const other = await f.metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'other' }));
  f.contexts.push(other);
  const { upload } = await import('./source-helpers.mjs'); f.uploaded.push(await f.sources.upload(other, upload()));
  for (const [index, ctx] of f.contexts.entries()) {
    const original = await f.metadata.get(ctx, { kind: 'source', id: f.uploaded[index].id, ownerId: ctx.userId });
    await f.metadata.put(ctx, { kind: 'source', id: target.id, ownerId: ctx.userId }, original.body, 0);
  }
  await f.open();
  for (const [index] of f.contexts.entries()) {
    const attempt = await f.admit(target, [], index); await f.manifests.publish(attempt, syntheticReference(f, target, index)); await f.coordinator.release(attempt);
  }
  const rows = await f.rows('sr_manifest'); assert.equal(rows.length, 3); assert.equal(new Set(rows.map(r => JSON.parse(r.body).reference.key)).size, 3);
  for (const [index, context] of f.contexts.entries()) {
    const attempt = await f.admit(undefined, [], index), read = await f.manifests.read(attempt, target);
    assert.equal(read.reference.identity.tenant, context.tenantId); assert.equal(read.reference.identity.owner, context.userId); await f.coordinator.release(attempt);
  }
});

test('SR2c deleting and recreating version one cannot resurrect a prior ready manifest or reset its fence', async t => {
  const f = await manifestFixture(t); await f.open(); await ready(f);
  const ctx = f.contexts[0], key = { kind: 'source', id: f.target().id, ownerId: ctx.userId }, source = await f.metadata.get(ctx, key);
  const old = await f.admit(), oldRead = await f.manifests.read(old, f.target());
  await f.metadata.remove(ctx, key, 1); await f.metadata.put(ctx, key, source.body, 0);
  await assert.rejects(f.manifests.verify(old, [oldRead]), { code: 'METADATA_REVISED' }); await f.coordinator.release(old);
  const current = await f.admit(); await assert.rejects(f.manifests.read(current, f.target()), { code: 'BLAZE_INVALIDATED' }); await f.coordinator.release(current);
  const replacement = await f.admit(f.target()); assert.equal(replacement.fence, '2'); assert.equal(replacement.generation, '2');
  assert.equal((await f.rows('sr_manifest_versions')).length, 1); await f.coordinator.release(replacement);
});

test('SR2c definition inputs are snapshotted before admission and oversized certificates roll back admission', async t => {
  const f = await manifestFixture(t); await f.open(); const definitions = [f.target()];
  const pending = f.manifests.admit(f.contexts[0], await f.input(0, true), definitions); definitions[0].version = 123;
  const handle = await pending; assert.equal(JSON.parse((await f.rows('sr_manifest'))[0].body).definitions[0].version, 1); await f.coordinator.release(handle);
  const before = await f.rows('sr_admission');
  const large = Array.from({ length: 2200 }, (_, i) => ({ kind: 'source', id: `${'x'.repeat(500)}${i}`, version: 1 }));
  await assert.rejects(f.admit(f.target(), large), { code: 'MANIFEST_LIMIT_EXCEEDED' }); assert.deepEqual(await f.rows('sr_admission'), before);
});
