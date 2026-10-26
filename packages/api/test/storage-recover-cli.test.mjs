import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { dryRunTransport, recordingTransport, storageRecoverTransport } from '../dist/storage-recover-transport.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { MetadataError, PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { TenantMetadata } from '../dist/metadata.js';
import { ObjectCollector } from '../dist/object-collector.js';
import { ObjectRecovery } from '../dist/object-recovery.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { DurableUploads } from '../dist/durable-uploads.js';
import { migrateRuntime } from '../dist/runtime-migration.js';
import { migrateCoordination } from '../dist/coordination-schema.js';
import { migrateManifests } from '../dist/manifest-schema.js';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateObjects } from '../dist/object-schema.js';
import { migrateOperations } from '../dist/operation-schema.js';
import { uploadFixture, directRequest } from './serverless-upload-helpers.mjs';
import { environment } from './hosted-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { seedSources } from './source-helpers.mjs';

const account = '0'.repeat(12), region = 'us-east-1';
const dispatchEnv = () => ({
  OPENSIGHT_WORK_QUEUE_URL: `https://sqs.${region}.amazonaws.com/${account}/work`,
  OPENSIGHT_WORK_QUEUE_ARN: `arn:aws:sqs:${region}:${account}:work`,
  OPENSIGHT_RECOVERY_QUEUE_URL: `https://sqs.${region}.amazonaws.com/${account}/recovery`,
  OPENSIGHT_RECOVERY_QUEUE_ARN: `arn:aws:sqs:${region}:${account}:recovery`,
  OPENSIGHT_SCHEDULER_GROUP: 'synthetic',
  OPENSIGHT_SCHEDULER_ROLE_ARN: `arn:aws:iam::${account}:role/scheduler`,
  OPENSIGHT_SCHEDULER_DLQ_ARN: `arn:aws:sqs:${region}:${account}:scheduler-dlq`,
});
const envelope = { version: 1, deploymentEpoch: 1, eventId: 'synthetic-event', kind: 'execute' };
const event = { eventId: envelope.eventId, epoch: 1, aggregateId: 'synthetic-object', aggregateRevision: 3,
  kind: 'object-cleanup', dueAt: 10000, expiresAt: 100000 };
function awsFixture() {
  const sent = [], schedules = new Map();
  const aws = { region, call: work => work(new AbortController().signal), sqs: { send: async command => {
    sent.push(command);
    return { MessageId: 'synthetic-message', MD5OfMessageBody: createHash('md5').update(command.input.MessageBody).digest('hex') };
  } }, scheduler: { send: async command => {
    sent.push(command); const input = command.input;
    if (command.constructor.name === 'GetScheduleCommand') return schedules.get(input.Name);
    if (schedules.has(input.Name)) throw Object.assign(new Error(), { name: 'ConflictException' });
    schedules.set(input.Name, structuredClone(input)); return { ScheduleArn: 'synthetic-schedule' };
  } } };
  return { aws, sent, schedules };
}

for (const key of Object.keys(dispatchEnv())) {
  test(`#130 recovery transport rejects missing or empty ${key} before any I/O`, () => {
    for (const value of [undefined, '']) {
      const f = awsFixture(), log = [], env = { ...dispatchEnv(), [key]: value };
      assert.throws(() => storageRecoverTransport(f.aws, env, 'test', log), { code: 'DISPATCH_CONFIG_INVALID', status: 503 });
      assert.deepEqual(f.sent, []); assert.deepEqual(log, []);
    }
  });
}

test('#130 recovery transport delegates URL/ARN/region and deployment validation to AwsDispatch', () => {
  for (const env of [
    { ...dispatchEnv(), OPENSIGHT_WORK_QUEUE_ARN: dispatchEnv().OPENSIGHT_RECOVERY_QUEUE_ARN },
    { ...dispatchEnv(), OPENSIGHT_RECOVERY_QUEUE_URL: dispatchEnv().OPENSIGHT_RECOVERY_QUEUE_URL.replace(region, 'eu-west-1') },
  ]) assert.throws(() => storageRecoverTransport(awsFixture().aws, env, 'test', []), { code: 'DISPATCH_CONFIG_INVALID' });
  assert.throws(() => storageRecoverTransport(awsFixture().aws, dispatchEnv(), 'invalid deployment', []), { code: 'DISPATCH_CONFIG_INVALID' });
});

