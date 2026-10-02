import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedLifecycle } from '../dist/hosted-lifecycle.js';
import { createBuiltinHostedServer, drainHostedServer } from '../dist/hosted-server.js';
import { database, environment } from './hosted-helpers.mjs';
import { jobFixture, refresh } from './job-helpers.mjs';

test('H8 readiness follows authoritative access, bounded probes, role capability and drain admission', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let available = true, calls = 0;
  const lifecycle = new HostedLifecycle(async () => { calls++; if (!available) throw new Error('private connection string'); }, 1, 100);
  assert.equal(await lifecycle.ready(), false); lifecycle.start(); assert.equal(await lifecycle.ready(), true);
  available = false; assert.equal(await lifecycle.ready(), false);
  const release = lifecycle.admit(); assert.throws(() => lifecycle.admit(), { code: 'NODE_ADMISSION_REFUSED' });
  const draining = lifecycle.drain(50, async () => {}); assert.equal(await lifecycle.ready(), false);
  assert.throws(() => lifecycle.admit(), { code: 'NODE_DRAINING' }); release(); release(); assert.equal(await draining, true); assert.equal(lifecycle.active, 0);
  const hung = new HostedLifecycle(() => { calls++; return new Promise(() => {}); }, 1, 100); hung.start();
  const first = hung.ready(); t.mock.timers.tick(100); assert.equal(await first, false);
  const before = calls, second = hung.ready(); t.mock.timers.tick(100); assert.equal(await second, false); assert.equal(calls, before);
});
test('H8 drain bounds a stuck request and cleanup without reopening admission', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifecycle = new HostedLifecycle(async () => {}); lifecycle.start(); const release = lifecycle.admit();
  const result = lifecycle.drain(250, () => new Promise(() => {})); t.mock.timers.tick(250);
  assert.equal(await result, false); assert.equal(await lifecycle.ready(), false); release();
});
test('H8 HTTP liveness survives metadata outage, readiness and admission fail closed during drain', async t => {
  const f = await database(t), env = environment(); let healthy = true;
  const server = await createBuiltinHostedServer({ membershipDatabase: f.db, tenantDatabase: f.db, env, roleProbe: async () => { if (!healthy) throw new Error('private'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await drainHostedServer(server); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/health/ready`)).status, 200); healthy = false;
  assert.equal((await fetch(`${url}/health/ready`)).status, 503); assert.equal((await fetch(`${url}/health/live`)).status, 200);
  healthy = true; await drainHostedServer(server);
  assert.equal((await fetch(`${url}/health/ready`)).status, 503);
  assert.equal((await (await fetch(`${url}/api/session`)).json()).errorCode, 'NODE_DRAINING');
});
test('H8 stopping a scheduler fences in-flight publication and prevents further claims', async t => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await jobFixture(t, { begin() {}, async authorize() {}, async execute() { entered(); await new Promise(resolve => { finish = resolve; }); return {}; } });
  await f.put('refresh', refresh); await f.store.enqueue(await f.login(), 'refresh');
  const tick = f.runner.tick(); await started; f.runner.stop(); finish(); await tick;
  const rows = await f.db.transaction(c => c.query('SELECT state,error_code FROM h7_occurrences'));
  assert.equal(rows[0].state, 'failed'); assert.equal(rows[0].error_code, 'NODE_DRAINING');
  await assert.rejects(f.runner.claimDue(), { code: 'NODE_DRAINING' });
});
