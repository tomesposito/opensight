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
test('prep aggregate and explicit pivot/unpivot have shared null and grouping semantics', async t => {
  const run = await engines(t);
  const grouped = await run([{ kind: 'aggregate', config: { groupBy: ['region'], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }, { column: 'amount', name: 'count', aggregation: 'COUNT' }] } }]);
  assert.ok(grouped.some(r => r.region === 'East' && r.total === 6.9 && r.count === 2));
  const pivot = { kind: 'pivot', config: { groupBy: ['region'], column: 'category', value: 'amount', aggregation: 'SUM', values: [{ value: 'A', name: 'a' }, { value: 'B', name: 'b' }] } };
  const rows = await run([pivot]); assert.ok(rows.some(r => r.region === 'East' && r.a === 2.9 && r.b === 4));
  const unpivoted = await run([pivot, { kind: 'unpivot', config: { columns: ['a', 'b'], nameColumn: 'kind', valueColumn: 'value' } }]);
  assert.equal(unpivoted.length, 6); assert.equal(unpivoted.filter(r => r.value === null).length, 3);
  for (const aggregation of ['COUNT','MIN','MAX','AVG']) await run([{ kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'result', aggregation }] } }]);
});
test('prep joins preserve multiplicity and SQL null semantics; append preserves duplicate rows', async t => {
  const run = await engines(t), right = { ...source, id: 'right' };
  for (const joinType of ['inner', 'left', 'full']) {
    const rows = await run([{ kind: 'join', config: { source: 'right', joinType, keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'amount', name: 'right_amount' }] } }], {}, [right]);
    assert.equal(rows.length, joinType === 'inner' ? 5 : joinType === 'left' ? 6 : 7);
  }
  assert.equal((await run([{ kind: 'append', config: { source: 'right' } }], {}, [right])).length, 8);
  for (const kind of ['join', 'append']) {
    const config = kind === 'join' ? { source: 'right', joinType: 'inner', keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'amount', name: 'other' }] } : { source: 'right' };
    assert.throws(() => compilePrep(pipeline([{ kind, config }]), [source, { ...right, security: 'protected' }]), e => e.code === 'PREP_SECURITY_REJECTED');
  }
});
test('prep validates all stages even for an earlier preview; no unsupported steps disappear', () => {
  assert.throws(() => compilePrep(pipeline([{ kind: 'select', config: { columns: ['region'] } }, { kind: 'select', config: { columns: ['amount'] } }]), [source], { through: 's0' }), e => e.code === 'PREP_SCHEMA_MISMATCH');
  assert.throws(() => compilePrep(pipeline([{ kind: 'append', config: { source: 'right' } }]), [source, { ...source, id: 'right', columns: columns.slice(1) }]), e => e.code === 'PREP_SCHEMA_MISMATCH');
});
test('private upload execution bounds the output and reports unknown totals honestly', async t => {
  const { UploadStaging } = await import('../dist/index.js');
  const staging = await UploadStaging.create(); t.after(() => staging.close());
  const upload = await staging.ingest({ config: { format: 'csv' }, data: new TextEncoder().encode('label,n\na,1\nb,2\nc,3\n') });
  const p = { version: 1, input: upload.id, steps: [] };
  const result = await staging.previewPrep(p, { limit: 2 });
  assert.equal(result.rows.length, 2); assert.equal(result.truncated, true); assert.equal(result.totalRows, null); assert.equal(result.rowCountLowerBound, 3);
  assert.equal((await staging.previewPrep(p, { limit: 3 })).totalRows, 3);
  const sources = staging.prepSources(); sources[0].columns[0].name = 'mutated';
  assert.equal(staging.prepSources()[0].columns[0].name, 'label');
  const counted = await staging.previewPrep({ ...p, steps: [{ id: 'a', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'n', name: 'total', aggregation: 'SUM' }] } }] }, { limit: 1 });
  assert.deepEqual(counted.rows, [{ total: 6 }]); assert.equal(counted.totalRows, 1);
  await assert.rejects(staging.previewPrep({ ...p, input: 'another-owner' }), e => e.code === 'PREP_SOURCE_NOT_FOUND');
});
test('string conversions share function-library parsing, invalid values become null', async t => {
  const run = await engines(t);
  for (const type of ['INTEGER','DECIMAL','DATETIME','BOOLEAN']) {
    const result = await run([{ kind: 'changeType', config: { column: 'category', type } }]);
    assert.ok(result.every(r => r.category === null));
  }
});
