import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeRequest } from '../ops/serverless/release-smoke-request.mjs';

const revised = { status: 403, body: { errorCode: 'METADATA_REVISED' } };
test('SR4c ingestion polling reauthorizes a read that races metadata publication', async () => {
  let calls = 0; const delays = [], completed = { status: 200, body: { state: 'completed' } };
  const result = await smokeRequest('GET', '/api/operations/synthetic-id', async () => ++calls === 1 ? revised : completed, async ms => delays.push(ms));
  assert.equal(result, completed); assert.equal(calls, 2); assert.deepEqual(delays, [250]);
});
test('SR4c repeated metadata changes remain a bounded smoke failure', async () => {
  let calls = 0;
  assert.equal(await smokeRequest('GET', '/api/operations/synthetic', async () => { calls++; return revised; }, async () => {}), revised);
  assert.equal(calls, 3);
});
test('SR4c smoke retry does not repeat writes, unrelated reads, or other denials', async () => {
  for (const [method, path, response] of [
    ['POST', '/api/operations/synthetic', revised], ['DELETE', '/api/operations/synthetic', revised],
    ['GET', '/api/sources/synthetic', revised], ['GET', '/api/operations/synthetic', { status: 403, body: { errorCode: 'ACCESS_DENIED' } }],
    ['GET', '/api/operations/synthetic', { status: 401, body: { errorCode: 'METADATA_REVISED' } }],
  ]) {
    let calls = 0;
    assert.equal(await smokeRequest(method, path, async () => { calls++; return response; }, async () => assert.fail('Unexpected retry')), response);
    assert.equal(calls, 1);
  }
});
test('SR4c smoke retry preserves transport failures', async () => {
  let calls = 0;
  await assert.rejects(smokeRequest('GET', '/api/operations/synthetic', async () => { calls++; throw Error('transport'); }), /transport/);
  assert.equal(calls, 1);
});
