import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { streamSourceRedshift, planSourceRead } from '@opensight/query-engine';
import { boundedPrepSql } from '../dist/prep-stream.js';
import { redshiftHarness } from './redshift-harness.mjs';
const columns = [{ name: 'tenant', type: 'STRING' }, { name: 'day', type: 'DATETIME' }, { name: 'amount', type: 'INTEGER' }];
const read = { source: { id: 'input', connectorId: 'redshift-manual', schema: 'public', table: 'sales', columns, security: 'unrestricted' }, columns: columns.map(c => c.name), security: { namespaceId: 'ns', userId: 'admin', users: [{ id: 'admin', namespaceId: 'ns' }], groups: [], policy: { namespaceId: 'ns', dataSetArn: 'input', rowLevel: false, rowRules: [] } }, tenantPredicate: { column: 'tenant', operator: 'eq', value: "tenant' OR TRUE --" } };
const limits = { maxRows: 2, cellChars: 1000 };
const fields = [{ name: 'v0', oid: 1043 }, { name: 'v1', oid: 1043 }, { name: 'v2', oid: 20 }, { name: 'oversized', oid: 16 }];
const row = ['tenant', '2026-01-01T00:00:00.123Z', '12', 'f'];
function sink() { return { columns: null, rows: [], start(columns) { this.columns = columns; }, row(values) { this.rows.push(values); }, oversized() { throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' }); } }; }

test('Redshift source SELECT binds tenant policy, formats timestamps, bounds rows and uses non-truncating text casts', () => {
  const plan = planSourceRead(read, limits, 'redshift');
  assert.equal(plan.sql, 'SELECT "tenant" AS "tenant", TO_CHAR("day", \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "day", "amount" AS "amount" FROM "public"."sales" WHERE ("tenant" = $1) LIMIT 3');
  assert.deepEqual(plan.parameters, ["tenant' OR TRUE --"]);
  const guard = '(COALESCE(LENGTH(CAST("tenant" AS VARCHAR(65535))), 0) + COALESCE(LENGTH(CAST("day" AS VARCHAR(65535))), 0) + COALESCE(LENGTH(CAST("amount" AS VARCHAR(65535))), 0)) > 1000';
  assert.equal(boundedPrepSql(plan, limits, 'redshift'), `SELECT CASE WHEN ${guard} THEN NULL ELSE "tenant" END AS "v0", CASE WHEN ${guard} THEN NULL ELSE "day" END AS "v1", CASE WHEN ${guard} THEN NULL ELSE "amount" END AS "v2", ${guard} AS "oversized" FROM (${plan.sql}) AS "bounded_prep"`);
});
test('Redshift streams bounded wire rows without cursor/transaction/PG cancellation statements', async t => {
  const h = await redshiftHarness(t, { evaluate(sql, values) { assert.match(sql, /LIMIT 3/); assert.deepEqual(values, read.tenantPredicate ? [read.tenantPredicate.value] : []); return { fields, rows: [row] }; } });
  const output = sink(); await streamSourceRedshift(read, h.connection, limits, output);
  assert.deepEqual(output.rows, [['tenant', '2026-01-01T00:00:00.123Z', 12]]);
  assert.deepEqual(h.sessions, ["SET TIME ZONE 'UTC'", 'SET statement_timeout TO 10000']);
  assert.equal(h.queries.length, 3); assert.deepEqual(h.errors, []);
});
for (const mode of ['sentinel', 'extra', 'guard', 'untrusted-guard', 'long', 'unknown', 'unknown-empty', 'consumer']) test(`Redshift source closes and fails closed: ${mode}`, async t => {
  const h = await redshiftHarness(t, { evaluate: () => ({ fields: mode.startsWith('unknown') ? [{ name: 'v0', oid: 4000 }, ...fields.slice(1)] : fields,
    rows: mode === 'unknown-empty' ? [] : mode === 'sentinel' || mode === 'extra' ? Array.from({ length: mode === 'sentinel' ? 3 : 5 }, () => row) : [[mode === 'long' ? 'x'.repeat(1001) : 'tenant', row[1], row[2], mode === 'guard' ? 't' : mode === 'untrusted-guard' ? 'invalid' : 'f']] }) });
  const output = sink(), consumer = new Error('consumer failure'); if (mode === 'consumer') output.row = () => { throw consumer; };
  await assert.rejects(streamSourceRedshift(read, h.connection, limits, output), e => mode === 'consumer' ? e === consumer : e.code === (mode.startsWith('unknown') ? 'UNSUPPORTED_FEATURE' : mode === 'untrusted-guard' ? 'PREP_EXECUTION_FAILED' : 'TOO_LARGE'));
  assert.deepEqual(h.errors, []);
});
test('Redshift RLS, CLS, TLS and pre-aborted reads fail before sockets', async t => {
  const h = await redshiftHarness(t), abort = new AbortController(); abort.abort();
  await assert.rejects(streamSourceRedshift(read, h.connection, limits, sink(), { signal: abort.signal }), { code: 'EXECUTION_CANCELLED' });
  await assert.rejects(streamSourceRedshift(read, { ...h.connection, host: 'remote.invalid' }, limits, sink()), { code: 'INVALID_INPUT' });
  for (const policy of [{ rowLevel: true, rowRules: [] }, { ...read.security.policy, protectedColumns: ['amount'], columnGrants: [] }]) await assert.rejects(streamSourceRedshift({ ...read, security: { ...read.security, policy: { ...read.security.policy, ...policy } } }, h.connection, limits, sink()), { code: policy.rowLevel ? 'ROW_ACCESS_DENIED' : 'COLUMN_ACCESS_DENIED' });
  assert.equal(h.startups.length, 0);
});
for (const mode of ['stall', 'stall-auth']) test(`Redshift cancellation/deadline closes ${mode} socket`, async t => {
  const h = await redshiftHarness(t); h.mode = mode;
  const abort = new AbortController();
  const running = streamSourceRedshift(read, h.connection, limits, sink(), { signal: abort.signal });
  setTimeout(() => abort.abort(), 30); await assert.rejects(running, { code: 'EXECUTION_CANCELLED' });
  await assert.rejects(streamSourceRedshift(read, h.connection, limits, sink(), { executionMs: 30 }), { code: 'EXECUTION_CANCELLED' });
  for (let i = 0; i < 20 && h.sockets.size; i++) await delay(5);
  assert.equal(h.sockets.size, 0); assert.deepEqual(h.errors, []);
});
