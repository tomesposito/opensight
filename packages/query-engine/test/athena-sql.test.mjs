import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual } from '@opensight/query-engine';
import { athenaBindings } from '../dist/athena-sql.js';
import { request } from './helpers.mjs';

test('Athena plans double-quoted identifiers and ordered positional execution parameters', () => {
  const p = planVisual(request('revenue-by-region'), { dialect: 'athena' });
  assert.equal(p.sql, 'WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = ?)\nSELECT "region" AS "region", SUM("revenue") AS "revenue"\nFROM "__opensight_filtered"\nGROUP BY 1\nORDER BY 1 ASC NULLS FIRST');
  assert.equal(p.tableSchema, 'public');
  assert.deepEqual(p.parameters, ['East']);
  assert.deepEqual(athenaBindings(`SELECT "$1""$2", '$2''$1', $2, $1, $2`, ['one', 2]), {
    sql: `SELECT "$1""$2", '$2''$1', ?, ?, ?`, parameters: [2, 'one', 2],
  });
  assert.throws(() => athenaBindings('$1', []), { code: 'INVALID_INPUT' });
  assert.throws(() => athenaBindings('$1', [null]), { code: 'UNSUPPORTED_FEATURE' });
});

import { ExpressionBinder, expressionSql, parseExpression } from '@opensight/query-engine';
import { athenaType, athenaResultValue, athenaGranularity, athenaTimestamp } from '../dist/athena-sql.js';
import { datetimeSql } from '../dist/datetime.js';
import { rowFilterSql } from '../dist/row-filter.js';
import { rowSecuritySql } from '../dist/security.js';
import { calculation } from './helpers.mjs';
const columns = [{ name: 'region', scalarType: 'string', type: 'STRING', nullable: true }, { name: 'revenue', scalarType: 'number', type: 'DECIMAL', nullable: true }, { name: 'day', scalarType: 'datetime', type: 'DATETIME', nullable: true }];
const binder = new ExpressionBinder('sales_data', columns, []);
const parse = expression => parseExpression(expression, '$.test', { bind: (name, path) => binder.bind(name, path) });
const sql = expression => expressionSql(parse(expression), 'athena');
const cases = [
  ...['sum', 'avg', 'count', 'min', 'max'].map(name => [`${name}({revenue})`, `${name.toUpperCase()}("revenue")`]),
  ...Object.entries({ stdev: 'stddev_samp', stdevp: 'stddev_pop', var: 'var_samp', varp: 'var_pop' }).map(([name, form]) => [`${name}({revenue})`, `${form}("revenue")`]),
  ['distinct_count({region})', 'COUNT(DISTINCT "region")'],
  ['ifelse(isNull({revenue}), 0, {revenue})', '(CASE WHEN ("revenue" IS NULL) THEN CAST(0 AS DOUBLE) ELSE "revenue" END)'],
  ['coalesce({revenue}, 0)', 'coalesce("revenue", CAST(0 AS DOUBLE))'],
  ['nullIf({revenue}, 0)', 'nullIf("revenue", CAST(0 AS DOUBLE))'],
  ['isNull({revenue})', '("revenue" IS NULL)'], ['isNotNull({revenue})', '("revenue" IS NOT NULL)'],
  ...['abs', 'ceil', 'floor'].map(name => [`${name}({revenue})`, `${name}("revenue")`]),
  ['decimalToInt({revenue})', 'truncate("revenue")'], ['toDecimal({revenue})', 'CAST("revenue" AS DOUBLE)'],
  ["concat({region}, 'x')", '("region" || CAST(\'x\' AS VARCHAR))'],
  ['upper({region})', 'upper("region")'], ['lower({region})', 'lower("region")'], ['strlen({region})', 'length("region")'],
  ['toString({day})', '(to_iso8601(CAST("day" AS TIMESTAMP)) || \'Z\')'],
  ['{revenue} / 2', '(CAST("revenue" AS DOUBLE) / NULLIF(CAST(CAST(2 AS DOUBLE) AS DOUBLE), 0))'],
  ["extract('WD', {day})", '(mod(day_of_week("day"), 7) + 1)'],
  ["formatDate({day}, 'yyyy-MM-dd HH:mm:ss.SSS ZZ')", '(CASE WHEN "day" IS NULL THEN NULL ELSE (date_format("day", \'%Y\') || \'-\' || date_format("day", \'%m\') || \'-\' || date_format("day", \'%d\') || \' \' || date_format("day", \'%H\') || \':\' || date_format("day", \'%i\') || \':\' || date_format("day", \'%s\') || \'.\' || substr(date_format("day", \'%f\'), 1, 3) || \' \' || \'+00:00\') END)'],
  ["formatDate({day}, 'YYYY yy hh a S SS Z')", '(CASE WHEN "day" IS NULL THEN NULL ELSE (date_format("day", \'%Y\') || \' \' || date_format("day", \'%y\') || \' \' || date_format("day", \'%h\') || \' \' || date_format("day", \'%p\') || \' \' || substr(date_format("day", \'%f\'), 1, 1) || \' \' || substr(date_format("day", \'%f\'), 1, 2) || \' \' || \'+0000\') END)'],
];
for (const [expression, expected] of cases) test(`Athena exact translation: ${expression}`, () => assert.equal(sql(expression), expected));
const units = { YYYY: 'year', YY: 'year', Q: 'quarter', MM: 'month', WK: 'week', DD: 'day', D: 'day', HH: 'hour', MI: 'minute', SS: 'second', MS: 'millisecond' };
for (const [key, unit] of Object.entries(units)) test(`Athena exact date forms: ${key}`, () => {
  assert.equal(sql(`addDateTime(1, '${key}', {day})`), `date_add('${unit}', CAST(truncate(CAST(1 AS DOUBLE)) AS BIGINT), "day")`);
  const trunc = key === 'WK' ? `date_add('day', -1, date_trunc('week', date_add('day', 1, "day")))` : `date_trunc('${unit}', "day")`;
  if (key !== 'MS') assert.equal(sql(`truncDate('${key}', {day})`), trunc);
  assert.equal(sql(`dateDiff({day}, {day}, '${key}')`), `date_diff('${unit}', ${key === 'MS' ? '"day"' : trunc}, ${key === 'MS' ? '"day"' : trunc})`);
  if (key !== 'WK') assert.equal(sql(`extract('${key}', {day})`), `${unit}("day")`);
});
for (const expression of ["parseDate('2024-01-01')", "parseDecimal('2')", "parseInt('2')", 'median({revenue})', 'percentile({revenue}, 50)', "formatDate({day}, 'MMMM')", "truncDate('MS', {day})", 'mod({revenue}, 2)', 'toString({revenue})', 'round({revenue}, 2)', 'sqrt({revenue})', 'trim({region})']) test(`Athena fails closed: ${expression}`, () => assert.throws(() => sql(expression), { code: 'UNSUPPORTED_FEATURE' }));

