import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';

const dimension = (name = 'period', date = false) => ({ [date ? 'dateDimensionField' : 'categoricalDimensionField']: {
  fieldId: name, column: { dataSetIdentifier: 'data', columnName: name }, ...(date ? { dateGranularity: 'MONTH' } : {}),
} });
const input = (trend = true) => ({ source: 'bundle', path: '$', bindings: {}, rows: [{ period: 'B', revenue: 10 }], definition: {
  kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: {
    values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'data', columnName: 'revenue' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
    ...(trend ? { trendGroups: [dimension()] } : {}),
  } } },
} });
const config = v => v.definition.kpiVisual.chartConfiguration;
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (v, source) => source === 'api' ? { ...v, source, definition: projectDefinition(definition(v.definition)).Sheets[0].Visuals[0] } : v;
const normalize = v => normalizeVisual(v.source, v.definition, v.path);
for (const source of ['bundle', 'api']) {
  test(`${source}: KPI accepts one categorical or date trend dimension`, () => {
    for (const date of [false, true]) {
      const v = input(); config(v).fieldWells.trendGroups = [dimension('period', date)];
      assert.deepEqual(normalize(dialect(v, source)).trendDimension, { id: 'period', column: 'period', dataSet: 'data', ...(date ? { dateGranularity: 'MONTH' } : {}) });
      assert.deepEqual(normalize(dialect(v, source)).dimensions, []);
    }
  });
  test(`${source}: KPI trend well rejects malformed, multiple and unsupported variants`, () => {
    for (const bad of [null, {}, [dimension(), dimension()], [{}], [config(input()).fieldWells.values[0]], [{ numericalDimensionField: Object.values(dimension())[0] }]]) {
      const v = input(); config(v).fieldWells.trendGroups = bad;
      assert.throws(() => normalize(dialect(v, source)), CompileError);
    }
    const v = input(); config(v).fieldWells.trendGroups[0].categoricalDimensionField.fieldId = 'value';
    assert.throws(() => normalize(dialect(v, source)), /duplicate field IDs/);
  });
  test(`${source}: empty trend well leaves complete trend-less output unchanged`, () => {
    const v = input(false), empty = structuredClone(v); config(empty).fieldWells.trendGroups = [];
    assert.deepEqual(compileVisual(dialect(v, source)), compileVisual(dialect(empty, source)));
    assert.equal('trendDimension' in normalize(dialect(v, source)), false);
  });
}
const sort = (direction = 'DESC') => ({ fieldSort: { fieldId: 'period', direction } });
const sorted = (v = input(), entries = [sort()]) => { config(v).sortConfiguration = { trendGroupSort: entries }; return v; };
const malformedSorts = [null, {}, [], [sort(), sort()], [null], [[]], [{}], [{ extra: true }],
  [{ aggregationSort: {} }], [{ ...sort(), aggregationSort: {} }], [{ ...sort(), extra: true }],
  ...[null, {}, [], { fieldId: 'missing' }, { fieldId: 'value' }, { fieldId: 'period', extra: true },
    ...['asc', '', null, 1].map(direction => ({ fieldId: 'period', direction }))].map(fieldSort => [{ fieldSort }])];
