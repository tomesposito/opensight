import assert from 'node:assert/strict';
import test from 'node:test';
import { planPreparedVisual, planVisual, QueryEngineError } from '@opensight/query-engine';
import { body, calculation, deferredExpressions, dimension, expected, measure, request, selectedScope, semantics, wells } from './helpers.mjs';

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

test('issue #257: a validated forecast line chart plans the same time series', () => {
  const baseline = planVisual(request('revenue-trend'));
  const r = request('revenue-trend');
  body(r).ChartConfiguration.ForecastConfigurations = [{ PeriodsForward: 3, PeriodsBackward: 1, PredictionInterval: 90, Seasonality: 'CUSTOM', CustomSeasonalityValue: 12, LowerBoundary: 0, UpperBoundary: 1000 }];
  const p = planVisual(r);
  assert.equal(p.sql, baseline.sql);
  assert.deepEqual(p.parameters, baseline.parameters);
  assert.deepEqual(p.dimensions.map(d => d.outputName), ['month']);
  // The hosted/prepared path (planPreparedVisual) accepts the same definition
  // (the fixture's region filter is dropped: the prepared table has no region).
  const columns = [{ name: 'order_date', type: 'DATETIME' }, { name: 'revenue', type: 'DECIMAL' }];
  const preparedAnalysis = structuredClone(r.analysis);
  preparedAnalysis.Definition.FilterGroups = [];
  const prepared = planPreparedVisual(columns, preparedAnalysis, 'revenue-trend', r.localData.dataSetArn);
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(prepared.measures.map(m => m.outputName), ['revenue']);
});

test('issue #257: area line charts and empty forecast arrays plan', () => {
  const r = request('revenue-trend');
  body(r).ChartConfiguration.Type = 'AREA';
  body(r).ChartConfiguration.ForecastConfigurations = [];
  assert.doesNotThrow(() => planVisual(r));
  body(r).ChartConfiguration.Type = 'STACKED_AREA';
  body(r).ChartConfiguration.ForecastConfigurations = [{ Seasonality: 'NONE' }];
  assert.doesNotThrow(() => planVisual(r));
});

test('issue #257: malformed forecast configurations fail closed', () => {
  const cases = [
    [{ PeriodsForward: -1 }, 'INVALID_INPUT'], [{ PeriodsForward: 101 }, 'INVALID_INPUT'],
    [{ PeriodsBackward: 1.5 }, 'INVALID_INPUT'], [{ PredictionInterval: 99 }, 'INVALID_INPUT'],
    [{ Seasonality: 'WEEKLY' }, 'INVALID_INPUT'], [{ Seasonality: 'CUSTOM' }, 'INVALID_INPUT'],
    [{ Seasonality: 'CUSTOM', CustomSeasonalityValue: 1 }, 'INVALID_INPUT'],
    [{ LowerBoundary: 10, UpperBoundary: 5 }, 'INVALID_INPUT'], [{ UpperBoundary: Infinity }, 'INVALID_INPUT'],
    [{ Unknown: true }, 'UNSUPPORTED_FEATURE'],
  ];
  for (const [patch, code] of cases) {
    const r = request('revenue-trend');
    body(r).ChartConfiguration.ForecastConfigurations = [patch];
    assert.throws(() => planVisual(r), { code }, JSON.stringify(patch));
  }
  const notArray = request('revenue-trend');
  body(notArray).ChartConfiguration.ForecastConfigurations = { PeriodsForward: 3 };
  assert.throws(() => planVisual(notArray), { code: 'INVALID_INPUT' });
  const badType = request('revenue-trend');
  body(badType).ChartConfiguration.Type = 'PIE';
  assert.throws(() => planVisual(badType), { code: 'UNSUPPORTED_FEATURE' });
});

test('issue #257: forecast stays line-only and requires a date dimension', () => {
  const bar = request('revenue-by-region');
  body(bar).ChartConfiguration.ForecastConfigurations = [{ PeriodsForward: 3 }];
  assert.throws(() => planVisual(bar), { code: 'UNSUPPORTED_FEATURE' });
  const categorical = request('revenue-trend');
  wells(categorical).Category = [dimension('region')];
  body(categorical).ChartConfiguration.ForecastConfigurations = [{ PeriodsForward: 3 }];
  assert.throws(() => planVisual(categorical), { code: 'UNSUPPORTED_FEATURE' });
});

