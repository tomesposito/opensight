import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Duplex } from 'node:stream';
import { request as httpRequest } from 'node:http';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { StubMailTransport, smtpFromEnvironment } from '../dist/mail.js';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { createRuntime } from '../dist/runtime.js';
import { adaptGatewayRequest, authorizeIngress, validateViewerRequest } from '../dist/runtime-ingress.js';
import { runtimeEnv, event, context, payload } from './runtime-helpers.mjs';
import { ACCESS_REQUEST_NOTIFY_CLAIM_MS, accessRequestNotifyTo, accessRequestRate, initializeAccessRequests, limitAccessRequests, listAccessRequests, notifyAccessRequests, storeAccessRequest } from '../dist/access-requests.js';

const path = '/api/access-requests';
const valid = { name: ' Synthetic Applicant ', email: ' Applicant@EXAMPLE.COM ', organization: ' Example Organization ', note: ' Example use case ' };
async function setup(t, rate, { transport, notifyTo } = {}) {
  const f = await h8Fixture(t), mail = transport ?? new StubMailTransport();
  if (rate !== undefined) f.env.OPENSIGHT_ACCESS_REQUEST_RATE = String(rate);
  if (notifyTo !== undefined) f.env.OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO = notifyTo;
  const serving = await serveH8(t, f, { mailTransport: mail });
  const request = (url = path, { method = 'POST', body = valid, raw, headers = {}, localAddress = '127.0.0.1', chunked = false } = {}) => new Promise((resolve, reject) => {
    const bytes = raw ?? (body === null ? undefined : JSON.stringify(body));
    const req = httpRequest({ host: '127.0.0.1', port: serving.server.address().port, localAddress, path: url, method,
      headers: { host: 'opensight.example', ...(bytes === undefined ? {} : { 'Content-Type': 'application/json',
        ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(bytes) }) }), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject); req.end(bytes);
  });
  return { ...f, ...serving, request, mail };
}
function error(result, status, code) {
  assert.equal(result.status, status);
  assert.deepEqual(result.body, { errorCode: code });
}

test('public submission stores normalized pending PII; only the operator list returns it; no email is sent', async t => {
  const f = await setup(t);
  const response = await f.request();
  assert.equal(response.status, 201); assert.deepEqual(response.body, { received: true });
  const result = await f.request('/api/host/access-requests', { method: 'GET', body: null, headers: f.operator });
  assert.equal(result.status, 200); assert.equal(result.body.requests.length, 1);
  const [stored] = result.body.requests;
  assert.match(stored.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Date(stored.createdAt).toISOString(), stored.createdAt);
  assert.deepEqual(stored, { id: stored.id, createdAt: stored.createdAt, name: 'Synthetic Applicant', email: 'applicant@example.com',
    organization: 'Example Organization', note: 'Example use case', status: 'pending', notifiedAt: null });
  assert.deepEqual(f.mail.messages, []);
});

test('initializer is repeatable, optional blanks become null, and list is newest first', async t => {
  const f = await setup(t);
  await initializeAccessRequests(f.db); await initializeAccessRequests(f.db);
  const later = await storeAccessRequest(f.db, { name: 'Later', email: 'later@example.com', now: Date.UTC(2026, 9, 31) });
  const earlier = await storeAccessRequest(f.db, { name: 'Earlier', email: 'earlier@example.com', organization: ' ', note: '', now: Date.UTC(2026, 9, 30) });
  assert.deepEqual(await listAccessRequests(f.db), [later, earlier]);
  assert.equal(earlier.organization, null); assert.equal(later.note, null);
});

