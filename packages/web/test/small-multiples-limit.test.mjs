import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, facetLimitValid, parseDraft, serializeDraft, serializeVisual, defaultMultiplesOptions } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { MultiplesOptions } from '../build/test/PropertiesSections.js';
import { FACETED_KINDS, applyFacetLimit } from '../build/test/facet-layout.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const rows = [
  { category: 'A', region: 'West', revenue: 10 },
  { category: 'A', region: 'East', revenue: 20 },
  { category: 'B', region: 'West', revenue: 30 },
  { category: 'B', region: 'East', revenue: 40 },
  { category: 'A', region: 'North', revenue: 50 },
  { category: 'C', region: 'South', revenue: 60 },
];
const input = (kind = 'pie', limit, data = rows) => {
  const spec = EXTRA_VISUALS[kind] ?? { variant: `${kind === 'pie' ? 'pie' : kind === 'line' ? 'line' : 'bar'}ChartVisual`, wells: `${kind === 'pie' ? 'pie' : kind === 'line' ? 'line' : 'bar'}ChartAggregatedFieldWells`, dimensions: ['category'], measures: ['values'] };
  const wells = { [spec.dimensions[0]]: [dim('category')], smallMultiples: [dim('region')] };
  spec.measures.forEach(key => { wells[key] = [measure('revenue')]; });
  if (kind === 'combo') wells.lineValues = [measure('profit')];
  return { source: 'bundle', path: '$.test', bindings: {}, rows: structuredClone(data), definition: {
    [spec.variant]: { visualId: kind, chartConfiguration: {
      fieldWells: { [spec.wells]: wells },
      ...(kind === 'area' ? { type: 'AREA' } : {}),
      ...(kind === 'bar100' ? { barsArrangement: 'STACKED_PERCENT' } : {}),
      ...(limit === undefined ? {} : { sortConfiguration: { smallMultiplesLimitConfiguration: limit } }),
    } },
  } };
};
const config = value => Object.values(value.definition)[0].chartConfiguration;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const draftWithFacet = (kind = 'pie') => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind }), { type: 'assign', field: kind === 'pie' ? 'region' : 'category', well: 'smallMultiples' });
const invalidLimits = [null, [], 'limit', 5, {}, { count: 1 }, { includeOther: true },
  ...[0, -1, 101, 1.5, '2', NaN, Infinity].map(count => ({ count, includeOther: true })),
  { count: 2, includeOther: 'yes' }, { count: 2, includeOther: true, extra: 1 }];

