import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { deflateSync } from 'node:zlib';
import { HostedEmbedding, defaultEmbedConfig, embeddingPolicy, initializeEmbedding, validateEmbedConfig, expectedEmbedRevision } from '../dist/embedding-config.js';
import { validatedPng } from '../dist/embed-assets.js';
import { TenantMetadata } from '../dist/metadata.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { authFixture } from './hosted-helpers.mjs';

function chunk(type, bytes) {
  const b = Buffer.alloc(bytes.length + 12); b.writeUInt32BE(bytes.length); b.write(type, 4); bytes.copy(b, 8);
  let n = 0xffffffff;
  for (const byte of b.subarray(4, -4)) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); }
  b.writeUInt32BE((n ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
function png({ width = 1, height = 1, extra = [], pixels = Buffer.from([0, 16, 80, 128, 255]) } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const origin = 'https://opensight.example', parent = 'https://product.example';
function policyInput(tenantId = 'tenant-one') {
  return { origins: [{ id: 'canonical', origin }], tenants: [{ tenantId, allowedParentOrigins: [parent], embedOriginIds: ['canonical'], maxSessionSeconds: 600 }],
    assets: [{ id: 'logo', tenantId, kind: 'logo', pngBase64: png() }, { id: 'favicon', tenantId, kind: 'favicon', pngBase64: png() }] };
}
const parsePolicy = raw => embeddingPolicy({ OPENSIGHT_EMBEDDING_POLICY: JSON.stringify(raw) }, origin);
function config() { return { ...defaultEmbedConfig(), enabled: true, allowedParentOrigins: [parent], embedOriginId: 'canonical', maxSessionSeconds: 300 }; }
async function fixture(t) {
  const f = await authFixture(t), metadata = new TenantMetadata(f.db, f.db);
  const token = (await f.login()).token, identity = await f.auth.verify(token), context = await metadata.authenticate(null, async () => identity);
  await initializeEmbedding(f.db);
  const policy = parsePolicy(policyInput(f.tenant.tenantId)), service = new HostedEmbedding(f.db, metadata, policy);
  return { ...f, metadata, token, identity, context, policy, service };
}
async function serving(t, f) {
  const c = f.config, env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds),
    OPENSIGHT_EMBEDDING_POLICY: JSON.stringify(policyInput(f.tenant.tenantId)) };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env, security: { authenticate: f.auth.authenticate }, mailTransport: f.mail });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path = '/api/embedding/config', { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method,
      headers: { host: new URL(origin).host, authorization: `Bearer ${f.token}`, ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(bytes);
  });
}

test('H5 strict configuration, feature capabilities and operator lifetime ceilings', () => {
  const policy = parsePolicy(policyInput());
  assert.deepEqual(validateEmbedConfig(config(), 'tenant-one', policy), config());
  for (const field of ['anonymous', 'authoring', 'export', 'download', 'persistentReaderState', 'filtering', 'parameterControls', 'madeUp']) {
    const input = config(); input.features[field] = true;
    assert.throws(() => validateEmbedConfig(input, 'tenant-one', policy), { code: 'EMBED_FEATURE_UNSUPPORTED', status: 422 });
  }
  for (const duration of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '300']) {
    assert.throws(() => validateEmbedConfig({ ...config(), maxSessionSeconds: duration }, 'tenant-one', policy), { code: 'EMBED_CONFIG_INVALID' });
  }
  assert.throws(() => validateEmbedConfig({ ...config(), maxSessionSeconds: 601 }, 'tenant-one', policy), { code: 'EMBED_SESSION_LIMIT_EXCEEDED' });
  assert.throws(() => validateEmbedConfig({ ...config(), maxSessionSeconds: null }, 'tenant-one', policy), { code: 'EMBEDDING_NOT_CONFIGURED' });
  for (const input of [{ ...config(), tenantId: 'forged' }, { ...config(), redirectOrigin: parent }, { ...config(), appearance: { ...config().appearance, removeLegalNotices: true } },
    { ...config(), features: { ...config().features, registeredDashboards: 'true' } }]) assert.throws(() => validateEmbedConfig(input, 'tenant-one', policy));
  for (const key of Object.keys(config())) { const input = config(); delete input[key]; assert.throws(() => validateEmbedConfig(input, 'tenant-one', policy)); }
  assert.equal(validateEmbedConfig(defaultEmbedConfig(), 'no-policy', embeddingPolicy({}, origin)).enabled, false);
});