test('Athena direct datetime entry never falls through to another dialect', () => {
  assert.throws(() => datetimeSql(parse("parseDate('2024-01-01')"), 'athena', e => expressionSql(e, 'athena')), { code: 'UNSUPPORTED_FEATURE' });
  assert.equal(datetimeSql(parse("dateDiff({day}, {day}, 'MS')"), 'athena', e => expressionSql(e, 'athena')), `date_diff('millisecond', "day", "day")`);
});

test('Athena visual grains and post-processing UTC projection are pinned', () => {
  for (const [grain, expected] of Object.entries({ YEAR: `date_format(date_trunc('year', "day"), '%Y')`, QUARTER: `(date_format(date_trunc('quarter', "day"), '%Y') || '-Q' || CAST(quarter(date_trunc('quarter', "day")) AS VARCHAR))`, MONTH: `date_format(date_trunc('month', "day"), '%Y-%m')`, DAY: `date_format(date_trunc('day', "day"), '%Y-%m-%d')` })) assert.equal(athenaGranularity('"day"', grain), expected);
  assert.equal(athenaTimestamp('"day"'), `(to_iso8601(CAST("day" AS TIMESTAMP)) || 'Z')`);
  assert.match(planVisual(request('revenue-trend'), { dialect: 'athena' }).sql, /date_format\(date_trunc\('month', "order_date"\), '%Y-%m'\)/);
  const r = request('revenue-by-region'); calculation(r, 'percentOfTotal(sum({revenue}))');
  const p = planVisual(r, { dialect: 'athena' });
  assert.equal(p.postProcess, true);
  assert.match(p.sql, /\(to_iso8601\(CAST\("order_date" AS TIMESTAMP\)\) \|\| 'Z'\)/);
  assert.doesNotMatch(p.sql, /STRFTIME|TO_CHAR|DOUBLE PRECISION|MAKE_TIMESTAMP|REGEXP_MATCH/);
});