const insightDateField = (fieldId = 'order_date', columnName = 'order_date', grain = 'MONTH') => ({ DateDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, ...(grain ? { DateGranularity: grain } : {}) } });
const insightCatField = (fieldId = 'region', columnName = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName } } });
const insightValueField = (fieldId = 'revenue', columnName = 'revenue', aggregation = 'SUM') => ({ NumericalMeasureField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, AggregationFunction: { SimpleNumericalAggregation: aggregation } } });
const anomalyComputation = (patch = {}) => ({ Anomaly: { ComputationId: 'anomaly', Time: insightDateField(), Value: insightValueField(), ...patch } });

test('anomaly planning binds a date dimension and SUM measure on local and prepared paths', () => {
  for (const AnomalyDetection of [undefined, {}, { Direction: 'HIGHER', MinSensitivityPercentage: 0 }, { Direction: 'LOWER', MinSensitivityPercentage: 100 }, { Direction: 'BOTH', MinSensitivityPercentage: 2.5 }]) {
    const r = insightRequest([anomalyComputation({ Name: 'Revenue anomalies', ...(AnomalyDetection === undefined ? {} : { AnomalyDetection }) })]);
    const before = structuredClone(r), p = planVisual(r);
    assert.equal(p.sql, planVisual(request('revenue-trend')).sql);
    assert.deepEqual(p.dimensions.map(d => [d.columnName, d.outputName, d.granularity]), [['order_date', 'month', 'MONTH']]);
    assert.deepEqual(p.measures.map(m => [m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'SUM']]);
    const analysis = structuredClone(r.analysis); analysis.Definition.FilterGroups = [];
    const prepared = planPreparedVisual([{ name: 'order_date', type: 'DATETIME' }, { name: 'revenue', type: 'DECIMAL' }], analysis, 'insight-1', r.localData.dataSetArn);
    assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['month']);
    assert.deepEqual(prepared.measures.map(m => m.aggregation), ['SUM']);
    assert.deepEqual(r, before);
  }
  const mixed = planVisual(insightRequest([anomalyComputation(),
    { Forecast: { ComputationId: 'fc', Time: insightDateField(), Value: insightValueField() } },
    { PeriodToDate: { ComputationId: 'ptd', Time: insightDateField(), Value: insightValueField() } },
  ]));
  assert.equal(mixed.dimensions.length, 1); assert.equal(mixed.measures.length, 1);
});

