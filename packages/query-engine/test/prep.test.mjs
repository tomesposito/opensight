import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { compilePrep } from '../dist/index.js';
export const columns = [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }, { name: 'category', type: 'STRING' }];
export const source = { id: 'sales', connectorId: 'file', table: 'sales', columns, security: 'unrestricted' };
export const pipeline = steps => ({ version: 1, input: 'sales', steps: steps.map((s, i) => ({ id: `s${i}`, ...s })) });
export async function engines(t) {
  const db = await DuckDBInstance.create(':memory:', { threads: '1' }), duck = await db.connect(), pg = new PGlite();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.close(); });
  const setup = "CREATE TABLE sales (region VARCHAR, amount DOUBLE PRECISION, category VARCHAR); INSERT INTO sales VALUES ('East', 2.9, 'A'), ('West', 3.1, 'B'), ('East', 4, 'B'), (NULL, NULL, 'A');";
  await duck.run(setup); await pg.exec(setup);
  return async (steps, options = {}, extra = []) => {
    const results = [];
    for (const dialect of ['duckdb', 'postgres']) {
      const sources = [source, ...extra].map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' }));
      const plan = compilePrep(pipeline(steps), sources, { dialect, ...options });
      const rows = dialect === 'duckdb' ? (await duck.runAndReadAll(plan.sql, plan.parameters)).getRowObjects() : (await pg.query(plan.sql, plan.parameters)).rows;
      const normalize = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? Number(v) : v]))).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      results.push(normalize(rows));
    }
    assert.deepEqual(results[0], results[1]); return results[0];
  };
}
test('prep column transforms execute identically in DuckDB and Postgres', async t => {
  const run = await engines(t);
  assert.deepEqual(await run([{ kind: 'changeType', config: { column: 'amount', type: 'INTEGER' } }, { kind: 'rename', config: { column: 'amount', name: 'revenue' } }, { kind: 'select', config: { columns: ['revenue'] } }]), [{ revenue: 2 }, { revenue: 3 }, { revenue: 4 }, { revenue: null }]);
  assert.equal((await run([{ kind: 'rename', config: { column: 'amount', name: 'revenue' } }], { through: null })).some(r => 'amount' in r), true);
});
test('prep refuses unknown columns, case collisions, invalid previews and unresolved security before SQL', () => {
  for (const step of [{ kind: 'select', config: { columns: ['missing'] } }, { kind: 'rename', config: { column: 'amount', name: 'REGION' } }]) assert.throws(() => compilePrep(pipeline([step]), [source]), e => e.code === 'PREP_SCHEMA_MISMATCH');
  assert.throws(() => compilePrep(pipeline([]), [{ ...source, security: 'protected' }]), e => e.code === 'PREP_SECURITY_REJECTED');
  assert.throws(() => compilePrep(pipeline([]), []), e => e.code === 'PREP_SOURCE_NOT_FOUND');
  assert.throws(() => compilePrep(pipeline([]), [source], { limit: 501 }), e => e.code === 'PREP_LIMIT_EXCEEDED');
});
test('prep filters reuse Phase 2b membership, ranges, empty-list and null semantics', async t => {
  const run = await engines(t);
  assert.deepEqual(await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', values: ['East'] }, { columnName: 'amount', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 3 }] } }]), [{ region: 'East', amount: 4, category: 'B' }]);
  assert.deepEqual(await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', values: [] }] } }]), []);
  assert.deepEqual(await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', value: "East' OR TRUE --" }] } }]), []);
  assert.throws(() => compilePrep(pipeline([{ kind: 'filter', config: { filters: [{ columnName: 'amount', value: '3' }] } }]), [source]), e => e.code === 'PREP_SCHEMA_MISMATCH');
});
test('prep calculated columns reuse the typed function library and feed subsequent steps', async t => {
  const run = await engines(t);
  assert.deepEqual(await run([{ kind: 'calculate', config: { name: 'upper_region', expression: 'upper({region})' } }, { kind: 'calculate', config: { name: 'label', expression: "concat({upper_region}, ' zone')" } }, { kind: 'filter', config: { filters: [{ columnName: 'label', value: 'EAST zone' }] } }, { kind: 'select', config: { columns: ['label'] } }]), [{ label: 'EAST zone' }, { label: 'EAST zone' }]);
  assert.equal((await run([{ kind: 'calculate', config: { name: 'date', expression: "parseDate('2024-02-29')" } }]))[0].date, '2024-02-29T00:00:00.000Z');
  for (const expression of ['sum({amount})', 'sumOver({amount}, [], PRE_AGG)', 'unknown({amount})', '{missing} + 1']) assert.throws(() => compilePrep(pipeline([{ kind: 'calculate', config: { name: 'result', expression } }]), [source]));
});
