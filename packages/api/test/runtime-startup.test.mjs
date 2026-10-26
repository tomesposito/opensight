import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../dist/runtime.js';
import { runtimeReadiness } from '../dist/runtime-startup.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { runtimeEnv, startupEvent, event, context, payload } from './runtime-helpers.mjs';

for (const remainingMs of [28000, 60000, 12000]) test(`SR1 cold startup with 14s ingress/init lag and ${remainingMs}ms Lambda time stays bounded and read-only`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 });
  const request = startupEvent();
  t.mock.timers.tick(14000);
  const invokedAt = Date.now(), connectTime = 9000, ready = remainingMs >= 28000;
  let active = 0, attempts = 0, closed = 0, applications = 0, deadline, connectBudget;
  const statements = [];
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const runtime = createRuntime(runtimeEnv, { databases(scope, _env, connectMs) {
    deadline = scope.deadline; connectBudget = connectMs;
    scope.own({ close: async () => { closed++; assert.equal(active, 0); }, force() {} });
    const db = { transaction: async work => work({ query: async sql => {
      statements.push(sql);
      if (sql.includes('FROM sr_control')) return [{ state: 'open', schema_min: 1, schema_max: 1, protocol_min: 1, protocol_max: 1 }];
      return [];
    } }) };
    return { membership: db, tenant: db, prepare: () => {
      attempts++; active++;
      let timer, rejectConnect;
      return scope.stage(() => new Promise((resolve, reject) => {
        rejectConnect = reject;
        timer = setTimeout(() => { active = 0; resolve(); }, connectTime);
        entered();
      }), connectMs, () => { clearTimeout(timer); active = 0; rejectConnect(Error('private cancelled socket')); }, 'SQL_CONNECT_TIMEOUT');
    } };
  }, application: () => { applications++; assert.fail('startup built API application'); } });
  const run = runtime.lambda(request, { getRemainingTimeInMillis: () => remainingMs - (Date.now() - invokedAt) });
  await started;
  t.mock.timers.tick(ready ? connectTime : remainingMs - 6000);
  const result = await run;
  assert.equal(result.statusCode, ready ? 200 : 503);
  assert.deepEqual(payload(result), ready ? { state: 'ready' } : { errorCode: 'WORKSPACE_STARTING' });
  assert.equal(result.headers['retry-after'], ready ? undefined : '5');
  assert.equal(deadline, invokedAt + Math.min(25000, remainingMs - 3000));
  assert.equal(connectBudget, 18000);
  assert.equal(attempts, 1); assert.equal(active, 0); assert.equal(closed, 1); assert.equal(applications, 0);
  assert.equal(Date.now() - invokedAt, ready ? connectTime : remainingMs - 6000);
  assert.equal(statements.length > 0, ready);
  assert.ok(statements.every(sql => /^(SELECT|SET TRANSACTION READ ONLY)/.test(sql)));
  const statementCount = statements.length;
  t.mock.timers.tick(300000);
  assert.equal(attempts, 1); assert.equal(active, 0); assert.equal(closed, 1); assert.equal(applications, 0);
  assert.equal(statements.length, statementCount);
});

test('SR1 startup without an invocation work budget returns STARTING before constructing SQL', async () => {
  let opened = 0;
  const runtime = createRuntime(runtimeEnv, { databases() { opened++; assert.fail('expired startup touched SQL'); } });
  for (const remainingMs of [0, 4000]) {
    const result = await runtime.lambda(startupEvent(), { getRemainingTimeInMillis: () => remainingMs });
    assert.equal(result.statusCode, 503); assert.deepEqual(payload(result), { errorCode: 'WORKSPACE_STARTING' });
    assert.equal(result.headers['retry-after'], '5'); assert.equal(opened, 0);
  }
});

test('SR1 startup cleanup failure and quarantine take precedence over retryable deadline exhaustion', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./support/runtime-startup-cleanup-worker.mjs', import.meta.url))], { timeout: 5000 });
  assert.match(stdout, /startup cleanup quarantined/);
});

