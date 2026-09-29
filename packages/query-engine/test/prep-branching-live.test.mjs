import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { DuckDBInstance } from '@duckdb/node-api';
import { compilePrep } from '../dist/index.js';

test('branched prep executes identically in DuckDB and live Postgres', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  const db = await DuckDBInstance.create(':memory:', { threads: '1' }), duck = await db.connect();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.end(); });
  await pg.connect(); await pg.query("SET TIME ZONE 'UTC'");
  // Temporary tables isolate the test from all persistent/local data.
  const setup = "CREATE TEMP TABLE branch_sales (region VARCHAR, amount DOUBLE PRECISION); INSERT INTO branch_sales VALUES ('East', 2), ('East', 5), ('West', 3), (NULL, 7);";
  await pg.query(setup); await duck.run(setup);
  const columns = [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }];
  const pipeline = { version: 1, input: 'sales', output: 'detail', steps: [
    { id: 'clean', kind: 'filter', config: { filters: [{ columnName: 'amount', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 0 }] } },
    { id: 'detail', kind: 'filter', config: { filters: [{ columnName: 'region', value: 'East' }] } },
    { id: 'total', from: 'clean', kind: 'aggregate', config: { groupBy: ['region'], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } },
    { id: 'chain', from: 'total', kind: 'filter', config: { filters: [{ columnName: 'total', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 4 }] } },
    { id: 'joined', from: 'detail', kind: 'join', config: { source: { step: 'chain' }, joinType: 'left', keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'total', name: 'region_total' }] } },
  ] };
  const sort = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const run = async (p, options = {}) => {
    const results = [];
    for (const dialect of ['duckdb', 'postgres']) {
      const source = { id: 'sales', table: 'branch_sales', columns, security: 'unrestricted', connectorId: dialect === 'postgres' ? 'postgresql' : 'file' };
      const plan = compilePrep(p, [source], { dialect, ...options });
      const rows = dialect === 'postgres' ? (await pg.query(plan.sql, plan.parameters)).rows : (await duck.runAndReadAll(plan.sql, plan.parameters)).getRowObjects();
      results.push(sort(rows));
    }
    assert.deepEqual(results[0], results[1]); return results[0];
  };
  const detail = [{ region: 'East', amount: 2 }, { region: 'East', amount: 5 }];
  assert.deepEqual(await run(pipeline), detail);
  assert.deepEqual(await run(pipeline, { through: 'joined' }), detail.map(r => ({ ...r, region_total: 7 })));
  assert.deepEqual(await run(pipeline, { through: 'chain' }), sort([{ region: 'East', total: 7 }, { region: null, total: 7 }]));
  assert.equal((await run(pipeline, { through: null })).length, 4);
  assert.equal((await run(pipeline, { through: 'total' })).length, 3);
  const implicit = structuredClone(pipeline); delete implicit.output;
  assert.deepEqual(await run(implicit), detail.map(r => ({ ...r, region_total: 7 })));
  assert.deepEqual(await run({ version: 1, input: { dataset: 'branched' }, steps: [] }, { datasets: [{ id: 'branched', pipeline }] }), detail);
});
