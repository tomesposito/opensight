import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, parseDraft, serializeVisual, sliceLimitValid } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { rowSelection } from '../build/test/visual-selection.js';
import { selectionFilters } from '../build/test/interactions.js';
import { drillDown } from '../build/test/drill.js';
import { init } from '../build/test/echarts.js';

const fixtures = JSON.parse(await readFile(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const pieFixture = () => structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'PieChartVisual')));
const config = input => input.definition.PieChartVisual.ChartConfiguration;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const pieDraft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'pie' });
const rows4 = [
  { category: 'A', revenue: 10 },
  { category: 'B', revenue: 50 },
  { category: 'C', revenue: 30 },
  { category: 'D', revenue: 20 },
];

test('sliceLimitValid accepts only complete, bounded limits', () => {
  assert.equal(sliceLimitValid({ count: 1, includeOther: true }), true);
  assert.equal(sliceLimitValid({ count: 100, includeOther: false }), true);
  assert.equal(sliceLimitValid({ count: 20, includeOther: true }), true);
  for (const bad of [undefined, null, 'limit', [], 5, { count: 5 }, { includeOther: true },
    { count: 0, includeOther: true }, { count: 101, includeOther: true }, { count: -3, includeOther: false },
    { count: 2.5, includeOther: true }, { count: '5', includeOther: true }, { count: NaN, includeOther: true },
    { count: 5, includeOther: 'yes' }, { count: 5, includeOther: true, extra: 1 }]) {
    assert.equal(sliceLimitValid(bad), false, JSON.stringify(bad));
  }
});

test('reducer sets, clears, and rejects invalid slice limits without touching the visual', () => {
  const draft = pieDraft(), before = selected(draft);
  assert.equal(before.sliceLimit, undefined);
  const set = authorReducer(draft, { type: 'slice-limit', limit: { count: 5, includeOther: false } });
  assert.deepEqual(selected(set).sliceLimit, { count: 5, includeOther: false });
  const cleared = authorReducer(set, { type: 'slice-limit', limit: undefined });
  assert.equal(selected(cleared).sliceLimit, undefined);
  for (const bad of [{ count: 0, includeOther: true }, { count: 101, includeOther: true },
    { count: 2.5, includeOther: true }, { count: '5', includeOther: true }, null,
    { count: 5, includeOther: true, extra: 1 }]) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'slice-limit', limit: bad })), before, JSON.stringify(bad));
  }
  // Draft storage round-trips the limit.
  const revived = parseDraft(JSON.stringify(set)).sheets[0].visuals.find(v => v.id === selected(set).id);
  assert.deepEqual(revived.sliceLimit, { count: 5, includeOther: false });
  // Tampered drafts fail validation.
  const tampered = structuredClone(set);
  activeSheet(tampered).visuals.find(v => v.id === selected(set).id).sliceLimit = { count: 500, includeOther: true };
  assert.throws(() => parseDraft(JSON.stringify(tampered)));
});

test('compiler parses CategoryItemsLimit into the model; bad shapes fail closed', () => {
  const input = pieFixture();
  config(input).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 3, OtherCategories: 'INCLUDE' } };
  assert.deepEqual(normalizeVisual('api', input.definition).sliceLimit, { count: 3, includeOther: true });
  const excluded = pieFixture();
  config(excluded).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 7, OtherCategories: 'EXCLUDE' } };
  assert.deepEqual(normalizeVisual('api', excluded.definition).sliceLimit, { count: 7, includeOther: false });
  // Missing OtherCategories defaults to INCLUDE, like the existing enumValue default.
  const defaulted = pieFixture();
  config(defaulted).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 2 } };
  assert.deepEqual(normalizeVisual('api', defaulted.definition).sliceLimit, { count: 2, includeOther: true });
  // No ItemsLimit at all keeps the old honest warning (nothing to compute).
  const degenerate = pieFixture();
  config(degenerate).SortConfiguration = { CategoryItemsLimit: { OtherCategories: 'INCLUDE' } };
  const degenerateModel = normalizeVisual('api', degenerate.definition);
  assert.equal(degenerateModel.sliceLimit, undefined);
  assert.ok(degenerateModel.warnings.some(w => /no slice limit specified/));
  // Slice limits on non-pie visuals fail with a located diagnostic (fail-closed).
  const bar = structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'BarChartVisual')));
  bar.definition.BarChartVisual.ChartConfiguration.SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 3, OtherCategories: 'INCLUDE' } };
  assert.throws(() => normalizeVisual('api', bar.definition), /only computed for pie visuals/);
  // Out-of-range or mistyped counts fail with a located diagnostic.
  for (const shape of [{ ItemsLimit: 0 }, { ItemsLimit: 101 }, { ItemsLimit: '3' }, { ItemsLimit: 2.5 }]) {
    const bad = pieFixture();
    config(bad).SortConfiguration = { CategoryItemsLimit: shape };
    assert.throws(() => normalizeVisual('api', bad.definition), /integer between 1 and 100/, JSON.stringify(shape));
  }
});

