import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { prepJoinDiagnostics, PrepJoinBudget, compilePrepJoinSample, prepJoinSampleResult, canonicalNumericKey, PREP_JOIN_SAMPLE_LIMIT as N } from '../dist/index.js';
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
test('canonical numeric keys: SQL-equal spellings share a key, distinct precision never collides', () => {
  assert.equal(canonicalNumericKey('1.00'), '1'); assert.equal(canonicalNumericKey('1.0'), '1');
  assert.equal(canonicalNumericKey('-0.00'), '0'); assert.equal(canonicalNumericKey('+007.500'), '7.5');
  assert.equal(canonicalNumericKey('1e3'), '1000'); assert.equal(canonicalNumericKey('1.5e-3'), '0.0015');
  assert.equal(canonicalNumericKey('9007199254740993'), '9007199254740993');
  assert.notEqual(canonicalNumericKey('123456789.1234567891'), canonicalNumericKey('123456789.1234567892'));
  assert.equal(canonicalNumericKey(9007199254740993n), '9007199254740993');
  assert.throws(() => canonicalNumericKey('abc'), { code: 'PREP_EXECUTION_FAILED' });
  assert.throws(() => canonicalNumericKey('NaN'), { code: 'PREP_EXECUTION_FAILED' });
});
test('sample result decoding preserves native key equality (microsecond datetimes, exact decimals)', () => {
  const plan = type => ({ columns: [{ name: '__side', type: 'INTEGER' }, { name: 'key_0', type }] });
  const run = (type, left, right) => prepJoinSampleResult(plan(type), [...left.map(v => ({ __side: 0, key_0: v })), ...right.map(v => ({ __side: 1, key_0: v }))]);
  const ts = run('DATETIME', ['2026-01-01T00:00:00.000001Z', '2026-01-01T00:00:00.000002Z'], ['2026-01-01T00:00:00.000002Z', '2026-01-01T00:00:00.000003Z']);
  assert.equal(ts.matchedRows, 1); assert.equal(ts.unmatchedLeft, 1); assert.equal(ts.unmatchedRight, 1);
  const dec = run('DECIMAL', ['1.00', '123456789.1234567891'], ['1.0', '123456789.1234567892']);
  assert.equal(dec.matchedRows, 1); assert.equal(dec.unmatchedLeft, 1); assert.equal(dec.unmatchedRight, 1);
  assert.throws(() => run('DATETIME', [42], []), { code: 'PREP_EXECUTION_FAILED' });
});
for (const dialect of ['duckdb', 'postgres']) test(`${dialect}: diagnostics agree with an actual join on sub-millisecond and precision-sensitive keys`, async () => {
  const instance = dialect === 'duckdb' ? await DuckDBInstance.create(':memory:') : new PGlite();
  const db = dialect === 'duckdb' ? await instance.connect() : instance;
  const query = async (sql, params = []) => dialect === 'duckdb' ? (await db.runAndReadAll(sql, params)).getRowObjects() : (await db.query(sql, params)).rows;
  try {
    const cases = [
      { column: 'ts', type: 'DATETIME', sqlType: 'TIMESTAMP',
        left: ['2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.123456'],
        right: ['2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.123456', '2026-01-01 00:00:00.123457'] },
      { column: 'amt', type: 'DECIMAL', sqlType: 'DECIMAL(38,10)',
        left: ['123456789.1234567891', '123456789.1234567892', '42.5'],
        right: ['123456789.1234567892', '42.50', '7'] },
      { column: 'id', type: 'INTEGER', sqlType: 'BIGINT',
        left: ['9007199254740993', '9007199254740992'], right: ['9007199254740992', '9007199254740994'] },
    ];
    for (const c of cases) {
      await query(`DROP TABLE IF EXISTS "left"`); await query(`DROP TABLE IF EXISTS "right"`);
      await query(`CREATE TABLE "left" (${c.column} ${c.sqlType})`); await query(`CREATE TABLE "right" (${c.column} ${c.sqlType})`);
      for (const v of c.left) await query(`INSERT INTO "left" VALUES ('${v}')`);
      for (const v of c.right) await query(`INSERT INTO "right" VALUES ('${v}')`);
      const actual = Number(Object.values((await query(`SELECT COUNT(*) AS n FROM "left" l JOIN "right" r ON l.${c.column} = r.${c.column}`))[0])[0]);
      const typed = ['left', 'right'].map(id => ({ id, table: id, connectorId: dialect === 'postgres' ? 'postgresql' : 'file', security: 'unrestricted', columns: [{ name: c.column, type: c.type }] }));
      const p = { version: 1, input: 'left', steps: [{ id: 'join', kind: 'join', config: { source: 'right', joinType: 'inner', keys: [{ left: c.column, right: c.column }], prefix: 'r_' } }] };
      const plan = compilePrepJoinSample(p, typed, 'join', { dialect });
      const diagnostics = prepJoinSampleResult(plan, await query(plan.sql, plan.parameters));
      assert.equal(diagnostics.matchedRows, actual, `${c.column}: diagnostics ${diagnostics.matchedRows} != actual join ${actual}`);
      assert.equal(diagnostics.unmatchedLeft, c.left.length - (c.column === 'ts' ? 2 : c.column === 'amt' ? 2 : 1));
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
