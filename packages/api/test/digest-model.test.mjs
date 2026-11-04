import test from 'node:test';
import assert from 'node:assert/strict';
import { digestFixture, digestInput } from './digest-helpers.mjs';
import { newDigest, digestSpec } from '../dist/digest-model.js';
import { DigestStore } from '../dist/digest-store.js';
import { JobStore } from '../dist/job-store.js';

test('digests: subscription is durable, scoped, weekly by default and self only; daily is explicit', async t => {
  const f = await digestFixture(t), c = await f.login(), s = await f.subscriptions.create(c, 'revenue', digestInput);
  assert.equal(s.cadence, 'weekly'); assert.equal(s.subscriberId, 'admin'); assert.equal(new Date(s.nextRun).getUTCDay(), 1); assert.equal(new Date(s.nextRun).getUTCHours(), 9);
  assert.equal('unsubscribeToken' in s, false);
  const daily = await f.subscriptions.create(c, 'revenue', { ...digestInput, cadence: 'daily' }); assert.equal(daily.cadence, 'daily');
  assert.equal((await f.subscriptions.list(await f.login('two'), 'revenue')).length, 0);
  assert.equal((await f.subscriptions.list(await f.login('one', 'other'), 'revenue')).length, 0);
  const stored = await f.store.get(c, s.id); assert.equal(stored.spec.unsubscribeToken.length, 64);
  const restarted = new DigestStore(new JobStore(f.db, f.metadata), f.executor); assert.equal((await restarted.list(c, 'revenue')).length, 2);
  for (const patch of [{ subscriberId: 'other' }, { recipients: ['other'] }, { email: 'other@example.test' }]) await assert.rejects(f.subscriptions.create(c, 'revenue', { ...digestInput, ...patch }), { code: 'METADATA_INVALID' });
  await assert.rejects(f.store.put(c, 'forged', newDigest('revenue', 'other', digestInput), 0, async () => {}), { code: 'DIGEST_SELF_ONLY' });
});

test('digests: published view access is required; shared destinations need owner/admin and verified membership', async t => {
  const f = await digestFixture(t), c = await f.login();
  await assert.rejects(f.subscriptions.create(c, 'missing', digestInput), { code: 'METRIC_NOT_FOUND' });
  f.executor.authorize = async () => { throw Object.assign(new Error('denied'), { code: 'SOURCE_ACCESS_DENIED' }); };
  await assert.rejects(f.subscriptions.create(c, 'revenue', digestInput), { code: 'SOURCE_ACCESS_DENIED' });
  assert.equal((await f.store.list(c)).length, 0);
  const shared = { ...digestInput, destination: { kind: 'shared-email', address: 'team@example.test' } };
  await assert.rejects(f.subscriptions.create(c, 'revenue', shared), { code: 'DIGEST_SHARED_DESTINATION_UNRESOLVED' });
  await f.metadata.put(c, { kind: 'user', id: 'other' }, { name: 'Reader', role: 'reader' }, 1);
  await assert.rejects(f.subscriptions.create(await f.login('one', 'other'), 'revenue', shared), { code: 'DIGEST_SHARED_FORBIDDEN' });
  f.executor.authorize = async () => {};
  const s = await f.subscriptions.create(await f.login('one', 'other'), 'revenue', digestInput); assert.equal(s.subscriberId, 'other');
});

test('digests: unsubscribe token cancels queued work, replays safely and cannot cross namespaces', async t => {
  const f = await digestFixture(t), c = await f.login(), s = await f.subscriptions.create(c, 'revenue', digestInput);
  const token = (await f.store.get(c, s.id)).spec.unsubscribeToken;
  await f.store.enqueue(c, s.id);
  await assert.rejects(f.subscriptions.unsubscribe(c, s.id, '0'.repeat(64)), { code: 'DIGEST_UNSUBSCRIBE_INVALID' });
  await assert.rejects(f.subscriptions.unsubscribe({ tenantId: 'tenant-two', namespaceId: 'two' }, s.id, token), { code: 'RESOURCE_NOT_FOUND' });
  await f.subscriptions.unsubscribe(c, s.id, token); await f.subscriptions.unsubscribe(c, s.id, token);
  assert.equal((await f.store.get(c, s.id)).stopped, true); assert.deepEqual(await f.subscriptions.list(c, 'revenue'), []);
  assert.equal((await f.store.history(c, s.id))[0].state, 'cancelled');
});

test('digests: stored specs reject recipient, cadence, schedule and dimension bypasses', () => {
  const spec = newDigest('metric', 'reader', digestInput); assert.deepEqual(digestSpec(spec), spec);
  for (const patch of [{ recipients: ['someone-else'] }, { schedule: { kind: 'interval', minutes: 1, timeZone: 'UTC' } }, { unsubscribeToken: 'guess' }]) assert.throws(() => digestSpec({ ...spec, ...patch }), { code: 'DIGEST_SUBSCRIPTION_INVALID' });
  assert.throws(() => newDigest('metric', 'reader', { ...digestInput, cadence: 'hourly' }), { code: 'DIGEST_CADENCE_INVALID' });
  assert.throws(() => newDigest('metric', 'reader', { ...digestInput, dimensions: ['region', 'region'] }), { code: 'DIGEST_DIMENSIONS_INVALID' });
});
