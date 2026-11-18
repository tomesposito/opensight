import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { applyCategoryLimit } from '../build/test/category-limit.js';
import { groupRowsByFacet } from '../build/test/facet-layout.js';
import { activeSheet, authorReducer, emptyDraft, parseDraft, serializeVisual } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { GroupColorOptions } from '../build/test/PropertiesSections.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';

const kinds = ['bar', 'bar100', 'line', 'area', 'combo'];
const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const rows = [
  { category: 'A', revenue: 10, profit: 5 },
  { category: 'B', revenue: 50, profit: 25 },
  { category: 'C', revenue: 30, profit: 30 },
  { category: 'D', revenue: 20, profit: 20 },
];
const input = (kind, limit, data = rows) => {
  const family = kind === 'line' ? 'line' : 'bar';
  const spec = EXTRA_VISUALS[kind] ?? { variant: `${family}ChartVisual`, wells: `${family}ChartAggregatedFieldWells` };
  const wells = { category: [dim('category')], ...(kind === 'combo'
    ? { barValues: [measure('revenue')], lineValues: [measure('profit')] }
    : { values: [measure('revenue'), measure('profit')] }) };
  return { source: 'bundle', path: '$.test', bindings: {}, rows: structuredClone(data), definition: {
    [spec.variant]: { visualId: kind, chartConfiguration: {
      fieldWells: { [spec.wells]: wells },
      ...(kind === 'area' ? { type: 'AREA' } : {}),
      ...(kind === 'bar100' ? { barsArrangement: 'STACKED_PERCENT' } : {}),
      ...(limit === undefined ? {} : { sortConfiguration: { categoryItemsLimit: limit } }),
    } },
  } };
};
const body = value => Object.values(value.definition)[0];
const config = value => body(value).chartConfiguration;
const wells = value => Object.values(config(value).fieldWells)[0];
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const draftOf = kind => authorReducer(emptyDraft(), { type: 'add', kind });