for (const method of ['recover', 'dispatch']) {
  test(`#130 recording ${method} waits for the external receipt and propagates rejection without an acknowledgement`, async () => {
    const log = [], received = [], gate = Promise.withResolvers();
    const input = method === 'recover' ? { ...envelope, kind: 'recover' } : envelope;
    const args = method === 'recover' ? [input] : [input, event];
    const entry = method === 'recover' ? { type: method, envelope: input } : { type: method, envelope: input, event };
    const base = { [method]: async (...actual) => { received.push(actual); await gate.promise; assert.deepEqual(log, []); } };
    const pending = recordingTransport(base, log)[method](...args);
    assert.deepEqual(received, [args]); assert.deepEqual(log, []);
    gate.resolve(); await pending;
    assert.deepEqual(log, [entry]);
    const error = new MetadataError('SEND_TIMEOUT', 503), failedLog = [];
    const failing = recordingTransport({ [method]: async () => { throw error; } }, failedLog);
    await assert.rejects(failing[method](...args), actual => actual === error);
    assert.deepEqual(failedLog, []);
  });
}

test('#130 AWS recovery transport acknowledges recovery/work queues and refuses bad MD5 receipts', async () => {
  const f = awsFixture(), log = [], transport = storageRecoverTransport(f.aws, dispatchEnv(), 'test', log);
  const recover = { ...envelope, kind: 'recover' };
  await transport.recover(recover); await transport.dispatch(envelope, event);
  assert.deepEqual(f.sent.map(c => c.constructor.name), ['SendMessageCommand', 'SendMessageCommand']);
  assert.deepEqual(f.sent.map(c => [c.input.QueueUrl, c.input.DelaySeconds]), [
    [dispatchEnv().OPENSIGHT_RECOVERY_QUEUE_URL, 60], [dispatchEnv().OPENSIGHT_WORK_QUEUE_URL, 0],
  ]);
  assert.deepEqual(f.sent.map(c => JSON.parse(c.input.MessageBody)), [recover, envelope]);
  assert.deepEqual(log, [{ type: 'recover', envelope: recover }, { type: 'dispatch', envelope, event }]);
  f.aws.sqs.send = async () => ({ MessageId: 'synthetic-message', MD5OfMessageBody: 'wrong' });
  const before = structuredClone(log);
  await assert.rejects(transport.recover(recover), { code: 'DISPATCH_ACKNOWLEDGEMENT_REQUIRED' });
  await assert.rejects(transport.dispatch(envelope, event), { code: 'DISPATCH_ACKNOWLEDGEMENT_REQUIRED' });
  assert.deepEqual(log, before, 'rejected sends add no audit acknowledgements');
});

test('#130 scheduled recovery continuations use the CLI deployment and exact scheduler acknowledgement', async () => {
  const f = awsFixture(), log = [], deployment = 'reviewed-deployment';
  const future = { ...event, dueAt: Date.now() + 3600000, expiresAt: Date.now() + 7200000 };
  const transport = storageRecoverTransport(f.aws, { ...dispatchEnv(), OPENSIGHT_DEPLOYMENT: 'different-env-deployment' }, deployment, log);
  await transport.dispatch(envelope, future); await transport.dispatch(envelope, future);
  const token = createHash('sha256').update(JSON.stringify([deployment, event.epoch, event.eventId, event.aggregateRevision, future.dueAt])).digest('hex');
  assert.deepEqual(f.sent.map(c => c.constructor.name), ['CreateScheduleCommand', 'CreateScheduleCommand', 'GetScheduleCommand']);
  const desired = f.sent[0].input;
  assert.equal(desired.Name, `os-${token.slice(0, 48)}`); assert.equal(desired.ClientToken, token);
  assert.equal(desired.GroupName, dispatchEnv().OPENSIGHT_SCHEDULER_GROUP);
  assert.equal(desired.Target.Arn, dispatchEnv().OPENSIGHT_WORK_QUEUE_ARN);
  assert.deepEqual(JSON.parse(desired.Target.Input), { ...envelope, kind: 'due' });
  assert.deepEqual(log, Array.from({ length: 2 }, () => ({ type: 'dispatch', envelope, event: future })));
  f.schedules.get(desired.Name).Target.Input = '{}';
  await assert.rejects(transport.dispatch(envelope, future), { code: 'DISPATCH_SCHEDULE_CONFLICT' });
  f.aws.scheduler.send = async () => ({});
  await assert.rejects(transport.dispatch(envelope, future), { code: 'DISPATCH_ACKNOWLEDGEMENT_REQUIRED' });
  assert.equal(log.length, 2);
});

