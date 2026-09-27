import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { organizationApi } from './organization-helpers.mjs';
const origin = 'https://api.example.com', parentOrigin = 'https://app.example.com';
const endpoint = '/dashboards/sales-dashboard/embed-url';
async function embeddedApi(t, options = {}) {
  const previous = process.env.OPENSIGHT_EMBED_SECRET;
  const secret = randomBytes(48).toString('base64');
  process.env.OPENSIGHT_EMBED_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.OPENSIGHT_EMBED_SECRET; else process.env.OPENSIGHT_EMBED_SECRET = previous; });
  const api = await organizationApi(t, { embedding: { origin, allowedParentOrigins: [parentOrigin] }, ...options });
  return { ...api, secret };
}
const signature = (payload, secret) => createHmac('sha256', secret).update(`OpenSight:embed:v1:${payload}`).digest('base64url');
function retoken(url, update, secret) {
  const result = new URL(url), [payload] = result.searchParams.get('token').split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url')); update(claims);
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  result.searchParams.set('token', `${encoded}.${signature(encoded, secret)}`); return result;
}
async function load(api, url) { const parsed = new URL(url); return fetch(`${api.origin}${parsed.pathname}${parsed.search}`); }

test('embed URL uses independent HMAC-SHA256 verification, explicit principal/resource/origin scope and bounded expiry', async t => {
  const api = await embeddedApi(t);
  const result = await api.api(endpoint, 'POST', { parentOrigin, visualId: 'total-revenue', expiresInSeconds: 60 }, 'default-alice');
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  const url = new URL(result.body.url), token = url.searchParams.get('token'), [payload, mac] = token.split('.');
  assert.equal(url.origin, origin); assert.equal(mac, signature(payload, api.secret));
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.namespaceId, 'default'); assert.equal(claims.userId, 'alice'); assert.equal(claims.visualId, 'total-revenue');
  assert.equal(claims.dashboardId, 'sales-dashboard'); assert.equal(claims.parentOrigin, parentOrigin);
  assert.equal(claims.expiresAt - claims.issuedAt, 60);
  assert.equal(result.body.expiresAt, new Date(claims.expiresAt * 1000).toISOString());
  assert.notEqual((await api.api(endpoint, 'POST', { parentOrigin }, 'default-alice')).body.url, result.body.url);
});
test('hosted iframe renders the selected visual using viewer RLS, existing chart bundle, escaped data and frame restrictions', async t => {
  const api = await embeddedApi(t);
  await api.api('/api/datasets/sales/row-rules/east', 'PUT', { principals: [{ type: 'user', id: 'alice' }], predicate: { column: 'region', operator: 'eq', value: 'East' } });
  const signed = await api.api(endpoint, 'POST', { parentOrigin, visualId: 'total-revenue' }, 'default-alice');
  const response = await load(api, signed.body.url); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/app\.example\.com/);
  const html = await response.text();
  const payload = /id="opensight-embed-data">(.*?)<\/script>/.exec(html)?.[1]; assert.ok(payload);
  const data = JSON.parse(payload); assert.equal(data.visuals.length, 1); assert.deepEqual(data.visuals[0].rows, [{ revenue: 500 }]);
  assert.equal(data.visuals[0].source, 'api'); assert.ok(html.includes('opensight:ready'));
  assert.ok(!html.includes(api.secret)); assert.ok(!html.includes(new URL(signed.body.url).searchParams.get('token')));
  assert.ok(!payload.includes('<report>')); assert.equal(data.title, 'Sales <report>');
  await api.api('/api/datasets/sales/column-grants/deny', 'PUT', { column: 'revenue', effect: 'deny', principals: [{ type: 'user', id: 'alice' }] });
  const denied = await load(api, signed.body.url); assert.equal(denied.status, 422); assert.equal((await denied.json()).errorCode, 'COLUMN_ACCESS_DENIED');
});
test('full dashboard embedding renders all stored visuals and never falls back to fixture rows', async t => {
  const api = await embeddedApi(t);
  const signed = await api.api(endpoint, 'POST', { parentOrigin }, 'default-alice');
  const response = await load(api, signed.body.url); assert.equal(response.status, 200);
  const data = JSON.parse(/id="opensight-embed-data">(.*?)<\/script>/.exec(await response.text())[1]);
  assert.equal(data.visuals.length, 5); assert.ok(data.visuals.every(v => Array.isArray(v.rows)));
});
test('embed tokens reject tampering, expiry, wrong resources, malformed claims and arbitrary query selectors', async t => {
  const api = await embeddedApi(t);
  const signed = (await api.api(endpoint, 'POST', { parentOrigin }, 'default-alice')).body.url;
  const badSignature = new URL(signed); badSignature.searchParams.set('token', badSignature.searchParams.get('token') + 'A');
  const wrongResource = new URL(signed); wrongResource.pathname = '/embed/dashboards/other';
  const duplicate = new URL(signed); duplicate.searchParams.append('token', duplicate.searchParams.get('token'));
  const invalids = [badSignature, wrongResource, duplicate, `${signed}&namespace=tenant`, retoken(signed, c => { c.expiresAt = c.issuedAt - 1; }, api.secret),
    retoken(signed, c => { c.expiresAt = c.issuedAt + 901; }, api.secret), retoken(signed, c => { c.issuedAt += 600; c.expiresAt += 600; }, api.secret),
    retoken(signed, c => { c.audience = 'general-api'; }, api.secret), retoken(signed, c => { c.userId = 'unknown'; }, api.secret), retoken(signed, c => { c.parentOrigin = 'https://evil.example'; }, api.secret),
    retoken(signed, c => { c.groups = ['admin']; }, api.secret), retoken(signed, c => { c.userId = 'admin'; }, randomBytes(32).toString('hex'))];
  for (const url of invalids) { const response = await load(api, url); assert.equal(response.status, 401); assert.equal((await response.json()).errorCode, 'INVALID_EMBED_TOKEN'); }
  assert.equal((await fetch(`${api.origin}/embed/dashboards/sales-dashboard`)).status, 401);
  assert.equal((await api.api(`/api/assets?token=${new URL(signed).searchParams.get('token')}`, 'GET', undefined, '')).status, 401);
});
test('share and folder revocation and user/group changes invalidate existing URLs on their next load', async t => {
  const api = await embeddedApi(t);
  await api.api('/dashboards/sales-dashboard/shares/group/team', 'PUT', { role: 'viewer' });
  const signed = (await api.api(endpoint, 'POST', { parentOrigin, visualId: 'total-revenue' }, 'default-alice')).body.url;
  assert.equal((await load(api, signed)).status, 200);
  await api.api('/api/groups/team', 'PUT', { name: 'Team', userIds: [] });
  assert.equal((await load(api, signed)).status, 404);
  await api.api('/api/groups/team', 'PUT', { name: 'Team', userIds: ['alice'] });
  await api.api('/api/folders/private', 'PUT', { name: 'Private' });
  await api.api('/api/assets/dashboard/sales-dashboard/move', 'POST', { folderId: 'private' });
  await api.api('/api/folders/private/permissions', 'PUT', { grants: [] });
  assert.equal((await load(api, signed)).status, 404);
  await api.api('/api/folders/private/permissions', 'PUT', { grants: null });
  await api.api('/dashboards/sales-dashboard/shares/group/team', 'DELETE');
  assert.equal((await load(api, signed)).status, 404);
  await api.api('/api/groups/team', 'PUT', { name: 'Team', userIds: [] });
  await api.api('/api/users/alice', 'DELETE');
  assert.equal((await load(api, signed)).status, 401);
});
test('embed issuance validates origins, claims, TTL, methods, credentials and environment-only configuration', async t => {
  const api = await embeddedApi(t);
  for (const body of [null, {}, { parentOrigin, userId: 'admin' }, { parentOrigin, secret: 'not-accepted' }, { parentOrigin, expiresInSeconds: 0 }, { parentOrigin, expiresInSeconds: 901 }, { parentOrigin, expiresInSeconds: 60.5 }, { parentOrigin: 'javascript:alert(1)' }, { parentOrigin: `${parentOrigin}/` }, { parentOrigin, visualId: '../bad' }]) assert.equal((await api.api(endpoint, 'POST', body)).status, 400);
  assert.equal((await api.api(endpoint, 'POST', { parentOrigin: 'https://evil.example' })).status, 403);
  assert.equal((await api.api(endpoint, 'POST', { parentOrigin, visualId: 'missing' })).status, 404);
  assert.equal((await api.api(endpoint, 'POST', { parentOrigin }, 'tenant-admin')).status, 404);
  assert.equal((await api.api(endpoint, 'POST', { parentOrigin }, '')).status, 401);
  assert.equal((await api.api(endpoint)).status, 405);
  assert.equal((await api.api(`${endpoint}?x=1`, 'POST', { parentOrigin })).status, 400);
  delete process.env.OPENSIGHT_EMBED_SECRET;
  const unconfigured = await organizationApi(t, { embedding: { origin, allowedParentOrigins: [parentOrigin] } });
  assert.equal((await unconfigured.api(endpoint, 'POST', { parentOrigin })).body.errorCode, 'EMBEDDING_NOT_CONFIGURED');
  process.env.OPENSIGHT_EMBED_SECRET = randomBytes(8).toString('hex');
  const weak = await organizationApi(t, { embedding: { origin, allowedParentOrigins: [parentOrigin] } });
  assert.equal((await weak.api(endpoint, 'POST', { parentOrigin })).status, 503);
});
test('embed URL issuance has exact-origin credentialed CORS and rejects broadened preflight requests', async t => {
  const api = await embeddedApi(t);
  const preflight = headers => fetch(`${api.origin}${endpoint}`, { method: 'OPTIONS', headers });
  const headers = { Origin: parentOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' };
  const response = await preflight(headers); assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), parentOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await preflight({ ...headers, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await preflight({ ...headers, 'Access-Control-Request-Headers': 'x-user-id' })).status, 400);
  const issued = await api.api(endpoint, 'POST', { parentOrigin }, 'default-alice', { Origin: parentOrigin });
  assert.equal(issued.status, 200); assert.equal(issued.headers.get('access-control-allow-origin'), parentOrigin);
});
