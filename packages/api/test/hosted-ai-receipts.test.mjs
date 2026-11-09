import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { HostedAIReceipts, initializeAiAnswerReceipts } from '../dist/hosted-ai-receipts.js';
import { checksum } from '../dist/metadata-operator.js';

const context = { tenantId: 'tenant', namespaceId: 'namespace', userId: 'reader' };
const revisions = { authorization: 1, policy: 1, configuration: 1 };
async function fixture(t) {
  const db = new SqliteMetadataDatabase(':memory:'); t.after(() => db.close());
  await initializeAiAnswerReceipts(db); await initializeAiAnswerReceipts(db);
  let now = Date.parse('2026-11-09T00:00:00Z');
  return { db, store: new HostedAIReceipts(db, () => now), nextStore: () => new HostedAIReceipts(db, () => now), advance: ms => { now += ms; } };
}
test('#229 receipts preserve pending answers after commit failure and replay across store instances', async t => {
  const f = await fixture(t), answer = { question: 'sum revenue', interpretations: [] };
  await assert.rejects(f.store.run(context, '/api/o/generate', 'key', 'hash', async attempt => {
    assert.equal(attempt.receipt, undefined);
    await attempt.pending(answer, 1, true, revisions);
    throw new Error('meter unavailable');
  }), /meter unavailable/);
  await f.nextStore().run(context, '/api/o/generate', 'key', 'hash', async attempt => {
    assert.deepEqual(attempt.receipt, { state: 'pending', answer, chargedCount: 1, managed: true, revisions });
    await attempt.committed();
  });
  await f.nextStore().run(context, '/api/o/generate', 'key', 'hash', async attempt => assert.equal(attempt.receipt.state, 'committed'));
});
test('#229 receipt reservations exclude concurrent workers, release failures and fence expired owners', async t => {
  const f = await fixture(t);
  await f.store.run(context, '/api/o/generate', 'key', 'hash', async attempt => {
    await assert.rejects(f.nextStore().run(context, '/api/o/generate', 'key', 'hash', async () => assert.fail('second worker admitted')), { code: 'IDEMPOTENCY_CONFLICT' });
    f.advance(60001);
    await f.nextStore().run(context, '/api/o/generate', 'key', 'hash', async () => {});
    await assert.rejects(attempt.pending({}, 1, true, revisions), { code: 'IDEMPOTENCY_CONFLICT' });
  });
  await assert.rejects(f.store.run(context, '/api/o/generate', 'key', 'hash', async () => { throw Error('provider failed'); }), /provider failed/);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM ai_answer_receipts'))).length, 0);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM ai_answer_receipt_reservations'))).length, 0);
});
test('#229 receipt fingerprints conflict, scope isolates keys and TTL regenerates after 60 minutes', async t => {
  const f = await fixture(t);
  const save = c => f.store.run(c, '/api/o/generate', 'key', 'hash', async a => { assert.equal(a.receipt, undefined); await a.pending({}, 1, true, revisions); await a.committed(); });
  await save(context);
  await assert.rejects(f.store.run(context, '/api/o/generate', 'key', 'different', async () => assert.fail()), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  for (const field of ['tenantId', 'namespaceId', 'userId']) await save({ ...context, [field]: 'other' });
  await f.store.run(context, '/api/o/revise', 'key', 'hash', async a => assert.equal(a.receipt, undefined));
  f.advance(3600000);
  await save(context);
  assert.equal(checksum({ path: 'generate', body: { question: 'sales', calculatedFields: [{ name: 'x', role: 'measure' }] } }), checksum({ body: { calculatedFields: [{ role: 'measure', name: 'x' }], question: 'sales' }, path: 'generate' }));
});