test('facet limit validator, reducer and draft storage fail closed and retain the last valid value', () => {
  for (const count of [1, 20, 100]) for (const includeOther of [true, false]) assert.ok(facetLimitValid({ count, includeOther }));
  const limit = { count: 2, includeOther: false };
  const draft = authorReducer(draftWithFacet(), { type: 'facet-limit', limit });
  limit.count = 3;
  assert.deepEqual(selected(draft).facetLimit, { count: 2, includeOther: false });
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  for (const bad of invalidLimits) {
    assert.equal(facetLimitValid(bad), false);
    assert.deepEqual(selected(authorReducer(draft, { type: 'facet-limit', limit: bad })), selected(draft));
    const tampered = structuredClone(draft);
    selected(tampered).facetLimit = bad;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  assert.equal(facetLimitValid(undefined), false);
  assert.equal(selected(authorReducer(draft, { type: 'facet-limit', limit: undefined })).facetLimit, undefined);
});

test('unassigning Small multiples drops the limit through both reducer paths', () => {
  const draft = authorReducer(draftWithFacet(), { type: 'facet-limit', limit: { count: 2, includeOther: true } });
  for (const well of ['smallMultiples', undefined]) {
    const removed = selected(authorReducer(draft, { type: 'unassign', field: 'region', well }));
    assert.deepEqual(removed.smallMultiples, []);
    assert.equal(removed.facetLimit, undefined);
  }
  assert.deepEqual(selected(authorReducer(draft, { type: 'unassign', field: 'revenue', well: 'values' })).facetLimit, selected(draft).facetLimit);
});

test('compiler accepts INCLUDE, EXCLUDE and default INCLUDE; missing count keeps the exact warning', () => {
  for (const otherCategories of ['INCLUDE', 'EXCLUDE', undefined]) {
    const model = normalizeVisual('bundle', input('pie', { itemsLimit: 2, otherCategories }).definition);
    assert.deepEqual(model.facetLimit, { count: 2, includeOther: otherCategories !== 'EXCLUDE' });
    assert.deepEqual(model.warnings, []);
  }
  const model = normalizeVisual('bundle', input('pie', { otherCategories: 'INCLUDE' }).definition, '$.test');
  assert.equal(model.facetLimit, undefined);
  assert.deepEqual(model.warnings, ['$.test.pieChartVisual.chartConfiguration.smallMultiplesLimitConfiguration: no top-N/Other bucket is computed; all supplied result rows are shown.']);
});

test('compiler rejects invalid counts, enum, keys, missing facet and unsupported kinds', () => {
  for (const itemsLimit of [0, -1, 101, 2.5, '2', null, NaN, Infinity]) {
    assert.throws(() => normalizeVisual('bundle', input('pie', { itemsLimit }).definition), /integer between 1 and 100/);
  }
  for (const limit of [{ itemsLimit: 1, otherCategories: 'ALL' }, { itemsLimit: 1, extra: true }, null, []]) {
    assert.throws(() => normalizeVisual('bundle', input('pie', limit).definition));
  }
  const missing = input('bar', { itemsLimit: 1 });
  delete config(missing).fieldWells.barChartAggregatedFieldWells.smallMultiples;
  assert.throws(() => normalizeVisual('bundle', missing.definition), /require a SmallMultiples field/);
  const unsupported = { kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: { values: [measure('revenue')] }, sortConfiguration: { smallMultiplesLimitConfiguration: { itemsLimit: 1 } } } } };
  assert.throws(() => normalizeVisual('bundle', unsupported), /unsupported property/);
  const funnel = input('funnel', { itemsLimit: 1 });
  delete config(funnel).fieldWells.funnelChartAggregatedFieldWells.smallMultiples;
  assert.throws(() => normalizeVisual('bundle', funnel.definition), /only computed for faceted visuals/);
});

test('pie panels use first appearance and summed Other categories in the chart, tooltip and view-data', () => {
  const value = input('pie', { itemsLimit: 1 });
  config(value).tooltip = { selectedTooltipType: 'DETAILED' };
  const before = structuredClone(value);
  const c = compileVisual(value);
  assert.deepEqual(value, before);
  assert.deepEqual(c.option.title.map(t => t.text), ['West', 'Other']);
  assert.deepEqual(c.option.series.map(s => s.data), [
    [{ name: 'A', value: 10 }, { name: 'B', value: 30 }],
    [{ name: 'A', value: 70 }, { name: 'B', value: 40 }, { name: 'C', value: 60 }],
  ]);
  assert.deepEqual(c.table.rows, [['A', 'West', 10], ['B', 'West', 30], ['A', 'Other', 70], ['B', 'Other', 40], ['C', 'Other', 60]]);
  const tooltip = c.option.tooltip.formatter({ seriesIndex: 1, dataIndex: 0 });
  assert.match(tooltip, /region: Other/);
  assert.match(tooltip, /revenue: 70/);
});