test('#130 dry-run transport rejects both acknowledgement paths', async () => {
  const transport = dryRunTransport();
  await assert.rejects(transport.recover({ ...envelope, kind: 'recover' }), { code: 'STORAGE_RECOVER_DRY_RUN', status: 503 });
  await assert.rejects(transport.dispatch(envelope, event), { code: 'STORAGE_RECOVER_DRY_RUN', status: 503 });
});

async function postgresFixture(t) {
  const schema = `recover_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000,
    options: `-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=1000` });
  t.after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await pool.end(); } });
  await pool.query(`CREATE SCHEMA ${schema}`);
  const db = new PostgresMetadataDatabase(pool);
  await migrateRuntime(db, { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined });
  await seedSources(db);
  await db.transaction(async c => {
    await c.query("INSERT INTO h2_identities (subject,email,status) VALUES ('one','one@example.test','active')");
    await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES ('one','tenant-one','one','admin','active')");
  });
  const entitlements = { defaults: { apiCalls: 1000, computeAttempts: 20, storageBytes: 128 * 1024 * 1024 }, tenants: {} };
  await migrateCoordination(db, 'test', entitlements, 'frozen');
  for (const migrate of [migrateManifests, migrateDispatch, migrateObjects, migrateOperations]) await migrate(db, 'test', 'frozen');
  const metadata = new TenantMetadata(db, db), context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  const dispatch = new DurableDispatch(db, metadata, 'test', { recover: async () => {}, dispatch: async () => {} });
  const uploads = new DurableUploads(metadata, dispatch, new ObjectLedger(metadata, 'test'), {
    capability: async entry => ({ url: `https://synthetic.example/${entry.id}`, method: 'PUT', headers: {}, expiresAt: new Date(Date.now() + 3600000).toISOString() }),
  });
  await db.transaction(c => c.query("UPDATE sr_control SET state = 'open' WHERE deployment = 'test'"));
  return { db, metadata, contexts: [context], dispatch, uploads, rows: table => db.transaction(c => c.query(`SELECT * FROM ${table}`)) };
}