for (const kind of kinds) {
  for (const otherCategories of ['INCLUDE', 'EXCLUDE']) test(`${kind}: ${otherCategories} limits categories in display order before series and view-data`, () => {
    const value = input(kind, { itemsLimit: 2, otherCategories });
    const before = structuredClone(value);
    const c = compileVisual(value);
    const include = otherCategories === 'INCLUDE';
    assert.deepEqual(c.model.sliceLimit, { count: 2, includeOther: include });
    assert.deepEqual(c.option.xAxis.data, include ? ['A', 'B', 'Other'] : ['A', 'B']);
    assert.deepEqual(c.table.rows, [['A', 10, 5], ['B', 50, 25], ...(include ? [['Other', 50, 50]] : [])]);
    assert.deepEqual(c.option.series.map(s => s.data), kind === 'bar100'
      ? [[10 / 15 * 100, 50 / 75 * 100, ...(include ? [50] : [])], [5 / 15 * 100, 25 / 75 * 100, ...(include ? [50] : [])]]
      : [[10, 50, ...(include ? [50] : [])], [5, 25, ...(include ? [50] : [])]]);
    assert.deepEqual(value, before);
  });

  test(`${kind}: no limit, missing count and non-binding limits keep compiled output unchanged`, () => {
    const all = compileVisual(input(kind));
    assert.deepEqual(all.option.xAxis.data, ['A', 'B', 'C', 'D']);
    assert.deepEqual(all.table.rows, rows.map(r => [r.category, r.revenue, r.profit]));
    for (const limit of [{ otherCategories: 'INCLUDE' }, { itemsLimit: 4 }, { itemsLimit: 100, otherCategories: 'EXCLUDE' }]) {
      const c = compileVisual(input(kind, limit));
      assert.deepEqual(c.option, all.option);
      assert.deepEqual(c.table, all.table);
      if (!limit.itemsLimit) {
        assert.equal(c.model.sliceLimit, undefined);
        assert.ok(c.model.warnings.some(w => w.endsWith(': no slice limit specified; all supplied result rows are shown.')));
      }
    }
    for (const data of [[], null]) {
      const c = compileVisual({ ...input(kind, { itemsLimit: 1 }), rows: data });
      assert.equal(c.state, data === null ? 'unavailable' : 'empty');
      assert.deepEqual(c.table.rows, []);
    }
  });

  test(`${kind}: literal Other folds only when INCLUDE actually collapses categories`, () => {
    const data = [{ category: 'Other', revenue: 100, profit: 10 }, ...rows.slice(0, 2)];
    for (const [limit, expected] of [
      [{ itemsLimit: 1 }, [['Other', 160, 40]]],
      [{ itemsLimit: 2 }, [['A', 10, 5], ['Other', 150, 35]]],
      [{ itemsLimit: 1, otherCategories: 'EXCLUDE' }, [['Other', 100, 10]]],
      [{ itemsLimit: 3 }, data.map(r => [r.category, r.revenue, r.profit])],
    ]) assert.deepEqual(compileVisual(input(kind, limit, data)).table.rows, expected);
    assert.deepEqual(compileVisual(input(kind, { itemsLimit: 1 }, [...rows.slice(0, 2), data[0]])).table.rows,
      [['A', 10, 5], ['Other', 150, 35]]);
  });

  test(`${kind}: sorted limits feed bound tooltip extras and conditional formatting`, () => {
    const value = input(kind, { itemsLimit: 1 });
    config(value).sortConfiguration.categorySort = [{ fieldSort: { fieldId: 'revenue', direction: 'DESC' } }];
    config(value).tooltip = { selectedTooltipType: 'DETAILED', fieldBasedTooltip: { tooltipFields: [{ fieldTooltipItem: { fieldId: 'extra' } }] } };
    body(value).opensightFormatting = { rules: [{ fieldId: 'revenue', operator: 'gte', threshold: 60, color: '#aa0000', background: '#ffeeee' }] };
    value.bindings = { category: 'c', revenue: 'r', profit: 'p', extra: 'e' };
    value.rows = rows.map(r => ({ c: r.category, r: r.revenue, p: r.profit, e: 7 }));
    const c = compileVisual(value);
    assert.deepEqual(c.table.rows, [['B', 50, 25], ['Other', 60, 55]]);
    assert.equal(c.option.series[0].data[1].itemStyle.color, '#aa0000');
    const tooltip = c.option.tooltip.formatter({ seriesIndex: 0, dataIndex: 1 });
    assert.match(tooltip, /category: Other/);
    assert.match(tooltip, /revenue: 60/);
    assert.match(tooltip, /extra: \(null\)/);
    assert.match(c.option.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }), /extra: 7/);
  });

  test(`${kind}: invalid limits and duplicated source categories fail before hiding rows`, () => {
    for (const limit of [null, [], { itemsLimit: 0 }, { itemsLimit: 101 }, { itemsLimit: 1.5 }, { itemsLimit: '2' },
      { itemsLimit: null }, { itemsLimit: 2, otherCategories: 'ALL' }, { itemsLimit: 2, unknown: true }]) {
      assert.throws(() => compileVisual(input(kind, limit)), undefined, JSON.stringify(limit));
    }
    for (const otherCategories of ['INCLUDE', 'EXCLUDE']) for (const category of ['A', 'Other']) {
      assert.throws(() => compileVisual(input(kind, { itemsLimit: 1, otherCategories }, [...rows, { ...rows[0], category }, { ...rows[1], category }])),
        /duplicate categories: expected aggregated result rows/);
    }
  });
}

test('bar, line, area and combo preserve all-null Other measures as null and mixed/zero sums as numbers', () => {
  for (const kind of ['bar', 'line', 'area', 'combo']) for (const [a, b, sum] of [[null, null, null], [null, 10, 10], [10, null, 10], [0, 0, 0]]) {
    const c = compileVisual(input(kind, { itemsLimit: 1 }, [rows[0], { ...rows[1], revenue: a }, { ...rows[2], revenue: b }]));
    assert.deepEqual(c.table.rows, [['A', 10, 5], ['Other', sum, 55]]);
    assert.deepEqual(c.option.series[0].data, [10, sum]);
  }
  // Percentage bars retain their existing non-null measure requirement.
  assert.throws(() => compileVisual(input('bar100', { itemsLimit: 1 }, [rows[0], { ...rows[1], revenue: null }])), /nonnegative, non-null/);
});

