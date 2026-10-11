import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../dist/runtime.js';
import { runtimeReadiness } from '../dist/runtime-startup.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { runtimeEnv, startupEvent, event, context, payload } from './runtime-helpers.mjs';

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

test('SR1 startup maps only known connection failures to STARTING and suppresses diagnostics', async () => {
  for (const [code, expected] of [['ETIMEDOUT', 'WORKSPACE_STARTING'], ['57P03', 'WORKSPACE_STARTING'], ['42P01', 'WORKSPACE_MAINTENANCE'], ['WORKSPACE_MAINTENANCE', 'WORKSPACE_MAINTENANCE'], ['CERT_HAS_EXPIRED', 'WORKSPACE_UNAVAILABLE'], ['28P01', 'WORKSPACE_UNAVAILABLE'], ['', 'WORKSPACE_UNAVAILABLE']]) {
    let closed = false;
    const runtime = createRuntime(runtimeEnv, { databases(scope) {
      scope.own({ close: async () => { closed = true; }, force() {} });
      return { prepare: async () => { throw Object.assign(Error('private diagnostic with secrets'), { code }); } };
    } });
    const response = await runtime.lambda(startupEvent(), context);
    assert.equal(payload(response).errorCode, expected); assert.equal(closed, true); assert.doesNotMatch(response.body, /private|secrets/);
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
});

test('SR2d startup requires all durable schema markers and never enables a partial migration', async () => {
  const checksums = await Promise.all(['coordination', 'manifest', 'dispatch', 'object', 'operation'].map(async name => {
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
