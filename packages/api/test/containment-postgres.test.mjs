import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { streamPostgresPlan } from '../../query-engine/dist/prep-stream.js';
import { sourceFixture, registration } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
const live = { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' };

test('H4 live PostgreSQL cancels the running backend and closes both connections without publishing partial rows', live, async t => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), application_name = `h4_${randomUUID()}`;
  t.after(() => pool.end());
  const controller = new AbortController(); let rows = 0;
  const work = streamPostgresPlan({ columns: [{ name: 'n', type: 'INTEGER' }], parameters: [], sql: 'SELECT 1 AS n FROM pg_sleep(30)' },
    { connectionString: process.env.DATABASE_URL, application_name }, { maxRows: 10, cellChars: 1000 },
    { start() {}, row() { rows++; }, oversized() { assert.fail(); } }, { signal: controller.signal });
  const rejected = assert.rejects(work, { code: 'EXECUTION_CANCELLED' });
  const deadline = performance.now() + 5000;
  for (;;) {
    const active = await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND state = 'active' AND query LIKE 'FETCH%'", [application_name]);
    if (active.rows.length) break;
    if (performance.now() > deadline) assert.fail('cursor never started');
    await delay(5);
  }
  const started = performance.now(); controller.abort(); await rejected;
  assert.equal(rows, 0);
  // Client.end observes the local socket close before PostgreSQL necessarily
  // removes its backend from pg_stat_activity. Require both connections to
  // disappear within the same cancellation deadline, including server cleanup.
  while ((await pool.query('SELECT pid FROM pg_stat_activity WHERE application_name = $1', [application_name])).rows.length) {
    assert.ok(performance.now() - started < 1500, 'cancelled PostgreSQL connections did not close');
    await delay(5);
  }
  const cancellationMs = performance.now() - started;
  assert.ok(cancellationMs < 1500);
  t.diagnostic(JSON.stringify({ postgresCancellationMs: cancellationMs, publishedRows: rows }));
});

test('H4 live SQL query, preview, output and Blaze refresh honour request cancellation at the common execution gate', live, async t => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), name = `h4_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE VIEW "${name}" AS SELECT 'east'::text AS region, 1::bigint AS amount, 'synthetic'::text AS private FROM pg_sleep(30)`);
  t.after(async () => { await pool.query(`DROP VIEW "${name}"`); await pool.end(); });
  const url = new URL(process.env.DATABASE_URL), endpoint = { id: 'reference', host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), tls: false };
  const f = await sourceFixture(t, { endpoints: [endpoint] }), a = await f.login(), data = new HostedData(f.sources, undefined, f.budgets);
  await f.sources.create(a, 'slow', { ...registration(), table: name, credentials: { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) || 'synthetic' } });
  const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
  for (const path of ['query', 'preview', 'output', 'refresh']) {
    const controller = new AbortController(); data.begin(a, controller.signal);
    const work = path === 'refresh' ? data.refresh(a, 'slow') : data.execute(a, 'slow', path, path === 'query' ? { query } : {});
    const rejected = assert.rejects(work, { code: 'EXECUTION_CANCELLED' });
    await delay(100); const start = performance.now(); controller.abort(); await rejected;
    assert.ok(performance.now() - start < 1500); assert.deepEqual(data.budgets.node(), { running: 0, queued: 0 });
  }
  data.begin(a, new AbortController().signal);
  await assert.rejects(data.execute(a, 'slow', 'output', { mode: 'BLAZE' }), { code: 'EXECUTION_CANCELLED' });
});

test('H4 HTTP disconnect cancels an admitted live source cursor before any response bytes', live, async t => {
  const { request } = await import('node:http');
  const { authFixture } = await import('./hosted-helpers.mjs');
  const { TenantMetadata } = await import('../dist/metadata.js');
  const { HostedSources } = await import('../dist/hosted-sources.js');
  const { createHostedApiServer, drainHostedServer } = await import('../dist/hosted-server.js');
  const f = await authFixture(t), c = f.config, pool = new Pool({ connectionString: process.env.DATABASE_URL }), name = `h4_http_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE VIEW "${name}" AS SELECT 'east'::text AS region, 1::bigint AS amount, 'synthetic'::text AS private FROM pg_sleep(30)`);
  const url = new URL(process.env.DATABASE_URL), endpoint = { id: 'reference', host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), tls: false };
  const metadata = new TenantMetadata(f.db, f.db), sources = new HostedSources(metadata, c.encryptionKey.toString('base64'), [endpoint]);
  const identity = await f.auth.verify((await f.login()).token), context = await metadata.authenticate(null, async () => identity);
  await sources.create(context, 'slow', { ...registration(), table: name, credentials: { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) || 'synthetic' } });
  const env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds), OPENSIGHT_SOURCE_ENDPOINTS: JSON.stringify([endpoint]) };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env, security: { authenticate: f.auth.authenticate } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await drainHostedServer(server); await pool.query(`DROP VIEW "${name}"`); await pool.end(); });
  const token = (await f.login()).token; let received = false;
  const req = request({ host: '127.0.0.1', port: server.address().port, path: '/api/sources/slow/output', method: 'POST',
    headers: { Host: new URL(c.origin).host, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': 2 } }, res => { received = true; res.resume(); });
  req.on('error', () => {}); req.end('{}');
  const deadline = performance.now() + 5000; let pid;
  for (;;) {
    const { rows } = await pool.query("SELECT pid FROM pg_stat_activity WHERE state = 'active' AND application_name = '' AND query = 'FETCH FORWARD 32 FROM blaze_cursor'");
    if (rows[0]) { pid = rows[0].pid; break; }
    if (performance.now() > deadline) { req.destroy(); assert.fail('HTTP cursor never started'); } await delay(5);
  }
  req.destroy(); const start = performance.now();
  while ((await pool.query('SELECT pid FROM pg_stat_activity WHERE pid = $1', [pid])).rows.length) {
    assert.ok(performance.now() - start < 1500, 'disconnect failed to stop cursor'); await delay(5);
  }
  assert.equal(received, false);
});