test('render keeps the top-N rows in display order and rolls the rest into Other', () => {
  const input = pieFixture();
  config(input).SortConfiguration = {
    CategorySort: [{ FieldSort: { FieldId: 'revenue', Direction: 'DESC' } }],
    CategoryItemsLimit: { ItemsLimit: 2, OtherCategories: 'INCLUDE' },
  };
  input.rows = structuredClone(rows4);
  const { model, option } = compileVisual(input);
  assert.deepEqual(model.sliceLimit, { count: 2, includeOther: true });
  // Sorted DESC by revenue: B(50), C(30) kept; D(20) + A(10) = Other(30).
  assert.deepEqual(option.series[0].data, [
    { name: 'B', value: 50 }, { name: 'C', value: 30 }, { name: 'Other', value: 30 },
  ]);
});

test('EXCLUDE drops the remaining rows instead of bucketing them', () => {
  const input = pieFixture();
  config(input).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 3, OtherCategories: 'EXCLUDE' } };
  input.rows = structuredClone(rows4);
  const { model, option } = compileVisual(input);
  assert.deepEqual(model.sliceLimit, { count: 3, includeOther: false });
  // Dataset order: A, B, C kept; D dropped.
  assert.deepEqual(option.series[0].data, [
    { name: 'A', value: 10 }, { name: 'B', value: 50 }, { name: 'C', value: 30 },
  ]);
});

test('no limit shows all rows; a limit above the row count is a no-op', () => {
  const all = pieFixture();
  all.rows = structuredClone(rows4);
  assert.deepEqual(compileVisual(all).option.series[0].data.map(d => d.name), ['A', 'B', 'C', 'D']);
  const noop = pieFixture();
  config(noop).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 10, OtherCategories: 'INCLUDE' } };
  noop.rows = structuredClone(rows4);
  assert.deepEqual(compileVisual(noop).option.series[0].data.map(d => d.name), ['A', 'B', 'C', 'D']);
});

for (const category of ['Other', 'A']) {
  test(`duplicate source category ${category} fails before slice limiting can hide it`, () => {
    for (const categories of [[category, category, 'B'], [category, 'B', category], ['B', category, category]]) {
      for (const limit of [undefined, ...[1, 2, 3, 4].flatMap(ItemsLimit =>
        ['INCLUDE', 'EXCLUDE'].map(OtherCategories => ({ ItemsLimit, OtherCategories })))]) {
        const input = pieFixture();
        config(input).SortConfiguration = limit ? { CategoryItemsLimit: limit } : {};
        input.rows = categories.map((category, i) => ({ category, revenue: 100 - i * 10 }));
        assert.throws(() => compileVisual(input), /duplicate categories: expected aggregated result rows/,
          JSON.stringify({ categories, limit }));
      }
    }
  });
}

