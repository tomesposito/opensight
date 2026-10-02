import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sessionFixture, request, parentOrigin } from './embed-session-helpers.mjs';
import { EmbedSessions, activateEmbedKey } from '../dist/embed-sessions.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';

test('H6 scoped five-minute bootstrap, atomic race/replay, memory-only credential and restart', async t => {
  const f = await sessionFixture(t), issued = await f.issue();
  assert.equal(issued.SessionLifetimeInMinutes, 600);
  assert.equal(Date.parse(issued.bootstrapExpiresAt) - f.clock(), 300000);
  const url = new URL(issued.EmbedUrl); assert.equal(url.search, ''); assert.ok(url.hash.startsWith('#bootstrap='));
  const race = await Promise.allSettled([f.redeem(issued), f.redeem(issued)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.code, 'EMBED_BOOTSTRAP_REPLAY');
  const session = race.find(r => r.status === 'fulfilled').value;
  assert.equal(session.expiresAt - f.clock(), 36000000);
  const reopened = new SqliteMetadataDatabase(f.path); t.after(() => reopened.close());
  const second = new EmbedSessions(reopened, f.metadata, f.policy, f.key, async () => {}, f.clock); await second.initialize();
  assert.equal((await second.verify(issued.sessionId, session.credential)).session.userId, f.identity.userId);
  const records = await f.db.transaction(c => c.query('SELECT * FROM h6_sessions'));
  assert.ok(!JSON.stringify(records).includes(session.credential)); assert.ok(!JSON.stringify(records).includes(url.hash.slice(11)));
  await assert.rejects(second.redeem(issued.sessionId, { bootstrap: url.hash.slice(11), parentOrigin, channelId: randomBytes(24).toString('base64url') }), { code: 'EMBED_BOOTSTRAP_REPLAY' });
  await assert.rejects(f.auth.verify(session.credential), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(second.verify(issued.sessionId, url.hash.slice(11)), { code: 'INVALID_EMBED_TOKEN' });
});
test('H6 rejects unknown scope, overlong duration, forged domains and target subjects', async t => {
  const f = await sessionFixture(t);
  for (const minutes of [14, 601, 15.5, '15', null, 0]) await assert.rejects(f.issue(request({ SessionLifetimeInMinutes: minutes })), { code: 'EMBED_SESSION_LIMIT_EXCEEDED' });
  for (const domains of [[], Array(4).fill(parentOrigin), [parentOrigin, parentOrigin], ['https://evil.example'], ['https://*.example'], ['null']]) await assert.rejects(f.issue(request({ AllowedDomains: domains })));
  const runtime = await f.issue(request({ AllowedDomains: ['https://second.example'], SessionLifetimeInMinutes: 15 }));
  await assert.rejects(f.redeem(runtime), { code: 'EMBED_ORIGIN_DENIED' });
  assert.equal((await f.redeem(runtime, { parentOrigin: 'https://second.example' })).expiresAt - f.clock(), 900000);
  for (const body of [request({ groups: ['admin'] }), request({ UserArn: 'urn:opensight:foreign:user/reader' }), request({ UserArn: f.arn('user', 'missing') }),
    request({ ExperienceConfiguration: { Dashboard: { InitialDashboardId: 'dashboard', export: true } } }),
    request({ ExperienceConfiguration: { Dashboard: { InitialDashboardId: 'dashboard' }, QSearchBar: { InitialTopicId: 'topic' } } })]) await assert.rejects(f.issue(body));
  const first = await f.issue(), other = await f.issue();
  await assert.rejects(f.redeem(first, { bootstrap: new URL(other.EmbedUrl).hash.slice(11) }), { code: 'INVALID_EMBED_TOKEN' });
  await assert.rejects(f.sessions.issue({ ...await f.context() }, request()), { code: 'TENANT_CONTEXT_REQUIRED' });
});
test('H6 renewal needs issuer authentication, invalidates the old session and serializes races', async t => {
  const f = await sessionFixture(t), issued = await f.issue(), redeemed = await f.redeem(issued);
  const context = await f.context();
  const race = await Promise.allSettled([f.sessions.renew(context, issued.sessionId), f.sessions.renew(context, issued.sessionId)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(f.sessions.verify(issued.sessionId, redeemed.credential), { code: 'EMBED_SESSION_REVOKED' });
  const next = race.find(r => r.status === 'fulfilled').value, active = await f.redeem(next);
  assert.ok(await f.sessions.verify(next.sessionId, active.credential));
  await f.sessions.revoke(context, next.sessionId);
  await assert.rejects(f.sessions.renew(context, next.sessionId), { code: 'EMBED_SESSION_REVOKED' });
});
test('H6 bootstrap/session expiry, configuration/policy revisions, suspension and user removal fail closed', async t => {
  for (const change of ['bootstrap', 'expiry', 'configuration', 'policy', 'suspension', 'removal']) {
    const f = await sessionFixture(t), issued = await f.issue(request({ SessionLifetimeInMinutes: 15 }));
    if (change === 'bootstrap') { f.advance(300000); await assert.rejects(f.redeem(issued), { code: 'EMBED_BOOTSTRAP_EXPIRED' }); continue; }
    const r = await f.redeem(issued);
    if (change === 'expiry') f.advance(900000);
    if (change === 'configuration') await f.embedding.put(await f.context(), f.config, 1);
    if (change === 'policy') await f.db.transaction(c => c.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ?', [f.tenant.tenantId]));
    if (change === 'suspension') { const tenant = await f.provisioning.operator.tenant(f.tenant.tenantId); await f.provisioning.transition('suspend', f.tenant.tenantId, 'suspend', tenant.version); }
    if (change === 'removal') await f.provisioning.removeMember(f.tenant.tenantId, f.identity.userId);
    await assert.rejects(f.sessions.verify(issued.sessionId, r.credential));
  }
});
test('H6 shared versioned key retirement revokes bootstrap and active sessions across nodes', async t => {
  const f = await sessionFixture(t), issued = await f.issue(), redeemed = await f.redeem(issued), unspent = await f.issue();
  const key = { id: 'embed-two', secret: randomBytes(32) }; await activateEmbedKey(f.db, key);
  for (const check of [() => f.sessions.verify(issued.sessionId, redeemed.credential), () => f.redeem(unspent), () => f.issue(), () => f.sessions.initialize()]) await assert.rejects(check, { code: 'EMBED_KEY_REVOKED' });
  await assert.rejects(activateEmbedKey(f.db, f.key), { code: 'EMBED_KEY_REUSED' });
  await assert.rejects(activateEmbedKey(f.db, { ...key, secret: randomBytes(32) }), { code: 'EMBED_KEY_REUSED' });
  const next = new EmbedSessions(f.db, f.metadata, f.policy, key, async () => {}, f.clock); await next.initialize();
  assert.ok((await next.issue(await f.context(), request())).EmbedUrl);
});
test('H6 anonymous virtual namespace and tags are scoped; readers cannot delegate or author', async t => {
  const f = await sessionFixture(t), body = request({ Namespace: 'virtual', AuthorizedResourceArns: [f.arn('dashboard', 'dashboard')], SessionTags: [{ Key: 'region', Value: 'east' }] });
  const issued = await f.issue(body, true), redeemed = await f.redeem(issued), session = (await f.sessions.verify(issued.sessionId, redeemed.credential)).session;
  assert.equal(session.virtualNamespace, 'virtual'); assert.equal(session.namespaceId, f.identity.namespaceId); assert.deepEqual(session.tags, { region: 'east' });
  for (const attack of [{ ...body, AuthorizedResourceArns: ['urn:opensight:foreign:dashboard/dashboard'] }, { ...body, SessionTags: [{ Key: 'region', Value: 'east' }, { Key: 'region', Value: 'west' }] }, { ...body, ExperienceConfiguration: { QuickSightConsole: {} } }]) await assert.rejects(f.issue(attack, true));
  await f.metadata.put(await f.context(), { kind: 'user', id: f.identity.userId }, { name: 'Reader', role: 'reader' }, 1);
  await assert.rejects(f.issue(body, true), { code: 'SECURITY_ADMIN_REQUIRED' });
  await assert.rejects(f.issue(request({ ExperienceConfiguration: { QuickSightConsole: {} } })), { code: 'EMBED_AUTHOR_REQUIRED' });
  assert.ok(await f.issue());
});
test('H6 authorization is rechecked after asynchronous asset checks before issuance/redemption', async t => {
  let mutate = async () => {}; const f = await sessionFixture(t, () => mutate());
  mutate = () => f.db.transaction(c => c.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ?', [f.tenant.tenantId]));
  await assert.rejects(f.issue(), { code: 'EMBED_SESSION_REVOKED' });
  mutate = async () => {}; const issued = await f.issue();
  mutate = () => f.db.transaction(c => c.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ?', [f.tenant.tenantId]));
  await assert.rejects(f.redeem(issued), { code: 'EMBED_SESSION_REVOKED' });
});

test('H6 cross-tenant handles and reduced operator origins cannot revoke, renew or redeem', async t => {
  const f = await sessionFixture(t), issued = await f.issue();
  const other = await f.provisioning.provision('other-tenant', { name: 'Other', administrator: { email: 'different@example.test', name: 'Other administrator' } });
  const user = await f.db.transaction(c => c.query("SELECT resource_id FROM h1_resources WHERE tenant_id = ? AND kind = 'user'", [other.tenantId]));
  const foreign = await f.metadata.authenticate(null, async () => ({ namespaceId: other.namespaceId, userId: user[0].resource_id }));
  await assert.rejects(f.sessions.revoke(foreign, issued.sessionId), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(f.sessions.renew(foreign, issued.sessionId), { code: 'RESOURCE_NOT_FOUND' });
  const reduced = new EmbedSessions(f.db, f.metadata, { ...f.policy, tenants: new Map() }, f.key, async () => {}, f.clock);
  await assert.rejects(reduced.redeem(issued.sessionId, { bootstrap: new URL(issued.EmbedUrl).hash.slice(11), parentOrigin, channelId: randomBytes(24).toString('base64url') }), { code: 'EMBED_ORIGIN_DENIED' });
});
