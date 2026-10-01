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
  const cancellationMs = performance.now() - started;
  assert.equal(rows, 0); assert.ok(cancellationMs < 1500);
  assert.equal((await pool.query('SELECT pid FROM pg_stat_activity WHERE application_name = $1', [application_name])).rows.length, 0);
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
