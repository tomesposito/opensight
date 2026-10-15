import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { refreshCredentials, createMcpServer } from '../dist/index.js';
import { connect, call, json, credentials } from './helpers.mjs';
const secret = () => randomBytes(32).toString('hex');

test('refresh-token exchange, concurrent coalescing, expiry, rotation and revocation fail closed', async t => {
  let now = 0, exchanges = 0, revoked = false;
  const initial = secret(), rotated = secret(), firstAccess = secret(), secondAccess = secret();
  const c = refreshCredentials({ tokenUrl: 'https://auth.example/token', refreshToken: initial, now: () => now,
    fetch: async (url, init) => {
      exchanges++;
      assert.equal(url.href, 'https://auth.example/token'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.equal(init.headers.Authorization, undefined);
      const form = new URLSearchParams(init.body);
      assert.deepEqual([...form.keys()], ['grant_type', 'refresh_token']); assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), exchanges === 1 ? initial : rotated);
      if (revoked) return json({ error: 'invalid_grant', error_description: initial }, 401);
      return json({ token_type: 'Bearer', access_token: exchanges === 1 ? firstAccess : secondAccess, expires_in: 30, refresh_token: rotated });
    } });
  assert.deepEqual(await Promise.all([c.accessToken(), c.accessToken(), c.accessToken()]), [firstAccess, firstAccess, firstAccess]);
  assert.equal(exchanges, 1);
  now = 31_000; assert.equal(await c.accessToken(), secondAccess); assert.equal(exchanges, 2);
  assert.equal(c.containsSecret(initial), true); assert.equal(c.containsSecret(rotated), true); assert.equal(c.containsSecret(secondAccess), true);
  revoked = true; c.invalidate();
  let calls = 0;
  const client = await connect(t, { credentials: c, fetch: async () => { calls++; return json({}); } });
  const result = await call(client, 'list_datasets');
  assert.equal(result.isError, true); assert.equal(result.structuredContent.errorCode, 'AUTHENTICATION_FAILED');
  assert.equal(calls, 0); assert.equal(JSON.stringify(result).includes(initial), false);
});

test('invalid and failed token transports produce redacted protocol errors', async () => {
  const token = secret();
  for (const fetchImpl of [
    async () => { throw new Error(token); },
    async () => new Response(token),
    ...[{ access_token: token }, { access_token: token, token_type: 'Basic', expires_in: 30 },
      { access_token: token, token_type: 'Bearer', expires_in: 0 },
      { access_token: token, token_type: 'Bearer', expires_in: 30, refresh_token: '' }].map(data => async () => json(data)),
  ]) {
    const c = refreshCredentials({ tokenUrl: 'https://auth.example/token', refreshToken: token, fetch: fetchImpl });
    await assert.rejects(() => c.accessToken(), error => error.code === -32603 && !error.message.includes(token));
  }
});

test('tool credentials, caller principals, policy assertions and nested header envelopes are rejected without HTTP', async t => {
  let calls = 0;
  const client = await connect(t, { fetch: async () => { calls++; return json({}); } });
  for (const key of ['credential', 'credentials', 'token', 'accessToken', 'refreshToken', 'authorization', 'principal', 'principals', 'principalId', 'subject', 'user', 'userId', 'tenantId', 'ownerId', 'namespaceId', 'groups', 'groupIds', 'role', 'roles', 'policy', 'security', 'capabilities', 'x-tenant-id']) {
    const result = await call(client, 'list_datasets', { [key]: secret() });
    assert.equal(result.isError, true, key); assert.equal(result.structuredContent.errorCode, 'FORGED_PRINCIPAL', key);
  }
  for (const args of [{ headers: { Authorization: secret() } }, { query: { principal: 'other' }, id: 'sample' }]) {
    assert.equal((await call(client, 'run_dataset_query', args)).structuredContent.errorCode, 'FORGED_PRINCIPAL');
  }
  assert.equal(calls, 0);
});

test('path traversal and injected header values cannot escape v1 or change identity', async t => {
  let calls = 0;
  const creds = credentials();
  const client = await connect(t, { credentials: creds, fetch: async () => { calls++; return json({}); } });
  for (const id of ['..', '.', '../uploads', '%2e%2e', 'x?tenantId=other', 'x#fragment', 'a/b', 'https://other.example']) {
    assert.equal((await call(client, 'describe_dataset', { id })).isError, true);
  }
  assert.equal((await call(client, 'list_datasets', { cursor: 'x\r\nAuthorization: forged' })).isError, true);
  const invalidHeader = await call(client, 'list_datasets', { cursor: creds.token + '😀' });
  assert.equal(invalidHeader.isError, true); assert.equal(JSON.stringify(invalidHeader).includes(creds.token), false);
  assert.equal(calls, 0);
  for (const baseUrl of ['https://host/api', 'http://public.example/api/v1', 'https://user:secret@host/api/v1', 'https://host/api/v1?q=1']) {
    assert.throws(() => createMcpServer({ baseUrl, credentials: credentials() }));
  }
});