test('Athena datetime filter, security and expression parameters share the explicit UTC cast', () => {
  const values = [], bind = value => { values.push(value); return `$${values.length}`; };
  const value = '2026-01-01T00:00:00Z', cast = n => `CAST(REPLACE(REPLACE($${n}, 'T', ' '), 'Z', '') AS TIMESTAMP)`;
  assert.equal(rowFilterSql({ columnName: 'day', scalarType: 'datetime', value }, 'athena', bind), `"day" = ${cast(1)}`);
  assert.equal(rowSecuritySql({ column: 'day', operator: 'gte', value }, columns, bind, 'athena'), `"day" >= ${cast(2)}`);
  const e = { kind: 'parameter', name: 'date', scalarType: 'datetime', value, location: { path: '$.test', start: 0, end: 0 } };
  assert.equal(expressionSql(e, 'athena', bind), cast(3));
  assert.equal(expressionSql({ ...e, kind: 'literal' }, 'athena', bind), cast(4));
  assert.deepEqual(values, [value, value, value, value]);
});

test('Athena native wire mapping preserves unsafe integers and rejects malformed/complex values', () => {
  for (const [types, mapped] of [[['tinyint', 'smallint', 'int', 'integer', 'bigint'], 'INTEGER'], [['double', 'float', 'real', 'decimal', 'decimal(20, 2)'], 'DECIMAL'], [['boolean'], 'BOOLEAN'], [['varchar', 'char', 'varchar(128)', 'char(4)'], 'STRING'], [['date', 'timestamp'], 'DATETIME']]) for (const type of types) { assert.equal(athenaType(type), mapped); assert.equal(athenaResultValue(null, type), null); }
  for (const [type, raw, expected] of [['bigint', '9007199254740993', '9007199254740993'], ['bigint', '-9007199254740993', '-9007199254740993'], ['integer', '12', 12], ['double', '2.5e2', 250], ['decimal(20,2)', '-2.5', -2.5], ['boolean', 'true', 1], ['boolean', 'false', 0], ['varchar', '0012', '0012'], ['date', '2026-01-01', '2026-01-01'], ['timestamp', '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000']]) assert.equal(athenaResultValue(raw, type), expected);
  for (const type of ['array', 'array(varchar)', 'map', 'struct', 'row', 'binary', 'varbinary', 'json', 'interval', 'timestamp with time zone', 'unknown', 'constructor']) { assert.throws(() => athenaType(type), { code: 'UNSUPPORTED_FEATURE' }); assert.throws(() => athenaResultValue(null, type), { code: 'UNSUPPORTED_FEATURE' }); }
  for (const [type, raw] of [['integer', '1.5'], ['integer', '1e2'], ['double', 'NaN'], ['double', 'Infinity'], ['double', '1e999'], ['decimal', ''], ['decimal', ' '], ['decimal', '0x12'], ['boolean', 'yes'], ['varchar', {}]]) assert.throws(() => athenaResultValue(raw, type), { code: 'EXECUTION_ERROR' });
});
