import assert from 'node:assert/strict';
import test from 'node:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { parseExpression, expressionSql, evaluateExpression } from '@opensight/query-engine';

// One-based Unicode positions, strict null propagation and QuickSight argument order.
export const scalarCases = [
  ['abs(-3)', 3], ['ceil(-1.2)', -1], ['floor(-1.2)', -2], ['round(-1.25, 1)', -1.3], ['round(125, -1)', 130],
  ['sqrt(9)', 3], ['sqrt(-1)', null], ['power(2, 3)', 8], ['power(-2, 0.5)', null], ['exp(0)', 1], ['exp(1000)', null],
  ['ln(1)', 0], ['ln(0)', null], ['log(100)', 2], ['log(8, 2)', 3], ['log(8, 1)', null],
  ['mod(-5, 3)', -2], ['mod(5, 0)', null], ['pi()', Math.PI], ['decimalToInt(-2.9)', -2], ['abs(null)', null],
  ['toDecimal(12)', 12], ["parseDecimal('12.50')", 12.5], ["parseInt('-12.50')", -12], ["parseInt('abc')", null], ["parseDecimal('12x')", null],
  ["concat('East', ' / ', 'Hardware')", 'East / Hardware'], ["concat('x', null)", null],
  ["substring('a😀bc', 2, 2)", '😀b'], ["substring('abc', 0, 2)", null],
  ["left('abc', 2)", 'ab'], ["right('abc', 2)", 'bc'], ["right('abc', 0)", ''],
  ["trim('  a b  ')", 'a b'], ["upper('East')", 'EAST'], ["lower('WEST')", 'west'],
  ["replace('banana', 'an', 'X')", 'bXXa'], ["replace('abc', '', 'x')", 'abc'],
  ["locate('banana', 'an')", 2], ["locate('banana', 'an', 3)", 4], ["locate('a😀bc', 'b')", 3], ["locate('abc', 'x')", 0],
  ["strlen('a😀b')", 3], ["toString(12)", '12'], ['toString(null)', null],
];
for (const [source, expected] of scalarCases) test(`scalar semantics: ${source}`, () => assert.deepEqual(evaluateExpression(parseExpression(source)), expected));
test('string signatures reject misuse with the function and expected signature', () => {
  for (const expression of ['substring(1, 2, 3)', "locate('abc')", 'strlen(2)', 'left()']) assert.throws(() => parseExpression(expression), /Expected \w+\(/);
  assert.throws(() => parseExpression('mystery(1)'), /Unsupported function mystery/);
});
test('scalar differential: DuckDB, PostgreSQL, client', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(); const db = await DuckDBInstance.create(':memory:', { threads: '1' }); const duck = await db.connect();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.close(); });
  for (const [source, expected] of scalarCases) {
    const e = parseExpression(source);
    for (const dialect of ['duckdb', 'postgres']) {
      const values = [], sql = `SELECT ${expressionSql(e, dialect, v => { values.push(v); return '$' + values.length; })} AS value`;
      const result = dialect === 'duckdb' ? (await duck.runAndReadAll(sql, values)).getRowObjects()[0].value : (await pg.query(sql, values)).rows[0].value;
      assert.deepEqual(typeof result === 'bigint' ? Number(result) : result, expected, `${dialect}: ${source}`);
    }
  }
});