async function recoveryFixture(t, dialect = 'sqlite', dispatchedOriginal = false) {
  const f = dialect === 'sqlite' ? await uploadFixture(t) : await postgresFixture(t), ctx = f.contexts[0];
  await f.uploads.reserve(ctx, directRequest(), randomUUID(), async () => {});
  const raw = (await f.rows('sr_object')).find(r => r.purpose === 'raw-upload');
  const expired = (await f.rows('sr_outbox')).find(r => r.aggregate_id === raw.object_id), now = Date.now();
  await f.db.transaction(async c => {
    await c.query('UPDATE sr_object SET created_at = ?, retention_until = ?, signature_until = ? WHERE object_id = ?',
      [now - 90000000, now - 1000, now - 90000000, raw.object_id]);
    await c.query("UPDATE sr_outbox SET due_at = ?, expires_at = ?, state = 'terminal' WHERE event_id = ?",
      [now - 7200000, now - 3600000, expired.event_id]);
  });
  const scope = { tenantId: ctx.tenantId, namespaceId: ctx.namespaceId, userId: ctx.userId };
  // Also exercise a fresh obligation already sent by another recovery owner:
  // interrupt after prearm, then obtain a real fixture-transport acknowledgement.
  if (dispatchedOriginal) {
    const interrupted = new ObjectRecovery(f.db, f.dispatch, { run: async () => { throw new MetadataError('SETUP_INTERRUPTED', 503); } });
    assert.equal((await interrupted.recover(scope, [raw.object_id])).objects[0].decision, 'failed');
    await f.dispatch.flush(raw.intent_id, Number(expired.control_epoch));
  }
  const calls = [], objects = { latest: async key => { calls.push(['head', key]); return undefined; }, remove: async (...args) => { calls.push(['delete', ...args]); } };
  return { ...f, ctx, scope, raw, expired, dialect, calls, objects,
    obligations: async () => (await f.rows('sr_outbox')).filter(r => r.aggregate_id === raw.object_id).sort((a, b) => Number(a.aggregate_revision) - Number(b.aggregate_revision)),
    gauge: async () => Number((await f.rows('sr_storage_usage')).find(r => r.namespace_id === ctx.namespaceId).reserved_bytes),
    object: async () => (await f.rows('sr_object')).find(r => r.object_id === raw.object_id),
  };
}

async function blockingOperation(f) {
  const upload = (await f.rows('sr_upload')).find(r => r.raw_object_id === f.raw.object_id), operationId = randomUUID();
  await f.db.transaction(async c => {
    await c.query(`INSERT INTO sr_operation (deployment, tenant_id, namespace_id, owner_id, operation_id, revision, kind, state,
      control_epoch, authorization_revision, policy_revision, configuration_revision, upload_id, expires_at, fence, attempt_id, error_code, result)
      VALUES (?,?,?,?,?,1,'ingest','queued',?,?,?,?,?,?,0,NULL,NULL,NULL)`,
      ['test', f.ctx.tenantId, f.ctx.namespaceId, f.ctx.userId, operationId, Number(f.expired.control_epoch), 1, 1, 1, upload.upload_id, Date.now() + 3600000]);
    await c.query("UPDATE sr_upload SET state = 'accepted', operation_id = ? WHERE upload_id = ?", [operationId, upload.upload_id]);
  });
}

function recoveryWith(f, external, log, race = false) {
  const dispatch = new DurableDispatch(f.db, f.metadata, 'test', recordingTransport(external, log), f.dialect);
  const collector = new ObjectCollector(f.db, dispatch, f.objects, f.dialect);
  const recovery = new ObjectRecovery(f.db, dispatch, race ? { run: async input => { await blockingOperation(f); await collector.run(input); } } : collector);
  return { recovery, collector, dispatch };
}

async function assertRace(t, dialect, dispatchedOriginal) {
  const f = await recoveryFixture(t, dialect, dispatchedOriginal), before = await f.gauge(), objectBefore = await f.object();
  const log = [], received = [], external = {
    recover: async () => assert.fail('recovery does not prepare a new business intent'),
    dispatch: async (envelope, event) => { received.push({ type: 'dispatch', envelope, event }); },
  };
  const { recovery } = recoveryWith(f, external, log, true);
  const report = await recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(report.objects[0].decision, 'protected-continued');
  const rows = await f.obligations(), original = rows[1], continuation = rows[2];
  assert.equal(rows.length, 3); assert.equal(original.state, 'terminal'); assert.equal(rows[0].state, 'terminal');
  assert.equal(continuation.state, 'dispatched'); assert.equal(Number(continuation.aggregate_revision), 3);
  const receipt = { type: 'dispatch', envelope: { version: 1, deploymentEpoch: Number(continuation.control_epoch), eventId: continuation.event_id, kind: 'execute' },
    event: { eventId: continuation.event_id, epoch: Number(continuation.control_epoch), aggregateId: f.raw.object_id, aggregateRevision: 3,
      kind: 'object-cleanup', dueAt: Number(continuation.due_at), expiresAt: Number(continuation.expires_at) } };
  assert.deepEqual(received.filter(r => r.event.aggregateRevision === 3), [receipt]);
  assert.deepEqual(log, received, 'audit contains exactly the external acknowledgements');
  if (dispatchedOriginal) assert.deepEqual(log, [receipt]);
  else assert.deepEqual(log.map(r => r.event.aggregateRevision), [2, 3], 'flush also delivers the still-pending fresh original');
  assert.deepEqual(await f.object(), objectBefore); assert.equal(await f.gauge(), before); assert.deepEqual(f.calls, []);
}

