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
import { syntheticReference } from './manifest-helpers.mjs';
import { HostedSources } from '../dist/hosted-sources.js';
import { environment } from './hosted-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { seedSources, upload } from './source-helpers.mjs';

test('SR2a/SR2c live Postgres: independent pools serialize admission/publication and restricted SQL cannot bypass scope or mutate authority',
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
    const rls = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname IN ('sr_claim','sr_admission','sr_manifest','sr_manifest_versions')");
    assert.equal(rls.rows.length, 4); assert.ok(rls.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
    await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
    await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    // Test-only SELECT grants exercise forced RLS even if a future grant widens access.
    await pool.query(`GRANT SELECT ON sr_admission, sr_claim, sr_manifest, sr_manifest_versions TO ${role}`);
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
  });
