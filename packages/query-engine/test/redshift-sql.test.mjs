import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual, ExpressionBinder, expressionSql, parseExpression } from '@opensight/query-engine';
import { redshiftType, redshiftResultValue, redshiftGranularity } from '../dist/redshift-sql.js';
import { quoteIdentifier } from '../dist/validation.js';
import { request, calculation } from './helpers.mjs';
const binder = new ExpressionBinder('sales_data', [{ name: 'region', scalarType: 'string', type: 'STRING', nullable: true }, { name: 'revenue', scalarType: 'number', type: 'DECIMAL', nullable: true }, { name: 'day', scalarType: 'datetime', type: 'DATETIME', nullable: true }], []);
const sql = expression => expressionSql(parseExpression(expression, '$.test', { bind: (name, path) => binder.bind(name, path) }), 'redshift');

test('Redshift identifiers, bound values and explicit NULLS FIRST grouped SQL', () => {
  for (const name of ['x'.repeat(128), 'é'.repeat(64), 'bad\0name']) assert.throws(() => quoteIdentifier(name, 'redshift'), { code: 'UNSUPPORTED_FEATURE' });
  assert.equal(quoteIdentifier('Sales"$1', 'redshift'), '"Sales""$1"');
  const p = planVisual(request('revenue-by-region'), { dialect: 'redshift' });
  assert.equal(p.sql, 'WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = $1)\nSELECT "region" AS "region", SUM("revenue") AS "revenue"\nFROM "__opensight_filtered"\nGROUP BY 1\nORDER BY 1 ASC NULLS FIRST');
  assert.deepEqual(p.parameters, ['East']);
  const r = request('revenue-by-region');
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ["x' OR TRUE --"];
  assert.doesNotMatch(planVisual(r, { dialect: 'redshift' }).sql, /OR TRUE/);
});

