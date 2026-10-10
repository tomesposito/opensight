import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:net';
import { access, writeFile } from 'node:fs/promises';
import { InvocationScope, invocationDeadline } from '../dist/runtime-scope.js';
import { InvocationPool, invocationDatabases } from '../dist/runtime-postgres.js';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';

const scope = () => new InvocationScope(Date.now() + 10000);
function fakePool(fault) {
  const log = [], pool = new EventEmitter(); let open = 0, ended = 0;
  pool.connect = async () => {
    if (fault === 'connect') throw Error('private connect diagnostic');
    open++; let released = false;
    return {
      async query(sql) {
        log.push(sql);
        if (sql === fault || fault === 'RESET-final' && sql === 'RESET ALL' && log.length > 1) throw Error('private SQL diagnostic');
        return { rows: sql.includes('pg_roles') && fault === 'unsafe' ? [{ unsafe: 1 }] : [] };
      },
      release(error) { assert.equal(released, false); assert.ok(error, 'transactions must discard instead of retaining idle clients'); released = true; open--; },
    };
  };
  pool.end = async () => { ended++; assert.equal(open, 0); };
  return { pool, log, stats: () => ({ open, ended }) };
}

test('SR1 invocation transactions close clients and pools on success and every SQL fault', async () => {
  for (const fault of [undefined, 'connect', 'RESET ALL', 'BEGIN', 'SELECT business', 'COMMIT', 'ROLLBACK', 'RESET-final', 'unsafe']) {
    const f = fakePool(fault), invocation = scope();
    const run = invocation.run(async s => {
      const db = new PostgresMetadataDatabase(new InvocationPool(s, {}, 3000, () => f.pool), true);
      await db.transaction(async c => { await c.query('SELECT business'); if (fault === 'ROLLBACK') throw Error('business failure'); }, { tenantId: 'a', namespaceId: 'b' });
      assert.equal(f.stats().open, 0, 'no connection retained between transactions');
    });
    if (fault && fault !== 'RESET-final') await assert.rejects(run); else await run;
    assert.deepEqual(f.stats(), { open: 0, ended: 1 });
    await invocation.close(); assert.equal(f.stats().ended, 1);
    if (!fault) {
      assert.equal(f.log[0], 'RESET ALL'); assert.ok(f.log.includes('BEGIN')); assert.ok(f.log.includes('COMMIT'));
      assert.ok(f.log.some(sql => sql.includes("set_config('opensight.tenant_id'"))); assert.equal(f.log.at(-1), 'RESET ALL');
    }
  }
});

test('SR1 SQL ownership is separate for each invocation and each role; restricted scope remains mandatory', async () => {
  const pools = [], options = [];
  const env = { OPENSIGHT_POSTGRES_OPERATOR_URL: 'postgres://control:synthetic@localhost/db', OPENSIGHT_POSTGRES_TENANT_URL: 'postgres://tenant:synthetic@localhost/db', OPENSIGHT_POSTGRES_CA: 'synthetic trust bundle' };
  await Promise.all([1, 2].map(() => scope().run(async s => {
    const db = invocationDatabases(s, env, 3000, config => { options.push(config); const f = fakePool(); pools.push(f); return f.pool; });
    await db.membership.transaction(c => c.query('SELECT 1'));
    await assert.rejects(db.tenant.transaction(c => c.query('SELECT 1')), { code: 'TENANT_CONTEXT_REQUIRED' });
    await db.tenant.transaction(c => c.query('SELECT 1'), { tenantId: 'a', namespaceId: 'b' });
  })));
  assert.equal(pools.length, 4); for (const f of pools) assert.deepEqual(f.stats(), { open: 0, ended: 1 });
  for (const c of options) {
    assert.equal(c.max, 1); assert.equal(c.keepAlive, false); assert.equal(c.ssl.rejectUnauthorized, true);
    assert.equal(c.statement_timeout, 2000); assert.equal(c.lock_timeout, 500); assert.equal(c.idle_in_transaction_session_timeout, 3000); assert.match(c.options, /idle_session_timeout=5000/);
  }
  for (const changed of [{ OPENSIGHT_POSTGRES_CA: '' }, { OPENSIGHT_POSTGRES_TENANT_URL: env.OPENSIGHT_POSTGRES_OPERATOR_URL }, { OPENSIGHT_POSTGRES_OPERATOR_URL: `${env.OPENSIGHT_POSTGRES_OPERATOR_URL}?sslmode=disable` }]) {
    await assert.rejects(scope().run(async s => invocationDatabases(s, { ...env, ...changed }, 3000, () => assert.fail('invalid config constructed pool'))), { code: 'RUNTIME_DATABASE_CONFIG_INVALID' });
  }
});

test('SR1 aborted real pg connects destroy their TCP sockets before invocation completion', async t => {
  const accepted = new Set();
  const server = createServer(socket => { accepted.add(socket); socket.on('close', () => accepted.delete(socket)); socket.resume(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of accepted) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const invocation = scope();
  await assert.rejects(invocation.run(async s => {
    const pool = new InvocationPool(s, { host: '127.0.0.1', port: server.address().port, user: 'synthetic', database: 'synthetic' }, 30);
    await new PostgresMetadataDatabase(pool).transaction(c => c.query('SELECT 1'));
  }));
  // The remote FIN is processed on the next I/O turn, independently of the owned socket.
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(accepted.size, 0);
});

test('SR1 a connect resolving after cancellation is discarded and awaited before return', async () => {
  let releaseConnect, open = 0, ended = 0;
  const pool = new EventEmitter();
  pool.connect = () => new Promise(resolve => { releaseConnect = () => { open++; resolve({ query: async () => ({ rows: [] }), release: () => { open--; } }); }; });
  pool.end = async () => { ended++; };
  const invocation = scope();
  const run = invocation.run(async s => {
    const db = new PostgresMetadataDatabase(new InvocationPool(s, {}, 10, () => pool));
    await db.transaction(c => c.query('SELECT 1'));
  });
  const rejected = assert.rejects(run, { code: 'SQL_CONNECT_TIMEOUT' });
  await new Promise(resolve => setTimeout(resolve, 20));
  releaseConnect(); await rejected; assert.equal(open, 0); assert.equal(ended, 1);
});

test('SR1 deadline arithmetic consumes ingress/init overhead; cleanup removes private temporary bytes', async () => {
  const now = Date.now();
  assert.equal(invocationDeadline({ getRemainingTimeInMillis: () => 28000 }, now - 10000), now + 15000);
  await assert.rejects(new InvocationScope(now - 1).run(async () => assert.fail('expired work ran')), { code: 'INVOCATION_DEADLINE_EXCEEDED' });
  let directory;
  await scope().run(async s => { directory = await s.temporaryDirectory(); await writeFile(`${directory}/sensitive`, 'synthetic'); });
  await assert.rejects(access(directory), { code: 'ENOENT' });
});