test('invalid fields and body shapes produce 400 ACCESS_REQUEST_INVALID without storing anything', async t => {
  const f = await setup(t, 100);
  const cases = [{ email: valid.email }, { ...valid, name: '  ' }, { ...valid, name: 42 },
    { name: 'Example' }, ...['bad', 'a@@example.com', 'a@localhost', 'a@.com', 'a@ex ample.com', 'a\t@example.com', 'a@example.com\n', 'a@ex\u0000ample.com'].map(email => ({ ...valid, email })),
    { ...valid, name: 'n'.repeat(121) }, { ...valid, email: 'e'.repeat(243) + '@example.com' },
    { ...valid, organization: 'o'.repeat(161) }, { ...valid, note: 'n'.repeat(1001) },
    { ...valid, organization: null }, { ...valid, note: [] }, { ...valid, status: 'provisioned' }, [], 'invalid'];
  for (const body of cases) error(await f.request(path, { body }), 400, 'ACCESS_REQUEST_INVALID');
  for (const raw of ['null', '{}', '{', '']) error(await f.request(path, { raw }), 400, 'ACCESS_REQUEST_INVALID');
  assert.deepEqual(await listAccessRequests(f.db), []);
});

test('maximum field lengths are accepted after trimming', async t => {
  const f = await setup(t);
  const response = await f.request(path, { body: { name: ` ${'n'.repeat(120)} `, email: `${'e'.repeat(242)}@example.com`, organization: 'o'.repeat(160), note: 'n'.repeat(1000) } });
  assert.equal(response.status, 201);
});

test('JSON only and a 16 KiB cap reject malformed, invalid UTF-8, oversized and chunked bodies', async t => {
  const f = await setup(t, 20);
  error(await f.request(path, { headers: { 'Content-Type': 'text/plain' } }), 400, 'ACCESS_REQUEST_INVALID');
  error(await f.request(path, { raw: Buffer.from([0xff]) }), 400, 'ACCESS_REQUEST_INVALID');
  for (const chunked of [false, true]) error(await f.request(path, { raw: JSON.stringify({ ...valid, note: 'n'.repeat(16384) }), chunked }), 413, 'ACCESS_REQUEST_TOO_LARGE');
  assert.deepEqual(await listAccessRequests(f.db), []);
});

test('operator list rejects absent, tenant and incorrect operator credentials', async t => {
  const f = await setup(t);
  for (const headers of [{}, { authorization: 'one' }, { authorization: 'Operator invalid' }, { ...f.operator, origin: 'https://opensight.example' }]) {
    error(await f.request('/api/host/access-requests', { method: 'GET', body: null, headers }), 403, 'OPERATOR_REQUIRED');
  }
});

test('default limit admits five attempts, denies the sixth, and ignores spoofed forwarded IPs', async t => {
  const f = await setup(t);
  for (let i = 0; i < 5; i++) assert.equal((await f.request()).status, 201);
  error(await f.request(path, { headers: { 'x-forwarded-for': '192.0.2.2' } }), 429, 'ACCESS_REQUEST_RATE_LIMITED');
  assert.equal((await f.request(path, { localAddress: '127.0.0.2' })).status, 201);
  assert.equal((await listAccessRequests(f.db)).length, 6);
});

test('env override and concurrent requests enforce the limit across server instances', async t => {
  const f = await setup(t, 2);
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request()));
  assert.equal(responses.filter(r => r.status === 201).length, 2);
  for (const response of responses.filter(r => r.status !== 201)) error(response, 429, 'ACCESS_REQUEST_RATE_LIMITED');
  const other = await serveH8(t, f);
  error(await other.request(path, { method: 'POST', body: valid }), 429, 'ACCESS_REQUEST_RATE_LIMITED');
});

test('fixed window resets at ten minutes; access request pruning preserves auth buckets', async t => {
  const f = await setup(t), now = Date.UTC(2026, 9, 31);
  await f.db.transaction(c => c.query('INSERT INTO h2_attempts VALUES (?,?,?)', ['synthetic-auth-bucket', now - 600000, 1]));
  await limitAccessRequests(f.db, '192.0.2.1', 1, now);
  await assert.rejects(limitAccessRequests(f.db, '192.0.2.1', 1, now + 599999), { code: 'ACCESS_REQUEST_RATE_LIMITED', status: 429 });
  await limitAccessRequests(f.db, '192.0.2.2', 1, now + 599999);
  await limitAccessRequests(f.db, '192.0.2.1', 1, now + 600000);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h2_attempts WHERE bucket = ?', ['synthetic-auth-bucket']))).length, 1);
});

