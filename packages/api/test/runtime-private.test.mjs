import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateRuntime } from '../dist/runtime-private.js';
import { migrateRuntime } from '../dist/runtime-migration.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { runtimeEnv, context } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { environment } from './hosted-helpers.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = () => ({ ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined, OPENSIGHT_WORK_QUEUE_ARN: 'synthetic-work-queue' });
const command = e => ({ command: 'migrate', authorization: `Operator ${Buffer.from(e.OPENSIGHT_OPERATOR_KEY, 'base64').toString('base64url')}` });
const occurrence = () => ({ Records: [{ messageId: 'message-one', eventSource: 'aws:sqs', eventSourceARN: 'synthetic-work-queue', body: JSON.stringify({ version: 1, deploymentEpoch: 1, eventId: 'event-one', kind: 'due' }) }] });

test('SR1 private scheduler/migration entrypoints own resources, await work and never start polling', async () => {
  const e = env(); let opened = 0, closed = 0, jobs = 0, migrations = 0, fail = false;
  const runtime = createPrivateRuntime(() => e, {
    databases(scope) { opened++; scope.own({ close: async () => { closed++; }, force() {} }); return {}; },
    scheduled: async (event, _db, scope) => { scope.check(); jobs++; assert.equal(event.eventId, 'event-one'); if (fail) throw Error('private diagnostic'); },
    migrate: async (_db, scope) => { scope.check(); migrations++; if (fail) throw Error('private diagnostic'); },
  });
  assert.deepEqual(await runtime.scheduler(occurrence(), context), { batchItemFailures: [] });
  assert.deepEqual(await runtime.migration(command(e), context), { state: 'migrated', maintenance: true });
  assert.equal(jobs, 1); assert.equal(migrations, 1); assert.equal(opened, closed);
  fail = true;
  assert.deepEqual(await runtime.scheduler(occurrence(), context), { batchItemFailures: [{ itemIdentifier: 'message-one' }] });
  await assert.rejects(runtime.migration(command(e), context)); assert.equal(opened, closed);
});

test('SR1 private calls reject spoofed operators, queues, event bodies and unsafe default scheduler before SQL', async () => {
  const e = env(), runtime = createPrivateRuntime(() => e, { databases: () => assert.fail('invalid private call constructed SQL') });
  for (const raw of [{}, { ...command(e), authorization: 'Operator forged' }, { ...command(e), origin: 'https://opensight.example' }, { ...command(e), command: 'serve' }]) await assert.rejects(runtime.migration(raw, context));
  assert.deepEqual(await runtime.scheduler(occurrence(), context), { batchItemFailures: [{ itemIdentifier: 'message-one' }] });
  const wrong = occurrence(); wrong.Records[0].eventSourceARN = 'other'; await assert.rejects(runtime.scheduler(wrong, context));
  const body = occurrence(); body.Records[0].body = '{"version":1,"deploymentEpoch":1,"eventId":"one","kind":"due","password":"forbidden"}';
  assert.equal((await runtime.scheduler(body, context)).batchItemFailures.length, 1);
  e.OPENSIGHT_MAINTENANCE = 'open'; await assert.rejects(runtime.migration(command(e), context), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
});

test('SR1 bootstrap migration is transactional, audited, repeatable and leaves maintenance closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sr1-migration-')), db = new SqliteMetadataDatabase(join(dir, 'metadata.sqlite'));
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  const e = env();
  const runtime = createPrivateRuntime(() => e, { databases: scope => {
    scope.own({ close: async () => {}, force() {} }); return { membership: db, tenant: db };
  }, migrate: db => migrateRuntime(db.membership, e, 'sqlite') });
  await runtime.migration(command(e), context); await runtime.migration(command(e), context);
  assert.equal((await db.transaction(c => c.query('SELECT state FROM sr_control')))[0].state, 'maintenance');
  assert.equal((await db.transaction(c => c.query('SELECT * FROM h8_audit'))).length, 2);
  assert.deepEqual(await db.transaction(c => c.query('SELECT * FROM h2_keys')), [], 'migration must not activate keys');
  await db.transaction(c => c.query('UPDATE sr_control SET schema_max = 2'));
  await assert.rejects(runtime.migration(command(e), context), { code: 'MIGRATION_SCHEMA_INCOMPATIBLE' });
  assert.equal((await db.transaction(c => c.query('SELECT schema_max FROM sr_control')))[0].schema_max, 2);
  await db.transaction(c => c.query("UPDATE sr_control SET state = 'open'"));
  await assert.rejects(runtime.migration(command(e), context), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  assert.equal((await db.transaction(c => c.query('SELECT * FROM h8_audit'))).length, 2);
});

test('SR1 migration failure rolls back DDL; PostgreSQL refuses live H8 or an SR2 admission schema', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sr1-migration-fail-')), db = new SqliteMetadataDatabase(join(dir, 'metadata.sqlite'));
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  const broken = { durable: true, close: async () => {}, transaction: work => db.transaction(c => work({ query: (sql, values) => { if (sql.includes('CREATE TABLE IF NOT EXISTS h6_keys')) throw Error('fault'); return c.query(sql, values); } })) };
  await assert.rejects(migrateRuntime(broken, env(), 'sqlite'));
  assert.deepEqual(await db.transaction(c => c.query("SELECT name FROM sqlite_master WHERE type = 'table'")), []);
  for (const [acquired, admission, code] of [[false, null, 'MIGRATION_BUSY'], [true, 'sr_admission', 'SERVERLESS_MIGRATION_GATE_REQUIRED']]) {
    const statements = [], fake = { transaction: work => work({ query: async sql => { statements.push(sql); return sql.includes('pg_try') ? [{ acquired }] : [{ admission }]; } }) };
    await assert.rejects(migrateRuntime(fake, env()), { code }); assert.ok(statements.every(sql => sql.startsWith('SELECT')));
  }
});

test('SR2d background calls allow Aurora wake and enforce separate recovery/work queue kinds', async () => {
  const e = { ...env(), OPENSIGHT_RECOVERY_QUEUE_ARN: 'synthetic-recovery-queue' }; let opened = 0;
  const runtime = createPrivateRuntime(() => e, { databases(_scope, _env, connectMs) { opened++; assert.equal(connectMs, 20000); return {}; }, scheduled: async () => {} });
  const recovery = occurrence(); recovery.Records[0].eventSourceARN = e.OPENSIGHT_RECOVERY_QUEUE_ARN;
  recovery.Records[0].body = JSON.stringify({ version: 1, deploymentEpoch: 1, eventId: 'intent-one', kind: 'recover' });
  assert.deepEqual(await runtime.scheduler(recovery, context), { batchItemFailures: [] });
  const wrong = structuredClone(recovery); wrong.Records[0].eventSourceARN = e.OPENSIGHT_WORK_QUEUE_ARN;
  assert.equal((await runtime.scheduler(wrong, context)).batchItemFailures.length, 1);
  wrong.Records[0].body = occurrence().Records[0].body; wrong.Records[0].eventSourceARN = e.OPENSIGHT_RECOVERY_QUEUE_ARN;
  assert.equal((await runtime.scheduler(wrong, context)).batchItemFailures.length, 1); assert.equal(opened, 1);
});