test('H5 exact origin lists and canonical registry deny spoofed hosts without disclosing tenants', () => {
  const policy = parsePolicy(policyInput());
  for (const value of ['https://product.example.evil', 'https://product.example/', 'https://product.example:443', 'https://user@product.example', 'https://*.example', 'null', 'http://product.example', 'https://product.example?next=evil', 'https://product.example#x', 'https://PRODUCT.example', 'https://product.example:8443']) {
    assert.throws(() => validateEmbedConfig({ ...config(), allowedParentOrigins: [value] }, 'tenant-one', policy), { code: 'EMBED_ORIGIN_DENIED', status: 403 });
  }
  for (const id of ['foreign', 'https://evil.example', '__proto__', 'constructor']) assert.throws(() => validateEmbedConfig({ ...config(), embedOriginId: id }, 'tenant-one', policy), { code: 'EMBED_ORIGIN_DENIED' });
  assert.throws(() => validateEmbedConfig(config(), 'tenant-two', policy), { code: 'EMBED_ORIGIN_DENIED' });
  for (const raw of [{ ...policyInput(), origins: [{ id: 'canonical', origin: parent }] }, { ...policyInput(), extra: true }, { ...policyInput(), tenants: [{ ...policyInput().tenants[0], maxSessionSeconds: null }] }]) {
    assert.throws(() => parsePolicy(raw), { code: 'EMBED_OPERATOR_CONFIG_INVALID', status: 503 });
  }
});

test('H5 appearance rejects executable markup, CSS, URL, event-handler, encoded and oversized bypasses', () => {
  const policy = parsePolicy(policyInput());
  const attacks = ['<script>alert(1)</script>', 'javascript:alert(1)', '<img src=x onerror=alert(1)>', 'onload="alert(1)"', 'url(https://evil.example)', 'expression(alert(1))',
    '&lt;script&gt;', '%3Cscript%3E', '\\75rl(evil)', 'data:image/svg+xml,<svg onload=alert(1)>', '\u202eunsafe', 'text\nnext', 'a'.repeat(161)];
  for (const field of ['productName', 'iframeTitle', 'palette', 'font', 'layout', 'logoAssetId', 'faviconAssetId']) for (const value of attacks) {
    assert.throws(() => validateEmbedConfig({ ...config(), appearance: { ...config().appearance, [field]: value } }, 'tenant-one', policy), undefined, `${field}: ${value}`);
  }
  for (const extra of ['css', 'style', 'html', 'onerror', 'logoUrl', 'faviconUrl', 'helpUrl', '__proto__']) {
    const appearance = JSON.parse(JSON.stringify(config().appearance)); Object.defineProperty(appearance, extra, { value: 'forged', enumerable: true });
    assert.throws(() => validateEmbedConfig({ ...config(), appearance }, 'tenant-one', policy));
  }
  assert.throws(() => validateEmbedConfig({ ...config(), appearance: { ...config().appearance, productName: 'a'.repeat(81) } }, 'tenant-one', policy));
  assert.equal(validateEmbedConfig({ ...config(), appearance: { ...config().appearance, productName: 'Équipe Atlas', palette: 'teal', font: 'sans', layout: 'compact' } }, 'tenant-one', policy).appearance.productName, 'Équipe Atlas');
});

