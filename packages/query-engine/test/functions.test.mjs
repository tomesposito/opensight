import assert from 'node:assert/strict';
import test from 'node:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { parseExpression, expressionSql, evaluateExpression } from '@opensight/query-engine';

// One-based Unicode positions, strict null propagation and QuickSight argument order.
export const scalarCases = [
  ["ifelse(1 = 2, 'no', 2 >= 1 AND NOT false, 'yes', 'else')", 'yes'],
  ['ifelse(isNull(null), 3, 1 / 0)', 3], ['ifelse(null, 1, 2)', 2], ['coalesce(null, null, 5)', 5], ['coalesce(null, null)', null],
  ['nullIf(3, 3)', null], ['nullIf(3, null)', 3], ['isNull(null)', 1], ['isNull(0)', 0], ['isNotNull(0)', 1],
  ['1 / 0', null], ['null = null', null], ['false AND null', 0], ['true OR null', 1],
  ["parseDate('2024-02-29')", '2024-02-29T00:00:00.000Z'], ["parseDate('2023-02-29')", null], ["parseDate('nonsense')", null],
  ["parseDate('31/01/2024 13:04:05', 'dd/MM/yyyy HH:mm:ss')", '2024-01-31T13:04:05.000Z'],
  ["parseDate('Feb 29, 2024', 'MMM dd, yyyy')", '2024-02-29T00:00:00.000Z'],
  ["addDateTime(1, 'MM', parseDate('2024-01-31'))", '2024-02-29T00:00:00.000Z'],
  ["addDateTime(-1, 'YYYY', parseDate('2024-02-29'))", '2023-02-28T00:00:00.000Z'],
  ["dateDiff(parseDate('2023-12-31'), parseDate('2024-01-01'), 'YYYY')", 1],
  ["dateDiff(parseDate('2024-02-28'), parseDate('2024-03-01'))", 2],
  ["dateDiff(parseDate('2024-01-06'), parseDate('2024-01-07'), 'WK')", 1],
  ["truncDate('Q', parseDate('2024-05-23'))", '2024-04-01T00:00:00.000Z'],
  ["truncDate('WK', parseDate('2024-01-10'))", '2024-01-07T00:00:00.000Z'],
  ["extract('WD', parseDate('2024-01-07'))", 1], ["extract('MM', parseDate('2024-02-29'))", 2],
  ["formatDate(parseDate('2024-02-29'), 'MMM dd, yyyy')", 'Feb 29, 2024'],
  ["formatDate(parseDate('2024-02-29'))", '2024-02-29T00:00:00.000Z'],
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
      assert.deepEqual(result && typeof result === 'object' && 'micros' in result ? new Date(Number(result.micros / 1000n)).toISOString() : result instanceof Date ? result.toISOString() : typeof result === 'boolean' || typeof result === 'bigint' || e.scalarType === 'number' && result !== null ? Number(result) : result, expected, `${dialect}: ${source}`);
    }
  }
});

test('now captures one UTC instant for both SQL dialects and the client', () => { const e = parseExpression('now()', '$.expression', { now: '2024-02-29T12:00:00.000Z' }); assert.equal(evaluateExpression(e), '2024-02-29T12:00:00.000Z'); assert.match(expressionSql(e), /TIMESTAMP/); });
