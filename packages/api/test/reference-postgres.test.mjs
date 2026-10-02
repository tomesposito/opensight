import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { environment } from './hosted-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
import { referenceDatabase } from '../dist/reference-postgres.js';
import { createBuiltinHostedServer, drainHostedServer } from '../dist/hosted-server.js';
import { migrateReference } from '../dist/reference-schema.js';
import { captureBackup, restoreBackup } from '../dist/hosted-recovery.js';
import { seedReference, referenceCall, exerciseReference } from './reference-pilot-helpers.mjs';

test('H8 live PostgreSQL reference: singleton role, RLS, authenticated isolation/load, restart and suspended recovery', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
  const schema = `h8_${randomUUID().replaceAll('-', '')}`, owner = `${schema}_owner`, tenant = `${schema}_tenant`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL }); let reference, server;
  t.after(async () => {
    if (server) { await drainHostedServer(server); await new Promise(resolve => server.close(resolve)); }
    await reference?.close(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${tenant}`); await admin.query(`DROP ROLE IF EXISTS ${owner}`); await admin.end();
  });
  await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER BYPASSRLS`); await admin.query(`CREATE ROLE ${tenant} LOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS`);
  await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`); await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${tenant}`);
  const url = new URL(process.env.DATABASE_URL); url.username = owner; url.password = ''; url.searchParams.set('options', `-c search_path=${schema}`);
  const tenantUrl = new URL(url); tenantUrl.username = tenant;
  const env = { ...environment(), OPENSIGHT_MODE: 'hosted', OPENSIGHT_WORKER_ROLE: 'api-query-scheduler', OPENSIGHT_METADATA_URL: url.href, OPENSIGHT_TENANT_METADATA_URL: tenantUrl.href,
    OPENSIGHT_MAINTENANCE: 'frozen', OPENSIGHT_NODE_LIMITS: JSON.stringify(budgetConfig.node), OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(budgetConfig.defaults), OPENSIGHT_AUDIT_OPERATOR_KEY: randomBytes(32).toString('base64') };
  reference = await referenceDatabase(env, () => {}); await reference.initialize();
  await assert.rejects(referenceDatabase(env, () => {}), { code: 'REFERENCE_ALREADY_RUNNING' });
  await assert.rejects(reference.tenantDatabase.transaction(c => c.query('SELECT * FROM h8_audit'), { tenantId: 'other', namespaceId: 'other' }), { code: '42501' });
  const actors = await seedReference(reference.membershipDatabase, reference.tenantDatabase, env);
  server = await createBuiltinHostedServer({ ...reference, env, roleProbe: reference.probe }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = referenceCall(`http://127.0.0.1:${server.address().port}`, env.OPENSIGHT_PUBLIC_ORIGIN);
  const measurements = await exerciseReference(call, actors, env.OPENSIGHT_AUDIT_OPERATOR_KEY);
  t.diagnostic(`H8 native PostgreSQL reference measurements (not Compose): ${JSON.stringify(measurements)}`);
  await drainHostedServer(server); await new Promise(resolve => server.close(resolve)); server = undefined;
  const snapshot = await captureBackup(reference.membershipDatabase, env.OPENSIGHT_AUTH_ENCRYPTION_KEY, 'frozen');
  const before = await reference.membershipDatabase.transaction(c => c.query('SELECT version FROM h4_budget_config'));
  await assert.rejects(migrateReference(reference.membershipDatabase, 'postgres', budgetConfig, async () => { throw new Error('interrupted'); }), /interrupted/);
  assert.deepEqual(await reference.membershipDatabase.transaction(c => c.query('SELECT version FROM h4_budget_config')), before);
  await reference.close(); reference = await referenceDatabase(env, () => {});
  server = await createBuiltinHostedServer({ ...reference, env, roleProbe: reference.probe }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const restarted = referenceCall(`http://127.0.0.1:${server.address().port}`, env.OPENSIGHT_PUBLIC_ORIGIN);
  const cached = await restarted('/api/sources/same/query', 'POST', { mode: 'BLAZE', query: { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] } }, `Bearer ${actors[0].token}`);
  assert.equal(cached.body.errorCode, 'BLAZE_NOT_READY');
  await drainHostedServer(server); await new Promise(resolve => server.close(resolve)); server = undefined;
  await restoreBackup(reference.membershipDatabase, snapshot, env.OPENSIGHT_AUTH_ENCRYPTION_KEY, 'frozen', actors[0].tenantId);
  const states = await reference.membershipDatabase.transaction(c => c.query('SELECT tenant_id,state FROM h1_tenants'));
  assert.equal(states.find(r => r.tenant_id === actors[0].tenantId).state, 'suspended'); assert.equal(states.find(r => r.tenant_id === actors[1].tenantId).state, 'active');
});
