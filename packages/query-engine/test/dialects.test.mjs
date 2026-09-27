import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planVisual } from '@opensight/query-engine';
import { calculation, dimension, measure, request, wells } from './helpers.mjs';

// Captured from the unchanged DuckDB planner before adding dialect support.
const duckdbSql = JSON.parse(readFileSync(new URL('./fixtures/duckdb-sql.json', import.meta.url), 'utf8'));
for (const [visualId, sql] of Object.entries(duckdbSql)) {
  test(`DuckDB SQL is byte-identical with default and explicit dialect: ${visualId}`, () => {
    const implicit = planVisual(request(visualId));
    const explicit = planVisual(request(visualId), { dialect: 'duckdb' });
    assert.equal(implicit.sql, sql);
    assert.deepEqual(explicit, implicit);
    assert.equal(implicit.dialect, 'duckdb');
    assert.deepEqual(implicit.parameters, ['East']);
    assert.equal(Object.hasOwn(implicit, 'tableSchema'), false);
  });
}

const postgresSql = {
  'revenue-by-region': `WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = $1)
SELECT "region" AS "region", SUM("revenue") AS "revenue"
FROM "__opensight_filtered"
GROUP BY 1
ORDER BY 1 ASC NULLS FIRST`,
  'revenue-trend': `WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = $1)
SELECT to_char(date_trunc('month', "order_date"), 'YYYY-MM') AS "month", SUM("revenue") AS "revenue"
FROM "__opensight_filtered"
GROUP BY 1
ORDER BY 1 ASC NULLS FIRST`,
  'sales-table': `WITH "__opensight_row_0" AS (SELECT *, (CAST("revenue" AS DOUBLE PRECISION) * CAST(CAST(0.9 AS DOUBLE PRECISION) AS DOUBLE PRECISION)) AS "discounted_revenue" FROM "public"."sales"),
"__opensight_filtered" AS (SELECT * FROM "__opensight_row_0" WHERE "region" = $1)
SELECT "region" AS "region", SUM("revenue") AS "revenue", SUM("discounted_revenue") AS "discounted_revenue"
FROM "__opensight_filtered"
GROUP BY 1
ORDER BY 1 ASC NULLS FIRST`,
  'total-revenue': `WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = $1)
SELECT SUM("revenue") AS "revenue"
FROM "__opensight_filtered"`,
  'share-by-category': `WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = $1)
SELECT "category" AS "category", SUM("revenue") AS "revenue"
FROM "__opensight_filtered"
GROUP BY 1
ORDER BY 1 ASC NULLS FIRST`,
};
for (const [visualId, sql] of Object.entries(postgresSql)) {
  test(`exact Postgres SQL: ${visualId}`, () => {
    const r = request(visualId);
    const before = structuredClone(r);
    const p = planVisual(r, { dialect: 'postgres' });
    assert.equal(p.sql, sql);
    assert.equal(p.dialect, 'postgres');
    assert.equal(p.tableSchema, 'public');
    assert.deepEqual(p.parameters, ['East']);
    assert.deepEqual(r, before);
  });
}

for (const dialect of ['duckdb', 'postgres']) {
  test(`exact ${dialect} SQL: multiple dimensions and all five aggregations without filters`, () => {
    const r = request('sales-table');
    r.analysis.Definition.FilterGroups = [];
    wells(r).GroupBy = [dimension('region'), dimension('category')];
    wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => measure('revenue', a, a.toLowerCase()));
    const p = planVisual(r, { dialect });
    const from = dialect === 'postgres' ? '"public"."sales"' : '"sales"';
    assert.equal(p.sql, `SELECT "region" AS "region", "category" AS "category", SUM("revenue") AS "sum", AVG("revenue") AS "avg", COUNT("revenue") AS "count", MIN("revenue") AS "min", MAX("revenue") AS "max"
FROM ${from}
GROUP BY 1, 2
ORDER BY 1 ASC NULLS FIRST, 2 ASC NULLS FIRST`);
    assert.deepEqual(p.parameters, []);
  });

  test(`exact ${dialect} SQL: intersecting filters bind values in order`, () => {
    const r = request();
    const first = r.analysis.Definition.FilterGroups[0];
    first.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ["East' OR TRUE --"];
    const second = structuredClone(first);
    second.FilterGroupId = 'software';
    second.Filters[0].CategoryFilter.Column.ColumnName = 'category';
    second.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['Software'];
    r.analysis.Definition.FilterGroups.push(second);
    const p = planVisual(r, { dialect });
    const from = dialect === 'postgres' ? '"public"."sales"' : '"sales"';
    assert.equal(p.sql, `WITH "__opensight_filtered" AS (SELECT * FROM ${from} WHERE "region" = $1 AND "category" = $2)
SELECT SUM("revenue") AS "revenue"
FROM "__opensight_filtered"`);
    assert.deepEqual(p.parameters, ["East' OR TRUE --", 'Software']);
  });
}