test('retained literal Other joins the bucket without losing totals or promoting another slice', () => {
  for (const count of [1, 2]) {
    const input = pieFixture();
    config(input).SortConfiguration = {
      CategorySort: [{ FieldSort: { FieldId: 'revenue', Direction: 'DESC' } }],
      CategoryItemsLimit: { ItemsLimit: count, OtherCategories: 'INCLUDE' },
    };
    input.rows = [{ category: 'A', revenue: 20 }, { category: 'Other', revenue: 100 }, { category: 'B', revenue: 10 }];
    const before = structuredClone(input);
    const { option, table } = compileVisual(input);
    const expected = count === 1 ? [{ name: 'Other', value: 130 }]
      : [{ name: 'A', value: 20 }, { name: 'Other', value: 110 }];
    assert.deepEqual(option.series[0].data, expected);
    assert.equal(option.series[0].data.reduce((sum, d) => sum + d.value, 0), 130);
    assert.deepEqual(table.rows, expected.map(d => [d.name, d.value]));
    assert.deepEqual(input, before, 'limiting must not mutate source rows or definitions');
  }
});

test('collapsed literal Other contributes to exactly one Other bucket', () => {
  for (const count of [1, 2]) {
    const input = pieFixture();
    config(input).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: count, OtherCategories: 'INCLUDE' } };
    input.rows = [{ category: 'A', revenue: 50 }, { category: 'B', revenue: 20 }, { category: 'Other', revenue: 10 }];
    const { option, table } = compileVisual(input);
    const expected = count === 1 ? [{ name: 'A', value: 50 }, { name: 'Other', value: 30 }]
      : [{ name: 'A', value: 50 }, { name: 'B', value: 20 }, { name: 'Other', value: 10 }];
    assert.deepEqual(option.series[0].data, expected);
    assert.equal(option.series[0].data.reduce((sum, d) => sum + d.value, 0), 80);
    assert.deepEqual(table.rows, expected.map(d => [d.name, d.value]));
  }
});

test('EXCLUDE keeps a literal Other ordinary, whether retained or dropped', () => {
  for (const rows of [
    [{ category: 'Other', revenue: 100 }, { category: 'A', revenue: 20 }],
    [{ category: 'A', revenue: 100 }, { category: 'Other', revenue: 20 }],
  ]) {
    const input = pieFixture();
    config(input).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 1, OtherCategories: 'EXCLUDE' } };
    input.rows = rows;
    const { option, table } = compileVisual(input);
    assert.deepEqual(option.series[0].data, [{ name: rows[0].category, value: 100 }]);
    assert.deepEqual(table.rows, [[rows[0].category, 100]]);
  }
});

test('no-limit, at-limit, and under-limit literal Other rows keep their values and tooltip extras', () => {
  for (const count of [undefined, 1, 2]) {
    const visual = { ...selected(pieDraft()), dimension: 'category', tooltipType: 'detailed',
      tooltipExtraFields: [{ field: 'profit', aggregation: 'AVG' }],
      ...(count ? { sliceLimit: { count, includeOther: true } } : {}) };
    const { option, table } = compileVisual({ ...buildAuthorVisual(visual), rows: [{ category: 'Other', revenue: 100, profit: 7 }] });
    assert.deepEqual(option.series[0].data, [{ name: 'Other', value: 100 }]);
    assert.deepEqual(table.rows, [['Other', 100]]);
    assert.equal(option.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }),
      'Other\ncategory: Other\nSum of revenue: 100\nAvg of profit: 7');
  }
});

test('merged Other respects result bindings, null sums, and zero values', () => {
  for (const [retained, collapsed, expected] of [[null, 10, 10], [100, null, 100], [0, 0, 0], [null, null, null]]) {
    const input = pieFixture();
    config(input).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 1, OtherCategories: 'INCLUDE' } };
    input.bindings = { category: 'label', revenue: 'amount' };
    input.rows = [{ label: 'Other', amount: retained }, { label: 'A', amount: collapsed }];
    if (expected === null) {
      assert.throws(() => compileVisual(input), /null slices are unsupported/);
    } else {
      const { option, table } = compileVisual(input);
      assert.deepEqual(option.series[0].data, [{ name: 'Other', value: expected }]);
      assert.deepEqual(table.rows, [['Other', expected]]);
    }
  }
});

const detailedLimitedPie = (faceted = false) => ({
  ...selected(pieDraft()), dimension: 'category', tooltipType: 'detailed',
  tooltipExtraFields: [{ field: 'profit', aggregation: 'AVG' }],
  sliceLimit: { count: 1, includeOther: true },
  smallMultiples: faceted ? ['region'] : [],
  formatting: { rules: [{ fieldId: 'revenue', operator: 'gte', threshold: 120, color: '#aa0000', background: '#ffeeee' }] },
});
const collisionRows = [
  { category: 'Other', revenue: 100, profit: 7 },
  { category: 'A', revenue: 20, profit: 8 },
  { category: 'B', revenue: 10, profit: 9 },
];