test('faceted line limits each panel independently and maps limited rows to tooltip and formatting', () => {
  const value = input('line', { itemsLimit: 1 }, [
    { category: 'B', region: 'West', revenue: 20, profit: 2 },
    { category: 'A', region: 'East', revenue: 10, profit: 1 },
    { category: 'C', region: 'West', revenue: 40, profit: 4 },
    { category: 'D', region: 'East', revenue: 30, profit: 3 },
    { category: 'E', region: 'West', revenue: 50, profit: 5 },
  ]);
  wells(value).smallMultiples = [dim('region')];
  config(value).tooltip = { selectedTooltipType: 'DETAILED' };
  body(value).opensightFormatting = { rules: [{ fieldId: 'revenue', operator: 'gte', threshold: 80, color: '#aa0000', background: '#ffeeee' }] };
  const c = compileVisual(value);
  assert.deepEqual(c.option.title.map(t => t.text), ['West', 'East']);
  assert.deepEqual(c.option.xAxis.map(a => a.data), [['B', 'Other'], ['A', 'Other']]);
  assert.deepEqual(c.table.rows, [['B', 'West', 20, 2], ['Other', 'West', 90, 9], ['A', 'East', 10, 1], ['Other', 'East', 30, 3]]);
  assert.deepEqual(c.option.series.map(s => s.data), [[20, { value: 90, itemStyle: { color: '#aa0000' } }], [2, 9], [10, 30], [1, 3]]);
  assert.match(c.option.tooltip.formatter({ seriesIndex: 3, dataIndex: 1 }), /region: East\nSum of revenue: 30\nSum of profit: 3/);
});

test('facet limits precede category limits, preserving distinct literal Other panels in all new kinds', () => {
  for (const kind of kinds) {
    const value = input(kind, { itemsLimit: 1 }, ['Other', 'East', 'West'].flatMap((region, i) =>
      rows.slice(0, 2).map(row => ({ ...row, region, revenue: row.revenue + i }))));
    wells(value).smallMultiples = [dim('region')];
    config(value).sortConfiguration.smallMultiplesLimitConfiguration = { itemsLimit: 1 };
    const c = compileVisual(value);
    assert.deepEqual(c.option.title.map(t => t.text), ['Other', 'Other']);
    assert.deepEqual(c.option.xAxis.map(a => a.data), [['A', 'Other'], ['A', 'Other']]);
    assert.deepEqual(c.table.rows, [['A', 'Other', 10, 5], ['Other', 'Other', 50, 25], ['A', 'Other', 23, 10], ['Other', 'Other', 103, 50]]);
  }
});

