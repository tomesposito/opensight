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
test('#229 active receipt reservations renew with fake timers and reject overlapping workers', async t => {
  const f = await fixture(t); t.mock.timers.enable({ apis: ['setInterval'] });
  await f.store.run(context, '/api/o/generate', 'key', 'hash', async () => {
    for (let i = 0; i < 4; i++) {
      f.advance(20000); t.mock.timers.tick(20000);
      await new Promise(r => setImmediate(r));
    }
    await assert.rejects(f.nextStore().run(context, '/api/o/generate', 'key', 'hash', async () => assert.fail()), { code: 'IDEMPOTENCY_CONFLICT' });
  });
});

const receiptTtl = 3600000;
const route = '/api/o/generate';
const scopeValues = (key, c = context, path = route) => [c.tenantId, c.namespaceId, c.userId, path, key];
const storedRows = (db, table) => db.transaction(c => c.query(`SELECT * FROM ${table}`));
const saveReceipt = (store, key, c = context, answer = {}, path = route) => store.run(c, path, key, 'hash', async attempt => {
  assert.equal(attempt.receipt, undefined);
  await attempt.pending(answer, 1, true, revisions);
  await attempt.committed();
});

test('#249 initialization adds expiry and tenant indexes to existing receipt tables', async t => {
  const f = await fixture(t);
  const indexes = [
    ['ai_answer_receipts_expiry', ['expires_at']],
    ['ai_answer_receipt_reservations_expiry', ['expires_at']],
    ['ai_answer_receipts_tenant_expiry', ['tenant_id', 'expires_at']],
  ];
  await saveReceipt(f.store, 'existing');
  await f.db.transaction(async c => {
    for (const [name] of indexes) await c.query(`DROP INDEX ${name}`);
  });
  await initializeAiAnswerReceipts(f.db);
  await initializeAiAnswerReceipts(f.db);
  for (const [name, columns] of indexes) {
    const rows = await f.db.transaction(c => c.query(`PRAGMA index_info(${name})`));
    assert.deepEqual(rows.map(row => row.name), columns);
  }
  assert.equal((await storedRows(f.db, 'ai_answer_receipts')).length, 1);
});

test('#249 unrelated tenant requests prune distinct expired receipts and abandoned reservations', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 30; i++) await saveReceipt(f.store, `expired-${i}`, context, { question: `old answer ${i}` });
  await f.db.transaction(c => c.query(`INSERT INTO ai_answer_receipt_reservations
    SELECT tenant_id, namespace_id, user_id, route, idempotency_key, 'abandoned', expires_at FROM ai_answer_receipts`));
  f.advance(receiptTtl);
  await saveReceipt(f.nextStore(), 'unrelated', { ...context, tenantId: 'other-tenant' });
  const rows = await storedRows(f.db, 'ai_answer_receipts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenant_id, 'other-tenant');
  assert.equal(rows[0].idempotency_key, 'unrelated');
  assert.equal((await storedRows(f.db, 'ai_answer_receipt_reservations')).length, 0);
});

test('#249 pruning protects only the full scope of a live replay reservation until its lease expires', async t => {
  const f = await fixture(t);
  await saveReceipt(f.store, 'key');
  for (const field of ['tenantId', 'namespaceId', 'userId']) await saveReceipt(f.store, 'key', { ...context, [field]: 'other' });
  await saveReceipt(f.store, 'key', context, {}, '/api/o/revise');
  await saveReceipt(f.store, 'other-key');
  f.advance(receiptTtl - 1);
  await f.store.run(context, route, 'key', 'hash', async attempt => {
    assert.equal(attempt.receipt.state, 'committed');
    f.advance(1);
    await f.nextStore().pruneExpired();
    const rows = await storedRows(f.db, 'ai_answer_receipts');
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].tenant_id, rows[0].namespace_id, rows[0].user_id, rows[0].route, rows[0].idempotency_key], scopeValues('key'));
    assert.equal((await storedRows(f.db, 'ai_answer_receipt_reservations')).length, 1);
    f.advance(60000);
    await f.nextStore().pruneExpired();
    assert.equal((await storedRows(f.db, 'ai_answer_receipts')).length, 0);
    assert.equal((await storedRows(f.db, 'ai_answer_receipt_reservations')).length, 0);
  });
});

test('#249 expiration maintenance bounds each table to twenty batches of five hundred and converges', async t => {
  const f = await fixture(t);
  const expired = '2026-11-08T00:00:00.000Z';
  await f.db.transaction(async c => {
    for (let i = 0; i < 10001; i++) {
      await c.query(`INSERT INTO ai_answer_receipts VALUES (?,?,?,?,?,?,'committed',?,1,1,?,?,?)`,
        [...scopeValues(`expired-${i}`), 'hash', '{}', JSON.stringify(revisions), expired, expired]);
    }
    await c.query(`INSERT INTO ai_answer_receipt_reservations
      SELECT tenant_id, namespace_id, user_id, route, idempotency_key, 'abandoned', expires_at FROM ai_answer_receipts`);
  });
  const selections = [];
  const transaction = f.db.transaction.bind(f.db);
  t.mock.method(f.db, 'transaction', work => transaction(c => work({ query: async (sql, args) => {
    const rows = await c.query(sql, args);
    if (sql.startsWith('SELECT tenant_id')) selections.push(rows.length);
    return rows;
  } })));
  await f.store.pruneExpired();
  assert.deepEqual(selections, Array(40).fill(500));
  assert.equal((await storedRows(f.db, 'ai_answer_receipts')).length, 1);
  assert.equal((await storedRows(f.db, 'ai_answer_receipt_reservations')).length, 1);
  selections.length = 0;
  await f.store.pruneExpired();
  assert.deepEqual(selections, [1, 1]);
  assert.equal((await storedRows(f.db, 'ai_answer_receipts')).length, 0);
  assert.equal((await storedRows(f.db, 'ai_answer_receipt_reservations')).length, 0);
});
