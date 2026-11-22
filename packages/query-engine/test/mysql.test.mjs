import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, Socket } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection } from 'mysql2';
import { mysqlHarness } from './mysql-harness.mjs';
import { mysqlSessionSql } from '../dist/mysql-session.js';
import { planVisual, executeMySql, executeConnector, connectorDialect, connectors, ExpressionBinder, expressionSql, parseExpression } from '@opensight/query-engine';
import { mysqlBindings } from '../dist/mysql-sql.js';
import { request, calculation, wells, measure, dimension } from './helpers.mjs';
const config = { hostEnv: 'DB_HOST', portEnv: 'DB_PORT', databaseEnv: 'DB_NAME', userEnv: 'DB_USER', passwordEnv: 'DB_PASSWORD' };
const environment = { DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'public', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic-password' };
const options = { config, environment, allowInsecureLoopback: true };
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
  assert.match(plan.sql, connector.dialect === 'athena' ? /date_format\(date_trunc/ : connector.dialect === 'mysql' ? /DATE_FORMAT\(`order_date`, '%Y-%m'\)/ : ['postgres', 'redshift'].includes(connector.dialect) ? /to_char\(date_trunc/i : /strftime\(date_trunc/);
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
  await assert.rejects(executeConnector('mariadb', config, mysqlRequest(), {}), { code: 'CONNECTOR_NOT_CONFIGURED' });
});
test('MySQL TCP connection failure is bounded, sanitized, and closes sockets without a live server', async t => {
  let accepted = 0;
  const server = createServer(socket => { accepted++; socket.destroy(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const env = { DB_HOST: '127.0.0.1', DB_PORT: String(server.address().port), DB_NAME: 'public', DB_USER: 'synthetic', DB_PASSWORD: 'do-not-echo-test-secret' };
  await assert.rejects(executeMySql(mysqlRequest(), { config, environment: env, allowInsecureLoopback: true }), error => error.code === 'EXECUTION_ERROR' && error.path === '$.mysql' && !error.message.includes(env.DB_PASSWORD));
  await assert.rejects(executeConnector('mariadb', config, mysqlRequest(), env), error => error.code === 'EXECUTION_ERROR' && !error.message.includes(env.DB_PASSWORD));
  assert.equal(accepted, 2);
});

test('MySQL and MariaDB expose query implementations and variant sessions', async () => {
  const { mysqlSessionSql, mysqlVariantSql } = await import('../dist/mysql-session.js');
  for (const id of ['mysql', 'mariadb']) assert.equal(connectors.find(c => c.id === id).implementation, 'query');
  assert.match(mysqlSessionSql('mysql'), /utf8mb4_0900_bin.*max_execution_time = 10000/);
  assert.match(mysqlSessionSql('mariadb'), /utf8mb4_bin.*max_statement_time = 10/);
  assert.equal(mysqlVariantSql("`COLLATE utf8mb4_0900_bin` COLLATE utf8mb4_0900_bin = 'COLLATE utf8mb4_0900_bin'", 'mariadb'), "`COLLATE utf8mb4_0900_bin` COLLATE utf8mb4_bin = 'COLLATE utf8mb4_0900_bin'");
});

for (const connectorId of ['mysql', 'mariadb']) {
  for (const [name, limits, rows] of [
    ['rows', { maxRows: 1 }, [['East', '1'], ['West', '2']]],
    ['cell bytes (UTF-8)', { maxCellBytes: 3 }, [['😀', '1']]],
    ['raw numeric cell bytes before conversion', { maxCellBytes: 4 }, [['East', '00001']]],
    ['cumulative bytes', { maxBytes: 9 }, [['East', '1'], ['West', '2']]],
    ['default cell cap', {}, [['x'.repeat(16 * 1024 + 1), '1']]],
  ]) test(`${connectorId} rejects ${name} before query completion and closes without partial results`, { timeout: 3000 }, async t => {
    const harness = await mysqlHarness(t, { holdOpen: true, evaluate: () => ({ fields: [{ name: 'region', type: 253 }, { name: 'revenue', type: 246 }], rows }) });
    await assert.rejects(executeMySql(mysqlRequest('revenue-by-region'), { ...options, connectorId, ...limits, environment: { ...environment, DB_PORT: String(harness.port) } }), error => {
      assert.equal(error.code, 'EXECUTION_ERROR'); assert.equal(error.path, '$.mysql'); assert.match(error.message, /limit exceeded/);
      assert.equal('rows' in error, false);
      for (const secret of ['synthetic-password', '127.0.0.1', 'East', 'West']) assert.equal(String(error).includes(secret), false);
      return true;
    });
    for (let i = 0; i < 50 && harness.sockets.size; i++) await delay(5);
    assert.equal(harness.sockets.size, 0); assert.deepEqual(harness.errors, []);
  });

  test(`${connectorId} streams at exact limits with prepared binding and exact session SQL`, async t => {
    let query;
    const execute = Connection.prototype.execute;
    t.mock.method(Connection.prototype, 'execute', function (...args) { query = execute.apply(this, args); return query; });
    const odd = "East'\\ OR 1=1 -- ? ☃", r = mysqlRequest('revenue-by-region');
    r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = [odd];
    wells(r).Values = [measure('revenue', 'SUM', 'sum`?')];
    const harness = await mysqlHarness(t, { evaluate(sql, values) {
      assert.deepEqual(values, [odd]); assert.equal(sql.includes(odd), false); assert.match(sql, /AS `sum``\?`/);
      assert.match(sql, connectorId === 'mysql' ? /COLLATE utf8mb4_0900_bin = \?/ : /COLLATE utf8mb4_bin = \?/);
      return { fields: [{ name: 'region', type: 253 }, { name: 'sum`?', type: 246 }], rows: [['😀', '0001'], [null, '0002']] };
    } });
    const result = await executeMySql(r, { ...options, connectorId, maxRows: 2, maxCellBytes: 4, maxBytes: 12, environment: { ...environment, DB_PORT: String(harness.port) } });
    assert.deepEqual(result.rows, [{ region: '😀', 'sum`?': 1 }, { region: null, 'sum`?': 2 }]);
    assert.deepEqual(result.provenance, { source: 'live' }); assert.deepEqual(harness.sessions, [mysqlSessionSql(connectorId)]);
    assert.equal(query.onResult, undefined); assert.deepEqual(query._rows, [[]]); assert.deepEqual(harness.errors, []);
  });
}

test('MySQL limit options reject invalid or raised caps before any socket', async t => {
  const connect = t.mock.method(Socket.prototype, 'connect', () => { throw new Error('must not connect'); });
  for (const [key, cap] of Object.entries({ maxRows: 100_000, maxBytes: 64 * 1024 * 1024, maxCellBytes: 16 * 1024 })) {
    for (const invalid of [0, -1, 1.5, cap + 1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
      await assert.rejects(executeMySql(mysqlRequest(), { ...options, [key]: invalid }), { code: 'INVALID_INPUT', path: `$.options.${key}` });
    }
  }
  assert.equal(connect.mock.callCount(), 0);
});

test('MySQL streaming preserves unsafe integers, decimal, numeric, date and NULL conversion', async t => {
  const fields = [{ name: 'big', type: 8 }, { name: 'decimal', type: 246 }, { name: 'integer', type: 3 }, { name: 'float', type: 5 }, { name: 'day', type: 12 }, { name: 'nil', type: 253 }];
  const harness = await mysqlHarness(t, { evaluate: () => ({ fields, rows: [['9007199254740993', '1.50', 42, 2.5, '2026-01-02T03:04:05.123Z', null]] }) });
  const result = await executeMySql(mysqlRequest(), { ...options, environment: { ...environment, DB_PORT: String(harness.port) } });
  assert.deepEqual(result.rows, [{ big: '9007199254740993', decimal: 1.5, integer: 42, float: 2.5, day: '2026-01-02 03:04:05.123000', nil: null }]);
  assert.deepEqual(harness.errors, []);
});

for (const mode of ['error', 'prepare-error', 'drop', 'nonfinite']) test(`MySQL streaming failure is sanitized and closes: ${mode}`, async t => {
  const harness = await mysqlHarness(t, { evaluate: () => ({ fields: [{ name: 'result', type: 5 }], rows: [[NaN]] }) }); harness.mode = mode;
  await assert.rejects(executeMySql(mysqlRequest(), { ...options, environment: { ...environment, DB_PORT: String(harness.port) } }), error => {
    assert.equal(error.code, 'EXECUTION_ERROR');
    for (const secret of ['synthetic-password', '127.0.0.1', 'private-host']) assert.equal(String(error).includes(secret), false);
    return true;
  });
  for (let i = 0; i < 50 && harness.sockets.size; i++) await delay(5);
  assert.equal(harness.sockets.size, 0); assert.deepEqual(harness.errors, []);
});

test('MySQL 10-second streaming deadline tears down a stalled query', async t => {
  const schedule = globalThis.setTimeout, durations = [];
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => { durations.push(ms); return schedule(fn, ms === 10000 ? 250 : ms, ...args); });
  const harness = await mysqlHarness(t, { evaluate: () => { throw new Error('unexpected evaluation'); } }); harness.mode = 'stall';
  await assert.rejects(executeMySql(mysqlRequest(), { ...options, environment: { ...environment, DB_PORT: String(harness.port) } }), { code: 'EXECUTION_ERROR', message: '$.mysql: MySQL connection or query failed' });
  assert.equal(durations.filter(ms => ms === 10000).length, 1);
  for (let i = 0; i < 50 && harness.sockets.size; i++) await delay(5);
  assert.equal(harness.sockets.size, 0); assert.deepEqual(harness.errors, []);
});

test('MySQL post-processing uses all bounded source rows and rejects overflow instead of partial aggregates', async t => {
  const r = mysqlRequest('revenue-by-region'); calculation(r, 'percentOfTotal(sum({revenue}))'); r.analysis.Definition.FilterGroups = [];
  const harness = await mysqlHarness(t, { evaluate(sql) {
    assert.doesNotMatch(sql, /\bLIMIT\b/i);
    return { fields: [{ name: 'region', type: 253 }, { name: 'revenue', type: 246 }], rows: [['East', '1'], ['West', '3']] };
  } });
  const bounded = { ...options, maxRows: 2, maxBytes: 10, environment: { ...environment, DB_PORT: String(harness.port) } };
  const result = await executeMySql(r, bounded);
  assert.equal(result.plan.postProcess, true);
  assert.deepEqual(result.rows, [{ region: 'East', calculated: 0.25 }, { region: 'West', calculated: 0.75 }]);
  await assert.rejects(executeMySql(r, { ...bounded, maxRows: 1 }), { code: 'EXECUTION_ERROR' });
  assert.deepEqual(harness.errors, []);
});