test('H5 tenant-owned PNG references reject foreign, wrong-kind, executable and malformed assets', () => {
  const raw = policyInput(); raw.tenants.push({ ...raw.tenants[0], tenantId: 'tenant-two' });
  raw.assets.push({ id: 'private-logo', tenantId: 'tenant-two', kind: 'logo', pngBase64: png() });
  const policy = parsePolicy(raw);
  const valid = { ...config(), appearance: { ...config().appearance, logoAssetId: 'logo', faviconAssetId: 'favicon' } };
  assert.equal(validateEmbedConfig(valid, 'tenant-one', policy).appearance.logoAssetId, 'logo');
  for (const id of ['private-logo', 'missing-logo', 'favicon', 'https://evil.example/logo.png']) assert.throws(() => validateEmbedConfig({ ...valid, appearance: { ...valid.appearance, logoAssetId: id } }, 'tenant-one', policy), { code: 'EMBED_ASSET_UNAVAILABLE', status: 422 });
  assert.match(validatedPng(png()), /^data:image\/png;base64,/);
  const good = Buffer.from(png(), 'base64'), badCrc = Buffer.from(good); badCrc[20] ^= 1;
  for (const value of ['<svg onload="alert(1)"/>', Buffer.from('<svg onload="alert(1)"/>').toString('base64'), 'javascript:alert(1)', 'a'.repeat(90001), badCrc.toString('base64'),
    Buffer.concat([good, Buffer.from('<script>')]).toString('base64'), png({ width: 513 }), png({ pixels: Buffer.from([5, 0, 0, 0, 0]) }), png({ pixels: Buffer.alloc(1024 * 1024) }),
    png({ extra: [chunk('tEXt', Buffer.from('<script>'))] }), png({ extra: [chunk('acTL', Buffer.alloc(8))] }), good.subarray(0, -8).toString('base64')]) assert.throws(() => validatedPng(value), { code: 'EMBED_ASSET_INVALID' });
});

