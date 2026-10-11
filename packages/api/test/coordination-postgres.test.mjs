import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { TenantMetadata } from '../dist/metadata.js';
import { migrateRuntime } from '../dist/runtime-migration.js';
import { migrateCoordination } from '../dist/coordination-schema.js';
import { DurableCoordinator } from '../dist/coordination.js';
import { migrateManifests } from '../dist/manifest-schema.js';
import { ManifestStore } from '../dist/manifests.js';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateObjects } from '../dist/object-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { migrateOperations } from '../dist/operation-schema.js';
import { DurableUploads } from '../dist/durable-uploads.js';
import { directRequest } from './serverless-upload-helpers.mjs';
import { syntheticReference } from './manifest-helpers.mjs';
import { HostedSources } from '../dist/hosted-sources.js';
import { environment } from './hosted-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { seedSources, upload } from './source-helpers.mjs';

test('SR2a/SR2d live Postgres: independent pools serialize admission, publication, dispatch and storage; restricted SQL cannot bypass scope',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = `sr2_test_${randomUUID().replaceAll('-', '')}`, role = `${schema}_tenant`;
    const settings = { connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000, options: `-c search_path=${schema} -c statement_timeout=2000 -c lock_timeout=500` };
    const pool = new Pool(settings), otherPool = new Pool({ ...settings, max: 1 }); let tenantPool;
    t.after(async () => {
      await tenantPool?.end(); await otherPool.end();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.query(`DROP ROLE IF EXISTS ${role}`); await pool.end();
    });
    await pool.query(`CREATE SCHEMA ${schema}`);
    const db = new PostgresMetadataDatabase(pool), otherDb = new PostgresMetadataDatabase(otherPool);
    const env = { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined };
    await migrateRuntime(db, env); await seedSources(db);
    await db.transaction(async c => {
      for (const ns of ['one', 'two']) {
        await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'active')", [ns, `${ns}@example.test`]);
        await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,'admin','active')", [ns, `tenant-${ns}`, ns]);
      }
    });
    const entitlements = { defaults: { apiCalls: 1000, computeAttempts: 20, storageBytes: 1000000 }, tenants: {} };
    await migrateCoordination(db, 'test', entitlements, 'frozen');
    await migrateCoordination(db, 'test', entitlements, 'frozen');
    await migrateManifests(db, 'test', 'frozen'); await migrateManifests(db, 'test', 'frozen');
    await migrateDispatch(db, 'test', 'frozen'); await migrateDispatch(db, 'test', 'frozen');
    await migrateObjects(db, 'test', 'frozen'); await migrateObjects(db, 'test', 'frozen');
    await migrateOperations(db, 'test', 'frozen'); await migrateOperations(db, 'test', 'frozen');
    const metadata = new TenantMetadata(db, db), otherMetadata = new TenantMetadata(otherDb, otherDb);
    const login = m => m.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
    const context = await login(metadata), other = await login(otherMetadata);
    const source = await new HostedSources(metadata, randomBytes(32).toString('base64'), []).upload(context, upload());
    const a = new DurableCoordinator(db, metadata, 'test'), b = new DurableCoordinator(otherDb, otherMetadata, 'test');
    const ma = new ManifestStore(a), mb = new ManifestStore(b);
    await db.transaction(c => c.query("UPDATE sr_control SET state = 'open'"));
    const input = async (m, ctx) => ({ attemptId: randomUUID(), class: 'refresh', platformRemainingMs: 28000,
      revisions: await m.revisions(ctx), claim: { kind: 'source', id: source.id, expectedVersion: 1 } });
    const requests = [await input(metadata, context), await input(otherMetadata, other)];
    const results = await Promise.allSettled([ma.admit(context, requests[0]), mb.admit(other, requests[1])]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'TENANT_BUDGET_EXCEEDED');
    const [winner, handle] = results[0].status === 'fulfilled' ? [a, results[0].value] : [b, results[1].value];
    const manifest = winner === a ? ma : mb, target = { kind: 'source', id: source.id, version: 1 };
    const reference = syntheticReference({ contexts: [context] }, target);
    const publications = await Promise.allSettled([manifest.publish(handle, reference), manifest.publish(handle, reference)]);
    assert.equal(publications.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(publications.find(r => r.status === 'rejected').reason.code, 'MANIFEST_PUBLICATION_LOST');
    await assert.rejects(manifest.fail(handle, 'BLAZE_REFRESH_FAILED'), { code: 'MANIFEST_PUBLICATION_LOST' });
    assert.equal((await db.transaction(c => c.query('SELECT state FROM sr_manifest')))[0].state, 'ready');
    assert.equal(handle.fence, '1');
    await assert.rejects(db.transaction(c => c.query('INSERT INTO sr_claim VALUES (?,?,?,?,?,?,1,1,1,?)',
      ['test', 'tenant-two', 'two', 'admin', 'source', 'foreign', handle.attemptId])), { code: 'METADATA_REFERENCE_INVALID' });
    const privateTables = ['sr_admission', 'sr_claim', 'sr_manifest', 'sr_manifest_versions', 'sr_dispatch_intent', 'sr_outbox', 'sr_object', 'sr_storage_usage', 'sr_object_pin', 'sr_cleanup_target', 'sr_upload', 'sr_operation', 'sr_result_chunk'];
    const rls = await pool.query('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname = ANY($1)', [privateTables]);
    assert.equal(rls.rows.length, 13); assert.ok(rls.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
    await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
    await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    // Test-only SELECT grants exercise forced RLS even if a future grant widens access.
    await pool.query(`GRANT SELECT ON ${privateTables.join(', ')} TO ${role}`);
    tenantPool = new Pool({ ...settings, max: 1, options: `${settings.options} -c role=${role}` });
    assert.deepEqual((await tenantPool.query('SELECT * FROM sr_admission')).rows, []);
    assert.deepEqual((await tenantPool.query('SELECT * FROM sr_claim')).rows, []);
    assert.deepEqual((await tenantPool.query('SELECT * FROM sr_manifest')).rows, []);
    assert.deepEqual((await tenantPool.query('SELECT * FROM sr_manifest_versions')).rows, []);
    const restricted = new PostgresMetadataDatabase(tenantPool, true);
    assert.equal((await restricted.transaction(c => c.query('SELECT * FROM sr_admission'), context)).length, 1);
    assert.deepEqual(await restricted.transaction(c => c.query('SELECT * FROM sr_admission'), { tenantId: 'tenant-two', namespaceId: 'two' }), []);
    assert.deepEqual(await restricted.transaction(c => c.query('SELECT * FROM sr_admission'), { tenantId: 'tenant-one', namespaceId: 'two' }), []);
    assert.equal((await restricted.transaction(c => c.query('SELECT * FROM sr_manifest'), context)).length, 1);
    assert.deepEqual(await restricted.transaction(c => c.query('SELECT * FROM sr_manifest_versions'), { tenantId: 'tenant-two', namespaceId: 'two' }), []);
    await assert.rejects(tenantPool.query('UPDATE sr_admission SET revoked = 1'), { code: '42501' });
    await assert.rejects(tenantPool.query('SELECT * FROM sr_limits'), { code: '42501' });
    await assert.rejects(tenantPool.query('UPDATE sr_manifest SET state = \'error\''), { code: '42501' });
    await assert.rejects(tenantPool.query('SELECT * FROM sr_manifest_schema'), { code: '42501' });
    await winner.release(handle);
    const reader = await mb.admit(other, { ...await input(otherMetadata, other), class: 'query', claim: undefined });
    const hydrated = await mb.read(reader, target); assert.deepEqual(hydrated.reference, reference); await mb.verify(reader, [hydrated]); await b.release(reader);
    const next = await mb.admit(other, await input(otherMetadata, other)); assert.equal(next.fence, '2');
    await mb.fail(next, 'BLAZE_REFRESH_FAILED'); await b.release(next);
    const usage = await db.transaction(c => c.query("SELECT admitted FROM h8_usage WHERE metric = 'computeAttempts'"));
    assert.equal(Number(usage[0].admitted), 2);

    const transport = { recover: async () => {}, dispatch: async () => {} };
    const dispatches = [new DurableDispatch(db, metadata, 'test', transport), new DurableDispatch(otherDb, otherMetadata, 'test', transport)];
    const ledgers = [new ObjectLedger(metadata, 'test'), new ObjectLedger(otherMetadata, 'test')], contexts = [context, other];
    const request = { kind: 'upload-reserve', requestDigest: 'a'.repeat(64), idempotencyKey: randomUUID(), revisions: await metadata.revisions(context) };
    const prepared = await Promise.all(dispatches.map((d, i) => d.prepare(contexts[i], request)));
    assert.equal(prepared[0].intentId, prepared[1].intentId); let businessCalls = 0;
    const commit = (i, preparation = prepared[i]) => dispatches[i].commit(preparation, async (c, now) => {
      businessCalls++;
      const plan = ledgers[i].plan(contexts[i], { purpose: 'raw-upload', capacityBytes: 700000, mediaType: 'text/csv' });
      await ledgers[i].reserve(c, contexts[i], request.revisions, preparation.intentId, [plan], now, now + 600000);
      return { receipt: { id: plan.id, revision: 1 }, events: [{ aggregateId: plan.id, aggregateRevision: 1, kind: 'object-cleanup', dueAt: now + 86400000, expiresAt: now + 172800000 }] };
    });
    const receipts = await Promise.all([commit(0), commit(1)]); assert.deepEqual(receipts[0], receipts[1]); assert.equal(businessCalls, 1);
    const overQuota = await dispatches[1].prepare(other, { ...request, idempotencyKey: randomUUID() });
    await assert.rejects(commit(1, overQuota), { code: 'USAGE_LIMIT_EXCEEDED' });
    assert.equal((await db.transaction(c => c.query('SELECT * FROM sr_object'))).length, 1);
    assert.equal((await db.transaction(c => c.query('SELECT * FROM sr_outbox'))).length, 1);
    const gauge = await restricted.transaction(c => c.query('SELECT * FROM sr_storage_usage'), context);
    assert.equal(Number(gauge[0].reserved_bytes), 700000);
    for (const table of ['sr_dispatch_intent', 'sr_outbox', 'sr_object', 'sr_storage_usage', 'sr_object_pin']) {
      assert.deepEqual((await tenantPool.query(`SELECT * FROM ${table}`)).rows, []);
      assert.deepEqual(await restricted.transaction(c => c.query(`SELECT * FROM ${table}`), { tenantId: 'tenant-two', namespaceId: 'two' }), []);
      await assert.rejects(tenantPool.query(`DELETE FROM ${table}`), { code: '42501' });
    }
    await assert.rejects(tenantPool.query('SELECT * FROM sr_object_schema'), { code: '42501' });
    await db.transaction(c => c.query('UPDATE sr_limits SET entitlements = ?', [JSON.stringify({ ...entitlements, defaults: { ...entitlements.defaults, storageBytes: 2 * 1024 * 1024 * 1024 } })]));
    const objects = { capability: async () => ({ url: 'https://synthetic.example/put', headers: {}, method: 'PUT', expiresAt: new Date(Date.now() + 60000).toISOString() }),
      head: async (entry, version) => ({ version, bytes: entry.capacityBytes, checksum: entry.checksum }) };
    const uploads = new DurableUploads(metadata, dispatches[0], ledgers[0], objects), recheck = async () => {};
    const reserved = await uploads.reserve(context, directRequest(), randomUUID(), recheck), completionKey = randomUUID();
    const operations = await Promise.all([uploads.complete(context, reserved.id, { versionId: 'exact-version' }, completionKey, recheck), uploads.complete(context, reserved.id, { versionId: 'exact-version' }, completionKey, recheck)]);
    assert.equal(operations[0].id, operations[1].id); assert.equal((await db.transaction(c => c.query('SELECT * FROM sr_operation'))).length, 1);
    for (const table of ['sr_upload', 'sr_operation', 'sr_result_chunk']) {
      assert.deepEqual((await tenantPool.query(`SELECT * FROM ${table}`)).rows, []);
      assert.deepEqual(await restricted.transaction(c => c.query(`SELECT * FROM ${table}`), { tenantId: 'tenant-two', namespaceId: 'two' }), []);
      await assert.rejects(tenantPool.query(`DELETE FROM ${table}`), { code: '42501' });
    }
    const cancelled = await uploads.cancel(context, 'operation', operations[0].id, { expectedRevision: 1 }, recheck); assert.equal(cancelled.state, 'cancelled');
  });
