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
import { parseDraft, serializeVisual, kpiTrendSortValid } from '../build/test/authoring.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { KpiTrendSortOptions } from '../build/test/PropertiesSections.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
const kpiDraft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' });
const trendDraft = (field = 'region') => authorReducer(kpiDraft(), { type: 'assign', well: 'trend', field });
const draftSort = (fieldId = 'region', direction = 'DESC') => ({ fieldId, direction });
const sortedDraft = () => authorReducer(trendDraft(), { type: 'kpi-trend-sort', sort: draftSort() });
test('KPI trend authoring validates edits/storage and preserves the last valid state', () => {
  const d = sortedDraft(); assert.deepEqual(parseDraft(JSON.stringify(d)), d);
  for (const sort of [null, [], {}, { ...draftSort(), extra: 1 }, { fieldId: ' ', direction: 'ASC' }, { fieldId: 'region\0', direction: 'ASC' }, { fieldId: 'region', direction: 'DOWN' }, draftSort('missing'), draftSort('revenue')]) {
    assert.deepEqual(selected(authorReducer(d, { type: 'kpi-trend-sort', sort })), selected(d));
    const bad = structuredClone(d); selected(bad).kpiTrendSort = sort; assert.throws(() => parseDraft(JSON.stringify(bad)));
  }
  assert.equal(kpiTrendSortValid({ fieldId: ' ', direction: 'ASC' }), false);
  for (const field of ['revenue', 'order_id', 'missing']) assert.deepEqual(selected(authorReducer(d, { type: 'assign', well: 'trend', field })), selected(d));
  const actionSort = draftSort(); const copied = authorReducer(trendDraft(), { type: 'kpi-trend-sort', sort: actionSort }); actionSort.direction = 'ASC';
  assert.equal(selected(copied).kpiTrendSort.direction, 'DESC');
  assert.equal(selected(authorReducer(kpiDraft(), { type: 'kpi-trend-sort', sort: draftSort() })).kpiTrendSort, undefined);
});
test('removing/replacing trend field and switching kind clear sorts; unrelated edits preserve them', () => {
  const d = sortedDraft();
  for (const action of [{ type: 'unassign', well: 'trend', field: 'region' }, { type: 'unassign', field: 'region' }, { type: 'assign', well: 'trend', field: 'order_date' }, { type: 'kind', kind: 'bar' }]) assert.equal(selected(authorReducer(d, action)).kpiTrendSort, undefined);
  for (const action of [{ type: 'title', title: 'Trend' }, { type: 'assign', well: 'values', field: 'profit' }]) assert.deepEqual(selected(authorReducer(d, action)).kpiTrendSort, draftSort());
  for (const kind of ['bar', 'pie', 'table', 'pivot', 'line', 'gauge']) {
    const other = authorReducer(emptyDraft(), { type: 'add', kind });
    assert.equal(selected(authorReducer(other, { type: 'assign', well: 'trend', field: 'region' })).trendField, undefined);
    assert.equal(selected(authorReducer(other, { type: 'kpi-trend-sort', sort: draftSort() })).kpiTrendSort, undefined);
    selected(other).kpiTrendSort = draftSort(); assert.throws(() => parseDraft(JSON.stringify(other)));
  }
});
test('authored KPIs emit only trend wells/sorts, preview real grouped values and clear back to the original definition', () => {
  const base = kpiDraft(), d = sortedDraft();
  const c = config({ definition: serializeVisual(selected(d)) });
  assert.deepEqual(Object.keys(c).sort(), ['fieldWells', 'sortConfiguration']);
  assert.deepEqual(Object.keys(c.fieldWells).sort(), ['trendGroups', 'values']);
  assert.deepEqual(c.sortConfiguration, { trendGroupSort: [{ fieldSort: draftSort() }] });
  const preview = compileVisual(buildAuthorPreview(selected(d)));
  assert.equal(preview.state, 'ready'); assert.ok(preview.table.rows.length > 1); assert.ok(preview.option.series);
  const datePreview = compileVisual(buildAuthorPreview(selected(trendDraft('order_date'))));
  assert.ok(datePreview.table.rows.length > 1); assert.equal(datePreview.model.trendDimension.dateGranularity, 'MONTH');
  const cleared = authorReducer(d, { type: 'unassign', well: 'trend', field: 'region' });
  assert.deepEqual(serializeVisual(selected(cleared)), serializeVisual(selected(base)));
  assert.equal(config({ definition: serializeVisual(selected(authorReducer(d, { type: 'kpi-trend-sort', sort: undefined }))) }).sortConfiguration, undefined);
});
test('KPI authoring UI offers one Trend group well with date/categorical fields', () => {
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: trendDraft(), dispatch() {} }));
  assert.match(html, /Assign Trend group/); assert.match(html, /TREND GROUP/);
  const select = /<select[^>]*aria-label="Assign Trend group"[\s\S]*?<\/select>/.exec(html)[0];
  assert.match(select, /order_date/); assert.match(select, /region/); assert.doesNotMatch(select, /order_id|revenue/);
});
test('Trend sort Properties offer ASC default, DESC, reset and disappear when the trend is removed', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() { [current, dispatch] = useReducer(authorReducer, trendDraft()); return createElement(KpiTrendSortOptions, { visual: selected(current), dispatch }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const control = label => renderer.root.findByProps({ 'aria-label': label });
  assert.equal(control('Trend sort ascending').props['aria-pressed'], true);
  await act(() => control('Trend sort descending').props.onClick()); assert.deepEqual(selected(current).kpiTrendSort, draftSort());
  await act(() => control('Trend sort ascending').props.onClick()); assert.deepEqual(selected(current).kpiTrendSort, draftSort('region', 'ASC'));
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'Reset trend sort').props.onClick()); assert.equal(selected(current).kpiTrendSort, undefined);
  await act(() => dispatch({ type: 'unassign', well: 'trend', field: 'region' })); assert.equal(renderer.toJSON(), null);
});