test('SR1 startup connects once, permits 15s resume, bounds 35s/never resume and has no idle keep-alive', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 });
  for (const connectTime of [15000, 35000, Infinity]) {
    let active = 0, attempts = 0, closed = 0, work = 0;
    let connected;
    const started = new Promise(resolve => { connected = resolve; });
    const runtime = createRuntime(runtimeEnv, { databases(scope, _env, connectMs) {
      scope.own({ close: async () => { closed++; assert.equal(active, 0); }, force() {} });
      return { prepare: () => {
        attempts++; active++;
        let timer, rejectConnect;
        return scope.stage(() => new Promise((resolve, reject) => {
          rejectConnect = reject;
          if (Number.isFinite(connectTime)) timer = setTimeout(() => { active--; resolve(); }, connectTime);
          connected();
        }), connectMs, () => { clearTimeout(timer); active--; rejectConnect(Error('cancelled socket')); }, 'SQL_CONNECT_TIMEOUT');
      } };
    }, readiness: async () => { work++; }, application: () => assert.fail('startup built API application') });
    const run = runtime.lambda(startupEvent(), context); await started;
    t.mock.timers.tick(connectTime === 15000 ? 15000 : 18000);
    const result = await run;
    assert.equal(attempts, 1); assert.equal(active, 0); assert.equal(closed, 1);
    if (connectTime === 15000) { assert.equal(result.statusCode, 200); assert.deepEqual(payload(result), { state: 'ready' }); assert.equal(work, 1); }
    else { assert.equal(result.statusCode, 503); assert.equal(payload(result).errorCode, 'WORKSPACE_STARTING'); assert.equal(result.headers['retry-after'], '5'); assert.equal(work, 0); }
    t.mock.timers.tick(300000); assert.equal(attempts, 1); assert.equal(work, connectTime === 15000 ? 1 : 0);
  }
});

test('SR1 startup maps only deadline exhaustion and known connection failures to STARTING and suppresses diagnostics', async () => {
  const cases = [
    ...['INVOCATION_DEADLINE_EXCEEDED', 'SQL_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', '57P03', '53300'].map(code => [code, 'WORKSPACE_STARTING']),
    ...['42P01', '42703', 'WORKSPACE_MAINTENANCE'].map(code => [code, 'WORKSPACE_MAINTENANCE']),
    ...['CERT_HAS_EXPIRED', '28P01', '42501', 'RUNTIME_CONFIG_INVALID', 'RUNTIME_DATABASE_CONFIG_INVALID', 'SQL_STATEMENT_TIMEOUT', 'WORKSPACE_UNAVAILABLE', 'UNKNOWN', ''].map(code => [code, 'WORKSPACE_UNAVAILABLE']),
  ];
  for (const [code, expected] of cases) {
    let closed = false;
    const runtime = createRuntime(runtimeEnv, { databases(scope) {
      scope.own({ close: async () => { closed = true; }, force() {} });
      return { prepare: async () => { throw Object.assign(Error('private diagnostic with secrets'), { code }); } };
    } });
    const response = await runtime.lambda(startupEvent(), context);
    assert.equal(response.statusCode, 503); assert.deepEqual(payload(response), { errorCode: expected });
    assert.equal(response.headers['retry-after'], expected === 'WORKSPACE_STARTING' ? '5' : undefined);
    assert.equal(closed, true); assert.doesNotMatch(response.body, /private|secrets/);
  }
});

test('SR1 expired requests never construct SQL; ordinary requests have only a 3s connect budget', async () => {
  let opened = 0, closed = 0;
  const runtime = createRuntime(runtimeEnv, { databases(scope, _env, connectMs) {
    opened++; assert.equal(connectMs, 3000); scope.own({ close: async () => { closed++; }, force() {} });
    return { prepare: async () => { throw Error('unavailable'); } };
  } });
  const expired = event(); expired.requestContext.timeEpoch -= 23000;
  assert.equal((await runtime.lambda(expired, context)).statusCode, 503); assert.equal(opened, 0);
  assert.equal((await runtime.lambda(event(), { getRemainingTimeInMillis: () => 4000 })).statusCode, 503); assert.equal(opened, 0);
  assert.equal((await runtime.lambda(event(), context)).statusCode, 503); assert.equal(opened, 1); assert.equal(closed, 1);
});

