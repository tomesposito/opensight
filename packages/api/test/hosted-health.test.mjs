import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { drainHostedServer } from '../dist/hosted-server.js';

test('H8 health is operator only; readiness names database, migration and tenant-store failures', async t => {
  const f = await h8Fixture(t); let dbDown = false, tenantDown = false;
  const member = { durable: true, close: async () => {}, transaction: (...a) => { if (dbDown) throw Error('private connection diagnostic'); return f.db.transaction(...a); } };
  const tenant = { durable: true, close: async () => {}, transaction: (...a) => { if (tenantDown) throw Error('private'); return f.db.transaction(...a); } };
  const { request, operator } = await serveH8(t, f, { membershipDatabase: member, tenantDatabase: tenant });
  for (const path of ['/healthz', '/readyz', '/api/host/drain']) for (const headers of [{}, { authorization: 'one' }, { authorization: 'Embed forged' }, { ...operator, origin: f.env.OPENSIGHT_PUBLIC_ORIGIN }]) {
    assert.equal((await request(path, { headers })).body.errorCode, 'OPERATOR_REQUIRED');
  }
  assert.equal((await request('/healthz', { headers: { ...operator, 'x-tenant': 'one' } })).body.errorCode, 'FORGED_PRINCIPAL');
  assert.equal((await request('/readyz', { headers: operator })).status, 200);
  tenantDown = true; assert.equal((await request('/readyz', { headers: operator })).body.errorCode, 'TENANT_STORE_UNAVAILABLE'); tenantDown = false;
  dbDown = true; assert.equal((await request('/healthz', { headers: operator })).status, 200);
  assert.equal((await request('/readyz', { headers: operator })).body.errorCode, 'DATABASE_UNAVAILABLE'); dbDown = false;
  await f.db.transaction(c => c.query("INSERT INTO h1_migrations VALUES ('pending','checksum','{}','committed',1)"));
  assert.equal((await request('/readyz', { headers: operator })).body.errorCode, 'MIGRATIONS_REQUIRED');
});

test('H8 graceful drain denies new work, finishes admitted requests and closes the listener', async t => {
  const f = await h8Fixture(t); let release, started;
  const entered = new Promise(r => { started = r; }), hold = new Promise(r => { release = r; });
  const { server, request, operator } = await serveH8(t, f, { security: { authenticate: async () => { started(); await hold; return { namespaceId: 'one', userId: 'admin' }; } } });
  const pending = request('/api/session'); await entered;
  assert.equal((await request('/api/host/drain', { method: 'POST', body: {}, headers: operator })).status, 202);
  assert.equal((await request('/api/session')).body.errorCode, 'SERVER_DRAINING');
  assert.equal((await request('/readyz', { headers: operator })).body.errorCode, 'SERVER_DRAINING');
  assert.equal((await request('/healthz', { headers: operator })).status, 200);
  release(); assert.equal((await pending).status, 200);
  await drainHostedServer(server); assert.equal(server.listening, false);
  await drainHostedServer(server);
});

test('H8 scheduler drain finishes its executing occurrence and leaves unstarted jobs queued', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.UTC(2026, 9, 3) });
  const { jobFixture, executor, refresh } = await import('./job-helpers.mjs');
  const e = executor(); let release, entered, executions = 0;
  const held = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  e.execute = async () => { executions++; entered(); await held; return {}; };
  const f = await jobFixture(t, e);
  const c = await f.login(); await f.put('first', refresh); await f.put('second', refresh);
  await f.store.enqueue(c, 'first'); await f.store.enqueue(c, 'second');
  const running = f.runner.tick(); await started; f.runner.stop(); release(); await running;
  assert.equal(executions, 1);
  const states = (await f.db.transaction(c => c.query('SELECT state FROM h7_occurrences'))).map(r => r.state).sort();
  assert.deepEqual(states, ['queued', 'succeeded']);
});