test('grouped category transform retains every top-category row and merges Other by facet and color', () => {
  // Current bar parsing rejects a second dimension/Colors well. Exercise the
  // actual shared compiler transform at that boundary without widening parsing.
  const field = column => ({ id: column, column, dataSet: 'sales_data' });
  const category = field('category'), region = field('region'), color = field('color');
  const fields = { category, remainingDimensions: [region, color], measures: [field('revenue'), field('profit')], extraFields: [field('extra')],
    cell: (row, f) => row[f.column], number: (row, f) => row[f.column], column: f => f.column };
  const data = [
    { category: 'Other', color: 'Red', region: 'West', revenue: 100, profit: null, extra: 1 },
    { category: 'A', color: 'Red', region: 'West', revenue: 10, profit: 1, extra: 2 },
    { category: 'B', color: 'Blue', region: 'West', revenue: 20, profit: null, extra: 3 },
    { category: 'A', color: 'Blue', region: 'West', revenue: 30, profit: 3, extra: 4 },
    { category: 'C', color: 'Red', region: 'West', revenue: 40, profit: null, extra: 5 },
    { category: 'C', color: 'Blue', region: 'West', revenue: 50, profit: null, extra: 6 },
    { category: 'A', color: 'Red', region: 'East', revenue: 60, profit: 6, extra: 7 },
    { category: 'B', color: 'Red', region: 'East', revenue: 70, profit: 7, extra: 8 },
    { category: 'C', color: 'Red', region: 'East', revenue: 80, profit: 8, extra: 9 },
  ];
  const before = structuredClone(data);
  const groups = groupRowsByFacet(data, region, fields.cell);
  const limited = groups.flatMap(g => applyCategoryLimit(g.rows, { count: 2, includeOther: true }, fields));
  assert.deepEqual(limited, [data[1], data[3],
    { category: 'Other', color: 'Blue', region: 'West', revenue: 70, profit: null, extra: null },
    { category: 'Other', color: 'Red', region: 'West', revenue: 140, profit: null, extra: null },
    data[6], data[7], { category: 'Other', color: 'Red', region: 'East', revenue: 80, profit: 8, extra: null },
  ]);
  assert.deepEqual(groups.flatMap(g => applyCategoryLimit(g.rows, { count: 2, includeOther: false }, fields)), [data[0], data[1], data[3], data[6], data[7]]);
  assert.equal(applyCategoryLimit(data, undefined, fields), data);
  assert.equal(applyCategoryLimit(data, { count: 4, includeOther: true }, fields), data);
  assert.deepEqual(data, before);
  const typed = [null, 1, '1', false].map(category => ({ category, revenue: 1 }));
  assert.deepEqual(applyCategoryLimit(typed, { count: 2, includeOther: true }, { ...fields, remainingDimensions: [], measures: [field('revenue')], extraFields: [] }),
    [{ category: null, revenue: 1 }, { category: 1, revenue: 1 }, { category: 'Other', revenue: 2 }]);
});

test('line and area forecasts consume the limited date rows and honestly skip a non-date Other bucket', () => {
  for (const kind of ['line', 'area']) {
    const data = Array.from({ length: 8 }, (_, i) => ({ category: `2025-${String(i + 1).padStart(2, '0')}`, revenue: 100 + 10 * i, profit: 10 + i }));
    const value = input(kind, { itemsLimit: 4, otherCategories: 'EXCLUDE' }, data);
    wells(value).category = [{ dateDimensionField: { ...dim('category').categoricalDimensionField, dateGranularity: 'MONTH' } }];
    config(value).forecastConfigurations = [{ periodsForward: 2, seasonality: 'NONE' }];
    const limited = compileVisual(value);
    const expected = structuredClone(value);
    delete config(expected).sortConfiguration;
    expected.rows = data.slice(0, 4);
    const manual = compileVisual(expected);
    assert.deepEqual(limited.option.series, manual.option.series);
    assert.deepEqual(limited.option.xAxis, manual.option.xAxis);
    assert.deepEqual(limited.table, manual.table);
    assert.ok(limited.option.series.some(s => s.id?.startsWith('forecast-seg')));
    config(value).sortConfiguration.categoryItemsLimit.otherCategories = 'INCLUDE';
    const withOther = compileVisual(value);
    assert.equal(withOther.option.series.length, 2);
    assert.equal(withOther.table.rows.at(-1)[0], 'Other');
    assert.ok(withOther.model.warnings.some(w => w.endsWith('forecast was not rendered because the category values are not dates at the chart grain.')));
  }
});

