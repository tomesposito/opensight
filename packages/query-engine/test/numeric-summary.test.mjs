import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { aggregateValue, relativeDifference, formatNumber, shiftDate } from '../dist/browser.js';
test('narrative shared math agrees with DuckDB and PostgreSQL over nulls and signed values', async t => {
  const instance = await DuckDBInstance.create(':memory:', { threads: '1' });
  const duck = await instance.connect(), pg = new PGlite();
  t.after(async () => { duck.closeSync(); instance.closeSync(); await pg.close(); });
  for (const values of [[null, 5.5, -2], [null, null], [0, 0], [-150, 100]]) {
    const sql = `SELECT SUM(v) AS total FROM (VALUES ${values.map(v => `(${v === null ? 'NULL' : v}::DOUBLE PRECISION)`).join(',')}) t(v)`;
    const reader = await duck.runAndReadAll(sql), actual = reader.getRowObjects()[0].total;
    const expected = aggregateValue('sum', values);
    assert.equal(actual, expected); assert.equal((await pg.query(sql)).rows[0].total, expected);
  }
  for (const [current, previous] of [[150, 100], [-50, -100], [1, 0], [null, 5]]) for (const abs of [true, false]) {
    const sql = `SELECT (${current ?? 'NULL'}::DOUBLE PRECISION - ${previous}::DOUBLE PRECISION) / NULLIF(${abs ? `ABS(${previous}::DOUBLE PRECISION)` : `${previous}::DOUBLE PRECISION`}, 0) AS ratio`;
    const expected = relativeDifference(current, previous, abs);
    assert.equal((await duck.runAndReadAll(sql)).getRowObjects()[0].ratio, expected);
    assert.equal((await pg.query(sql)).rows[0].ratio, expected);
  }
  assert.equal(formatNumber(1234.5, 2), '1,234.50');
  assert.equal(shiftDate('2024-03-31', -1, 'MM'), '2024-02-29T00:00:00.000Z');
});