test('invalid requests consume attempts, while preflight does not', async t => {
  const f = await setup(t, 1);
  for (let i = 0; i < 3; i++) assert.equal((await f.request(path, { method: 'OPTIONS', body: null })).status, 204);
  error(await f.request(path, { body: {} }), 400, 'ACCESS_REQUEST_INVALID');
  error(await f.request(), 429, 'ACCESS_REQUEST_RATE_LIMITED');
});

test('rate configuration uses strict positive integer parsing', () => {
  assert.equal(accessRequestRate({}), 5);
  assert.equal(accessRequestRate({ OPENSIGHT_ACCESS_REQUEST_RATE: '12' }), 12);
  for (const raw of ['0', '-1', '1.5', ' 5', '05', '', 'Infinity', '100001', '9007199254740992']) {
    assert.throws(() => accessRequestRate({ OPENSIGHT_ACCESS_REQUEST_RATE: raw }), /OPENSIGHT_ACCESS_REQUEST_RATE/);
  }
});

test('CORS permits only the exact marketing origin, including error responses and OPTIONS', async t => {
  const f = await setup(t, 20);
  for (const origin of ['https://getopensight.org', 'https://foreign.example.com', 'https://getopensight.org.evil.example', 'http://getopensight.org', 'https://getopensight.org/', undefined]) {
    const headers = origin ? { origin } : {};
    for (const method of ['POST', 'OPTIONS']) {
      const result = await f.request(path, { method, body: method === 'POST' ? valid : null, headers });
      assert.equal(result.status, method === 'POST' ? 201 : 204);
      assert.equal(result.headers['access-control-allow-origin'], origin === 'https://getopensight.org' ? origin : undefined);
      assert.equal(result.headers.vary, origin === 'https://getopensight.org' ? 'Origin' : undefined);
      assert.equal(result.headers['access-control-allow-credentials'], undefined);
      if (method === 'OPTIONS') {
        assert.equal(result.body, null);
        assert.equal(result.headers['access-control-allow-methods'], 'POST');
        assert.equal(result.headers['access-control-allow-headers'], 'Content-Type');
      }
    }
  }
  const result = await f.request(path, { body: {}, headers: { origin: 'https://getopensight.org' } });
  error(result, 400, 'ACCESS_REQUEST_INVALID');
  assert.equal(result.headers['access-control-allow-origin'], 'https://getopensight.org');
});