test('H5 durable revisions serialize concurrent replacements, invalidate H2 and preserve H3/H4 authorization', async t => {
  const f = await fixture(t), first = await f.service.get(f.context), revisions = await f.metadata.revisions(f.context);
  assert.equal(first.revision, 0); assert.equal(first.config.enabled, false);
  const race = await Promise.allSettled([f.service.put(f.context, config(), 0), f.service.put(f.context, config(), 0)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.status, 412);
  await assert.rejects(f.auth.verify(f.token), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(f.metadata.assertRevisions(f.context, revisions), { code: 'METADATA_REVISED' });
  const reopened = new SqliteMetadataDatabase(f.path); t.after(() => reopened.close());
  const metadata = new TenantMetadata(reopened, reopened), context = await metadata.authenticate(null, async () => f.identity);
  const service = new HostedEmbedding(reopened, metadata, f.policy);
  assert.deepEqual((await service.get(context)).config, config());
  assert.equal((await service.get(context)).revision, 1);
  const events = await f.db.transaction(c => c.query("SELECT * FROM h1_outbox WHERE event_type = 'embedding.config.changed'")); assert.equal(events.length, 1);
  await assert.rejects(service.get({ ...context }), { code: 'TENANT_CONTEXT_REQUIRED' });
  await f.provisioning.transition('suspend-h5', f.tenant.tenantId, 'suspend', 2);
  await assert.rejects(service.get(context), { code: 'TENANT_UNAVAILABLE' });
});

test('H5 rejected config is atomic and policy reductions fail closed until explicit repair', async t => {
  const f = await fixture(t);
  await f.service.put(f.context, config(), 0);
  const revision = await f.metadata.revisions(f.context);
  const input = config(); input.features.export = true;
  await assert.rejects(f.service.put(f.context, input, 1), { code: 'EMBED_FEATURE_UNSUPPORTED' });
  assert.equal((await f.service.get(f.context)).revision, 1); assert.deepEqual(await f.metadata.revisions(f.context), revision);
  const reduced = new HostedEmbedding(f.db, f.metadata, embeddingPolicy({}, origin));
  await assert.rejects(reduced.get(f.context), { code: 'EMBED_ORIGIN_DENIED' });
  assert.equal((await reduced.put(f.context, defaultEmbedConfig(), 1)).revision, 2);
});

test('H5 HTTP config enforces If-Match, admin scope, exact browser origin and named failures', async t => {
  const f = await fixture(t), request = await serving(t, f);
  const initial = await request(); assert.equal(initial.status, 200); assert.equal(initial.headers.etag, '"0"'); assert.equal(initial.headers['cache-control'], 'no-store');
  assert.equal(initial.body.capabilities.sessionIssuance, false);
  for (const value of [undefined, '*', '0', 'W/"0"', '"0", "1"', '"9007199254740992"']) {
    const response = await request(undefined, { method: 'PUT', headers: value === undefined ? {} : { 'if-match': value }, body: config() }); assert.equal(response.status, value === undefined ? 428 : 400);
  }
  assert.equal(expectedEmbedRevision('"0"'), 0);
  const conflict = await request(undefined, { method: 'PUT', headers: { 'if-match': '"1"' }, body: config() }); assert.equal(conflict.status, 412); assert.deepEqual(conflict.body, { errorCode: 'EMBED_CONFIG_REVISION_CONFLICT' });
  for (const headers of [{ origin: parent }, { origin: 'null' }, { host: 'foreign.example' }, { forwarded: 'host=foreign' }, { 'x-forwarded-host': 'foreign.example' }]) {
    const denied = await request(undefined, { headers }); assert.equal(denied.status, 403); assert.deepEqual(denied.body, { errorCode: 'EMBED_ORIGIN_DENIED' });
  }
  const wrong = await request(undefined, { method: 'PUT', headers: { 'if-match': '"0"' }, body: { ...config(), allowedParentOrigins: ['https://evil.example'] } });
  assert.equal(wrong.status, 403); assert.deepEqual(wrong.body, { errorCode: 'EMBED_ORIGIN_DENIED' });
  assert.equal((await request('/api/namespaces/foreign/embedding/config')).status, 404);
  assert.equal((await request(undefined, { headers: { authorization: 'Bearer invalid' } })).status, 401);
  const forged = await request(undefined, { method: 'PUT', headers: { 'if-match': '"0"' }, body: { ...config(), userId: 'forged' } }); assert.equal(forged.body.errorCode, 'FORGED_PRINCIPAL');
  const saved = await request(undefined, { method: 'PUT', headers: { 'if-match': '"0"', origin }, body: config() }); assert.equal(saved.status, 200); assert.equal(saved.headers.etag, '"1"');
  assert.equal((await request()).status, 401);
  const fresh = await f.login(), headers = { authorization: `Bearer ${fresh.token}` };
  assert.equal((await request(undefined, { headers })).body.revision, 1);
  assert.equal((await request(undefined, { method: 'PUT', headers: { ...headers, 'if-match': '"0"' }, body: config() })).status, 412);
  for (const [path, code] of [['/api/embedding/sessions', 'EMBEDDING_NOT_CONFIGURED'], ['/api/embedding/domains', 'EMBED_FEATURE_UNSUPPORTED']]) assert.deepEqual((await request(path, { method: 'POST', headers, body: {} })).body, { errorCode: code });
  await f.metadata.put(f.context, { kind: 'user', id: f.context.userId }, { name: 'Reader', role: 'reader' }, 1);
  const reader = await f.login();
  for (const method of ['GET', 'PUT']) assert.equal((await request(undefined, { method, headers: { authorization: `Bearer ${reader.token}`, 'if-match': '"1"' }, ...(method === 'PUT' ? { body: config() } : {}) })).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
});

test('H5 tenant membership and policy responses never expose foreign configuration or asset owners', async t => {
  const f = await fixture(t);
  const other = await f.provisioning.provision('h5-other', { name: 'Other tenant', administrator: { email: 'other@example.test', name: 'Other' } });
  const raw = policyInput(f.tenant.tenantId); raw.tenants.push({ tenantId: other.tenantId, allowedParentOrigins: ['https://private.example'], embedOriginIds: ['canonical'], maxSessionSeconds: 99 });
  raw.assets.push({ id: 'private', tenantId: other.tenantId, kind: 'logo', pngBase64: png() });
  const service = new HostedEmbedding(f.db, f.metadata, parsePolicy(raw));
  const result = await service.get(f.context), encoded = JSON.stringify(result);
  assert.ok(!encoded.includes(other.tenantId)); assert.ok(!encoded.includes('private')); assert.ok(!encoded.includes('pngBase64'));
  await service.put(f.context, config(), 0);
  const records = await f.db.transaction(c => c.query('SELECT tenant_id FROM h5_embedding_config')); assert.deepEqual(records.map(r => r.tenant_id), [f.tenant.tenantId]);
  await f.provisioning.removeMember(f.tenant.tenantId, f.context.userId);
  await assert.rejects(service.get(f.context), { code: 'AUTHORIZATION_REVISED' });
});