test('Postgres quotes schema, table, column and output identifiers separately', () => {
  const r = request('revenue-by-region');
  const table = r.dataSet.DataSet.PhysicalTableMap.sales.RelationalTable;
  table.Schema = 'Reporting"Schema';
  table.Name = 'Sales.Table"';
  table.InputColumns.find(c => c.Name === 'revenue').Name = 'Revenue"';
  r.dataSet.DataSet.OutputColumns.find(c => c.Name === 'revenue').Name = 'Revenue"';
  wells(r).Values = [measure('Revenue"', 'SUM', 'sum"; DROP TABLE sales; --')];
  assert.equal(planVisual(r, { dialect: 'postgres' }).sql, `WITH "__opensight_filtered" AS (SELECT * FROM "Reporting""Schema"."Sales.Table""" WHERE "region" = $1)
SELECT "region" AS "region", SUM("Revenue""") AS "sum""; DROP TABLE sales; --"
FROM "__opensight_filtered"
GROUP BY 1
ORDER BY 1 ASC NULLS FIRST`);
});

test('Postgres casts recursive arithmetic and numeric literals with its numeric type', () => {
  const r = request();
  r.analysis.Definition.FilterGroups = [];
  calculation(r, '({revenue} - 2) + 1');
  assert.equal(planVisual(r, { dialect: 'postgres' }).sql, `WITH "__opensight_row_0" AS (SELECT *, (CAST((CAST("revenue" AS DOUBLE PRECISION) - CAST(CAST(2 AS DOUBLE PRECISION) AS DOUBLE PRECISION)) AS DOUBLE PRECISION) + CAST(CAST(1 AS DOUBLE PRECISION) AS DOUBLE PRECISION)) AS "calculated" FROM "public"."sales")
SELECT SUM("calculated") AS "calculated"
FROM "__opensight_row_0"`);
});

test('unknown or malformed dialect options fail closed', () => {
  for (const dialect of ['sqlite', '', null, 1]) {
    assert.throws(() => planVisual(request(), { dialect }), { code: 'UNSUPPORTED_FEATURE', path: '$.options.dialect' });
  }
  assert.throws(() => planVisual(request(), null), { code: 'INVALID_INPUT', path: '$.options' });
  assert.throws(() => planVisual(request(), { future: true }), { code: 'UNSUPPORTED_FEATURE', path: '$.options.future' });
});

for (const dialect of ['duckdb', 'postgres']) {
  test(`${dialect} multi-value category filters bind every value in order, including empty selections`, () => {
    const r = request();
    const group = r.analysis.Definition.FilterGroups[0];
    group.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['East', "West' OR TRUE --"];
    const second = structuredClone(group); second.FilterGroupId = 'second';
    second.Filters[0].CategoryFilter.Column.ColumnName = 'category';
    second.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['Hardware'];
    r.analysis.Definition.FilterGroups.push(second);
    const plan = planVisual(r, { dialect });
    assert.match(plan.sql, /"region" IN \(\$1, \$2\) AND "category" = \$3/);
    assert.deepEqual(plan.parameters, ['East', "West' OR TRUE --", 'Hardware']);
    assert.doesNotMatch(plan.sql, /East|West|TRUE/);
    group.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = [];
    const none = planVisual(r, { dialect });
    assert.match(none.sql, /WHERE FALSE AND "category" = \$1/);
    assert.deepEqual(none.parameters, ['Hardware']);
  });
}
