import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { organizationApi } from './organization-helpers.mjs';
import { AISettings } from '../dist/ai-settings.js';
import { providerAdapters } from '../dist/ai-providers.js';
const settings = '/api/admin/ai';
const secret = () => randomBytes(32).toString('hex');
const encryptionKey = () => randomBytes(32).toString('base64');
const reply = provider => provider === 'openai' ? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] } : provider === 'anthropic' ? { content: [{ type: 'text', text: 'OK' }] } : { choices: [{ message: { content: 'OK' } }] };

test('AI settings and test routes require a registered administrator before reading bodies or making calls', async t => {
  let calls = 0;
  const { api } = await organizationApi(t, { ai: { fetcher: async () => { calls++; throw new Error(); } } });
  for (const role of ['author', 'author_ai', 'reader', 'reader_ai']) {
    await api('/api/users/alice', 'PUT', { name: 'Alice', role });
    for (const [path, verb, body] of [[settings, 'GET'], [settings, 'POST', { provider: 'openai', model: 'test-model', role: 'administrator' }], [`${settings}/key`, 'POST', { key: secret() }], [`${settings}/test`, 'POST', {}]]) {
      const result = await api(path, verb, body, 'default-alice');
      assert.equal(result.status, 403); assert.equal(result.body.errorCode, 'SECURITY_ADMIN_REQUIRED');
    }
  }
  assert.equal((await api(settings, 'POST', {}, '')).status, 401);
  assert.equal((await api(settings, 'GET', undefined, 'forged')).status, 401);
  assert.equal((await api(settings, 'POST', {}, 'default-alice', { 'x-role': 'administrator' })).status, 403);
  assert.equal(calls, 0);
});
test('keys are encrypted at rest, never returned, survive restart, and are isolated by namespace/provider', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-ai-')); t.after(() => rm(dir, { force: true, recursive: true }));
  const ai = { storePath: join(dir, 'keys.json'), encryptionKey: encryptionKey(), fetcher: async () => Response.json(reply('openai')) };
  const { api } = await organizationApi(t, { ai }), key = secret();
  assert.equal((await api(settings, 'POST', { provider: 'openai', model: 'test-model' })).status, 200);
  const result = await api(`${settings}/key`, 'POST', { key });
  assert.equal(result.status, 200); assert.equal(result.body.hasKey, true); assert.equal(result.body.configured, true);
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(key));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const saved = await readFile(ai.storePath, 'utf8'); assert.ok(!saved.includes(key));
  assert.equal((await stat(ai.storePath)).mode & 0o777, 0o600);
  assert.equal((await api(settings, 'GET', undefined, 'tenant-admin')).body.hasKey, false);
  const restarted = await organizationApi(t, { ai });
  assert.equal((await restarted.api(`${settings}/test`, 'POST', {})).body.ok, true);
  await api(settings, 'POST', { provider: 'openai', model: 'different-model' });
  assert.equal((await api(settings)).body.hasKey, true);
  await api(settings, 'POST', { provider: 'anthropic', model: 'test-model' });
  assert.equal((await api(settings)).body.hasKey, false);
  assert.equal((await api(`${settings}/test`, 'POST', {})).body.errorCode, 'AI_NOT_CONFIGURED');
  const corrupted = JSON.parse(saved); corrupted.configs[0].namespaceId = 'tenant';
  await writeFile(ai.storePath, JSON.stringify(corrupted));
  await assert.rejects(AISettings.load(ai), e => e.code === 'AI_KEY_UNAVAILABLE');
});
test('non-AWS adapters perform bounded minimal checks and sanitize upstream failures', async t => {
  for (const provider of ['openai', 'anthropic', 'openai-compatible']) {
    const calls = [], key = secret();
    const ai = { encryptionKey: encryptionKey(), compatibleBaseUrls: ['https://example.test/v1'], fetcher: async (url, init) => { calls.push({ url, init }); return Response.json(reply(provider)); } };
    const { api } = await organizationApi(t, { ai });
    assert.equal((await api(settings, 'POST', { provider, model: 'test-model', ...(provider === 'openai-compatible' ? { baseUrl: 'https://example.test/v1' } : {}) })).status, 200);
    await api(`${settings}/key`, 'POST', { key });
    assert.deepEqual((await api(`${settings}/test`, 'POST', {})).body, { ok: true });
    assert.equal(calls.length, 1); assert.equal(calls[0].init.redirect, 'error'); assert.ok(calls[0].init.signal);
    const body = JSON.parse(calls[0].init.body); assert.equal(body.max_tokens ?? body.max_output_tokens, 32); assert.equal(body.model, 'test-model');
    assert.ok(Object.values(calls[0].init.headers).some(v => v.includes(key)));
    assert.match(calls[0].url, provider === 'openai' ? /api\.openai\.com\/v1\/responses$/ : provider === 'anthropic' ? /api\.anthropic\.com\/v1\/messages$/ : /example\.test\/v1\/chat\/completions$/);
  }
  for (const status of [401, 429, 500]) {
    const key = secret(), adapter = providerAdapters(async () => new Response(key, { status })).openai;
    await assert.rejects(adapter.complete({ provider: 'openai', model: 'test' }, key, { system: 's', prompt: 'p' }), e => !e.message.includes(key) && e.code === (status === 401 ? 'AI_AUTH_FAILED' : status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED'));
  }
  await assert.rejects(providerAdapters(async () => { throw new Error('secret private error'); }).openai.complete({ provider: 'openai', model: 'test' }, 'key', { system: 's', prompt: 'p' }), e => e.code === 'AI_CONNECTION_FAILED' && !e.message.includes('private'));
});
test('Bedrock selection is honest and never invokes the transport, even with forged approval', async t => {
  let calls = 0;
  const { api } = await organizationApi(t, { ai: { encryptionKey: encryptionKey(), fetcher: async () => { calls++; throw new Error(); } } });
  assert.equal((await api(settings, 'POST', { provider: 'bedrock', model: 'future-model' })).body.state, 'needs-approval');
  assert.equal((await api(`${settings}/test`, 'POST', {})).body.errorCode, 'AI_BEDROCK_APPROVAL_REQUIRED');
  assert.equal((await api(`${settings}/key`, 'POST', { key: secret() })).body.errorCode, 'AI_BEDROCK_APPROVAL_REQUIRED');
  assert.equal((await api(`${settings}/test`, 'POST', { approved: true })).status, 400);
  assert.equal((await api(settings, 'POST', { provider: 'bedrock', model: 'test', approved: true })).status, 400);
  assert.equal(calls, 0);
});
test('settings validation, secure-store requirement, and endpoint allowlist prevent unsafe configuration', async t => {
  const { api } = await organizationApi(t, { ai: { compatibleBaseUrls: ['https://example.test/v1'] } });
  for (const body of [{}, { provider: 'unknown', model: 'm' }, { provider: 'openai', model: '' }, { provider: 'openai', model: 'm', key: secret() }, { provider: 'openai', model: 'm', baseUrl: 'https://example.test' }, ...['http://localhost', 'https://bedrock-runtime.us-east-1.amazonaws.com', 'https://example.test/v1?key=x', 'https://secret@example.test/v1', 'https://other.test/v1'].map(baseUrl => ({ provider: 'openai-compatible', model: 'm', baseUrl }))]) assert.equal((await api(settings, 'POST', body)).status, 400);
  await api(settings, 'POST', { provider: 'openai', model: 'm' });
  assert.equal((await api(`${settings}/key`, 'POST', { key: secret() })).body.errorCode, 'AI_SECURE_STORE_REQUIRED');
  assert.equal((await api(`${settings}?role=administrator`)).status, 400);
  assert.equal((await api(settings, 'DELETE')).status, 405);
  assert.equal((await api(`${settings}/test`, 'POST', {})).body.errorCode, 'AI_NOT_CONFIGURED');
});
test('environment bootstrap key stays server-side and provider output is bounded', async () => {
  const key = secret();
  const ai = await AISettings.load({ bootstrap: { provider: 'openai', model: 'test', key }, fetcher: async () => Response.json(reply('openai')) });
  assert.equal(ai.summary('default').configured, true); assert.equal(ai.summary('tenant').configured, false);
  assert.ok(!JSON.stringify(ai.summary('default')).includes(key));
  assert.equal(await ai.complete('default', { system: 's', prompt: 'p' }), 'OK');
  for (const response of [Response.json({}), new Response('x'.repeat(140_000))]) await assert.rejects(providerAdapters(async () => response).openai.complete({ provider: 'openai', model: 'test' }, key, { system: 's', prompt: 'p' }), e => e.code === 'AI_INVALID_RESPONSE');
});