for (const kind of ['bar', 'line', 'area', 'combo', 'bar100']) {
  test(`${kind} applies the same panel limit before cartesian layout and tooltip mapping`, () => {
    const value = input(kind, { itemsLimit: 1 }, rows.map(row => ({ ...row, profit: row.revenue / 10 })));
    config(value).tooltip = { selectedTooltipType: 'DETAILED' };
    const c = compileVisual(value);
    const stride = kind === 'combo' ? 2 : 1;
    assert.deepEqual(c.option.title.map(t => t.text), ['West', 'Other']);
    assert.deepEqual(c.option.xAxis.map(a => a.data), [['A', 'B'], ['A', 'B', 'C']]);
    assert.deepEqual(c.option.series[stride].data, kind === 'bar100' ? [100, 100, 100] : [70, 40, 60]);
    assert.match(c.option.tooltip.formatter({ seriesIndex: stride, dataIndex: 0 }), /region: Other/);
    assert.match(c.option.tooltip.formatter({ seriesIndex: stride, dataIndex: 0 }), /revenue: 70/);
    if (kind === 'combo') assert.deepEqual(c.option.series[3].data, [7, 4, 6]);
  });
}

test('EXCLUDE drops remaining panels and their view-data rows', () => {
  for (const kind of ['pie', 'bar', 'area']) {
    const c = compileVisual(input(kind, { itemsLimit: 2, otherCategories: 'EXCLUDE' }));
    assert.deepEqual(c.option.title.map(t => t.text), ['West', 'East']);
    assert.deepEqual(c.table.rows, [['A', 'West', 10], ['B', 'West', 30], ['A', 'East', 20], ['B', 'East', 40]]);
  }
});

test('unset, missing-count and non-binding limits leave options and view-data identical', () => {
  for (const kind of ['pie', 'bar', 'area']) {
    const all = compileVisual(input(kind));
    for (const limit of [{ otherCategories: 'INCLUDE' }, { itemsLimit: 4 }, { itemsLimit: 100, otherCategories: 'EXCLUDE' }]) {
      const c = compileVisual(input(kind, limit));
      assert.deepEqual(c.option, all.option);
      assert.deepEqual(c.table, all.table);
    }
  }
  const groups = [{ value: 'A', rows: [] }];
  assert.equal(applyFacetLimit(groups, undefined, () => assert.fail()), groups);
  assert.equal(applyFacetLimit(groups, { count: 1, includeOther: true }, () => assert.fail()), groups);
});

test('layout caps run after merging all remaining facets, with their existing warnings', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ category: 'A', region: `F${i}`, revenue: 1 }));
  const c = compileVisual(input('pie', { itemsLimit: 1 }, many));
  assert.deepEqual(c.option.title.map(t => t.text), ['F0', 'Other']);
  assert.deepEqual(c.option.series[1].data, [{ name: 'A', value: 29 }]);
  assert.deepEqual(c.model.warnings, []);
  const capped = compileVisual(input('pie', { itemsLimit: 20 }, many));
  assert.equal(capped.option.title.length, 20);
  assert.match(capped.model.warnings[0], /21 small-multiple panels exceed the 20-panel limit/);
  for (const options of [{ panelCount: 1 }, { visibleRows: 1, visibleColumns: 1 }]) {
    const value = input('bar', { itemsLimit: 1 }, many);
    config(value).opensightMultiplesOptions = { ...defaultMultiplesOptions(), ...options };
    const result = compileVisual(value);
    assert.equal(result.option.title.length, 1);
    assert.match(result.model.warnings[0], /2 small-multiple panels exceed/);
  }
});

test('merge honors result bindings, null sums, tooltip extras and finite totals', () => {
  const value = input('bar', { itemsLimit: 1 }, [
    { c: 'A', f: 'West', m: 1, extra: 7 },
    { c: 'A', f: 'East', m: null, extra: 8 },
    { c: 'A', f: 'North', m: null, extra: 9 },
  ]);
  value.bindings = { category: 'c', region: 'f', revenue: 'm' };
  config(value).tooltip = { selectedTooltipType: 'DETAILED', fieldBasedTooltip: { tooltipFields: [{ fieldTooltipItem: { fieldId: 'extra' } }] } };
  const c = compileVisual(value);
  assert.deepEqual(c.option.series[1].data, [null]);
  assert.deepEqual(c.table.rows, [['A', 'West', 1], ['A', 'Other', null]]);
  assert.doesNotMatch(c.option.tooltip.formatter({ seriesIndex: 1, dataIndex: 0 }), /extra: [789]/);
  value.rows[1].m = Number.MAX_VALUE;
  value.rows[2].m = Number.MAX_VALUE;
  assert.throws(() => compileVisual(value), /Other totals must be finite/);
});

