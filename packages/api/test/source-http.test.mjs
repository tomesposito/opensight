import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { authFixture } from './hosted-helpers.mjs';
import { registration, upload, credentials } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedDataRoutes } from '../dist/hosted-data-routes.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { sourceFixture } from './source-helpers.mjs';
async function serving(t, f, overrides = {}) {
  const c = f.config, env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds),
    OPENSIGHT_SOURCE_ENDPOINTS: JSON.stringify([{ id: 'reference', host: 'localhost', port: 5433, database: 'opensight', tls: false }]) };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, env, ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path, method = 'GET', body, token) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { Host: new URL(c.origin).host,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}) } }, res => {
      let data = ''; res.on('data', b => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }));
    }); req.on('error', reject); req.end(bytes);
  });
}
test('H3 HTTP durable source lifecycle, policy gates, uploads, owner prep and unsupported surfaces compose', async t => {
  const f = await authFixture(t), call = await serving(t, f); let token = (await f.login()).token;
  const write = async (path, method, body) => {
    const result = await call(path, method, body, token);
    if (result.status < 400) {
      assert.equal((await call('/api/sources', 'GET', undefined, token)).status, 401, 'A durable write invalidates the old revision-bound session');
      token = (await f.login()).token;
    }
    return result;
  };
  for (const path of ['/api/sources', '/api/uploads', '/api/connectors', '/api/ai/sources', '/api/prep-datasets/import']) assert.equal((await call(path)).status, 401);
  assert.deepEqual((await call('/api/connectors', 'GET', undefined, token)).body.map(c => c.id).sort(), ['file', 'postgresql']);
  const raw = registration();
  let r = await write('/api/sources/tenant-source', 'PUT', raw); assert.equal(r.status, 201); assert.equal(JSON.stringify(r.body).includes(raw.credentials.password), false); assert.equal('secretId' in r.body, false);
  assert.equal((await write('/api/sources/tenant-source/rotate', 'POST', { expectedVersion: 1, credentials: credentials() })).status, 200);
  assert.equal((await write('/api/sources/tenant-source/bind', 'POST', { expectedVersion: 2, policy: { rowLevel: true, rowRules: [] } })).status, 200);
  for (const path of ['query', 'preview', 'output']) assert.equal((await call(`/api/sources/tenant-source/${path}`, 'POST', {}, token)).body.errorCode, 'ROW_ACCESS_DENIED');
  assert.equal((await call('/api/ai/sources/tenant-source/schema', 'GET', undefined, token)).body.errorCode, 'ROW_ACCESS_DENIED');
  assert.equal((await write('/api/sources/tenant-source', 'DELETE', { expectedVersion: 3 })).status, 200);
  assert.equal((await call('/api/sources/tenant-source', 'GET', undefined, token)).body.errorCode, 'SOURCE_RETIRED');
  r = await write('/api/uploads', 'POST', upload()); assert.equal(r.status, 201); const id = r.body.id;
  assert.equal((await call(`/api/uploads/${id}`, 'GET', undefined, token)).body.rows.length, 3);
  assert.equal((await call(`/api/ai/sources/${id}/schema`, 'GET', undefined, token)).body.columns.length, 3);
  const pipeline = { version: 1, input: id, steps: [] };
  assert.equal((await write('/api/datasets/private/prep', 'PUT', { name: 'Private', pipeline, expectedVersion: 0 })).status, 200);
  assert.equal((await call('/api/datasets/private/rows', 'GET', undefined, token)).body.rows.length, 3);
  assert.equal((await call('/api/datasets/private/share', 'POST', {}, token)).body.errorCode, 'PREP_SHARING_REFUSED');
  assert.equal((await call('/api/datasets/private/embed', 'POST', {}, token)).body.errorCode, 'PREP_EMBED_REFUSED');
  assert.equal((await call('/api/namespaces/foreign/sources', 'GET', undefined, token)).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await call('/api/sources/foreign', 'GET', undefined, token)).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await call('/api/automation-status', 'GET', undefined, token)).body.persistence, 'durable');
  for (const path of ['/api/assets', '/api/o/generate', '/embed/foreign']) assert.equal((await call(path, 'GET', undefined, token)).body.errorCode, 'HOSTED_CAPABILITY_UNAVAILABLE');
  for (const changes of [{ secretId: 'foreign' }, { tenantId: 'foreign' }, { policy: undefined }, { credentials: { ...raw.credentials, host: 'unapproved.example' } }]) {
    r = await call('/api/sources/invalid', 'PUT', { ...raw, ...changes }, token); assert.ok(r.status >= 400); assert.equal(JSON.stringify(r.body).includes(raw.credentials.password), false);
  }
});
test('H3 HTTP checks the verified session again immediately before publishing data', async t => {
  const f = await authFixture(t), token = (await f.login()).token; let calls = 0;
  const call = await serving(t, f, { security: { authenticate: async req => { calls++; if (calls > 1) return undefined; return f.auth.authenticate(req); } } });
  const result = await call('/api/sources', 'GET', undefined, token);
  assert.equal(calls, 2); assert.equal(result.status, 401); assert.deepEqual(result.body, { errorCode: 'PRINCIPAL_REQUIRED' });
});
test('H3 HTTP revoked verification after body intake prevents durable source writes', async t => {
  const f = await authFixture(t), token = (await f.login()).token; let calls = 0;
  const call = await serving(t, f, { security: { authenticate: async req => ++calls === 1 ? f.auth.authenticate(req) : undefined } });
  const result = await call('/api/sources/refused', 'PUT', registration(), token);
  assert.equal(calls, 2); assert.equal(result.status, 401);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind IN ('source','secret')"))).length, 0);
});
test('H3 every data response rejects policy changes or expiry during the final verifier check', async t => {
  for (const change of ['policy', 'expiry']) for (const path of ['discovery', 'query', 'preview', 'output', 'ai', 'prep']) {
    const f = await sourceFixture(t), a = await f.login(), source = await f.sources.upload(a, upload(undefined, new Date(Date.now() + 60000).toISOString()));
    const routes = new HostedDataRoutes(new HostedData(f.sources, undefined, f.budgets));
    await routes.prep.save(a, 'private', { name: 'Private', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
    const url = { discovery: '/api/sources', query: `/api/sources/${source.id}/query`, preview: `/api/uploads/${source.id}`, output: `/api/sources/${source.id}/output`, ai: `/api/ai/sources/${source.id}/schema`, prep: '/api/datasets/private/rows' }[path];
    const body = path === 'query' ? { query: { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] } } : {};
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: ['query', 'output'].includes(path) ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } });
    let published = false, rechecked = false;
    const response = { writeHead() { published = true; }, end() { published = true; } };
    await assert.rejects(routes.route(request, response, url, a, async () => {
      rechecked = true;
      if (change === 'expiry') f.advance(61000);
      else await f.sources.bind(a, source.id, { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } });
    }), { code: change === 'expiry' ? 'UPLOAD_EXPIRED' : 'METADATA_REVISED' });
    assert.equal(rechecked, true); assert.equal(published, false, `${change}/${path}`);
  }
});
test('H3 cached prepared dependencies require graph admission and perform no source read', async t => {
  const f = await sourceFixture(t), a = await f.login(); let reads = 0;
  const data = new HostedData(f.sources, async (_r, _c, _l, table) => { reads++; table.start(registration().columns); table.row(['east', 10, 'a']); }, f.budgets);
  const prep = new HostedPrep(data); await f.sources.create(a, 'source', registration());
  const pipeline = { version: 1, input: 'source', steps: [{ id: 'total', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } }] };
  await prep.save(a, 'base', { name: 'Base', pipeline, expectedVersion: 0 });
  await prep.save(a, 'child', { name: 'Child', pipeline: { version: 1, input: { dataset: 'base' }, steps: [] }, expectedVersion: 0 });
  await prep.execute(a, 'base', 'refresh'); assert.equal(reads, 1);
  await prep.execute(a, 'child', 'refresh'); assert.equal(reads, 1);
  assert.deepEqual((await prep.execute(a, 'child', 'rows')).rows, [{ total: 10 }]);
  await f.sources.bind(a, 'source', { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } });
  await assert.rejects(prep.execute(a, 'child', 'rows'), { code: 'PREP_SECURITY_REJECTED' }); assert.equal(reads, 1);
});