test('SR1 startup readiness is read-only and rejects maintenance, schema mismatch and disabled RLS', async () => {
  for (const failure of ['', 'maintenance', 'schema', 'rls']) {
    const statements = [];
    const db = { transaction: async work => work({ query: async sql => {
      statements.push(sql);
      if (sql.includes('FROM sr_control')) return [{ state: failure === 'maintenance' ? 'maintenance' : 'open', schema_min: failure === 'schema' ? 2 : 1, schema_max: 1, protocol_min: 1, protocol_max: 1 }];
      if (sql.includes('FROM pg_class') && failure === 'rls') return [{ relname: 'h1_resources' }];
      return [];
    } }) };
    const run = new InvocationScope(Date.now() + 10000).run(scope => runtimeReadiness({ membership: db, tenant: db }, scope, runtimeEnv()));
    if (failure) await assert.rejects(run, { code: failure === 'rls' ? 'WORKSPACE_UNAVAILABLE' : 'WORKSPACE_MAINTENANCE' }); else await run;
    assert.ok(statements.every(sql => /^(SELECT|SET TRANSACTION READ ONLY)/.test(sql)));
    assert.ok(!statements.some(sql => /FROM h1_tenants|UPDATE|INSERT|CREATE/.test(sql)));
  }
});

test('SR1 readiness timeout cancels ongoing SQL and waits for disposal', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  let active = false, closed = false;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const runtime = createRuntime(runtimeEnv, { databases(scope) {
    scope.own({ close: async () => { closed = true; assert.equal(active, false); }, force() {} });
    const db = { transaction: work => work({ query: () => {
      active = true;
      entered();
      return new Promise((_, reject) => scope.signal.addEventListener('abort', () => { active = false; reject(Error('cancelled')); }, { once: true }));
    } }) };
    return { membership: db, tenant: db };
  } });
  const run = runtime.lambda(startupEvent(), context); await started; t.mock.timers.tick(2000);
  const result = await run; assert.equal(result.statusCode, 503); assert.equal(closed, true); assert.equal(active, false);
  // Readiness cancels the entire scope, whose deadline error wins the race.
  assert.deepEqual(payload(result), { errorCode: 'WORKSPACE_STARTING' }); assert.equal(result.headers['retry-after'], '5');
});

test('SR3 startup requires all durable schema markers and never enables a partial migration', async () => {
  const checksums = await Promise.all(['coordination', 'manifest', 'dispatch', 'object', 'operation', 'execution'].map(async name => {
    const module = await import(`../dist/${name}-schema.js`); return [`sr_${name}_schema`, module[`${name}Checksum`]];
  }));
  for (const broken of [undefined, ...checksums.map(([table]) => table)]) {
    const seen = [];
    const db = { transaction: async work => work({ query: async sql => {
      seen.push(sql);
      if (sql.includes('FROM sr_control')) return [{ state: 'open', schema_min: 1, schema_max: 1, protocol_min: 1, protocol_max: 1 }];
      const match = checksums.find(([table]) => sql.includes(`FROM ${table} `));
      return match ? [{ version: 1, checksum: match[0] === broken ? 'obsolete' : match[1] }] : [];
    } }) };
    const result = new InvocationScope(Date.now() + 10000).run(scope => runtimeReadiness({ membership: db, tenant: db }, scope, { ...runtimeEnv(), OPENSIGHT_SERVERLESS_DATA: 'durable' }));
    if (broken) await assert.rejects(result, { code: 'WORKSPACE_MAINTENANCE' }); else { await result; assert.ok(checksums.every(([table]) => seen.some(sql => sql.includes(`FROM ${table} `)))); }
    assert.ok(seen.every(sql => /^(SELECT|SET TRANSACTION READ ONLY)/.test(sql)));
  }
});
