import test from 'node:test';
import assert from 'node:assert/strict';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { recordMaintenanceReceipt } from '../dist/serverless-backup-lambda.js';
import { InvocationAws } from '../dist/runtime-aws.js';
import { InvocationScope } from '../dist/runtime-scope.js';

const expected = { state: 'migrated', epoch: 4, replayed: false, plan: 'plan', registry: 'registry', backup: 'backup' };
const env = { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic' };
const location = { Bucket: 'synthetic-operations', Key: 'maintenance/receipts/synthetic.json' };
const sdkError = name => Object.assign(new Error('private provider detail'), { name });

// Exercise the real invocation error normalization, with a scoped S3 service
// substitute: absent reads are AccessDenied and conditional writes cannot replace
// evidence. No network calls, credentials or ListBucket permission are needed.
async function fixture(t, options, work) {
  await new InvocationScope(Date.now() + 12000).run(async scope => {
    const aws = new InvocationAws(scope, env), calls = [];
    let stored = options.stored, writes = 0;
    t.mock.method(aws.s3, 'send', async command => {
      assert.equal(command.input.Bucket, location.Bucket);
      assert.equal(command.input.Key, location.Key);
      if (command instanceof GetObjectCommand) {
        calls.push('read');
        if (options.unreadable || stored === undefined) throw sdkError('AccessDenied');
        return { Body: { transformToString: async () => JSON.stringify(stored) } };
      }
      assert.ok(command instanceof PutObjectCommand);
      calls.push('create');
      assert.equal(command.input.IfNoneMatch, '*');
      if (options.denied) throw sdkError('AccessDenied');
      if (stored !== undefined) throw sdkError('PreconditionFailed');
      if (!options.lostBeforeCommit) { stored = JSON.parse(command.input.Body); writes++; }
      if (options.lostResponse || options.lostBeforeCommit) throw sdkError('TimeoutError');
      return { VersionId: 'synthetic-version' };
    });
    const io = {
      read: () => aws.call(async signal => {
        const response = await aws.s3.send(new GetObjectCommand(location), { abortSignal: signal });
        return JSON.parse(await response.Body.transformToString());
      }),
      create: value => aws.call(signal => aws.s3.send(new PutObjectCommand({ ...location, Body: JSON.stringify(value), IfNoneMatch: '*' }), { abortSignal: signal })),
    };
    await work({ io, calls, stored: () => stored, writes: () => writes });
  });
}

test('maintenance receipt creates first even when absent reads normalize AccessDenied', async t => {
  await fixture(t, {}, async f => {
    await assert.rejects(f.io.read(), { code: 'AWS_REQUEST_FAILED' });
    f.calls.length = 0;
    await recordMaintenanceReceipt(expected, f.io);
    assert.deepEqual(f.calls, ['create']); assert.equal(f.writes(), 1);
    assert.deepEqual(f.stored(), expected);
  });
});

test('maintenance receipt reconciles exact retry without overwriting its original replay observation', async t => {
  await fixture(t, { stored: expected }, async f => {
    await recordMaintenanceReceipt({ ...expected, replayed: true }, f.io);
    assert.deepEqual(f.calls, ['create', 'read']); assert.equal(f.writes(), 0);
    assert.deepEqual(f.stored(), expected);
  });
});

test('maintenance receipt reconciles a committed write with a lost response', async t => {
  await fixture(t, { lostResponse: true }, async f => {
    await recordMaintenanceReceipt(expected, f.io);
    assert.deepEqual(f.calls, ['create', 'read']); assert.equal(f.writes(), 1);
    assert.deepEqual(f.stored(), expected);
  });
});

for (const [name, options] of Object.entries({
  'write denied and key absent': { denied: true },
  'response lost before commit': { lostBeforeCommit: true },
  'existing evidence unreadable': { stored: expected, unreadable: true },
})) test(`maintenance receipt fails closed with normalized errors: ${name}`, async t => {
  await fixture(t, options, async f => {
    await assert.rejects(recordMaintenanceReceipt(expected, f.io), { code: 'AWS_REQUEST_FAILED' });
    assert.deepEqual(f.calls, ['create', 'read']); assert.equal(f.writes(), 0);
    assert.deepEqual(f.stored(), options.stored);
  });
});

for (const [name, change] of Object.entries({ plan: { plan: 'foreign' }, registry: { registry: 'foreign' },
  backup: { backup: 'foreign' }, result: { epoch: 5 }, replay: { replayed: 'true' }, extra: { extra: true },
})) test(`maintenance receipt rejects conflicting ${name} evidence after normalized conditional failure`, async t => {
  const stored = { ...expected, ...change };
  await fixture(t, { stored }, async f => {
    await assert.rejects(recordMaintenanceReceipt(expected, f.io), { code: 'BACKUP_RECEIPT_CONFLICT' });
    assert.deepEqual(f.calls, ['create', 'read']); assert.equal(f.writes(), 0);
    assert.deepEqual(f.stored(), stored);
  });
});