test('CORS exception does not weaken other routes, host checks or forged-principal checks', async t => {
  const f = await setup(t);
  for (const url of ['/api/session', '/api/host/access-requests', '/api/access-requests/']) {
    const result = await f.request(url, { method: 'OPTIONS', body: null, headers: { origin: 'https://getopensight.org' } });
    error(result, 403, 'UNTRUSTED_ORIGIN'); assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  error(await f.request(path, { headers: { host: 'foreign.example.com' } }), 403, 'UNTRUSTED_ORIGIN');
  error(await f.request(path, { headers: { 'x-user': 'forged' } }), 403, 'FORGED_PRINCIPAL');
  assert.equal((await f.request(path, { method: 'GET', body: null })).status, 405);
});

test('the exact marketing URL crosses edge and gateway boundaries, with invocation-safe rate limits', async t => {
  const f = await setup(t, 1), env = { ...runtimeEnv(), ...f.env };
  const runtime = createRuntime(() => env, { databases: () => ({ membership: f.db, tenant: f.db }), readiness: async () => {},
    application: (_db, scope, config) => createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: config,
      security: { authenticate: async () => assert.fail('public route authenticated a principal') }, mailTransport: f.mail,
      invocation: { signal: scope.signal } }) });
  const viewer = { protocol: 'https', uri: path, querystring: {}, headers: { host: { value: 'opensight.example' }, origin: { value: 'https://getopensight.org' } } };
  validateViewerRequest(viewer, env.OPENSIGHT_PUBLIC_ORIGIN);
  const e = event(path, 'POST', valid); e.headers.origin = 'https://getopensight.org'; delete e.headers.authorization;
  assert.equal(authorizeIngress(e, env).isAuthorized, true);
  assert.equal(adaptGatewayRequest(e, env).path, path);
  const preflight = event(path, 'OPTIONS'); preflight.headers.origin = e.headers.origin; delete preflight.headers.authorization;
  let result = await runtime.lambda(preflight, context);
  assert.equal(result.statusCode, 204); assert.equal(result.headers['access-control-allow-origin'], e.headers.origin);
  result = await runtime.lambda(e, context);
  assert.equal(result.statusCode, 201); assert.deepEqual(payload(result), { received: true });
  assert.equal(result.headers['access-control-allow-origin'], e.headers.origin);
  result = await runtime.lambda(e, context);
  assert.equal(result.statusCode, 429); assert.deepEqual(payload(result), { errorCode: 'ACCESS_REQUEST_RATE_LIMITED' });
  assert.equal(result.headers['access-control-allow-origin'], e.headers.origin);
  for (const uri of ['/api/access-requests/', '/api/api/namespaces/one/access-requests', '/api/api/host/access-requests', '/api/api/session']) {
    assert.throws(() => validateViewerRequest({ ...viewer, uri }, env.OPENSIGHT_PUBLIC_ORIGIN));
    const bad = event(uri, 'POST', valid); bad.headers.origin = e.headers.origin;
    assert.equal(authorizeIngress(bad, env).isAuthorized, false);
  }
});

test('notify-to parsing: unset is null, valid address lowercases, garbage is a config error', () => {
  assert.equal(accessRequestNotifyTo({}), null);
  assert.equal(accessRequestNotifyTo({ OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO: '  ' }), null);
  assert.equal(accessRequestNotifyTo({ OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO: ' Ops@Example.COM ' }), 'ops@example.com');
  assert.throws(() => accessRequestNotifyTo({ OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO: 'not-an-email' }), /must be a single email address/);
  assert.throws(() => accessRequestNotifyTo({ OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO: 'a@example.com, b@example.com' }), /must be a single email address/);
});

test('notification is emailed after a stored submission and stamps notifiedAt', async t => {
  const f = await setup(t, undefined, { notifyTo: 'ops@example.com' });
  const response = await f.request();
  assert.equal(response.status, 201);
  assert.equal(f.mail.messages.length, 1);
  const [message] = f.mail.messages;
  assert.deepEqual(message.to, ['ops@example.com']);
  assert.match(message.subject, /Synthetic Applicant/);
  assert.match(message.html, /applicant@example\.com/);
  assert.match(message.html, /Example Organization/);
  assert.match(message.dedupeKey, /^[a-f0-9]{64}$/);
  const [storedRequest] = await listAccessRequests(f.db);
  assert.equal(message.dedupeKey, createHash('sha256').update(`access-request:${storedRequest.id}`).digest('hex'));
  const list = await f.request('/api/host/access-requests', { method: 'GET', body: null, headers: f.operator });
  assert.equal(new Date(list.body.requests[0].notifiedAt).toISOString(), list.body.requests[0].notifiedAt);
});

test('a failing mail transport never fails the submission; the request stays unnotified', async t => {
  const failing = { configured: true, async send() { throw new Error('smtp down'); } };
  const f = await setup(t, undefined, { transport: failing, notifyTo: 'ops@example.com' });
  const response = await f.request();
  assert.equal(response.status, 201); assert.deepEqual(response.body, { received: true });
  const [stored] = await listAccessRequests(f.db);
  assert.equal(stored.notifiedAt, null);
});

