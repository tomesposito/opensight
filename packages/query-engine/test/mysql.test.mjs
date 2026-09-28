import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { planVisual, executeMySql, executeConnector, connectorDialect, connectors, ExpressionBinder, expressionSql, parseExpression } from '@opensight/query-engine';
import { mysqlBindings } from '../dist/mysql-sql.js';
import { request, calculation, wells, measure, dimension } from './helpers.mjs';
const config = { hostEnv: 'DB_HOST', portEnv: 'DB_PORT', databaseEnv: 'DB_NAME', userEnv: 'DB_USER', passwordEnv: 'DB_PASSWORD' };
const mysqlRequest = (id) => { const r = request(id); const s = r.dataSource.DataSource; s.Type = 'MYSQL'; s.DataSourceParameters = { MySqlParameters: s.DataSourceParameters.PostgreSqlParameters }; return r; };
test('MySQL exact grouped SELECT uses backticks, positional filters, binary collation and native null order', () => {
  const plan = planVisual(mysqlRequest('revenue-by-region'), { dialect: 'mysql' });
  assert.equal(plan.sql, 'WITH `__opensight_filtered` AS (SELECT * FROM `public`.`sales` WHERE `region` COLLATE utf8mb4_0900_bin = ?)\nSELECT `region` COLLATE utf8mb4_0900_bin AS `region`, SUM(`revenue`) AS `revenue`\nFROM `__opensight_filtered`\nGROUP BY 1\nORDER BY 1 ASC');
  assert.deepEqual(plan.parameters, ['East']);
});
for (const connector of connectors) test(`${connector.name}: query dialect either translates the fixture or rejects it`, () => {
  if (!connector.dialect) { assert.throws(() => connectorDialect(connector.id), { code: 'CONNECTOR_NOT_IMPLEMENTED' }); return; }
  const plan = planVisual(request('revenue-trend'), { dialect: connectorDialect(connector.id) });
  assert.equal(plan.dialect, connector.dialect);
  assert.match(plan.sql, connector.dialect === 'mysql' ? /DATE_FORMAT\(`order_date`, '%Y-%m'\)/ : connector.dialect === 'postgres' ? /to_char\(date_trunc/ : /strftime\(date_trunc/);
  assert.deepEqual(plan.parameters, ['East']);
});
test('MySQL escapes identifiers and never puts filter contents into SQL', () => {
  const r = mysqlRequest('revenue-by-region'), table = r.dataSet.DataSet.PhysicalTableMap.sales.RelationalTable;
  table.Name = 'Sales`$1'; table.Schema = 'DB`';
  wells(r).Values = [measure('revenue', 'SUM', 'sum`?')];
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ["East' OR TRUE --", 'West'];
  const p = planVisual(r, { dialect: 'mysql' });
  assert.match(p.sql, /`DB```\.`Sales``\$1`/); assert.match(p.sql, /AS `sum``\?`/); assert.match(p.sql, /IN \(\?, \?\)/);
  assert.deepEqual(p.parameters, ["East' OR TRUE --", 'West']); assert.doesNotMatch(p.sql, /East|West/);
});
test('MySQL expands repeated expression bindings in occurrence order and ignores quoted tokens', () => {
  assert.deepEqual(mysqlBindings("SELECT `$1`, '$2', $2, $1, $2", ['first', 'second']), { sql: "SELECT `$1`, '$2', ?, ?, ?", parameters: ['second', 'first', 'second'] });
  const r = mysqlRequest(); calculation(r, "ifelse(strlen('East') > 2, 1, 0)");
  const p = planVisual(r, { dialect: 'mysql' }); assert.equal(p.sql.match(/\?/g).length, p.parameters.length); assert.deepEqual(p.parameters, ['East', 'East']);
});
test('MySQL translates the scalar function families and fails closed for unavailable functions', () => {
  const binder = new ExpressionBinder('sales_data', [{ name: 'region', scalarType: 'string', type: 'STRING', nullable: true }, { name: 'revenue', scalarType: 'number', type: 'DECIMAL', nullable: true }, { name: 'day', scalarType: 'datetime', type: 'DATETIME', nullable: true }], []);
  const cases = [
    ["strlen(concat({region}, 'x'))", /CHAR_LENGTH\(CONCAT/],
    ['decimalToInt({revenue})', /TRUNCATE/], ['round({revenue}, 2)', /SIGN.*FLOOR/],
    ["formatDate({day}, 'yyyy-MM-dd')", /CONCAT\(DATE_FORMAT/],
    ["addDateTime(1, 'MM', {day})", /TIMESTAMPADD\(MONTH/],
    ["truncDate('WK', {day})", /DAYOFWEEK/],
    ["dateDiff({day}, now(), 'DD')", /TIMESTAMPDIFF/],
    ["extract('MS', {day})", /MICROSECOND/],
    ["locate({region}, 'a', 2)", /LOCATE/], ['distinct_count({region})', /COUNT\(DISTINCT/],
  ];
  for (const [expression, pattern] of cases) assert.match(expressionSql(parseExpression(expression, '$.test', { bind: (name, path) => binder.bind(name, path) }), 'mysql'), pattern);
  for (const expression of ["parseDate('2024-01-01')", "parseDecimal('2')", "parseInt('2')", 'median({revenue})', 'percentile({revenue}, 50)']) assert.throws(() => expressionSql(parseExpression(expression, '$.test', { bind: (name, path) => binder.bind(name, path) }), 'mysql'), { code: 'UNSUPPORTED_FEATURE' });
});
test('MySQL table calculations use shared post-processing and source projections', () => {
  const r = mysqlRequest('revenue-by-region'); calculation(r, 'percentOfTotal(sum({revenue}))');
  const p = planVisual(r, { dialect: 'mysql' }); assert.equal(p.postProcess, true); assert.match(p.sql, /DATE_FORMAT/); assert.doesNotMatch(p.sql, /STRFTIME|TO_CHAR/);
});
test('MySQL config, missing environment, policy bypass and unimplemented connectors reject before sockets', async () => {
  const env = { DB_HOST: 'remote.invalid', DB_PORT: '3306', DB_NAME: 'public', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic' };
  await assert.rejects(executeMySql(mysqlRequest(), { config, environment: {} }), { code: 'CONNECTOR_NOT_CONFIGURED' });
  for (const port of ['0', '65536', '12x']) await assert.rejects(executeMySql(mysqlRequest(), { config, environment: { ...env, DB_PORT: port } }), { code: 'INVALID_CONNECTOR_CONFIG' });
  await assert.rejects(executeMySql(mysqlRequest(), { config, environment: env, allowInsecureLoopback: true }), { code: 'INVALID_CONNECTOR_CONFIG' });
  const r = mysqlRequest(); r.localData.security.dataset = 'protected';
  await assert.rejects(executeMySql(r, { config, environment: env }), { code: 'SECURITY_REJECTED' });
  await assert.rejects(executeConnector('mariadb', config, mysqlRequest(), env), { code: 'CONNECTOR_NOT_IMPLEMENTED' });
});
test('MySQL TCP connection failure is bounded, sanitized, and closes sockets without a live server', async t => {
  let accepted = 0;
  const server = createServer(socket => { accepted++; socket.destroy(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const env = { DB_HOST: '127.0.0.1', DB_PORT: String(server.address().port), DB_NAME: 'public', DB_USER: 'synthetic', DB_PASSWORD: 'do-not-echo-test-secret' };
  await assert.rejects(executeMySql(mysqlRequest(), { config, environment: env, allowInsecureLoopback: true }), error => error.code === 'EXECUTION_ERROR' && error.path === '$.mysql' && !error.message.includes(env.DB_PASSWORD));
  assert.equal(accepted, 1);
});