test('merged Other has one legend entry, summed tooltip and formatting, and a consistent selection label', () => {
  const visual = detailedLimitedPie();
  const compiled = compileVisual({ ...buildAuthorVisual(visual), rows: collisionRows });
  assert.deepEqual(compiled.option.series[0].data, [{ name: 'Other', value: 130, itemStyle: { color: '#aa0000' } }]);
  assert.equal(compiled.option.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }),
    'Other\ncategory: Other\nSum of revenue: 130\nAvg of profit: (null)');
  assert.deepEqual(compiled.table.rows, [['Other', 130]]);
  const selection = rowSelection(compiled, 0);
  assert.deepEqual(selection, { values: { category: 'Other' } });
  // Actions and drill retain the existing bucket-label semantics, with no
  // hidden identity or second identically named slice to select.
  assert.deepEqual(selectionFilters('category', 'string', selection.values.category),
    [{ columnName: 'category', type: 'string', values: ['Other'] }]);
  assert.deepEqual(drillDown({ ...visual, hierarchy: { id: 'h', name: 'Category', levels: [
    { columnName: 'category' }, { columnName: 'region' },
  ] } }, [], selection), [selection]);
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 700, height: 400 });
  try {
    chart.setOption(compiled.option);
    const svg = chart.renderToSVGString();
    assert.equal((svg.match(/>Other<\/text>/g) ?? []).length, 1, 'one rendered legend entry');
    assert.match(svg, />Other: 100%<\/text>/, 'one slice accounts for the entire total');
  } finally { chart.dispose(); }
});

test('faceted collisions keep series, table, tooltip extras, and formatting independent per panel', () => {
  const visual = detailedLimitedPie(true);
  const input = { ...buildAuthorVisual(visual), rows: [
    { ...collisionRows[0], region: 'East' },
    { category: 'A', region: 'West', revenue: 50, profit: 11 },
    { ...collisionRows[1], region: 'East' },
    { category: 'B', region: 'West', revenue: 20, profit: 12 },
    { ...collisionRows[2], region: 'East' },
    { category: 'Other', region: 'West', revenue: 10, profit: 13 },
    { category: 'A', region: 'South', revenue: 40, profit: 14 },
    { category: 'B', region: 'South', revenue: 5, profit: 15 },
    { category: 'Other', region: 'North', revenue: 9, profit: 77 },
  ] };
  const { option, table } = compileVisual(input);
  assert.deepEqual(option.title.map(t => t.text), ['East', 'West', 'South', 'North']);
  assert.deepEqual(option.series.map(s => s.data), [
    [{ name: 'Other', value: 130, itemStyle: { color: '#aa0000' } }],
    [{ name: 'A', value: 50 }, { name: 'Other', value: 30 }],
    [{ name: 'A', value: 40 }, { name: 'Other', value: 5 }],
    [{ name: 'Other', value: 9 }],
  ]);
  assert.deepEqual(option.series.map(s => s.data.reduce((sum, d) => sum + d.value, 0)), [130, 80, 45, 9]);
  assert.deepEqual(table.rows, [['Other', 'East', 130], ['A', 'West', 50], ['Other', 'West', 30],
    ['A', 'South', 40], ['Other', 'South', 5], ['Other', 'North', 9]]);
  const format = option.tooltip.formatter;
  assert.equal(format({ seriesIndex: 0, dataIndex: 0 }),
    'Other\ncategory: Other\nregion: East\nSum of revenue: 130\nAvg of profit: (null)');
  assert.equal(format({ seriesIndex: 1, dataIndex: 0 }),
    'A\ncategory: A\nregion: West\nSum of revenue: 50\nAvg of profit: 11');
  assert.equal(format({ seriesIndex: 1, dataIndex: 1 }),
    'Other\ncategory: Other\nregion: West\nSum of revenue: 30\nAvg of profit: (null)');
  assert.equal(format({ seriesIndex: 2, dataIndex: 1 }),
    'Other\ncategory: Other\nregion: South\nSum of revenue: 5\nAvg of profit: (null)');
  assert.equal(format({ seriesIndex: 3, dataIndex: 0 }),
    'Other\ncategory: Other\nregion: North\nSum of revenue: 9\nAvg of profit: 77');
  for (const category of ['Other', 'A']) {
    assert.throws(() => compileVisual({ ...input, rows: [...input.rows, { category, region: 'East', revenue: 1, profit: 1 }] }),
      /duplicate categories: expected aggregated result rows/);
  }
});