test('#130 SQLite race delivers and audits the continuation before terminalizing the original', t => assertRace(t, 'sqlite', true));
test('#130 SQLite fresh prearm race audits both pending deliveries without replaying the expired event', t => assertRace(t, 'sqlite', false));
test('#130 live Postgres race delivers the continuation before acknowledging cleanup',
  { skip: !process.env.DATABASE_URL && 'DATABASE_URL is not set' }, t => assertRace(t, 'postgres', false));

for (const dispatchedOriginal of [true, false]) {
test(`#130 rejected continuation resumes exactly once (${dispatchedOriginal ? 'already dispatched' : 'fresh pending'} original)`, async t => {
  const f = await recoveryFixture(t, 'sqlite', dispatchedOriginal), before = await f.gauge(), objectBefore = await f.object();
  const log = [], attempted = [], error = new MetadataError('SEND_TIMEOUT', 503);
  const failed = recoveryWith(f, { recover: async () => assert.fail(), dispatch: async (envelope, event) => {
    attempted.push({ envelope, event }); if (event.aggregateRevision === 3) throw error;
  } }, log, true);
  const report = await failed.recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(report.objects[0].decision, 'failed'); assert.equal(report.objects[0].error, error.code);
  const rows = await f.obligations(), original = rows[1], continuation = rows[2];
  assert.equal(rows.length, 3); assert.notEqual(original.state, 'terminal'); assert.equal(continuation.state, 'pending');
  const rejected = attempted.filter(r => r.event.aggregateRevision === 3);
  assert.equal(rejected.length, 1); assert.equal(rejected[0].envelope.eventId, continuation.event_id);
  if (dispatchedOriginal) assert.deepEqual(log, []);
  else assert.deepEqual(log.map(r => r.envelope.eventId), [original.event_id], 'only the acknowledged original appears in the log');
  const beforeLog = [...log];
  assert.equal(await f.gauge(), before); assert.deepEqual(await f.object(), objectBefore); assert.deepEqual(f.calls, []);
  const received = [], resumed = recoveryWith(f, { recover: async () => assert.fail(), dispatch: async (envelope, event) => { received.push({ type: 'dispatch', envelope, event }); } }, log);
  const again = await resumed.recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(again.objects[0].decision, 'protected-continued', JSON.stringify(again.objects[0]));
  assert.equal(again.objects[0].newEventId, original.event_id);
  assert.deepEqual(received.map(r => r.envelope.eventId), [continuation.event_id]); assert.deepEqual(log, [...beforeLog, ...received]);
  assert.equal((await f.obligations()).length, 3, 'retry must not grow a second continuation');
  assert.equal((await f.obligations())[1].state, 'terminal'); assert.equal((await f.obligations())[2].state, 'dispatched');
  assert.equal(await f.gauge(), before); assert.deepEqual(f.calls, []);
  // Model the eligibility window arriving without waiting an hour in the test.
  await f.db.transaction(async c => {
    await c.query("UPDATE sr_operation SET state = 'cancelled' WHERE upload_id = (SELECT upload_id FROM sr_upload WHERE raw_object_id = ?)", [f.raw.object_id]);
    await c.query('UPDATE sr_outbox SET due_at = ? WHERE event_id = ?', [Date.now() - 1000, continuation.event_id]);
  });
  assert.equal((await resumed.recovery.recover(f.scope, [f.raw.object_id])).objects[0].decision, 'recovered');
  assert.equal((await resumed.recovery.recover(f.scope, [f.raw.object_id])).objects[0].decision, 'already-complete');
  assert.equal(await f.gauge(), before - Number(f.raw.capacity_bytes));
  assert.equal((await f.object()).state, 'deleted'); assert.ok((await f.obligations()).every(r => r.state === 'terminal'));
  assert.equal((await f.obligations()).length, 3); assert.deepEqual(f.calls, [['head', f.raw.object_key]]);
  assert.equal(log.length, beforeLog.length + 1, 'no duplicate acknowledgement on settlement');
});
}

