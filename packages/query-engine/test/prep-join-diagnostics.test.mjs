import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { prepJoinDiagnostics, PrepJoinBudget, compilePrepJoinSample, PREP_JOIN_SAMPLE_LIMIT as N } from '../dist/index.js';
const keys = [{ left: 'id', right: 'id' }];
const rows = (...ids) => ids.map(id => ({ id }));
const sources = ['left', 'right'].map(id => ({ id, table: id, connectorId: 'file', security: 'unrestricted', columns: [{ name: 'id', type: 'INTEGER' }] }));
const join = { id: 'join', kind: 'join', config: { source: 'right', joinType: 'inner', keys, prefix: 'r_' } };
const pipeline = { version: 1, input: 'left', steps: [join] };
test('diagnostics exact multiplication, unmatched NULLs, and matched-key multiplicities', () => {
  assert.deepEqual(prepJoinDiagnostics(rows(1,1,2,null,8,8), rows(1,1,1,3,null), keys), {
    basis: 'bounded-preview', sampleLimit: N, timedOut: false, matchedRows: 6, unmatchedLeft: 4, unmatchedRight: 2,
    fanOut: true, maxLeftMultiplicity: 2, maxRightMultiplicity: 3, leftRowsSampled: 6, rightRowsSampled: 5, leftTruncated: false, rightTruncated: false,
  });
});
test('diagnostics composite keys are collision-safe and NULL in any component never matches', () => {
  const a = [{ id: 'a|b', v: 'c' }, { id: 'a', v: 'b|c' }, { id: null, v: 'x' }];
  const d = prepJoinDiagnostics(a, [a[1], a[2]], [...keys, { left: 'v', right: 'v' }]);
  assert.equal(d.matchedRows, 1); assert.equal(d.unmatchedLeft, 2); assert.equal(d.unmatchedRight, 1); assert.equal(d.fanOut, false);
});
test('diagnostics empty sides, probe rows excluded, and inherited truncation', () => {
  assert.equal(prepJoinDiagnostics([], rows(1,2), keys).unmatchedRight, 2);
  assert.equal(prepJoinDiagnostics(rows(1), [], keys).unmatchedLeft, 1);
  const d = prepJoinDiagnostics(rows(...Array(N + 1).fill(1)), rows(1), keys, { rightTruncated: true });
  assert.equal(d.matchedRows, N); assert.equal(d.leftRowsSampled, N); assert.equal(d.leftTruncated, true); assert.equal(d.rightTruncated, true);
});
test('diagnostics fail closed on missing keys/scalars and shared budget expiration during counts', () => {
  assert.throws(() => prepJoinDiagnostics([], [], []), { code: 'INVALID_PREP_PIPELINE' });
  assert.throws(() => prepJoinDiagnostics([{}], [], keys), { code: 'PREP_EXECUTION_FAILED' });
  let time = 0; const budget = new PrepJoinBudget(() => time); time = 10_000;
  assert.throws(() => prepJoinDiagnostics(rows(1), rows(1), keys, {}, () => budget.check()), { code: 'PREP_EXECUTION_FAILED' });
});
for (const dialect of ['duckdb', 'postgres']) test(`${dialect}: bounded physical samples precede filters, prefix branches and joins`, async () => {
  const instance = dialect === 'duckdb' ? await DuckDBInstance.create(':memory:') : new PGlite();
  const db = dialect === 'duckdb' ? await instance.connect() : instance;
  const query = async (sql, params = []) => dialect === 'duckdb' ? (await db.runAndReadAll(sql, params)).getRowObjects() : (await db.query(sql, params)).rows;
  try {
    await query('CREATE TABLE "left" (id BIGINT)'); await query('CREATE TABLE "right" (id BIGINT)');
    await query(`INSERT INTO "left" SELECT generate_series FROM generate_series(1, ${N + 30})`);
    await query('INSERT INTO "right" VALUES (1),(1),(3),(NULL)');
    const p = { ...pipeline, steps: [{ id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'id', values: [1,2] }] } }, join] };
    const plan = compilePrepJoinSample(p, sources.map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' })), 'join', { dialect });
    assert.match(plan.sql, /AS MATERIALIZED \(SELECT \* FROM "left" LIMIT 10001\)/);
    const result = await query(plan.sql, plan.parameters);
    const side = n => result.filter(r => Number(r.__side) === n).map(r => Number(r.key_0));
    assert.deepEqual(side(0), [1,2]); assert.equal(side(1).length, 4); assert.equal(side(2).length, 1); assert.equal(side(3).length, 0);
    assert.deepEqual(plan.sampleSources.map(s => s.id), ['left','right']);
    const branch = { ...pipeline, steps: [{ id: 'renamed', kind: 'rename', config: { column: 'id', name: 'key' } }, { ...join, config: { ...join.config, source: { step: 'renamed' }, keys: [{ left: 'key', right: 'key' }] } }] };
    const b = compilePrepJoinSample(branch, sources.map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' })), 'join', { dialect });
    assert.equal((await query(b.sql, b.parameters)).length, N * 2 + 2);
  } finally { if (dialect === 'duckdb') { db.closeSync(); instance.closeSync(); } else await db.close(); }
});
test('sample compiler retains named configuration/security errors and nested prepared inputs', () => {
  for (const [config, code] of [[{ keys: [] }, 'INVALID_PREP_PIPELINE'], [{ keys: [{ left: 'missing', right: 'id' }] }, 'PREP_SCHEMA_MISMATCH']]) {
    assert.throws(() => compilePrepJoinSample({ ...pipeline, steps: [{ ...join, config: { ...join.config, ...config } }] }, sources, 'join'), { code });
  }
  assert.throws(() => compilePrepJoinSample(pipeline, [sources[0], { ...sources[1], columns: [{ name: 'id', type: 'STRING' }] }], 'join'), { code: 'PREP_SCHEMA_MISMATCH' });
  assert.throws(() => compilePrepJoinSample(pipeline, sources.map(s => ({ ...s, security: 'protected' })), 'join'), { code: 'PREP_SECURITY_REJECTED' });
  const plan = compilePrepJoinSample({ ...pipeline, input: { dataset: 'nested' } }, sources, 'join', { datasets: [{ id: 'nested', pipeline: { version: 1, input: 'left', steps: [] } }] });
  assert.deepEqual(plan.sampleSources.map(s => s.id), ['left','right']);
});