test('pending notifications retry on a later call, oldest first, and stop at the first failure', async t => {
  const f = await h8Fixture(t);
  await initializeAccessRequests(f.db);
  const first = await storeAccessRequest(f.db, { name: 'First', email: 'first@example.com', now: Date.UTC(2026, 9, 30) });
  const second = await storeAccessRequest(f.db, { name: 'Second', email: 'second@example.com', now: Date.UTC(2026, 9, 31) });
  const down = { configured: true, async send() { throw new Error('smtp down'); } };
  assert.equal(await notifyAccessRequests(f.db, down, 'ops@example.com', Date.now()), 0);
  assert.deepEqual((await listAccessRequests(f.db)).map(r => r.notifiedAt), [null, null]);
  const mail = new StubMailTransport();
  assert.equal(await notifyAccessRequests(f.db, mail, 'ops@example.com', Date.now()), 2);
  assert.equal(mail.messages[0].dedupeKey, createHash('sha256').update(`access-request:${first.id}`).digest('hex'));
  assert.equal(mail.messages[1].dedupeKey, createHash('sha256').update(`access-request:${second.id}`).digest('hex'));
  assert.ok((await listAccessRequests(f.db)).every(r => r.notifiedAt !== null));
  assert.equal(await notifyAccessRequests(f.db, mail, 'ops@example.com', Date.now()), 0);
  assert.equal(await notifyAccessRequests(f.db, mail, null, Date.now()), 0);
  assert.equal(await notifyAccessRequests(f.db, { configured: false, async send() { throw new Error('must not be called'); } }, 'ops@example.com', Date.now()), 0);
});

test('pending notifications deliver through the real SMTP protocol transport (issue #224)', async t => {
  const f = await h8Fixture(t);
  await initializeAccessRequests(f.db);
  const first = await storeAccessRequest(f.db, { name: 'First', email: 'first@example.com', now: Date.UTC(2026, 9, 30) });
  // Same fake-socket SMTP boundary as serverless-mail.test.mjs: the real
  // smtpFromEnvironment transport speaks the protocol and validates the
  // dedupe key itself — the stub transport accepted the old invalid key.
  const written = [];
  let body = false;
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) {
    const line = chunk.toString(); written.push(line);
    if (line.startsWith('QUIT')) { done(); this.destroy(); return; }
    if (body) { body = false; this.push('250 accepted\r\n'); }
    else if (line.startsWith('DATA')) { body = true; this.push('354 proceed\r\n'); }
    else this.push('250 ok\r\n');
    done();
  } });
  socket.setTimeout = () => socket;
  const connect = () => { queueMicrotask(() => socket.push('220 synthetic\r\n')); return socket; };
  const transport = smtpFromEnvironment(
    { OPENSIGHT_SMTP_HOST: 'smtp.example.test', OPENSIGHT_SMTP_FROM: 'ops@example.test' },
    { timeoutMs: 1000, connect });
  assert.equal(await notifyAccessRequests(f.db, transport, 'ops@example.com', Date.now()), 1);
  const expectedKey = createHash('sha256').update(`access-request:${first.id}`).digest('hex');
  assert.ok(written.some(s => s.includes(`Message-ID: <${expectedKey}@opensight.local>`)));
  const [stored] = await listAccessRequests(f.db);
  assert.notEqual(stored.notifiedAt, null);
});

test('initializer adds notified_at to a pre-notification table without losing rows', async t => {
  const f = await h8Fixture(t);
  await f.db.transaction(c => c.query(`CREATE TABLE h8_access_requests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, organization TEXT, note TEXT,
    created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`));
  await f.db.transaction(c => c.query(`INSERT INTO h8_access_requests (id, name, email, organization, note, created_at, status)
    VALUES ('legacy-1', 'Legacy', 'legacy@example.com', NULL, NULL, '2026-10-30T00:00:00.000Z', 'pending')`));
  await initializeAccessRequests(f.db); await initializeAccessRequests(f.db);
  const [row] = await listAccessRequests(f.db);
  assert.equal(row.id, 'legacy-1'); assert.equal(row.notifiedAt, null);
});

