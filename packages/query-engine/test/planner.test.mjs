import assert from 'node:assert/strict';
import test from 'node:test';
import { planVisual, QueryEngineError } from '@opensight/query-engine';
import { calculation, deferredExpressions, dimension, expected, measure, request, selectedScope, semantics, wells } from './helpers.mjs';

for (const oracle of expected) {
  test(`planner SQL shape agrees with expected-queries: ${oracle.visualId}`, () => {
    const r = request(oracle.visualId);
    const before = structuredClone(r);
    const p = planVisual(r);
    assert.deepEqual(r, before, 'planning must not alter preserved input');
    assert.equal(p.dialect, 'duckdb');
    assert.deepEqual(p.parameters, ['East']);
    assert.match(p.sql, /WHERE "region" = \$1/);
    assert.doesNotMatch(p.sql, /'East'/);
    const sums = [...oracle.sql.matchAll(/SUM\(/g)].length;
    assert.equal([...p.sql.matchAll(/SUM\(/g)].length, sums);
    assert.equal(/GROUP BY/.test(p.sql), /GROUP BY/.test(oracle.sql));
    assert.equal(/ORDER BY/.test(p.sql), /ORDER BY/.test(oracle.sql));
    assert.ok(p.sql.indexOf('WHERE') < p.sql.indexOf('SUM('));
    assert.deepEqual([...p.dimensions, ...p.measures].map((f) => f.outputName), Object.keys(oracle.rows[0]));
    if (oracle.visualId === 'revenue-trend') {
      assert.match(p.sql, /strftime\(date_trunc\('month', "order_date"\), '%Y-%m'\) AS "month"/);
      assert.equal(p.dimensions[0].fieldId, 'order_date');
    }
    if (oracle.visualId === 'sales-table') {
      assert.match(p.sql, /AS "discounted_revenue" FROM "sales"/);
      assert.match(p.sql, /SUM\("discounted_revenue"\)/);
      assert.deepEqual(p.calculations[0].expression.dependencies, ['revenue']);
    } else assert.equal(p.calculations.length, 0);
  });
}

for (const scenario of semantics) {
  test(`semantic planner contract: ${scenario.id}`, () => {
    if (scenario.status.startsWith('deferred-')) {
      assert.ok(deferredExpressions[scenario.id], 'historical semantic cases remain covered');
      for (const expression of deferredExpressions[scenario.id]) {
        const r = request(scenario.id === 'missing-period' ? 'revenue-trend' : undefined);
        calculation(r, expression);
        assert.doesNotThrow(() => planVisual(r));
      }
    } else {
      assert.equal(scenario.id, 'all-null-aggregation');
      const p = planVisual(request());
      assert.match(p.sql, /SELECT SUM\("revenue"\) AS "revenue"/);
      assert.doesNotMatch(p.sql, /COALESCE|IFNULL|GROUP BY/);
    }
  });
}

test('multiple dimensions and measures define one explicit grain', () => {
  const r = request('sales-table');
  wells(r).GroupBy = [dimension('region'), dimension('category')];
  wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map((a) => measure('revenue', a, a.toLowerCase()));
  const p = planVisual(r);
  assert.match(p.sql, /GROUP BY 1, 2\nORDER BY 1 ASC NULLS FIRST, 2 ASC NULLS FIRST$/);
  assert.match(p.sql, /COUNT\("revenue"\) AS "count"/);
  assert.equal(p.dimensions.length, 2);
  assert.deepEqual(p.measures.map((m) => m.aggregation), ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);
});

test('row expressions bind forward dependencies topologically with types and locations', () => {
  const r = request();
  calculation(r, '({later} - 2) * 3 + 1', 'first');
  r.analysis.Definition.CalculatedFields.push({ Name: 'later', DataSetIdentifier: 'sales_data', Expression: '{revenue} * 0.9' });
  const p = planVisual(r);
  assert.deepEqual(p.calculations.map((c) => c.name), ['later', 'first']);
  const node = p.calculations[1].expression;
  assert.equal(node.level, 'row');
  assert.equal(node.scalarType, 'number');
  assert.equal(node.nullable, true);
  assert.deepEqual(node.dependencies, ['later']);
  assert.equal(node.location.path, '$.analysis.Definition.CalculatedFields[1].Expression');
  assert.equal(node.location.start, 0);
  assert.equal(node.location.end, '({later} - 2) * 3 + 1'.length);
  assert.equal(node.operator, '+');
  assert.equal(node.left.operator, '*');
  assert.match(p.sql, /FROM "__opensight_row_0"/);
});

test('reachable calculations alone determine execution capability', () => {
  const r = request();
  r.analysis.Definition.CalculatedFields[0].Expression = 'unsupportedFunction({revenue})';
  assert.equal(planVisual(r).calculations.length, 0);
  wells(r).Values = [measure('discounted_revenue')];
  assert.throws(() => planVisual(r), { code: 'UNSUPPORTED_FEATURE' });
});

test('applicable filter dependencies are bound even when absent from field wells', () => {
  const r = request();
  r.analysis.Definition.CalculatedFields.push({ Name: 'region_alias', DataSetIdentifier: 'sales_data', Expression: '{region}' });
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Column.ColumnName = 'region_alias';
  const p = planVisual(r);
  assert.equal(p.calculations[0].expression.scalarType, 'string');
  assert.match(p.sql, /WHERE "region_alias" = \$1/);
});

test('resolved selected-visual scopes permit independent visuals', () => {
  const r = request();
  const group = r.analysis.Definition.FilterGroups[0];
  group.ScopeConfiguration = selectedScope(['sales-table']);
  group.Filters = [{ TopBottomFilter: {} }];
  assert.equal(planVisual(r).filters.length, 0);
  r.visualId = 'sales-table';
  assert.throws(() => planVisual(r), { code: 'UNSUPPORTED_FEATURE' });
});

test('disabled filters do not change totals', () => {
  const r = request();
  r.analysis.Definition.FilterGroups[0].Status = 'DISABLED';
  assert.equal(planVisual(r).filters.length, 0);
  assert.doesNotMatch(planVisual(r).sql, /WHERE/);
});

test('SQL literals are parameters and identifiers are escaped', () => {
  const r = request();
  const value = "East' OR TRUE --";
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = [value];
  wells(r).Values = [measure('revenue', 'SUM', 'sum"; DROP TABLE sales; --')];
  const p = planVisual(r);
  assert.deepEqual(p.parameters, [value]);
  assert.ok(!p.sql.includes(value));
  assert.match(p.sql, /AS "sum""; DROP TABLE sales; --"/);
});

test('physical names cannot shadow internal CTEs', () => {
  const r = request();
  r.dataSet.DataSet.PhysicalTableMap.sales.RelationalTable.Name = '__opensight_filtered';
  const p = planVisual(r);
  assert.match(p.sql, /"__opensight__filtered" AS/);
});
