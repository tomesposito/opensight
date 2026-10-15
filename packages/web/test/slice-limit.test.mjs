import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, parseDraft, serializeVisual, sliceLimitValid } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';

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
