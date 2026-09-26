import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DuckDBInstance, version } from '@duckdb/node-api';
import { expected, fixtureRoot, semantics } from './helpers.mjs';

const lock = JSON.parse(readFileSync(new URL('../duckdb-lock.json', import.meta.url), 'utf8'));
const packages = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8')).packages;
async function database(t) {
  const instance = await DuckDBInstance.create(':memory:', {
    threads: '1', autoload_known_extensions: 'false', autoinstall_known_extensions: 'false',
  });
  const connection = await instance.connect();
  t.after(() => { connection.closeSync(); instance.closeSync(); });
  await connection.run(`CREATE TABLE sales AS SELECT * FROM read_csv($1, header = true, auto_detect = false,
    columns = {order_id: 'INTEGER', order_date: 'VARCHAR', region: 'VARCHAR', category: 'VARCHAR', revenue: 'DOUBLE', profit: 'DOUBLE'})`,
  [join(fixtureRoot, 'sales.csv')]);
  return connection;
}

test('pinned Node API, native DuckDB identity and loaded extensions match the lock manifest', async t => {
  const c = await database(t);
  assert.equal(packages['node_modules/@duckdb/node-api'].version, lock.nodeApi);
  assert.equal(packages['node_modules/@duckdb/node-bindings'].version, lock.nodeBindings);
  assert.equal(packages[`node_modules/${lock.nativePackage}`].integrity, lock.nativePackageIntegrity);
  assert.equal(version(), lock.native.library_version);
  assert.deepEqual((await c.runAndReadAll('PRAGMA version')).getRowObjects(), [lock.native]);
  assert.deepEqual((await c.runAndReadAll('SELECT extension_name, extension_version, install_mode FROM duckdb_extensions() WHERE loaded ORDER BY extension_name')).getRowObjects(), lock.loadedExtensions);
});

for (const oracle of [...expected, ...semantics]) {
  test(`independent DuckDB reference oracle (not feature enablement): ${oracle.visualId ?? oracle.id}`, async t => {
    const c = await database(t);
    // This SQLite date function is the sole dialect adaptation. The proposed calendar
    // join remains distinct from LAG and is never exposed by the production planner.
    const sql = oracle.id === 'missing-period'
      ? oracle.sql.replace("date(c.month, '-1 month')", "strftime(CAST(c.month AS DATE) - INTERVAL '1 month', '%Y-%m-%d')")
      : oracle.sql;
    assert.deepEqual((await c.runAndReadAll(sql)).getRowObjects(), oracle.rows);
    if (oracle.id === 'missing-period') {
      const wrong = await c.runAndReadAll(`WITH monthly AS (SELECT substr(order_date, 1, 7) || '-01' AS month,
        SUM(revenue) AS revenue FROM sales GROUP BY month) SELECT month, revenue - LAG(revenue) OVER (ORDER BY month) AS difference FROM monthly ORDER BY month`);
      assert.notDeepEqual(wrong.getRowObjects(), oracle.rows, 'LAG must not substitute for a calendar offset');
    }
    if (oracle.id === 'row-ratio-versus-aggregate-ratio') {
      assert.notEqual(oracle.rows[0].average_row_margin, oracle.rows[0].aggregate_margin);
    }
  });
}