test('Other bucket sums measures, nulls out all-null measures, and never invents rows', () => {
  const input = pieFixture();
  config(input).SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 1, OtherCategories: 'INCLUDE' } };
  input.rows = [
    { category: 'A', revenue: 50 },
    { category: 'B', revenue: null },
    { category: 'C', revenue: 10 },
  ];
  const before = structuredClone(input.rows);
  const { option } = compileVisual(input);
  assert.deepEqual(option.series[0].data, [{ name: 'A', value: 50 }, { name: 'Other', value: 10 }]);
  assert.deepEqual(input.rows, before, 'compile must not mutate the input rows');
});

test('slice limit applies per facet group for faceted pies', () => {
  const input = pieFixture();
  input.definition.PieChartVisual.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.SmallMultiples =
    [{ CategoricalDimensionField: { FieldId: 'region', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'region' } } }];
  config(input).SortConfiguration = {
    CategorySort: [{ FieldSort: { FieldId: 'revenue', Direction: 'DESC' } }],
    CategoryItemsLimit: { ItemsLimit: 1, OtherCategories: 'INCLUDE' },
  };
  input.rows = [
    { category: 'Hardware', region: 'East', revenue: 200 },
    { category: 'Software', region: 'East', revenue: 100 },
    { category: 'Gadget', region: 'East', revenue: 5 },
    { category: 'Hardware', region: 'West', revenue: 50 },
    { category: 'Software', region: 'West', revenue: 300 },
  ];
  const { option } = compileVisual(input);
  const names = option.series.map(s => s.data.map(d => d.name));
  assert.ok(names.some(d => d.includes('Other')), 'an Other bucket appears');
  // Sorted DESC by revenue within each facet: East keeps Hardware, Other(105);
  // West keeps Software, Other(50).
  const east = option.series.find(s => s.data.some(d => d.name === 'Hardware'));
  assert.deepEqual(east.data, [{ name: 'Hardware', value: 200 }, { name: 'Other', value: 105 }]);
  const west = option.series.find(s => s.data.some(d => d.name === 'Software'));
  assert.deepEqual(west.data, [{ name: 'Software', value: 300 }, { name: 'Other', value: 50 }]);
});

test('authored slice limit exports as categoryItemsLimit and merges with the sort', () => {
  let draft = pieDraft();
  draft = authorReducer(draft, { type: 'slice-limit', limit: { count: 4, includeOther: true } });
  draft = authorReducer(draft, { type: 'group-sort', sort: { fieldId: 'revenue', direction: 'DESC' } });
  const sortConfiguration = serializeVisual(selected(draft)).pieChartVisual.chartConfiguration.sortConfiguration;
  assert.deepEqual(sortConfiguration, {
    categorySort: [{ fieldSort: { fieldId: 'revenue', direction: 'DESC' } }],
    categoryItemsLimit: { itemsLimit: 4, otherCategories: 'INCLUDE' },
  });
  // The authored export parses back into the same model.
  const compiled = compileVisual({ ...buildAuthorVisual(selected(draft)), rows: structuredClone(rows4) });
  assert.deepEqual(compiled.model.sliceLimit, { count: 4, includeOther: true });
  // An untouched limit-only export stays minimal.
  const limitOnly = pieDraft();
  const limitOnlyExport = serializeVisual(selected(authorReducer(limitOnly, { type: 'slice-limit', limit: { count: 2, includeOther: false } })));
  assert.deepEqual(limitOnlyExport.pieChartVisual.chartConfiguration.sortConfiguration,
    { categoryItemsLimit: { itemsLimit: 2, otherCategories: 'EXCLUDE' } });
});
