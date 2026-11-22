import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { prepJoinDiagnostics, PrepJoinBudget, compilePrepJoinSample, prepJoinSampleResult, PREP_JOIN_SAMPLE_LIMIT as N } from '../dist/index.js';
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
    const result = prepJoinSampleResult(plan, await query(plan.sql, plan.parameters));
    assert.equal(result.matchedRows, 2); assert.equal(result.unmatchedLeft, 1); assert.equal(result.unmatchedRight, 2);
    assert.equal(result.leftRowsSampled, 2); assert.equal(result.rightRowsSampled, 4);
    assert.equal(result.leftTruncated, true); assert.equal(result.rightTruncated, false);
    assert.deepEqual(plan.sampleSources.map(s => s.id), ['left','right']);
    const branch = { ...pipeline, steps: [{ id: 'renamed', kind: 'rename', config: { column: 'id', name: 'key' } }, { ...join, config: { ...join.config, source: { step: 'renamed' }, keys: [{ left: 'key', right: 'key' }] } }] };
    const b = compilePrepJoinSample(branch, sources.map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' })), 'join', { dialect });
    const bd = prepJoinSampleResult(b, await query(b.sql, b.parameters));
    // The branch joins the renamed left stage against itself: every sampled key matches once.
    assert.equal(bd.matchedRows, N); assert.equal(bd.unmatchedLeft, 0); assert.equal(bd.unmatchedRight, 0);
    assert.equal(bd.leftRowsSampled, N); assert.equal(bd.rightRowsSampled, N);
    assert.equal(bd.leftTruncated, true); assert.equal(bd.rightTruncated, true);
  } finally { if (dialect === 'duckdb') { db.closeSync(); instance.closeSync(); } else await db.close(); }
});
test('sample result decoding validates the aggregate row shape and fails closed on drift', () => {
  const plan = { columns: [{ name: 'matchedRows', type: 'INTEGER' }, { name: 'unmatchedLeft', type: 'INTEGER' }, { name: 'unmatchedRight', type: 'INTEGER' },
    { name: 'maxLeftMultiplicity', type: 'INTEGER' }, { name: 'maxRightMultiplicity', type: 'INTEGER' },
    { name: 'leftRowsSampled', type: 'INTEGER' }, { name: 'rightRowsSampled', type: 'INTEGER' },
    { name: 'leftTruncated', type: 'BOOLEAN' }, { name: 'rightTruncated', type: 'BOOLEAN' }] };
  const row = { matchedRows: '6', unmatchedLeft: '4', unmatchedRight: '2', maxLeftMultiplicity: '2', maxRightMultiplicity: '3',
    leftRowsSampled: '6', rightRowsSampled: '5', leftTruncated: 'f', rightTruncated: 't' };
  assert.deepEqual(prepJoinSampleResult(plan, [row]), { basis: 'bounded-preview', sampleLimit: N, timedOut: false,
    matchedRows: 6, unmatchedLeft: 4, unmatchedRight: 2, fanOut: true, maxLeftMultiplicity: 2, maxRightMultiplicity: 3,
    leftRowsSampled: 6, rightRowsSampled: 5, leftTruncated: false, rightTruncated: true });
  assert.throws(() => prepJoinSampleResult(plan, []), { code: 'PREP_EXECUTION_FAILED' });
  assert.throws(() => prepJoinSampleResult(plan, [row, row]), { code: 'PREP_EXECUTION_FAILED' });
  assert.throws(() => prepJoinSampleResult(plan, [{ ...row, matchedRows: '-1' }]), { code: 'PREP_EXECUTION_FAILED' });
  assert.throws(() => prepJoinSampleResult(plan, [{ ...row, leftTruncated: 'yes' }]), { code: 'PREP_EXECUTION_FAILED' });
});
for (const dialect of ['duckdb', 'postgres']) test(`${dialect}: diagnostics agree with an actual join on sub-millisecond and precision-sensitive keys`, async () => {
  const instance = dialect === 'duckdb' ? await DuckDBInstance.create(':memory:') : new PGlite();
  const db = dialect === 'duckdb' ? await instance.connect() : instance;
  const query = async (sql, params = []) => dialect === 'duckdb' ? (await db.runAndReadAll(sql, params)).getRowObjects() : (await db.query(sql, params)).rows;
  try {
    const cases = [
      { column: 'ts', type: 'DATETIME', leftSqlType: 'TIMESTAMP', rightSqlType: 'TIMESTAMP',
        left: ['2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.123456'],
        right: ['2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.123456', '2026-01-01 00:00:00.123457'] },
      { column: 'amt', type: 'DECIMAL', leftSqlType: 'DECIMAL(38,10)', rightSqlType: 'DECIMAL(38,10)',
        left: ['123456789.1234567891', '123456789.1234567892', '42.5'],
        right: ['123456789.1234567892', '42.50', '7'] },
      { column: 'id', type: 'INTEGER', leftSqlType: 'BIGINT', rightSqlType: 'BIGINT',
        left: ['9007199254740993', '9007199254740992'], right: ['9007199254740992', '9007199254740994'] },
      // Mixed native types under one prep type: native coercion decides equality, not text form.
      { column: 'amt', type: 'DECIMAL', leftSqlType: 'REAL', rightSqlType: 'DOUBLE PRECISION',
        left: ['0.1', '0.5'], right: ['0.1', '0.5'] },
      { column: 'amt', type: 'DECIMAL', leftSqlType: 'DOUBLE PRECISION', rightSqlType: 'DECIMAL(38,17)',
        left: ['0.1'], right: ['0.10000000000000001'] },
      { column: 'ts', type: 'DATETIME', leftSqlType: 'DATE', rightSqlType: 'TIMESTAMP',
        left: ['2026-01-01', '2026-01-02'], right: ['2026-01-01 00:00:00', '2026-01-03 00:00:00'] },
    ];
    for (const c of cases) {
      await query(`DROP TABLE IF EXISTS "left"`); await query(`DROP TABLE IF EXISTS "right"`);
      await query(`CREATE TABLE "left" (${c.column} ${c.leftSqlType})`); await query(`CREATE TABLE "right" (${c.column} ${c.rightSqlType})`);
      for (const v of c.left) await query(`INSERT INTO "left" VALUES ('${v}')`);
      for (const v of c.right) await query(`INSERT INTO "right" VALUES ('${v}')`);
      const actual = Number(Object.values((await query(`SELECT COUNT(*) AS n FROM "left" l JOIN "right" r ON l.${c.column} = r.${c.column}`))[0])[0]);
      const typed = ['left', 'right'].map(id => ({ id, table: id, connectorId: dialect === 'postgres' ? 'postgresql' : 'file', security: 'unrestricted', columns: [{ name: c.column, type: c.type }] }));
      const p = { version: 1, input: 'left', steps: [{ id: 'join', kind: 'join', config: { source: 'right', joinType: 'inner', keys: [{ left: c.column, right: c.column }], prefix: 'r_' } }] };
      const plan = compilePrepJoinSample(p, typed, 'join', { dialect });
      const diagnostics = prepJoinSampleResult(plan, await query(plan.sql, plan.parameters));
      assert.equal(diagnostics.matchedRows, actual, `${c.leftSqlType}/${c.rightSqlType}: diagnostics ${diagnostics.matchedRows} != actual join ${actual}`);
      assert.equal(diagnostics.unmatchedLeft, c.left.length - actual, `${c.column} unmatchedLeft`);
      assert.equal(diagnostics.unmatchedRight, c.right.length - actual, `${c.column} unmatchedRight`);
      assert.equal(diagnostics.leftTruncated, false); assert.equal(diagnostics.rightTruncated, false);
    }
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