test('concurrent notification calls claim first: each pending row is sent exactly once through a non-deduping transport (issue #232)', async t => {
  const f = await h8Fixture(t);
  await initializeAccessRequests(f.db);
  await storeAccessRequest(f.db, { name: 'First', email: 'first@example.com', now: Date.UTC(2026, 9, 30) });
  await storeAccessRequest(f.db, { name: 'Second', email: 'second@example.com', now: Date.UTC(2026, 9, 31) });
  // The transport records every call and never deduplicates: any duplicate
  // delivery would show up as an extra call with a repeated dedupe key.
  const calls = [];
  const transport = { configured: true, async send(message) { calls.push(message); await new Promise(resolve => setTimeout(resolve, 25)); } };
  const now = Date.now();
  const results = await Promise.all([
    notifyAccessRequests(f.db, transport, 'ops@example.com', now),
    notifyAccessRequests(f.db, transport, 'ops@example.com', now),
    notifyAccessRequests(f.db, transport, 'ops@example.com', now),
  ]);
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map(m => m.dedupeKey)).size, 2);
  assert.equal(results.reduce((sum, n) => sum + n, 0), 2);
  assert.ok((await listAccessRequests(f.db)).every(r => r.notifiedAt !== null));
});

test('an unexpired claim blocks other senders; an expired claim is recovered and delivered (issue #232)', async t => {
  const f = await h8Fixture(t);
  await initializeAccessRequests(f.db);
  const request = await storeAccessRequest(f.db, { name: 'Claimed', email: 'claimed@example.com', now: Date.UTC(2026, 10, 8) });
  const now = Date.UTC(2026, 10, 9, 12);
  // Another sender holds a live claim (e.g. it is mid-send right now).
  await f.db.transaction(c => c.query(
    'UPDATE h8_access_requests SET notify_claim_token = ?, notify_claim_expires_at = ? WHERE id = ?',
    ['other-sender', new Date(now + ACCESS_REQUEST_NOTIFY_CLAIM_MS).toISOString(), request.id]));
  const mail = new StubMailTransport();
  assert.equal(await notifyAccessRequests(f.db, mail, 'ops@example.com', now), 0);
  assert.deepEqual(mail.messages, []);
  assert.equal((await listAccessRequests(f.db))[0].notifiedAt, null);
  // The lease lapses with no stamp — the earlier sender died mid-send — so
  // the next call takes the row over, delivers it, and clears the claim.
  assert.equal(await notifyAccessRequests(f.db, mail, 'ops@example.com', now + ACCESS_REQUEST_NOTIFY_CLAIM_MS), 1);
  assert.equal(mail.messages.length, 1);
  const [stored] = await listAccessRequests(f.db);
  assert.notEqual(stored.notifiedAt, null);
  const [raw] = await f.db.transaction(c => c.query('SELECT notify_claim_token, notify_claim_expires_at FROM h8_access_requests WHERE id = ?', [request.id]));
  assert.equal(raw.notify_claim_token, null); assert.equal(raw.notify_claim_expires_at, null);
});

test('initializer adds the claim columns to a pre-claim table without losing rows (issue #232)', async t => {
  const f = await h8Fixture(t);
  await f.db.transaction(c => c.query(`CREATE TABLE h8_access_requests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, organization TEXT, note TEXT,
    created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT)`));
  await f.db.transaction(c => c.query(`INSERT INTO h8_access_requests (id, name, email, organization, note, created_at, status)
    VALUES ('legacy-2', 'Legacy Two', 'legacy2@example.com', NULL, NULL, '2026-10-30T00:00:00.000Z', 'pending')`));
  await initializeAccessRequests(f.db); await initializeAccessRequests(f.db);
  const mail = new StubMailTransport();
  assert.equal(await notifyAccessRequests(f.db, mail, 'ops@example.com', Date.now()), 1);
  const [row] = await listAccessRequests(f.db);
  assert.equal(row.id, 'legacy-2'); assert.notEqual(row.notifiedAt, null);
});
