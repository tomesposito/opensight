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
test('provisioning, invitation and activation emit after success and skip idempotent replays', async t => {
  const { database, decode32 } = await import('./hosted-helpers.mjs');
  const { HostedProvisioning } = await import('../dist/hosted-provisioning.js');
  const { HostedAuth } = await import('../dist/hosted-auth.js');
  const { StubMailTransport } = await import('../dist/mail.js');
  const { totp } = await import('../dist/auth-crypto.js');
  const { randomBytes } = await import('node:crypto');
  const f = await database(t); await initializeAnalytics(f.db); const calls = [];
  const analytics = new Analytics(new AnalyticsStore(f.db), { enabled: true, vendorKey: 'test-only', transport: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; } });
  const mail = new StubMailTransport(), provisioning = new HostedProvisioning(f.db, f.config, mail, Date.now, undefined, analytics);
  const input = { name: 'Synthetic private label', administrator: { email: 'synthetic@example.test', name: 'Private administrator' } };
  const tenant = await provisioning.provision('analytics-onboard', input); await provisioning.provision('analytics-onboard', input);
  await assert.rejects(provisioning.provision('analytics-onboard', { ...input, name: 'Different' }));
  const invitation = { email: 'another@example.test', name: 'Private invitee', role: 'reader' };
  await provisioning.inviteMember('analytics-invite', tenant.tenantId, invitation); await provisioning.inviteMember('analytics-invite', tenant.tenantId, invitation);
  const token = mail.messages[0].html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
  const auth = await HostedAuth.create(f.db, f.config); auth.analytics = analytics;
  const enrollment = await auth.enroll(token, password, 'local'), code = totp(decode32(enrollment.secret), Math.floor(Date.now() / 30000));
  await auth.accept(token, password, code, 'local'); await auth.accept(token, password, code, 'local'); await analytics.flush();
  assert.deepEqual(calls.map(c => c.event), ['tenant_provisioned', 'user_invited', 'user_invited', 'user_activated']);
  assert.ok(calls.every(c => c.properties.distinct_id === tenant.tenantId)); assert.doesNotMatch(JSON.stringify(calls), /Private|Synthetic|example\.test/);
  await analytics.close();
});
test('committed uploads and prep saves emit fixed properties; rejected mutations emit nothing', async t => {
  const { sourceFixture, upload } = await import('./source-helpers.mjs');
  const { HostedData } = await import('../dist/hosted-data.js'); const { HostedPrep } = await import('../dist/hosted-prep.js');
  const f = await sourceFixture(t); await initializeAnalytics(f.db);
  const store = new AnalyticsStore(f.db), analytics = new Analytics(store, { enabled: true, vendorKey: 'test-only', transport: async () => ({ ok: true }) });
  const data = new HostedData(f.sources, undefined, f.budgets, undefined, undefined, analytics), prep = new HostedPrep(data);
  const context = await f.login(); data.begin(context);
  await assert.rejects(data.upload(context, { ...upload(), base64: 'bad' }));
  const source = await data.upload(context, upload());
  await prep.save(context, 'prepared', { name: 'Private dataset', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
  await assert.rejects(prep.save(context, 'prepared', { name: 'Private dataset', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 }));
  await analytics.close();
  const rows = await store.read(f.metadata, await f.login());
  assert.deepEqual(rows.map(r => [r.name, r.props]), [['dataset_uploaded', { sourceType: 'file', rowCountBucket: '1-99' }], ['dataset_prep_saved', {}]]);
});
test('analysis first visual survives removal and server restart; dashboard views and shares use server routes', async t => {
  const f = await authFixture(t); await initializeAnalytics(f.db); const calls = [];
  const analytics = new Analytics(new AnalyticsStore(f.db), { enabled: true, vendorKey: 'test-only', transport: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; } });
  const request = await serving(t, f, analytics), { token } = await f.login(), base = '/api/v1/analyses';
  const input = { analysisId: 'tracked', name: 'Private analysis', definition: { dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 'sheet', visuals: [] }], calculatedFields: [], filterGroups: [] }, datasetBindings: {} };
  const create = { token, method: 'POST', body: input, headers: { 'idempotency-key': 'create-tracked' } };
  assert.equal((await request(base, create)).status, 201); assert.equal((await request(base, create)).status, 201);
  const visual = { kpiVisual: { visualId: 'first' } }, path = `${base}/tracked/sheets/sheet/visuals`;
  assert.equal((await request(path, { token, method: 'POST', body: visual, headers: { 'if-match': '"1"' } })).status, 200);
  assert.equal((await request(`${path}/first`, { token, method: 'DELETE', headers: { 'if-match': '"2"' } })).status, 200);
  const restart = await serving(t, f, analytics);
  assert.equal((await restart(path, { token, method: 'POST', body: visual, headers: { 'if-match': '"3"' } })).status, 200);
  const published = await restart(`${base}/tracked/publish`, { token, method: 'POST', body: {} }); assert.equal(published.status, 201, JSON.stringify(published.body));
  const dash = `/api/v1/dashboards/${published.body.DashboardId}`;
  assert.equal((await restart(dash, { token })).status, 200);
  const userId = (await f.db.transaction(c => c.query('SELECT user_id FROM h2_memberships WHERE tenant_id = ? AND status = ?', [f.tenant.tenantId, 'active'])))[0].user_id;
  assert.equal((await restart(`${dash}/shares/user/${userId}`, { token, method: 'PUT', body: { role: 'viewer' }, headers: { 'if-match': '"1"' } })).status, 200);
  await analytics.flush(); assert.deepEqual(calls.map(c => c.event), ['analysis_created', 'analysis_first_visual', 'dashboard_viewed', 'dashboard_shared']);
  assert.ok(calls.every(c => Object.keys(c.properties).length === 3));
});
test('Ask O counts validated questions without text; admin connection tests do not emit questions', async t => {
  const { organizationApi } = await import('./organization-helpers.mjs');
  const { fixture } = await import('./analytics-helpers.mjs');
  const f = await fixture(), calls = [];
  const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', localScopes: new Map([['default', f.a]]), transport: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; } });
  t.after(async () => { await analytics.close(); await f.db.close(); });
  const { api } = await organizationApi(t, { analytics, ai: { bootstrap: { provider: 'openai', model: 'test-model', key: 'test-only' }, fetcher: async (_url, init) => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.parse(init.body).max_output_tokens === 32 ? 'OK' : '{"question":"sum revenue by region"}' }] }] }) } });
  assert.equal((await api('/api/o/generate', 'POST', { question: 'private content', email: 'private' })).status, 400);
  assert.equal((await api('/api/o/generate', 'POST', { question: 'sum revenue by region' }, '')).status, 401);
  assert.equal((await api('/api/admin/ai/test', 'POST', {})).status, 200);
  assert.equal((await api('/api/o/generate', 'POST', { question: 'How much revenue in each region?' })).status, 200);
  assert.equal((await api('/api/o/query', 'POST', { query: { dimensions: [], measures: [{ fieldId: 'value', columnName: 'revenue', aggregation: 'SUM' }], filters: [] } })).status, 200);
  await analytics.flush(); assert.equal(calls.length, 1); assert.equal(calls[0].event, 'ask_o_asked');
  assert.deepEqual(calls[0].properties, { count: 1, distinct_id: 'a', $groups: { tenant: 'a' }, $process_person_profile: false });
});
test('embedded content emits a view only after authorized content is available', async t => {
  const { sessionFixture, request, parentOrigin } = await import('./embed-session-helpers.mjs');
  const { seedEmbedContent } = await import('./embed-content-helpers.mjs');
  const { httpStack } = await import('./embed-http-helpers.mjs');
  const f = await sessionFixture(t); await seedEmbedContent(f); await initializeAnalytics(f.db); const events = [];
  const analytics = new Analytics(new AnalyticsStore(f.db), { enabled: true, vendorKey: 'test-only', transport: async (_url, init) => { events.push(JSON.parse(init.body)); return { ok: true }; } });
  const { call } = await httpStack(t, f, analytics), auth = `Bearer ${(await f.login()).token}`;
  const issued = await call('/api/embedding/GenerateEmbedUrlForRegisteredUser', 'POST', request(), auth); assert.equal(issued.status, 200);
  const url = new URL(issued.body.EmbedUrl), path = `/api/embed/sessions/${issued.body.sessionId}`;
  const redeemed = await call(`${path}/redeem`, 'POST', { bootstrap: new URLSearchParams(url.hash.slice(1)).get('bootstrap'), parentOrigin, channelId: (await import('node:crypto')).randomBytes(24).toString('base64url') }); assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
  const credential = `Embed ${redeemed.body.credential}`;
  assert.equal((await call(`${path}/status`, 'GET', undefined, credential)).status, 200);
  assert.equal((await call(`${path}/content`, 'GET', undefined, 'Embed invalid')).status, 401);
  await analytics.flush(); assert.equal(events.length, 0);
  assert.equal((await call(`${path}/content`, 'GET', undefined, credential)).status, 200);
  await analytics.close(); assert.deepEqual(events.map(e => e.event), ['embed_viewed']);
});
test('local server draft save selecting sample sales records the honest opt-in point once', async t => {
  const { fixture } = await import('./analytics-helpers.mjs'), { organizationApi } = await import('./organization-helpers.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises'), { join } = await import('node:path'), { tmpdir } = await import('node:os');
  const f = await fixture(), dir = await mkdtemp(join(tmpdir(), 'analytics-sample-')), calls = [];
  const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', localScopes: new Map([['default', f.a]]), transport: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; } });
  t.after(async () => { await analytics.close(); await f.db.close(); await rm(dir, { recursive: true, force: true }); });
  const { api } = await organizationApi(t, { analytics, security: { storePath: join(dir, 'security.json') } });
  const definition = { dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:sales' }], sheets: [{ sheetId: 'sheet', visuals: [] }], calculatedFields: [], filterGroups: [] };
  const input = { analysisId: 'sample-selected', name: 'Synthetic sample draft', definition, datasetBindings: { sales: { kind: 'dataset', id: 'sales' } } };
  const created = await api('/api/v1/analyses', 'POST', input); assert.equal(created.status, 201, JSON.stringify(created.body));
  const { analysisId, ...replacement } = input;
  assert.equal((await api(`/api/v1/analyses/${analysisId}`, 'PUT', replacement, 'default-admin', { 'if-match': '"1"' })).status, 200);
  await analytics.close(); assert.deepEqual(calls.map(c => c.event), ['analysis_created', 'sample_data_opted_in']);
});