test('anomaly planning rejects malformed detection config and unresolved or unsupported bindings', () => {
  for (const AnomalyDetection of [null, [], 1, 'invalid',
    ...['UP', 'higher', null, 1].map(Direction => ({ Direction })),
    ...[-1, 101, Infinity, -Infinity, NaN, null, '5'].map(MinSensitivityPercentage => ({ MinSensitivityPercentage })),
  ]) assert.throws(() => planVisual(insightRequest([anomalyComputation({ AnomalyDetection })])), { code: 'INVALID_INPUT' });
  for (const [patch, code] of [
    [{ ComputationId: 'bad id' }, 'INVALID_INPUT'], [{ Name: 1 }, 'INVALID_INPUT'],
    [{ Future: true }, 'UNSUPPORTED_FEATURE'], [{ AnomalyDetection: { Future: true } }, 'UNSUPPORTED_FEATURE'],
    [{ AnomalyDetection: { direction: 'HIGHER' } }, 'UNSUPPORTED_FEATURE'],
    [{ Time: insightCatField() }, 'UNSUPPORTED_FEATURE'],
    [{ Value: insightValueField('revenue', 'revenue', 'AVG') }, 'UNSUPPORTED_FEATURE'],
    [{ Value: insightValueField('missing', 'missing') }, 'UNRESOLVED_BINDING'],
  ]) assert.throws(() => planVisual(insightRequest([anomalyComputation(patch)])), { code });
  assert.throws(() => planVisual(insightRequest([anomalyComputation(), anomalyComputation()])), { code: 'INVALID_INPUT' });
  assert.throws(() => planVisual(insightRequest([anomalyComputation(), anomalyComputation({ ComputationId: 'other', Value: insightValueField('revenue', 'profit') })])), { code: 'UNRESOLVED_BINDING' });
  assert.throws(() => planVisual(insightRequest([anomalyComputation(), { TopBottomMovers: { ComputationId: 'm', Type: 'TOP', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }])), { code: 'UNSUPPORTED_FEATURE' });
  const custom = insightRequest([anomalyComputation()]);
  custom.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.CustomNarrative = { Narrative: '${anomaly.result}' };
  assert.throws(() => planVisual(custom), { code: 'UNSUPPORTED_FEATURE' });
});
function insightRequest(computations, visualId = 'insight-1') {
  const r = request('revenue-trend');
  r.analysis.Definition.Sheets[0].Visuals = [{ InsightVisual: { VisualId: visualId, InsightConfiguration: { Computations: computations } } }];
  r.visualId = visualId;
  return r;
}

test('issue #257: a forecast insight plans its bound time series', () => {
  const baseline = planVisual(request('revenue-trend'));
  const r = insightRequest([{ Forecast: { ComputationId: 'fc', Name: 'Projection', Time: insightDateField(), Value: insightValueField(), ForecastProperties: { PeriodsForward: 3, PredictionInterval: 90, Seasonality: 'CUSTOM', CustomSeasonalityValue: 12 } } }]);
  const p = planVisual(r);
  assert.equal(p.sql, baseline.sql);
  assert.deepEqual(p.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(p.measures.map(m => m.outputName), ['revenue']);
  // The hosted/prepared path accepts the same exported-style definition.
  const columns = [{ name: 'order_date', type: 'DATETIME' }, { name: 'revenue', type: 'DECIMAL' }];
  const preparedAnalysis = structuredClone(r.analysis);
  preparedAnalysis.Definition.FilterGroups = [];
  const prepared = planPreparedVisual(columns, preparedAnalysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(prepared.measures.map(m => m.outputName), ['revenue']);
});

test('issue #257: a period-to-date insight plans its bound time series', () => {
  const p = planVisual(insightRequest([{ PeriodToDate: { ComputationId: 'ptd', Time: insightDateField(), Value: insightValueField(), PeriodTimeGranularity: 'MONTH' } }]));
  assert.deepEqual(p.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(p.measures.map(m => [m.outputName, m.aggregation]), [['revenue', 'SUM']]);
});

test('issue #257: a unique-values insight plans category-only with a COUNT carrier', () => {
  const r = insightRequest([{ UniqueValues: { ComputationId: 'uv', Name: 'Regions', Category: insightCatField() } }]);
  const p = planVisual(r);
  assert.deepEqual(p.dimensions.map(d => d.outputName), ['region']);
  assert.equal(p.measures.length, 1);
  assert.equal(p.measures[0].fieldId, '__unique_count');
  assert.equal(p.measures[0].aggregation, 'COUNT');
  assert.equal(p.measures[0].columnName, 'order_id', 'carrier is the first numeric column');
  assert.match(p.sql, /COUNT\("order_id"\) AS "__unique_count"/);
  const columns = [{ name: 'region', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }];
  const preparedAnalysis = structuredClone(r.analysis);
  preparedAnalysis.Definition.FilterGroups = [];
  const prepared = planPreparedVisual(columns, preparedAnalysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['region']);
  assert.equal(prepared.measures[0].columnName, 'revenue', 'carrier follows the prepared column order');
});

test('issue #257: a top/bottom movers insight plans category then time', () => {
  const p = planVisual(insightRequest([{ TopBottomMovers: { ComputationId: 'mv', Type: 'TOP', MoverSize: 5, SortOrder: 'ABSOLUTE_DIFFERENCE', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }]));
  assert.deepEqual(p.dimensions.map(d => d.outputName), ['region', 'month']);
  assert.deepEqual(p.measures.map(m => m.outputName), ['revenue']);
});

test('issue #257: computations sharing fields dedupe to one dimension and measure', () => {
  const p = planVisual(insightRequest([
    { Forecast: { ComputationId: 'fc', Time: insightDateField(), Value: insightValueField() } },
    { PeriodToDate: { ComputationId: 'ptd', Time: insightDateField(), Value: insightValueField() } },
  ]));
  assert.equal(p.dimensions.length, 1);
  assert.equal(p.measures.length, 1);
});

test('issue #257: malformed insight configurations fail closed', () => {
  const cases = [
    [[{ Forecast: { ComputationId: 'bad id', Time: insightDateField(), Value: insightValueField() } }], 'INVALID_INPUT'],
    [[{ Forecast: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField() } }, { PeriodToDate: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField() } }], 'INVALID_INPUT'],
    [[{ Forecast: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField(), Future: true } }], 'UNSUPPORTED_FEATURE'],
    [[{ Forecast: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField(), ForecastProperties: { PeriodsForward: 101 } } }], 'INVALID_INPUT'],
    [[{ Forecast: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField(), ForecastProperties: { Seasonality: 'CUSTOM' } } }], 'INVALID_INPUT'],
    [[{ Anomaly: { ComputationId: 'a' } }], 'INVALID_INPUT'],
    [[{ TotalAggregation: { ComputationId: 'a', Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ FutureComputation: { ComputationId: 'a' } }], 'UNSUPPORTED_FEATURE'],
    [[{ TopBottomMovers: { ComputationId: 'a', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'INVALID_INPUT'],
    [[{ TopBottomMovers: { ComputationId: 'a', Type: 'TOP', MoverSize: 21, Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'INVALID_INPUT'],
    [[{ TopBottomMovers: { ComputationId: 'a', Type: 'TOP', SortOrder: 'RANK', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'INVALID_INPUT'],
    [[{ TopBottomMovers: { ComputationId: 'a', Type: 'BOTTOM', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }, { UniqueValues: { ComputationId: 'u', Category: insightCatField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ Forecast: { ComputationId: 'a', Time: insightCatField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ Forecast: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField('revenue', 'revenue', 'AVG') } }], 'UNSUPPORTED_FEATURE'],
    [[{ PeriodToDate: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField(), PeriodTimeGranularity: 'WEEK' } }], 'INVALID_INPUT'],
    [[{ UniqueValues: { ComputationId: 'a', Category: insightCatField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ UniqueValues: { ComputationId: 'u', Category: insightCatField() } }, { Forecast: { ComputationId: 'f' } }], 'UNSUPPORTED_FEATURE'],
    [[], 'INVALID_INPUT'],
  ];
  for (const [computations, code] of cases) {
    assert.throws(() => planVisual(insightRequest(computations)), { code }, JSON.stringify(computations).slice(0, 120));
  }
  const bare = insightRequest([{ UniqueValues: { ComputationId: 'u', Category: insightCatField() } }]);
  delete bare.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration;
  assert.throws(() => planVisual(bare), { code: 'INVALID_INPUT' });
  const cross = insightRequest([{ UniqueValues: { ComputationId: 'u', Category: { CategoricalDimensionField: { FieldId: 'region', Column: { DataSetIdentifier: 'other', ColumnName: 'region' } } } } }]);
  assert.throws(() => planVisual(cross), { code: 'UNRESOLVED_BINDING' });
});

test('issue #257: insight planning honors protected datasets and CLS denial', () => {
  const securedInsight = () => {
    const r = insightRequest([{ Forecast: { ComputationId: 'fc', Time: insightDateField(), Value: insightValueField() } }]);
    r.analysis.Definition.FilterGroups = [];
    r.localData.security.dataset = 'protected';
    r.security = { namespaceId: 'default', userId: 'alice', users: ['alice', 'bob'].map(id => ({ id, namespaceId: 'default' })), groups: [{ id: 'east-team', namespaceId: 'default', userIds: ['alice'] }],
      policy: { namespaceId: 'default', dataSetArn: r.localData.dataSetArn, rowLevel: true, rowRules: [{ id: 'east', predicate: { column: 'region', operator: 'eq', value: 'East' }, principals: [{ type: 'group', id: 'east-team' }] }] } };
    return r;
  };
  assert.equal(planVisual(securedInsight()).securityProtected, true);
  const denied = securedInsight();
  denied.security.policy.protectedColumns = ['revenue'];
  assert.throws(() => planVisual(denied), { code: 'UNRESOLVED_BINDING' });
});

test('physical names cannot shadow internal CTEs', () => {
  const r = request();
  r.dataSet.DataSet.PhysicalTableMap.sales.RelationalTable.Name = '__opensight_filtered';
  const p = planVisual(r);
  assert.match(p.sql, /"__opensight__filtered" AS/);
});