test('source duplicates cannot be concealed by INCLUDE or EXCLUDE', () => {
  for (const otherCategories of ['INCLUDE', 'EXCLUDE']) {
    assert.throws(() => compileVisual(input('pie', { itemsLimit: 1, otherCategories }, [...rows, rows[1]])), /duplicate categories/);
  }
});

test('facet limits precede slice limits, including a retained literal Other facet', () => {
  const value = input('pie', { itemsLimit: 1 }, rows.map(row => ({ ...row, region: row.region === 'West' ? 'Other' : row.region })));
  config(value).sortConfiguration.categoryItemsLimit = { itemsLimit: 1, otherCategories: 'INCLUDE' };
  const c = compileVisual(value);
  assert.deepEqual(c.option.title.map(t => t.text), ['Other', 'Other']);
  assert.deepEqual(c.option.series.map(s => s.data), [[{ name: 'A', value: 10 }, { name: 'Other', value: 30 }], [{ name: 'A', value: 70 }, { name: 'Other', value: 100 }]]);
  assert.deepEqual(c.table.rows, [['A', 'Other', 10], ['Other', 'Other', 30], ['A', 'Other', 70], ['Other', 'Other', 100]]);
});

test('authoring merges limits with sort, exports/imports editable limits for every faceted kind', () => {
  for (const kind of FACETED_KINDS) {
    let draft = authorReducer(draftWithFacet(kind), { type: 'facet-limit', limit: { count: 2, includeOther: false } });
    if (kind === 'pie') {
      draft = authorReducer(draft, { type: 'slice-limit', limit: { count: 3, includeOther: true } });
      draft = authorReducer(draft, { type: 'group-sort', sort: { fieldId: 'revenue', direction: 'DESC' } });
    }
    const resource = serializeDraft(draft);
    const body = Object.values(resource.definition.sheets[0].visuals[0])[0];
    assert.deepEqual(body.chartConfiguration.sortConfiguration.smallMultiplesLimitConfiguration, { itemsLimit: 2, otherCategories: 'EXCLUDE' });
    if (kind === 'pie') assert.deepEqual(body.chartConfiguration.sortConfiguration, {
      categorySort: [{ fieldSort: { fieldId: 'revenue', direction: 'DESC' } }],
      categoryItemsLimit: { itemsLimit: 3, otherCategories: 'INCLUDE' },
      smallMultiplesLimitConfiguration: { itemsLimit: 2, otherCategories: 'EXCLUDE' },
    });
    const bundle = exportBundle(draft);
    const imported = importBundle(bundle);
    const visual = activeSheet(imported).visuals[0];
    assert.deepEqual(visual.facetLimit, { count: 2, includeOther: false });
    assert.deepEqual(visual.smallMultiples, selected(draft).smallMultiples);
    assert.deepEqual(visual.imported.issues, []);
    assert.deepEqual(exportBundle(imported), bundle);
    const edited = authorReducer(imported, { type: 'facet-limit', limit: { count: 1, includeOther: true } });
    assert.deepEqual(activeSheet(importBundle(exportBundle(edited))).visuals[0].facetLimit, { count: 1, includeOther: true });
  }
  const bare = selected(authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'pie' }), { type: 'facet-limit', limit: { count: 1, includeOther: true } }));
  assert.equal(Object.values(serializeVisual(bare))[0].chartConfiguration.sortConfiguration, undefined);
  assert.equal(Object.values(serializeVisual({ ...bare, kind: 'kpi' }))[0].chartConfiguration.sortConfiguration, undefined);
  assert.throws(() => serializeVisual({ ...bare, kind: 'kpi', smallMultiples: ['category'] }), /SMALL_MULTIPLES_UNSUPPORTED/);
});