for (const kind of [...kinds, 'pie']) {
  for (const dialect of ['bundle', 'api']) test(`${kind}: ${dialect} category limits import, edit and export with both enum choices and default`, () => {
    for (const otherCategories of ['INCLUDE', 'EXCLUDE', undefined]) {
      const draft = draftOf(kind);
      const bundle = exportBundle(draft);
      const definition = bundle.members[0].resource.definition;
      const raw = definition.sheets[0].visuals[0];
      Object.values(raw)[0].chartConfiguration.sortConfiguration = { categoryItemsLimit: { itemsLimit: 2, ...(otherCategories ? { otherCategories } : {}) } };
      if (dialect === 'api') {
        const native = projectDefinition(definition);
        assert.deepEqual(normalizeVisual('api', native.Sheets[0].Visuals[0]).sliceLimit, { count: 2, includeOther: otherCategories !== 'EXCLUDE' });
        bundle.members[0].resource.definition = convertDefinition(native);
      }
      const imported = importBundle(bundle);
      assert.deepEqual(selected(imported).sliceLimit, { count: 2, includeOther: otherCategories !== 'EXCLUDE' });
      assert.deepEqual(exportBundle(imported), bundle);
      const edited = authorReducer(imported, { type: 'slice-limit', limit: { count: 1, includeOther: false } });
      const exported = exportBundle(edited);
      const visual = exported.members[0].resource.definition.sheets[0].visuals[0];
      assert.deepEqual(Object.values(visual)[0].chartConfiguration.sortConfiguration.categoryItemsLimit, { itemsLimit: 1, otherCategories: 'EXCLUDE' });
      assert.deepEqual(selected(importBundle(exported)).sliceLimit, { count: 1, includeOther: false });
      const nativeAgain = projectDefinition(exported.members[0].resource.definition);
      assert.deepEqual(normalizeVisual('api', nativeAgain.Sheets[0].Visuals[0]).sliceLimit, { count: 1, includeOther: false });
    }
  });
}

test('malformed imports preserve source definitions without hydrating invalid limits in any new kind', () => {
  for (const kind of kinds) for (const limit of [{ itemsLimit: 0 }, { itemsLimit: 101 }, { itemsLimit: '2' }, { itemsLimit: 1.5 }, { itemsLimit: 2, otherCategories: 'ALL' }, { otherCategories: 'INCLUDE' }]) {
    const bundle = exportBundle(draftOf(kind));
    Object.values(bundle.members[0].resource.definition.sheets[0].visuals[0])[0].chartConfiguration.sortConfiguration = { categoryItemsLimit: limit };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).sliceLimit, undefined);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});

for (const kind of kinds) test(`${kind}: Properties controls and draft storage retain valid edits, reject invalid input and clear the limit`, async t => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current;
  function Harness() {
    const [draft, dispatch] = useReducer(authorReducer, draftOf(kind));
    current = draft;
    return createElement(GroupColorOptions, { visual: selected(draft), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const count = () => renderer.root.findByProps({ 'aria-label': 'Number of categories displayed' });
  const other = () => renderer.root.findAllByProps({ 'aria-label': 'Group the rest as Other' });
  assert.equal(count().props.value, '');
  assert.equal(other().length, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /Other” category/);
  await act(() => count().props.onChange({ target: { value: '2' } }));
  assert.deepEqual(selected(current).sliceLimit, { count: 2, includeOther: true });
  await act(() => other()[0].props.onChange({ target: { checked: false } }));
  for (const value of ['0', '101', '-1', '1.5', 'abc']) {
    await act(() => count().props.onChange({ target: { value } }));
    assert.deepEqual(selected(current).sliceLimit, { count: 2, includeOther: false });
  }
  assert.deepEqual(selected(parseDraft(JSON.stringify(current))).sliceLimit, { count: 2, includeOther: false });
  const invalid = structuredClone(current);
  selected(invalid).sliceLimit.count = 101;
  assert.throws(() => parseDraft(JSON.stringify(invalid)));
  assert.deepEqual(Object.values(serializeVisual(selected(current)))[0].chartConfiguration.sortConfiguration.categoryItemsLimit,
    { itemsLimit: 2, otherCategories: 'EXCLUDE' });
  await act(() => count().props.onChange({ target: { value: '' } }));
  assert.equal(selected(current).sliceLimit, undefined);
  assert.equal(other().length, 0);
  assert.equal(Object.values(serializeVisual(selected(current)))[0].chartConfiguration.sortConfiguration, undefined);
});
