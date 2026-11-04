import test from 'node:test';
import assert from 'node:assert/strict';
import { executeNotebookSql } from '../dist/index.js';
const table = { source: { id: 'data', table: 'data', connectorId: 'file', security: 'unrestricted', columns: [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }] }, rowCount: 3, value: (r, c) => [['East', 1], ['East', 2], ['West', 3]][r][c] };
const run = (sql, bindings = {}, cap = 100) => executeNotebookSql(sql, ['data'], bindings, [table], cap);
test('notebook SQL: bound parameters, CTEs, joins, aggregates and cap', async () => {
  assert.deepEqual((await run('SELECT * FROM data WHERE amount > $minimum ORDER BY amount', { minimum: 1 })).rows, [{ region: 'East', amount: 2 }, { region: 'West', amount: 3 }]);
  assert.deepEqual((await run('WITH q AS (SELECT * FROM data) SELECT region, sum(amount) AS total FROM q GROUP BY region ORDER BY region')).rows, [{ region: 'East', total: 3 }, { region: 'West', total: 3 }]);
  assert.equal((await run('SELECT a.amount FROM data a JOIN data b ON a.amount=b.amount')).rowCount, 3);
  assert.equal((await run('SELECT * FROM data', {}, 2)).truncated, true);
  assert.equal((await run('SELECT * FROM data', {}, 3)).truncated, false);
  assert.deepEqual((await run('SELECT * FROM data WHERE region = $region', { region: "East' OR true --" })).rows, []);
  assert.equal((await run("SELECT '; INSERT INTO data VALUES(1)' AS text")).rowCount, 1);
  assert.equal((await run('SELECT * FROM data; -- trailing comment')).rowCount, 3);
});
for (const [sql, code] of [
  ['SELECT 1; SELECT 2', 'NOTEBOOK_SQL_SINGLE_STATEMENT_REQUIRED'],
  ['INSERT INTO data VALUES (1)', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['UPDATE data SET amount=2', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['DELETE FROM data', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['CREATE TABLE x(i INTEGER)', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['DROP TABLE data', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ["COPY data TO '/tmp/notebook-escape'", 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ["ATTACH '/tmp/notebook-escape' AS x", 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['INSTALL httpfs', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['LOAD httpfs', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['PRAGMA version', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['SELECT * FROM missing', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ['SELECT (SELECT count(*) FROM missing)', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ['WITH q AS (SELECT * FROM missing) SELECT * FROM q', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ['SELECT * FROM data UNION ALL SELECT * FROM missing', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ['SELECT * FROM information_schema.tables', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ['SELECT * FROM main.data', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ["SELECT * FROM read_csv('/tmp/a')", 'NOTEBOOK_SQL_TABLE_DENIED'],
  ["SELECT * FROM query('SELECT 1')", 'NOTEBOOK_SQL_TABLE_DENIED'],
  ["SELECT * FROM glob('/tmp/*')", 'NOTEBOOK_SQL_TABLE_DENIED'],
  ["SELECT getenv('HOME')", 'NOTEBOOK_SQL_FUNCTION_DENIED'],
  ["SELECT nextval('sequence')", 'NOTEBOOK_SQL_FUNCTION_DENIED'],
  ["SELECT current_setting('temp_directory')", 'NOTEBOOK_SQL_FUNCTION_DENIED'],
  ['SELECT $missing', 'NOTEBOOK_SQL_PARAMETER_UNDECLARED'],
  ['SELECT ?', 'NOTEBOOK_SQL_PARAMETER_UNDECLARED'],
  ['WITH RECURSIVE q AS (SELECT 1 UNION ALL SELECT * FROM q) SELECT * FROM q', 'NOTEBOOK_SQL_UNSUPPORTED'],
]) test(`notebook SQL safety: ${sql}`, async () => {
  await assert.rejects(() => run(sql), e => { assert.equal(e.code, code); return true; });
});
