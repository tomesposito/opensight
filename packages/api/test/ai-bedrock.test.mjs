import test from 'node:test';
import assert from 'node:assert/strict';
import { providerAdapters } from '../dist/ai-providers.js';
import { signConverse } from '../dist/ai-bedrock.js';
const identity = { accessKeyId: 'test-access', secretAccessKey: 'test-secret', sessionToken: 'test-session' };
const options = { region: 'us-east-1', credentials: async () => identity, clock: () => new Date('2026-11-05T12:00:00Z') };
test('#190 Bedrock Converse signs and maps bounded transport and usage', async () => {
  let called = 0;
  const adapter = providerAdapters(async (url, init) => {
    called++;
    assert.equal(url, 'https://bedrock-runtime.us-east-1.amazonaws.com/model/test%3Amodel/converse');
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\/20261105\/us-east-1\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[a-f0-9]{64}$/);
    assert.equal(init.headers['x-amz-security-token'], identity.sessionToken);
    assert.deepEqual(JSON.parse(init.body), { system: [{ text: 'rules' }], messages: [{ role: 'user', content: [{ text: 'question' }] }], inferenceConfig: { maxTokens: 32 } });
    assert.deepEqual(init.headers, signConverse(options.region, 'test:model', init.body, identity, options.clock()).headers);
    return Response.json({ output: { message: { content: [{ text: '{"question":"sum revenue"}' }] } }, usage: { inputTokens: 4, outputTokens: 8 } });
  }, options).bedrock;
  assert.deepEqual(await adapter.complete({ provider: 'bedrock', model: 'test:model' }, '', { system: 'rules', prompt: 'question', maxTokens: 32 }), { text: '{"question":"sum revenue"}', tokens: 12 });
  assert.equal(called, 1);
});
for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED'], [500, 'AI_PROVIDER_FAILED']]) test(`#190 Bedrock sanitizes ${status}`, async () => {
  const adapter = providerAdapters(async () => new Response('private provider body', { status }), options).bedrock;
  await assert.rejects(adapter.complete({ provider: 'bedrock', model: 'test' }, '', { system: '', prompt: '' }), e => e.code === code && !e.message.includes('private'));
});
test('#190 Bedrock requires deployment approval and bounds response size', async () => {
  await assert.rejects(providerAdapters(async () => { throw Error('must not call'); }).bedrock.complete({}, '', {}), { code: 'AI_BEDROCK_APPROVAL_REQUIRED' });
  await assert.rejects(providerAdapters(async () => new Response('x'.repeat(128 * 1024 + 1)), options).bedrock.complete({ model: 'test' }, '', {}), { code: 'AI_INVALID_RESPONSE' });
});
