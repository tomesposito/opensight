import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectCollector, AwsObjectDeletion } from '../dist/object-collector.js';
import { MetadataError } from '../dist/metadata-db.js';
import { uploadFixture, directRequest } from './serverless-upload-helpers.mjs';
import { InvocationAws } from '../dist/runtime-aws.js';
import { InvocationScope } from '../dist/runtime-scope.js';
const awsEnv = { AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic', AWS_REGION: 'us-east-1', OPENSIGHT_DEPLOYMENT: 'test' };
async function fixture(t) {
  const f = await uploadFixture(t), ctx = f.contexts[0];
  await f.uploads.reserve(ctx, directRequest(), randomUUID(), async () => {});
  const raw = (await f.rows('sr_object')).find(r => r.purpose === 'raw-upload');
  const event = (await f.rows('sr_outbox')).find(e => e.aggregate_id === raw.object_id);
  const now = Date.now();
  await f.db.transaction(async c => {
    await c.query('UPDATE sr_object SET created_at = ?, retention_until = ?, signature_until = ? WHERE object_id = ?', [now - 90000000, now - 1000, now - 90000000, raw.object_id]);
    await c.query('UPDATE sr_outbox SET due_at = ?, expires_at = ? WHERE event_id = ?', [now - 1000, now + 3600000, event.event_id]);
  });
  const calls = [], objects = { latest: async key => { calls.push(['head', key]); return 'uncertain-version'; }, remove: async (key, version) => { calls.push(['delete', key, version]); } };
  const collector = new ObjectCollector(f.db, f.dispatch, objects, 'sqlite');
  const envelope = { version: 1, deploymentEpoch: Number(event.control_epoch), eventId: event.event_id, kind: 'execute' };
  return { ...f, raw, event, envelope, collector, calls, objects };
}
test('SR2d collector reclaims an unacknowledged PUT after owner suspension and duplicates cannot double-release bytes', async t => {
  const f = await fixture(t);
  const before = (await f.rows('sr_storage_usage'))[0].reserved_bytes;
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = ?", [f.contexts[0].tenantId]));
  await f.collector.run(f.envelope); await f.collector.run(f.envelope);
  const raw = (await f.rows('sr_object')).find(r => r.object_id === f.raw.object_id);
  assert.equal(raw.state, 'deleted'); assert.equal(raw.object_version, 'uncertain-version');
  assert.equal((await f.rows('sr_storage_usage'))[0].reserved_bytes, before - Number(f.raw.capacity_bytes));
  assert.deepEqual(f.calls, [['head', f.raw.object_key], ['delete', f.raw.object_key, 'uncertain-version']]);
});
test('SR2d uncertain deletion retains quota; a later confirmed exact-version absence releases it', async t => {
  const f = await fixture(t), before = (await f.rows('sr_storage_usage'))[0].reserved_bytes;
  const remove = f.objects.remove; f.objects.remove = async () => { throw new MetadataError('DELETE_TIMEOUT', 503); };
  await assert.rejects(f.collector.run(f.envelope), { code: 'DELETE_TIMEOUT' });
  assert.equal((await f.rows('sr_storage_usage'))[0].reserved_bytes, before);
  assert.equal((await f.rows('sr_object')).find(r => r.object_id === f.raw.object_id).state, 'retiring');
  f.objects.remove = remove; await f.collector.run(f.envelope);
  assert.equal(f.calls.filter(c => c[0] === 'head').length, 1, 'retry uses the recorded exact version');
  assert.equal((await f.rows('sr_storage_usage'))[0].reserved_bytes, before - Number(f.raw.capacity_bytes));
});
test('SR2d backup pin creates a durable continuation; failed dispatch cannot acknowledge the original queue obligation', async t => {
  const f = await fixture(t), ctx = f.contexts[0], until = Date.now() + 3600000;
  await f.db.transaction(c => c.query('INSERT INTO sr_object_pin VALUES (?,?,?,?,?,?,?)', ['test', ctx.tenantId, ctx.namespaceId, ctx.userId, f.raw.object_id, 'backup', until]));
  const dispatch = f.transport.dispatch; f.transport.dispatch = async () => { throw new MetadataError('SEND_TIMEOUT', 503); };
  await assert.rejects(f.collector.run(f.envelope), { code: 'SEND_TIMEOUT' });
  let rows = await f.rows('sr_outbox');
  assert.notEqual(rows.find(r => r.event_id === f.event.event_id).state, 'terminal');
  assert.equal(rows.find(r => r.aggregate_id === f.raw.object_id && Number(r.aggregate_revision) === 2).state, 'pending');
  f.transport.dispatch = dispatch; await f.collector.run(f.envelope);
  rows = await f.rows('sr_outbox');
  assert.equal(rows.filter(r => r.aggregate_id === f.raw.object_id).length, 2);
  assert.equal(rows.find(r => r.event_id === f.event.event_id).state, 'terminal');
  assert.equal(rows.find(r => Number(r.aggregate_revision) === 2).state, 'dispatched');
  assert.equal(f.calls.length, 0);
});
test('SR2d missing unbound key is reclaimed without issuing a versionless DELETE', async t => {
  const f = await fixture(t); f.objects.latest = async () => undefined;
  await f.collector.run(f.envelope);
  assert.equal((await f.rows('sr_object')).find(r => r.object_id === f.raw.object_id).state, 'deleted'); assert.equal(f.calls.length, 0);
});
test('SR2d S3 deletion requires exact version and verified 404; 403 and ambiguous responses do not count', async () => {
  const key = `objects/v1/${'a'.repeat(64)}/${randomUUID()}`, calls = [];
  let failure;
  const aws = { call: work => work(new AbortController().signal), s3: { send: async command => {
    calls.push(command); if (command.constructor.name === 'HeadObjectCommand') { if (failure) throw failure; return { VersionId: 'v1' }; } return {};
  } } };
  const deletion = new AwsObjectDeletion(aws, 'synthetic-artifacts');
  await assert.rejects(deletion.remove(key, 'v1'), { code: 'OBJECT_DELETE_UNCONFIRMED' });
  failure = Object.assign(new Error(), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  await assert.rejects(deletion.remove(key, 'v1'), { name: 'AccessDenied' });
  failure = Object.assign(new Error(), { name: 'NoSuchVersion', $metadata: { httpStatusCode: 404 } });
  await deletion.remove(key, 'v1');
  assert.ok(calls.every(c => c.input.VersionId === 'v1'));
  assert.equal(await deletion.latest(key), undefined);
  await assert.rejects(deletion.remove('../foreign', 'v1'), { code: 'OBJECT_INVALID' });
});

test('#91 real AWS wrapper preserves absence proof and collector releases quota exactly once', async t => {
  for (const bound of [false, true]) {
    const f = await fixture(t), before = (await f.rows('sr_storage_usage'))[0].reserved_bytes, calls = [];
    if (bound) await f.db.transaction(c => c.query('UPDATE sr_object SET object_version = ? WHERE object_id = ?', ['exact-version', f.raw.object_id]));
    await new InvocationScope(Date.now() + 12000).run(async invocation => {
      const aws = new InvocationAws(invocation, awsEnv);
      t.mock.method(aws.s3, 'send', async command => {
        calls.push(command);
        if (command.constructor.name === 'HeadObjectCommand') throw Object.assign(new Error('private provider detail'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return {};
      });
      const collector = new ObjectCollector(f.db, f.dispatch, new AwsObjectDeletion(aws, 'synthetic-artifacts'), 'sqlite');
      await collector.run(f.envelope); await collector.run(f.envelope);
    });
    assert.equal((await f.rows('sr_object')).find(r => r.object_id === f.raw.object_id).state, 'deleted');
    assert.equal((await f.rows('sr_storage_usage'))[0].reserved_bytes, before - Number(f.raw.capacity_bytes));
    assert.deepEqual(calls.map(c => c.constructor.name), bound ? ['DeleteObjectCommand', 'HeadObjectCommand'] : ['HeadObjectCommand']);
    assert.ok(calls.every(c => c.input.VersionId === (bound ? 'exact-version' : undefined)));
  }
});

test('#91 real AWS wrapper fails closed on denied, unnamed, ambiguous and timed-out HEAD responses', async t => {
  await new InvocationScope(Date.now() + 12000).run(async invocation => {
    const aws = new InvocationAws(invocation, awsEnv), deletion = new AwsObjectDeletion(aws, 'synthetic-artifacts');
    const key = `objects/v1/${'a'.repeat(64)}/${randomUUID()}`;
    for (const [name, status] of [['AccessDenied', 403], ['NotFound', 403], ['Error', 404], ['NotFound', 500]]) {
      t.mock.method(aws.s3, 'send', async command => {
        if (command.constructor.name === 'HeadObjectCommand') throw Object.assign(new Error('private provider detail'), { name, $metadata: { httpStatusCode: status } });
        return {};
      });
      for (const call of [() => deletion.latest(key), () => deletion.remove(key, 'exact-version')]) {
        await assert.rejects(call(), error => error.code === 'AWS_REQUEST_FAILED' && !error.message.includes('private'));
      }
    }
    t.mock.method(aws.s3, 'send', async () => ({ VersionId: 'exact-version' }));
    await assert.rejects(deletion.remove(key, 'exact-version'), { code: 'OBJECT_DELETE_UNCONFIRMED' });
    const call = aws.call.bind(aws); t.mock.method(aws, 'call', work => call(work, 20));
    t.mock.method(aws.s3, 'send', async (_command, { abortSignal }) => new Promise((_resolve, reject) => {
      abortSignal.addEventListener('abort', () => reject(Error('private transport failure')), { once: true });
    }));
    await assert.rejects(deletion.latest(key), { code: 'AWS_REQUEST_TIMEOUT' });
  });
});