test('Redshift date projections and all visual grains use dedicated TO_CHAR/DATE_TRUNC forms', () => {
  for (const [grain, format] of Object.entries({ YEAR: 'YYYY', QUARTER: 'YYYY-"Q"Q', MONTH: 'YYYY-MM', DAY: 'YYYY-MM-DD' })) {
    assert.equal(redshiftGranularity('"day"', grain), `TO_CHAR(DATE_TRUNC('${grain.toLowerCase()}', "day"), '${format}')`);
  }
  assert.match(planVisual(request('revenue-trend'), { dialect: 'redshift' }).sql, /TO_CHAR\(DATE_TRUNC\('month', "order_date"\), 'YYYY-MM'\)/);
  const r = request('revenue-by-region'); calculation(r, 'percentOfTotal(sum({revenue}))');
  const p = planVisual(r, { dialect: 'redshift' });
  assert.equal(p.postProcess, true);
  assert.match(p.sql, /TO_CHAR\("order_date", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'\)/);
  assert.doesNotMatch(p.sql, /STRFTIME|MAKE_TIMESTAMP|REGEXP_MATCH/);
});

const cases = [
  ["addDateTime(1, 'MM', {day})", 'DATEADD(month, CAST(TRUNC(CAST(1 AS DOUBLE PRECISION)) AS INTEGER), "day")'],
  ["truncDate('WK', {day})", 'DATEADD(day, -1, DATE_TRUNC(\'week\', DATEADD(day, 1, "day")))'],
  ["truncDate('MS', {day})", 'DATE_TRUNC(\'millisecond\', "day")'],
  ["dateDiff({day}, {day}, 'DD')", 'DATEDIFF(day, "day", "day")'],
  ["dateDiff({day}, {day}, 'WK')", '(DATEDIFF(day, DATEADD(day, -1, DATE_TRUNC(\'week\', DATEADD(day, 1, "day"))), DATEADD(day, -1, DATE_TRUNC(\'week\', DATEADD(day, 1, "day")))) / 7)'],
  ["extract('MS', {day})", 'MOD(CAST(DATE_PART(millisecond, "day") AS INTEGER), 1000)'],
  ["extract('WD', {day})", '(DATE_PART(dow, "day") + 1)'],
  ["extract('Q', {day})", 'FLOOR(DATE_PART(quarter, "day"))'],
  ["formatDate({day}, 'yyyy-MM-dd')", '(CASE WHEN "day" IS NULL THEN NULL ELSE (TO_CHAR("day", \'YYYY\') || \'-\' || TO_CHAR("day", \'MM\') || \'-\' || TO_CHAR("day", \'DD\')) END)'],
  ["formatDate({day}, 'SS ZZ')", '(CASE WHEN "day" IS NULL THEN NULL ELSE (LEFT(TO_CHAR("day", \'MS\'), 2) || \' \' || \'+00:00\') END)'],
  ['toString({day})', 'TO_CHAR("day", \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')'],
  ['strlen(upper({region}))', 'LENGTH(upper("region"))'],
  ["concat({region}, 'x')", '("region" || CAST(\'x\' AS VARCHAR(65535)))'],
  ['distinct_count({region})', 'COUNT(DISTINCT "region")'],
  ['decimalToInt({revenue})', 'TRUNC("revenue")'],
  ['round({revenue}, 2)', '(SIGN("revenue") * FLOOR(ABS("revenue") * POWER(10, CAST(TRUNC(CAST(2 AS DOUBLE PRECISION)) AS INTEGER)) + 0.5) / POWER(10, CAST(TRUNC(CAST(2 AS DOUBLE PRECISION)) AS INTEGER)))'],
];
for (const [expression, expected] of cases) test(`Redshift exact translation: ${expression}`, () => assert.equal(sql(expression), expected));
for (const expression of ["parseDate('2024-01-01')", "parseDecimal('2')", "parseInt('2')", 'median({revenue})', 'percentile({revenue}, 50)', "formatDate({day}, 'MMMM')", 'mod({revenue}, 2)', 'toString({revenue})']) test(`Redshift fails closed: ${expression}`, () => assert.throws(() => sql(expression), { code: 'UNSUPPORTED_FEATURE' }));

test('Redshift native type mapping and wire scalar conversion are explicit', () => {
  for (const [type, mapped] of Object.entries({ SMALLINT: 'INTEGER', INT8: 'INTEGER', 'numeric(20, 2)': 'DECIMAL', 'DOUBLE PRECISION': 'DECIMAL', BOOLEAN: 'BOOLEAN', 'char(4)': 'STRING', 'varchar(128)': 'STRING', DATE: 'DATETIME', TIMESTAMP: 'DATETIME', TIMESTAMPTZ: 'DATETIME', TIME: 'STRING', TIMETZ: 'STRING' })) assert.equal(redshiftType(type), mapped);
  for (const [oid, wire, result] of [[16, 't', 1], [16, 'f', 0], [20, '9007199254740993', '9007199254740993'], [1700, '-9007199254740993', '-9007199254740993'], [23, '12', 12], [701, '2.5', 2.5], [1043, '0012', '0012'], [1082, '2026-01-01', '2026-01-01'], [1083, '12:00:00', '12:00:00'], [1114, null, null]]) assert.equal(redshiftResultValue(wire, oid), result);
  for (const type of ['SUPER', 'GEOMETRY', 'GEOGRAPHY', 'HLLSKETCH', 'VARBYTE', 'JSON', 'constructor', 4000, 3000, 3001, 3615, 6551, 99999]) {
    assert.throws(() => redshiftType(type), { code: 'UNSUPPORTED_FEATURE' });
    if (typeof type === 'number') assert.throws(() => redshiftResultValue(null, type), { code: 'UNSUPPORTED_FEATURE' });
  }
  for (const [oid, value] of [[701, 'NaN'], [1700, 'Infinity'], [16, 'yes'], [23, ''], [23, 'secret']]) assert.throws(() => redshiftResultValue(value, oid), { code: 'EXECUTION_ERROR' });
});