test('PascalCase analysis definition converts and round-trips through editable bundle state', () => {
  const column = name => ({ FieldId: name, Column: { ColumnName: name, DataSetIdentifier: 'sales_data' } });
  const definition = { DataSetIdentifierDeclarations: [{ Identifier: 'sales_data', DataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/sample' }], Sheets: [{ SheetId: 's', Name: 'Sheet', Visuals: [{ PieChartVisual: {
    VisualId: 'v', ChartConfiguration: {
      FieldWells: { PieChartAggregatedFieldWells: { Category: [{ CategoricalDimensionField: column('category') }], SmallMultiples: [{ CategoricalDimensionField: column('region') }], Values: [{ NumericalMeasureField: { ...column('revenue'), AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } }] } },
      SortConfiguration: { SmallMultiplesLimitConfiguration: { ItemsLimit: 2, OtherCategories: 'EXCLUDE' } },
    },
  } }] }] };
  const converted = convertDefinition(definition);
  const native = normalizeVisual('api', definition.Sheets[0].Visuals[0]);
  assert.deepEqual(normalizeVisual('bundle', converted.sheets[0].visuals[0]), native);
  const imported = importBundle({ members: [{ path: 'analysis/synthetic.json', resource: { resourceType: 'analysis', analysisId: 'synthetic', name: 'Synthetic', definition: converted } }] });
  assert.deepEqual(activeSheet(imported).visuals[0].facetLimit, { count: 2, includeOther: false });
  const exported = exportBundle(imported).members[0].resource.definition.sheets[0].visuals[0];
  assert.deepEqual(exported.pieChartVisual.chartConfiguration.sortConfiguration.smallMultiplesLimitConfiguration, { itemsLimit: 2, otherCategories: 'EXCLUDE' });
});

test('malformed imported limits stay out of editable state and preserve the original definition', () => {
  for (const limit of [{ itemsLimit: 0 }, { itemsLimit: 2, otherCategories: 'ALL' }, { itemsLimit: 2, extra: true }, { otherCategories: 'INCLUDE' }]) {
    const bundle = exportBundle(draftWithFacet());
    const visual = bundle.members[0].resource.definition.sheets[0].visuals[0];
    visual.pieChartVisual.chartConfiguration.sortConfiguration = { smallMultiplesLimitConfiguration: limit };
    const imported = importBundle(bundle);
    assert.equal(activeSheet(imported).visuals[0].facetLimit, undefined);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});

test('Multiples Options shows count only with an assigned facet and keeps invalid edits fail-closed', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, draftWithFacet());
    return createElement(MultiplesOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const count = () => renderer.root.findByProps({ 'aria-label': 'Number of panels displayed' });
  const toggle = () => renderer.root.findAllByProps({ 'aria-label': 'Group the rest as Other' });
  assert.equal(count().props.value, '');
  assert.equal(toggle().length, 0);
  await act(() => count().props.onChange({ target: { value: '2' } }));
  assert.deepEqual(selected(current).facetLimit, { count: 2, includeOther: true });
  await act(() => toggle()[0].props.onChange({ target: { checked: false } }));
  for (const value of ['0', '101', '-1', '2.5', 'abc']) {
    await act(() => count().props.onChange({ target: { value } }));
    assert.deepEqual(selected(current).facetLimit, { count: 2, includeOther: false });
  }
  await act(() => count().props.onChange({ target: { value: '' } }));
  assert.equal(selected(current).facetLimit, undefined);
  assert.equal(toggle().length, 0);
  await act(() => dispatch({ type: 'unassign', well: 'smallMultiples', field: 'region' }));
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Number of panels displayed' }).length, 0);
});
