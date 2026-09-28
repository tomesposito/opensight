import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { executeLocal, planVisual } from '@opensight/query-engine';
import { evaluatePlan, interactiveRequest } from '@opensight/query-engine/browser';
import { interpretQuestion } from '@opensight/q-interpreter';
import { dataFields } from '../build/test/authoring.js';
import { prepareQVisual } from '../build/test/q-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import sales from '../src/sales.generated.json' with { type: 'json' };

test('Q queries agree across DuckDB, PostgreSQL and browser evaluation', async t => {
  // Use the existing embedded PostgreSQL test dependency; no server or network.
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE sales (order_id BIGINT, order_date TIMESTAMP, region TEXT, category TEXT, revenue DOUBLE PRECISION, profit DOUBLE PRECISION)');
  for (const r of sales.rows) await pg.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)', [r.order_id, r.order_date, r.region, r.category, r.revenue, r.profit]);
  for (const q of ['average revenue by region', 'count rows', 'count revenue', 'min profit by region', 'max revenue per month', 'sum revenue by region in 2025 top 1', 'sum revenue by region where profit is 20', 'count rows by region and category top 3']) {
    await t.test(q, async () => {
      const prepared = prepareQVisual(interpretQuestion(q, dataFields()).interpretations[0]);
      const request = interactiveRequest(buildAuthorQuery(prepared.visual, prepared.calculatedFields), sales.metadata);
      const duck = await executeLocal(request, { dataRoot: fileURLToPath(new URL('../../../fixtures/renderable-sales/', import.meta.url)) });
      const postgres = planVisual(request, { dialect: 'postgres' });
      const raw = (await pg.query(postgres.sql, [...postgres.parameters])).rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v !== null && (postgres.sourceColumns.find(c => c.name === k)?.scalarType === 'number' || postgres.measures.some(m => m.outputName === k)) ? Number(v) : v])));
      assert.deepEqual(postgres.postProcess ? evaluatePlan(postgres, raw) : raw, duck.rows);
      assert.deepEqual(evaluatePlan(duck.plan, sales.rows), duck.rows);
    });
  }
});
