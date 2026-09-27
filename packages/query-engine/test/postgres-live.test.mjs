import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client } from 'pg';
import { executePostgres } from '@opensight/query-engine';
import { calculation, dimension, expected, measure, read, request, wells } from './helpers.mjs';

test('live Postgres executor', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
  const connectionString = process.env.DATABASE_URL;
  const client = new Client({ connectionString });
  // A fresh schema isolates concurrent runs and existing data. All executor calls use
  // separate connections, so a session-local temporary table would not be visible.
  const schema = `opensight_test_${randomUUID().replaceAll('-', '')}`;
  const table = `"${schema}"."sales"`;
  let created = false;
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`CREATE TABLE ${table} (
      order_id BIGINT, order_date TIMESTAMPTZ, region TEXT, category TEXT,
      revenue DOUBLE PRECISION, profit NUMERIC
    )`);
    for (const line of read('sales.csv').trimEnd().split('\n').slice(1)) {
      const values = line.split(',').map(value => value === '' ? null : value);
      values[1] += 'T00:00:00Z';
      await client.query(`INSERT INTO ${table} VALUES ($1, $2, $3, $4, $5, $6)`, values);
    }
    const boundRequest = (visualId) => {
      const r = request(visualId);
      r.dataSet.DataSet.PhysicalTableMap.sales.RelationalTable.Schema = schema;
      r.localData.csv = 'deliberately-absent.csv'; // Postgres must not open local files.
      return r;
    };
    const execute = r => executePostgres(r, { connectionString });

    for (const oracle of expected) {
      await t.test(`fixture results: ${oracle.visualId}`, async () => {
        const result = await execute(boundRequest(oracle.visualId));
        assert.equal(result.plan.dialect, 'postgres');
        assert.deepEqual(result.rows, oracle.rows);
        assert.doesNotThrow(() => JSON.stringify(result));
      });
    }
    await t.test('all five aggregations with multiple grouping keys', async () => {
      const r = boundRequest('sales-table');
      r.analysis.Definition.FilterGroups = [];
      wells(r).GroupBy = [dimension('region'), dimension('category')];
      wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => measure('revenue', a, a.toLowerCase()));
      assert.deepEqual((await execute(r)).rows, [
        { region: 'East', category: 'Hardware', sum: 200, avg: 200 / 3, count: 3, min: 0, max: 100 },
        { region: 'East', category: 'Software', sum: 300, avg: 300, count: 1, min: 300, max: 300 },
        { region: 'West', category: 'Hardware', sum: 350, avg: 175, count: 2, min: 150, max: 200 },
        { region: 'West', category: 'Software', sum: 50, avg: 50, count: 1, min: 50, max: 50 },
      ]);
    });
    await t.test('NUMERIC aggregates normalize to the same result scalars', async () => {
      const r = boundRequest();
      wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => measure('profit', a, a.toLowerCase()));
      assert.deepEqual((await execute(r)).rows, [{ sum: 65, avg: 16.25, count: 4, min: 5, max: 30 }]);
    });
    await t.test('chained row calculations and multiple filters execute before aggregation', async () => {
      const r = boundRequest();
      calculation(r, '{later} - 5', 'first');
      r.analysis.Definition.CalculatedFields.push({ Name: 'later', DataSetIdentifier: 'sales_data', Expression: '{revenue} * 0.9' });
      const second = structuredClone(r.analysis.Definition.FilterGroups[0]);
      second.FilterGroupId = 'software';
      second.Filters[0].CategoryFilter.Column.ColumnName = 'category';
      second.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['Software'];
      r.analysis.Definition.FilterGroups.push(second);
      assert.deepEqual((await execute(r)).rows, [{ first: 265 }]);
    });
    await t.test('injection values stay bound and output aliases stay quoted', async () => {
      const r = boundRequest();
      const alias = 'revenue"; DROP TABLE sales; --';
      wells(r).Values = [measure('revenue', 'SUM', alias)];
      r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ["East' OR TRUE --"];
      assert.deepEqual((await execute(r)).rows, [{ [alias]: null }]);
      r.visualId = 'revenue-by-region';
      assert.deepEqual((await execute(r)).rows, []);
    });
    await t.test('large bigint sums preserve integer precision', async () => {
      await client.query(`INSERT INTO ${table} (order_id, region) VALUES (9007199254740993, 'Large')`);
      const r = boundRequest();
      wells(r).Values = [measure('order_id')];
      r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['Large'];
      assert.deepEqual((await execute(r)).rows, [{ order_id: '9007199254740993' }]);
    });
    await t.test('all-null and empty input preserve aggregation semantics', async () => {
      await client.query(`INSERT INTO ${table} (region) VALUES ('Nulls')`);
      const r = boundRequest();
      wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => measure('revenue', a, a.toLowerCase()));
      for (const region of ['Nulls', 'Nowhere']) {
        r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = [region];
        assert.deepEqual((await execute(r)).rows, [{ sum: null, avg: null, count: 0, min: null, max: null }]);
      }
    });
    await t.test('month grouping uses UTC across offset timestamps and years', async () => {
      await client.query(`INSERT INTO ${table} (order_date, region, revenue)
        VALUES ('2025-12-31T23:30:00-02:00', 'East', 10)`);
      assert.deepEqual((await execute(boundRequest('revenue-trend'))).rows, [
        ...expected.find(q => q.visualId === 'revenue-trend').rows, { month: '2026-01', revenue: 10 },
      ]);
    });
    await t.test('a database error becomes a located execution error', async () => {
      const r = boundRequest();
      r.dataSet.DataSet.PhysicalTableMap.sales.RelationalTable.Name = 'missing';
      await assert.rejects(execute(r), { code: 'EXECUTION_ERROR', path: '$.postgres' });
    });
  } finally {
    try {
      if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  }
});