const cli = fileURLToPath(new URL('../dist/storage-recover-cli.js', import.meta.url));
const runCli = (args, env) => promisify(execFile)(process.execPath, [cli, ...args], { env: { TZ: 'UTC', NODE_NO_WARNINGS: '1', ...env }, timeout: 15000 });
const cliArgs = (scope, objects, audit) => ['--tenant', scope.tenantId, '--namespace', scope.namespaceId, '--owner', scope.userId,
  '--objects', objects.join(','), '--audit-path', audit, '--deployment', 'test'];

test('#130 CLI rejects dispatch config before opening SQLite and creates no audit acknowledgement', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-recover-config-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'unopened.sqlite'), audit = join(dir, 'audit.json');
  const env = { AWS_REGION: region, AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic',
    OPENSIGHT_ARTIFACT_BUCKET: 'synthetic-artifacts', OPENSIGHT_METADATA_DATABASE: path };
  for (const dispatch of [{}, { ...dispatchEnv(), OPENSIGHT_WORK_QUEUE_ARN: dispatchEnv().OPENSIGHT_RECOVERY_QUEUE_ARN }]) {
    await assert.rejects(runCli(cliArgs({ tenantId: 'tenant-one', namespaceId: 'one', userId: 'admin' }, [randomUUID()], audit), { ...env, ...dispatch }),
      error => error.code === 1 && error.stderr.trim() === 'DISPATCH_CONFIG_INVALID');
    await assert.rejects(stat(path), { code: 'ENOENT' }); await assert.rejects(stat(audit), { code: 'ENOENT' });
  }
});

test('#130 CLI dry run requires no AWS/dispatch configuration, changes nothing and writes a private audit', async t => {
  const f = await recoveryFixture(t), audit = `${f.path}.audit.json`, before = await f.obligations(), object = await f.object(), gauge = await f.gauge();
  const result = await runCli([...cliArgs(f.scope, [f.raw.object_id], audit), '--dry-run'], { OPENSIGHT_METADATA_DATABASE: f.path });
  const report = JSON.parse(result.stdout), saved = JSON.parse(await readFile(audit, 'utf8'));
  assert.equal(report.dryRun, true); assert.equal(report.objects[0].decision, 'replace'); assert.equal(report.deployment, 'test');
  assert.deepEqual(saved.report, report); assert.deepEqual(saved.transport, []); assert.equal((await stat(audit)).mode & 0o777, 0o600);
  assert.deepEqual(await f.obligations(), before); assert.deepEqual(await f.object(), object); assert.equal(await f.gauge(), gauge);
});

test('#130 CLI preserves required verified Postgres TLS and incomplete-recovery exit status', async t => {
  const f = await recoveryFixture(t), audit = `${f.path}.audit.json`, args = cliArgs(f.scope, [randomUUID()], audit);
  await assert.rejects(runCli([...args, '--dry-run'], { OPENSIGHT_METADATA_POSTGRES: 'postgresql://synthetic.invalid/synthetic' }),
    error => error.code === 1 && error.stderr.trim() === 'STORAGE_RECOVER_TLS_REQUIRED');
  await assert.rejects(runCli(args, { ...dispatchEnv(), AWS_REGION: region, AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic',
    AWS_SESSION_TOKEN: 'synthetic', OPENSIGHT_ARTIFACT_BUCKET: 'synthetic-artifacts', OPENSIGHT_METADATA_DATABASE: f.path }),
  error => error.code === 1 && error.stderr.trim() === 'STORAGE_RECOVER_INCOMPLETE' && JSON.parse(error.stdout).objects[0].decision === 'unknown-object');
  assert.deepEqual(JSON.parse(await readFile(audit, 'utf8')).transport, []);
});