for (const source of ['bundle', 'api']) {
  test(`${source}: TrendGroupSort binds trend id, defaults ASC, maps both dialects`, () => {
    assert.deepEqual(normalize(dialect(sorted(), source)).trendGroupSort, { fieldId: 'period', direction: 'DESC' });
    const v = sorted(); delete config(v).sortConfiguration.trendGroupSort[0].fieldSort.direction;
    assert.deepEqual(normalize(dialect(v, source)).trendGroupSort, { fieldId: 'period', direction: 'ASC' });
    const internal = definition(sorted().definition);
    assert.deepEqual(convertDefinition(projectDefinition(internal)), internal);
  });
  test(`${source}: TrendGroupSort rejects malformed entries and unknown keys at every level`, () => {
    for (const bad of malformedSorts) assert.throws(() => normalize(dialect(sorted(input(), bad), source)), CompileError, JSON.stringify(bad));
    for (const bad of [null, [], { ...config(sorted()).sortConfiguration, unknown: true }, { categorySort: [] }]) {
      const v = input(); config(v).sortConfiguration = bad;
      assert.throws(() => normalize(dialect(v, source)), CompileError);
    }
    assert.throws(() => normalize(dialect(sorted(input(false)), source)), /bound trend dimension/);
  });
}
import { orderKpiTrend } from '../build/test/kpi-trend.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
const selected = d => activeSheet(d).visuals.find(v => v.id === activeSheet(d).selectedId);
const order = (values, direction = 'ASC', grain) => orderKpiTrend(values.map(period => ({ period })), { column: 'period', ...(grain ? { dateGranularity: grain } : {}) }, direction, (r, f) => r[f.column], message => { throw new Error(message); }).map(r => r.period);
test('trend order is typed, stable, null-last and defaults ascending', () => {
  assert.deepEqual(order([10, null, 2, 1]), [1, 2, 10, null]);
  assert.deepEqual(order([10, null, 2, 1], 'DESC'), [10, 2, 1, null]);
  assert.deepEqual(order(['b', 'a', null]), ['a', 'b', null]);
  assert.deepEqual(order([2, '2', 1]), [1, 2, '2']);
  assert.deepEqual(order(['2025-02', '2024-12', null], 'ASC', 'MONTH'), ['2024-12', '2025-02', null]);
  assert.deepEqual(order(['2025-Q4', '2024-Q2'], 'ASC', 'QUARTER'), ['2024-Q2', '2025-Q4']);
  assert.throws(() => order(['bad'], 'ASC', 'MONTH'), /invalid date/);
  assert.throws(() => order(['a', 'a']), /duplicate trend groups/);
});
test('KPI query groups by the date or category trend well', () => {
  const v = selected(authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }));
  assert.deepEqual(buildAuthorQuery(v).dimensions, []);
  assert.deepEqual(buildAuthorQuery({ ...v, trendField: 'region' }).dimensions, [{ fieldId: 'region', columnName: 'region' }]);
  assert.deepEqual(buildAuthorQuery({ ...v, trendField: 'order_date' }).dimensions, [{ fieldId: 'order_date', columnName: 'order_date', granularity: 'MONTH' }]);
});
import { kpiComparison } from '../build/test/kpi-trend.js';
test('trended KPI sums grouped SUM values, draws ordered gaps and exposes the ordered data', () => {
  const v = input(); v.rows = [{ period: 'C', revenue: 12 }, { period: null, revenue: null }, { period: 'A', revenue: 3 }, { period: 'B', revenue: null }];
  const before = structuredClone(v), result = compileVisual(v);
  assert.equal(result.option.graphic[0].style.text, '15');
  assert.deepEqual(result.option.series[0].data, [3, null, 12, null]);
  assert.equal(result.option.series[0].connectNulls, false);
  assert.deepEqual(result.table.rows, [['A', 3], ['B', null], ['C', 12], [null, null]]);
  assert.equal(result.table.dimensionCount, 1);
  assert.deepEqual(v, before);
  assert.deepEqual(compileVisual(sorted(v)).option.series[0].data, [12, null, 3, null]);
});
test('single/empty/unavailable and all-null KPI groups never invent zeros or a sparkline', () => {
  for (const [rows, label] of [[[{ period: 'A', revenue: null }], 'No value'], [[], 'No results'], [null, 'Needs data'], [[{ period: 'A', revenue: 7 }], '7']]) {
    const v = input(); v.rows = rows;
    const result = compileVisual(v);
    assert.equal(result.option.graphic[0].style.text, label);
    assert.equal(result.option.series, undefined);
  }
  const v = input(); v.rows = [{ period: 'A', revenue: null }, { period: 'B', revenue: null }];
  assert.equal(compileVisual(v).option.graphic[0].style.text, 'No value');
  v.rows = [{ period: 'A', revenue: Number.MAX_VALUE }, { period: 'B', revenue: Number.MAX_VALUE }];
  assert.throws(() => compileVisual(v), /total must be finite/);
  v.rows = [{ period: 'A', revenue: 1 }, { period: 'A', revenue: 2 }];
  assert.throws(() => compileVisual(v), /duplicate trend groups/);
  v.rows = [{ period: 'A', revenue: 1 }, { period: 'B', revenue: 2 }]; delete config(v).fieldWells.trendGroups;
  assert.throws(() => compileVisual(v), /exactly one aggregate row/);
});
test('trended KPI refuses non-SUM governed metric bindings', () => {
  for (const source of ['bundle', 'api']) for (const agg of ['AVG', 'MIN', 'MAX', 'COUNT', 'DISTINCT_COUNT']) {
    const v = input(), measure = config(v).fieldWells.values[0].numericalMeasureField;
    measure.column.columnName = '__metric_average'; measure.aggregationFunction.simpleNumericalAggregation = agg;
    assert.throws(() => normalize(dialect(v, source)), /trended KPI requires an explicit SUM/);
    delete config(v).fieldWells.trendGroups;
    assert.doesNotThrow(() => normalize(dialect(v, source)));
  }
});
test('KPI comparison uses the last two groups, including null and zero edge cases', () => {
  assert.equal(kpiComparison([100, 10, 15], 'DIFFERENCE'), 5);
  assert.equal(kpiComparison([100, 10, 15], 'PERCENT_DIFFERENCE'), 50);
  assert.equal(kpiComparison([0, 15], 'PERCENT_DIFFERENCE'), null);
  assert.equal(kpiComparison([0, 15], 'DIFFERENCE'), 15);
  for (const values of [[], [1], [null, 1], [1, null]]) assert.equal(kpiComparison(values, 'DIFFERENCE'), null);
});
for (const source of ['bundle', 'api']) {
  test(`${source}: minimal KPI options render area, hidden sparkline and configured comparisons`, () => {
    const v = input(); v.rows = [{ period: 'B', revenue: 15 }, { period: 'A', revenue: 10 }];
    config(v).kpiOptions = { sparkline: { type: 'AREA', visibility: 'VISIBLE' }, comparison: { comparisonMethod: 'PERCENT_DIFFERENCE' }, primaryValueDisplayType: 'ACTUAL', progressBar: { visibility: 'VISIBLE' }, trendArrows: { visibility: 'VISIBLE' } };
    let c = compileVisual(dialect(v, source));
    assert.equal(c.option.graphic[0].style.text, '25'); assert.equal(c.option.graphic[1].style.text, '50%');
    assert.ok(c.option.series[0].areaStyle); assert.ok(c.model.warnings.some(w => w.includes('targetValues')));
    assert.deepEqual(c.model.kpiOptions, config(v).kpiOptions);
    config(v).kpiOptions.primaryValueDisplayType = 'COMPARISON';
    assert.equal(compileVisual(dialect(v, source)).option.graphic[0].style.text, '50%');
    config(v).kpiOptions.comparison.comparisonMethod = 'DIFFERENCE';
    config(v).kpiOptions.sparkline.visibility = 'HIDDEN';
    c = compileVisual(dialect(v, source));
    assert.equal(c.option.graphic[0].style.text, '5'); assert.equal(c.option.series, undefined);
    config(v).sortConfiguration = { trendGroupSort: [sort('DESC')] };
    assert.equal(compileVisual(dialect(v, source)).option.graphic[0].style.text, '-5');
  });
  test(`${source}: unavailable comparisons fall back to ACTUAL with a warning`, () => {
    const v = input(); config(v).kpiOptions = { primaryValueDisplayType: 'COMPARISON', comparison: { comparisonMethod: 'PERCENT_DIFFERENCE' } };
    for (const rows of [[{ period: 'A', revenue: 10 }], [{ period: 'A', revenue: 0 }, { period: 'B', revenue: 10 }], [{ period: 'A', revenue: null }, { period: 'B', revenue: 10 }]]) {
      v.rows = rows; const c = compileVisual(dialect(v, source));
      assert.equal(c.option.graphic[0].style.text, '10');
      assert.ok(c.model.warnings.some(w => w.includes('falling back to ACTUAL')));
    }
  });
  test(`${source}: KPI options reject malformed shapes, enums and unknown keys`, () => {
    const invalid = [null, [], { unknown: true }, { primaryValueDisplayType: 'OTHER' },
      ...['sparkline', 'comparison', 'progressBar', 'trendArrows'].flatMap(key => [null, [], { extra: 1 }].map(value => ({ [key]: value }))),
      { sparkline: { type: 'BAR' } }, { sparkline: { visibility: 'yes' } }, { comparison: {} }, { comparison: { comparisonMethod: 'PERCENT' } },
      { progressBar: { visibility: null } }, { trendArrows: { visibility: 'yes' } }];
    for (const options of invalid) { const v = input(); config(v).kpiOptions = options; assert.throws(() => normalize(dialect(v, source)), CompileError, JSON.stringify(options)); }
    const v = input(); config(v).fieldWells.targetValues = config(v).fieldWells.values;
    assert.throws(() => normalize(dialect(v, source)), /field well not supported/);
  });
}
