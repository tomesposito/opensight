import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Analytics } from '../dist/analytics.js';
import { AnalyticsStore, initializeAnalytics } from '../dist/analytics-store.js';
import { createHostedApiServer, drainHostedServer } from '../dist/hosted-server.js';
import { authFixture } from './hosted-helpers.mjs';

export function configEnv(config) {
  return { OPENSIGHT_PUBLIC_ORIGIN: config.origin, OPENSIGHT_AUTH_ISSUER: config.issuer, OPENSIGHT_AUTH_AUDIENCE: config.audience,
    OPENSIGHT_AUTH_KEY_ID: config.keyId, OPENSIGHT_AUTH_SIGNING_KEY: config.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: config.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: config.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(config.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(config.invitationSeconds) };
}
export async function serving(t, f, analytics) {
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, builtinAuth: f.auth,
    env: configEnv(f.config), mailTransport: f.mail, analytics });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => drainHostedServer(server));
  return async (path, { method = 'GET', token, body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ port: server.address().port, host: '127.0.0.1', path, method,
      headers: { Host: new URL(f.config.origin).host, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(bytes);
  });
}
test('analytics admin API validates booleans, protects both verbs, persists override, and overrides env both ways', async t => {
  const f = await authFixture(t); await initializeAnalytics(f.db);
  let calls = 0;
  const analytics = new Analytics(new AnalyticsStore(f.db), { enabled: true, vendorKey: 'test-only', transport: async () => { calls++; return { ok: true }; } });
  const request = await serving(t, f, analytics), { token } = await f.login();
  assert.equal((await request('/api/admin/analytics')).status, 401);
  assert.deepEqual((await request('/api/admin/analytics', { token })).body, { enabled: true, override: null, defaultEnabled: true, configured: true });
  for (const body of [{}, { enabled: 'false' }, { enabled: 0 }, { enabled: null }, { enabled: false, tenantId: 'foreign' }, { enabled: true, email: 'private' }]) {
    assert.equal((await request('/api/admin/analytics', { token, method: 'POST', body })).status, 400);
  }
  assert.equal((await request('/api/admin/analytics', { token, method: 'POST', body: { enabled: false } })).body.enabled, false);
  analytics.track(f.tenant, { name: 'analysis_created' }); await analytics.flush(); assert.equal(calls, 0);
  const again = new Analytics(new AnalyticsStore(f.db), { enabled: true, vendorKey: 'test-only' });
  assert.equal((await again.settings(f.tenant)).override, false);
  await request('/api/admin/analytics', { token, method: 'POST', body: { enabled: true } });
  const envOff = new Analytics(new AnalyticsStore(f.db), { enabled: false, vendorKey: 'test-only', transport: async () => { calls++; return { ok: true }; } });
  envOff.track(f.tenant, { name: 'analysis_created' }); await envOff.close(); assert.equal(calls, 1);
  assert.equal((await new Analytics(new AnalyticsStore(f.db), { enabled: true }).settings(f.tenant)).enabled, false);
  await f.db.transaction(async c => {
    const row = (await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND kind = 'user'", [f.tenant.tenantId]))[0];
    await c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = ? AND kind = 'user'", [JSON.stringify({ ...JSON.parse(row.body), role: 'reader' }), f.tenant.tenantId]);
  });
  for (const method of ['GET', 'POST']) assert.equal((await request('/api/admin/analytics', { token, method, ...(method === 'POST' ? { body: { enabled: false } } : {}) })).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
});
