import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata, metadataTables } from '../dist/metadata-schema.js';
import { initializeAudit } from '../dist/operator-audit.js';
import { initializeAuth } from '../dist/auth-schema.js';
import { HostedAuth, activateAuthKey } from '../dist/hosted-auth.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { TenantMetadata } from '../dist/metadata.js';
import { StubMailTransport } from '../dist/mail.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { environment, decode32 } from './hosted-helpers.mjs';
import { totp } from '../dist/auth-crypto.js';
import { HostedEmbedding, initializeEmbedding, embeddingPolicy, defaultEmbedConfig } from '../dist/embedding-config.js';

test('H2 live Postgres: private credentials, concurrent onboarding/MFA/switch, cross-pool revocation and tenant RLS', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
  const schema = `h2_test_${randomUUID().replaceAll('-', '')}`, role = `${schema}_tenant`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, options: `-c search_path=${schema}` }); let tenantPool;
  t.after(async () => { await tenantPool?.end(); await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await adminPool.query(`DROP ROLE IF EXISTS ${role}`); await adminPool.end(); });
  await adminPool.query(`CREATE SCHEMA ${schema}`); await adminPool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
  const db = new PostgresMetadataDatabase(adminPool); await initializeMetadata(db, 'postgres'); await db.transaction(c => initializeAudit(c)); await initializeAuth(db);
  await adminPool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  for (const table of metadataTables.filter(t => t !== 'migrations')) await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_${table} TO ${role}`);
  const url = new URL(process.env.DATABASE_URL); url.username = role; url.password = '';
  tenantPool = new Pool({ connectionString: url.href, max: 1, options: `-c search_path=${schema}` });
  for (const table of ['identities', 'memberships', 'sessions', 'keys', 'invitations', 'attempts', 'onboarding', 'requests', 'control']) await assert.rejects(tenantPool.query(`SELECT * FROM h2_${table}`), { code: '42501' });
  const config = hostedConfig(environment()), mail = new StubMailTransport(); let now = 1800000000000;
  const provisioning = new HostedProvisioning(db, config, mail, () => now), auth = await HostedAuth.create(db, config, () => now);
  const second = await HostedAuth.create(new PostgresMetadataDatabase(adminPool), config, () => now);
  const input = { name: 'PG tenant', administrator: { email: 'postgres@example.test', name: 'Synthetic user' } };
  const operations = await Promise.all([provisioning.provision('concurrent', input), provisioning.provision('concurrent', input)]);
  assert.deepEqual(operations[0], operations[1]); const tenant = operations[0];
  assert.equal((await adminPool.query('SELECT * FROM h1_tenants')).rows.length, 1); assert.equal((await adminPool.query('SELECT * FROM h2_memberships')).rows.length, 1);
  const invitation = mail.messages[0].html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
  const enrolled = await auth.enroll(invitation, password, 'local'), secret = decode32(enrolled.secret), code = () => totp(secret, Math.floor(now / 30000));
  await auth.accept(invitation, password, code(), 'local'); now += 30000;
  const logins = await Promise.allSettled([auth, second].map(a => a.login(input.administrator.email, password, code(), tenant.tenantId, 'local')));
  assert.equal(logins.filter(r => r.status === 'fulfilled').length, 1); assert.equal(logins.find(r => r.status === 'rejected').reason.code, 'AUTHENTICATION_FAILED');
  const session = logins.find(r => r.status === 'fulfilled').value;
  const repository = new TenantMetadata(new PostgresMetadataDatabase(tenantPool, true), db);
  const context = await repository.authenticate(session.token, token => auth.verify(token));
  assert.equal((await repository.get(context, { kind: 'user', id: context.userId })).body.role, 'administrator');
  const switches = await Promise.allSettled([auth, second].map(a => a.switchTenant(session.token, tenant.tenantId)));
  assert.equal(switches.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(switches.find(r => r.status === 'rejected').reason.code, 'AUTHENTICATION_FAILED');
  const switched = switches.find(r => r.status === 'fulfilled').value;
  await second.logout(switched.token); await assert.rejects(auth.verify(switched.token), { code: 'AUTHENTICATION_FAILED' });
  // H5 uses operator-owned config metadata and the same tenant lock on Postgres.
  await initializeEmbedding(db);
  await assert.rejects(tenantPool.query('SELECT * FROM h5_embedding_config'), { code: '42501' });
  const embedding = new HostedEmbedding(db, repository, embeddingPolicy({}, config.origin));
  const replacements = await Promise.allSettled([embedding.put(context, defaultEmbedConfig(), 0), embedding.put(context, defaultEmbedConfig(), 0)]);
  assert.equal(replacements.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(replacements.find(r => r.status === 'rejected').reason.status, 412);
  assert.equal((await embedding.get(context)).revision, 1);
  now += 30000; const fresh = await auth.login(input.administrator.email, password, code(), tenant.tenantId, 'local');
  const current = await provisioning.operator.tenant(tenant.tenantId);
  await provisioning.operator.transition('suspend', tenant.tenantId, 'suspend', current.version);
  await assert.rejects(second.verify(fresh.token), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(repository.get(context, { kind: 'user', id: context.userId }), { code: 'TENANT_UNAVAILABLE' });
  await activateAuthKey(db, { ...config, keyId: 'rotated', signingKey: randomBytes(32) });
  await assert.rejects(auth.verify(fresh.token), { code: 'AUTH_KEY_REVOKED' });
  assert.deepEqual((await tenantPool.query('SELECT * FROM h1_tenants')).rows, []);
});

test('Issue 150 live Postgres: revocation between invitation lookup and tenant lock denies enrollment and acceptance', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
  const schema = `invitation_race_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); });
  await pool.query(`CREATE SCHEMA ${schema}`);
  const db = new PostgresMetadataDatabase(pool);
  await initializeMetadata(db, 'postgres'); await initializeAuth(db); await db.transaction(c => initializeAudit(c));
  const config = hostedConfig(environment()), mail = new StubMailTransport(), now = 1800000000000;
  const provisioning = new HostedProvisioning(db, config, mail, () => now), auth = await HostedAuth.create(db, config, () => now);
  const tenant = await provisioning.provision('race-workspace', { name: 'Race workspace', administrator: { email: 'race-admin@example.test', name: 'Admin' } });
  const token = mail.messages[0].html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
  const enrollment = await auth.enroll(token, password, 'local');
  await auth.accept(token, password, totp(decode32(enrollment.secret), Math.floor(now / 30000)), 'local');
  const [admin] = await db.transaction(c => c.query('SELECT user_id FROM h2_memberships WHERE tenant_id = ?', [tenant.tenantId]));
  const metadata = new TenantMetadata(db, db), context = await metadata.authenticate(null, async () => ({ namespaceId: tenant.namespaceId, userId: admin.user_id }));
  for (const action of ['enroll', 'accept']) {
    const created = await provisioning.inviteTenantMember(context, { email: `${action}-race@example.test`, name: action, role: 'reader_ai' });
    const invitedPassword = randomBytes(24).toString('base64');
    let code;
    if (action === 'accept') {
      const enrolled = await auth.enroll(created.token, invitedPassword, 'local');
      code = totp(decode32(enrolled.secret), Math.floor(now / 30000));
    }
    let invitationTransactions = 0, revoked = false;
    // Pause the final authentication transaction after its first invitation read,
    // before it locks the tenant. Revocation commits on another real connection.
    const racingDb = { durable: true, transaction: work => db.transaction(c => {
      let lookedUp = false;
      return work({ query: async (sql, values) => {
        const rows = await c.query(sql, values);
        if (!lookedUp && sql === 'SELECT * FROM h2_invitations WHERE token_hash = ?') {
          lookedUp = true;
          if (++invitationTransactions === 2) {
            await provisioning.revokeTenantInvitation(context, created.invitation.id); revoked = true;
          }
        }
        return rows;
      } });
    }) };
    const racingAuth = await HostedAuth.create(racingDb, config, () => now);
    await assert.rejects(action === 'enroll' ? racingAuth.enroll(created.token, invitedPassword, 'local')
      : racingAuth.accept(created.token, invitedPassword, code, 'local'), { code: 'AUTHENTICATION_FAILED' });
    assert.equal(revoked, true);
    const [stored] = await db.transaction(c => c.query('SELECT accepted, expires_at FROM h2_invitations WHERE invitation_id = ?', [created.invitation.id]));
    assert.equal(Number(stored.accepted), 0); assert.equal(Number(stored.expires_at), 0);
    assert.deepEqual(await provisioning.listTenantInvitations(context), []);
  }
});
