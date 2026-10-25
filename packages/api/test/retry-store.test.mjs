import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryStore, RETRY_TTL_MS } from '../dist/retry-store.js';

const bytes = value => Buffer.byteLength(JSON.stringify(value));
const capacity = work => assert.throws(work, e => e.code === 'IDEMPOTENCY_CAPACITY_EXCEEDED' && e.status === 429);
function store(t, env = {}, options = {}) {
  const cache = new RetryStore({ env, ...options }); t.after(() => cache.close()); return cache;
}

test('retry store: positive safe integer configuration and defaults', t => {
  for (const name of ['OPENSIGHT_RETRY_CACHE_MAX_ENTRIES', 'OPENSIGHT_RETRY_CACHE_MAX_BYTES',
    'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES', 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES']) {
    for (const value of ['', '0', '-1', '1.5', '1e3', ' 2', 'NaN', '9007199254740992']) {
      assert.throws(() => new RetryStore({ env: { [name]: value } }), { message: `${name} must be a positive integer` });
    }
  }
  const cache = store(t);
  for (let tenant = 0; tenant < 4; tenant++) {
    for (let i = 0; i < 250; i++) cache.set(String(tenant), `${tenant}:${i}`, null);
    capacity(() => cache.reserve(String(tenant), `${tenant}:overflow`));
  }
  capacity(() => cache.reserve('fifth', 'global-overflow'));
  assert.deepEqual(cache.usage(), { entries: 1000, bytes: 4000 });
});

test('retry store: tenant entry exhaustion leaves other tenants room until the global cap', t => {
  const cache = store(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '3', OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES: '2' });
  cache.set('a', 'a1', 1); cache.set('a', 'a2', 2);
  capacity(() => cache.reserve('a', 'a3'));
  cache.set('b', 'b1', 3);
  capacity(() => cache.reserve('b', 'b2'));
  assert.equal(cache.get('a1'), 1);
  assert.deepEqual(cache.usage('a'), { entries: 2, bytes: 2 });
  assert.deepEqual(cache.usage('b'), { entries: 1, bytes: 1 });
});

test('retry store: tenant and global JSON byte caps include reply, record and access', t => {
  const receipt = { fingerprint: 'hash', reply: { status: 201, body: { name: 'é' } },
    record: { definition: { sheets: ['retained definition'] } }, access: { grants: ['owner'] }, removed: false };
  const size = bytes(receipt);
  assert.ok(size > bytes(receipt.reply) + bytes(receipt.record));
  const cache = store(t, { OPENSIGHT_RETRY_CACHE_MAX_BYTES: String(size * 2), OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES: String(size) });
  cache.set('a', 'a1', receipt);
  assert.deepEqual(cache.usage('a'), { entries: 1, bytes: size });
  capacity(() => cache.reserve('a', 'a2'));
  capacity(() => cache.set('a', 'a2', null));
  cache.set('b', 'b1', receipt);
  capacity(() => cache.reserve('c', 'c1'));
  capacity(() => cache.set('c', 'c1', null));
  assert.deepEqual(cache.get('a1'), receipt);
});

test('retry store: oversized receipts fail atomically with remaining byte headroom', t => {
  const cache = store(t, { OPENSIGHT_RETRY_CACHE_MAX_BYTES: '12', OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES: '8' });
  cache.set('a', 'a1', 'four'); // Six JSON bytes.
  capacity(() => cache.set('a', 'a2', 'x'));
  cache.set('b', 'b1', 'x');
  capacity(() => cache.set('c', 'c1', 'xx'));
  assert.deepEqual(cache.usage(), { entries: 2, bytes: 9 });
  assert.equal(cache.get('a2'), undefined);
});

test('retry store: replacing and deleting maintain exact global and tenant totals', t => {
  const cache = store(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '1', OPENSIGHT_RETRY_CACHE_MAX_BYTES: '8' });
  cache.set('a', 'key', 'four'); cache.set('a', 'key', 'x');
  assert.deepEqual(cache.usage(), { entries: 1, bytes: 3 });
  assert.deepEqual(cache.usage('a'), cache.usage());
  capacity(() => cache.set('a', 'key', 'too large'));
  assert.equal(cache.get('key'), 'x');
  cache.set('b', 'key', 'longer');
  assert.deepEqual(cache.usage('a'), { entries: 0, bytes: 0 });
  assert.deepEqual(cache.usage('b'), { entries: 1, bytes: 8 });
  assert.deepEqual(cache.usage(), cache.usage('b'));
  assert.equal(cache.delete('key'), true); assert.equal(cache.delete('key'), false);
  assert.deepEqual(cache.usage(), { entries: 0, bytes: 0 });
  assert.deepEqual(cache.usage('b'), cache.usage());
});

test('retry store: clock expiry reclaims bytes and entries on access and admission', t => {
  let now = 0;
  const cache = store(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '1' }, { now: () => now });
  cache.set('a', 'old', 'value'); now = RETRY_TTL_MS - 1;
  assert.equal(cache.get('old'), 'value'); capacity(() => cache.reserve('b', 'new'));
  now++;
  assert.equal(cache.get('old'), undefined);
  assert.deepEqual(cache.usage(), { entries: 0, bytes: 0 });
  assert.deepEqual(cache.usage('a'), cache.usage());
  cache.set('a', 'old', 'value'); now += RETRY_TTL_MS;
  cache.set('b', 'new', 1);
  assert.deepEqual(cache.usage(), { entries: 1, bytes: 1 });
  assert.deepEqual(cache.usage('a'), { entries: 0, bytes: 0 });
});

test('retry store: periodic prune works without access and close stops the timer', t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  const cache = store(t); cache.set('a', 'old', 'value');
  t.mock.timers.tick(RETRY_TTL_MS);
  assert.deepEqual(cache.usage(), { entries: 0, bytes: 0 });
  assert.deepEqual(cache.usage('a'), cache.usage());
  cache.set('b', 'new', 1); cache.close();
  t.mock.timers.tick(RETRY_TTL_MS);
  assert.deepEqual(cache.usage(), { entries: 1, bytes: 1 });
});

test('retry store: in-flight reservations prevent competing admission and release on failure', t => {
  const cache = store(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '2', OPENSIGHT_RETRY_CACHE_MAX_BYTES: '8', OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES: '1' });
  const a = cache.reserve('a', 'a1');
  capacity(() => cache.reserve('a', 'a2'));
  const b = cache.reserve('b', 'b1');
  capacity(() => cache.reserve('c', 'c1'));
  a.prepare('four');
  capacity(() => b.prepare('x'));
  assert.equal(cache.get('a1'), undefined, 'uncommitted results cannot replay');
  b.release(); b.release();
  assert.deepEqual(cache.usage(), { entries: 1, bytes: 6 });
  a.commit(); a.release();
  assert.equal(cache.get('a1'), 'four');
  assert.deepEqual(cache.usage(), { entries: 1, bytes: 6 });
});

test('retry store: prepared reservations survive prune during slow commits', t => {
  let now = 0;
  const cache = store(t, {}, { now: () => now }), reservation = cache.reserve('a', 'key');
  reservation.prepare('longer'); reservation.prepare('x');
  now = RETRY_TTL_MS * 2; cache.prune();
  assert.deepEqual(cache.usage(), { entries: 1, bytes: 3 });
  reservation.commit(); assert.equal(cache.get('key'), 'x');
  now += RETRY_TTL_MS; cache.prune();
  assert.deepEqual(cache.usage(), { entries: 0, bytes: 0 });
});