for (const [status, errorCode, headers] of [[409, 'SOURCE_DELETE_BLOCKED_BY_DATASET', {}], [428, 'V1_IF_MATCH_REQUIRED', {}], [429, 'RATE_LIMIT_EXCEEDED', { 'Retry-After': '42' }], [401, 'AUTHENTICATION_FAILED', {}]]) {
  test(`HTTP ${status} ${errorCode} survives as a structured tool error`, async t => {
    const c = credentials(); let invalidated = false; c.invalidate = () => { invalidated = true; };
    const client = await connect(t, { credentials: c, fetch: async () => json({ errorCode, message: 'Named REST error' }, status, headers) });
    const result = await call(client, 'delete_source', { id: 'sample' });
    assert.equal(result.isError, true); assert.deepEqual(result.structuredContent, { errorCode, message: 'Named REST error' });
    assert.equal(result._meta.status, status); if (status === 429) assert.equal(result._meta.headers['Retry-After'], '42');
    assert.equal(invalidated, status === 401);
  });
}

test('transport failures, invalid API envelopes and reflected credentials are redacted protocol errors', async t => {
  const c = credentials(secret() + String.fromCharCode(34, 92));
  for (const fetchImpl of [
    async () => { throw new Error(c.token); },
    async () => new Response(c.token, { status: 502 }),
    async () => json({ token: c.token }),
    async () => new Response('{"value":"' + [...c.token].map(ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"}', { headers: { 'Content-Type': 'application/json' } }),
    async () => json({ errorCode: 'AUTHENTICATION_FAILED', message: c.token }, 401),
    async () => json({}, 200, { ETag: c.token }),
    async () => json({ error: 'wrong error shape' }, 400),
    async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const client = await connect(t, { credentials: c, fetch: fetchImpl });
    await assert.rejects(() => call(client, 'list_datasets'), error => error.code === -32603 && !error.message.includes(c.token));
  }
});

test('binary export bytes and content metadata survive without truncation or resource registration', async t => {
  const bytes = randomBytes(4096);
  const client = await connect(t, { fetch: async () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="dashboard.pdf"', ETag: '"1"' } }) });
  const result = await call(client, 'create_dashboard_export', { id: 'sample', body: { format: 'pdf' } });
  assert.equal(result.structuredContent.mimeType, 'application/pdf');
  assert.deepEqual(Buffer.from(result.structuredContent.base64, 'base64'), bytes);
  assert.equal(result._meta.headers['Content-Disposition'], 'attachment; filename="dashboard.pdf"');
});

test('packaged stdio executable exchanges credentials over HTTP and produces protocol-only stdout', async t => {
  const refresh = secret(), access = secret(); let exchanges = 0, calls = 0;
  const http = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString(); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token') {
      exchanges++; assert.equal(new URLSearchParams(body).get('refresh_token'), refresh);
      res.end(JSON.stringify({ access_token: access, token_type: 'Bearer', expires_in: 60 }));
    } else {
      calls++; assert.equal(req.url, '/api/v1/datasets'); assert.equal(req.headers.authorization, `Bearer ${access}`);
      res.end(JSON.stringify({ items: [], nextCursor: null }));
    }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { http.close(resolve); http.closeAllConnections(); }));
  const base = `http://127.0.0.1:${http.address().port}`;
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../dist/cli.js', import.meta.url).pathname], stderr: 'pipe',
    env: { OPENSIGHT_MCP_BASE_URL: `${base}/api/v1`, OPENSIGHT_MCP_TOKEN_URL: `${base}/token`, OPENSIGHT_MCP_REFRESH_TOKEN: refresh } });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport); t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 53);
  assert.deepEqual((await call(client, 'list_datasets')).structuredContent, { items: [], nextCursor: null });
  assert.equal(exchanges, 1); assert.equal(calls, 1); assert.equal(stderr, '');
  const audit = JSON.parse(readFileSync(new URL('../dist/license-audit.json', import.meta.url)));
  assert.ok(audit.some(p => p.name === '@modelcontextprotocol/sdk' && p.license === 'MIT'));
  assert.ok(audit.every(p => ['MIT', 'Apache-2.0'].includes(p.license)));
});

test('CLI configuration failures never print credentials or URLs', async () => {
  const token = secret();
  const p = spawn(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname], { env: { OPENSIGHT_MCP_TOKEN_URL: `https://${token}@invalid.example/token`, OPENSIGHT_MCP_REFRESH_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; p.stdout.on('data', b => { stdout += b; }); p.stderr.on('data', b => { stderr += b; });
  assert.equal(await new Promise(resolve => p.on('close', resolve)), 1);
  assert.equal(stdout, ''); assert.equal(stderr.includes(token), false); assert.match(stderr, /startup failed/);
});


test('generated query schema rejects invalid successes while preserving exact REST errors', async t => {
  let status = 200;
  const client = await connect(t, { fetch: async () => json(status === 200 ? { columns: [], rows: [{ protected: 'must not publish' }] } : { errorCode: 'UNSUPPORTED_FEATURE', message: 'Unsupported aggregation' }, status) });
  const query = { dimensions: [], measures: [{ fieldId: 'value', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
  for (const invalid of ['SELECT 1', { sql: 'SELECT 1' }, { ...query, extra: true }, { ...query, filters: [{ columnName: 'x', value: 'y', operator: 'unknown' }] }]) {
    const r = await call(client, 'run_dataset_query', { id: 'sample', query: invalid });
    assert.equal(r.isError, true); assert.equal(r.structuredContent.errorCode, 'HOSTED_REQUEST_INVALID');
    assert.equal(JSON.stringify(r).includes('must not publish'), false);
  }
  status = 422;
  const r = await call(client, 'run_dataset_query', { id: 'sample', query: { ...query, measures: [{ ...query.measures[0], aggregation: 'unknown' }] } });
  assert.equal(r.isError, true); assert.equal(r.structuredContent.errorCode, 'UNSUPPORTED_FEATURE');
});
