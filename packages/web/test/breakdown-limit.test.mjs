import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, parseDraft, serializeDraft, serializeVisual, breakdownLimitValid } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const breakdownInput = (rows, sortConfiguration) => ({ source: 'bundle', path: '$.waterfall', bindings: {}, rows, definition: {
  waterfallChartVisual: { visualId: 'waterfall', chartConfiguration: {
    fieldWells: { waterfallChartAggregatedFieldWells: { category: [dim('category')], breakdowns: [dim('breakdown')], values: [measure('delta')] } },
    ...(sortConfiguration ? { sortConfiguration } : {}),
  } },
} });
const waterfallDraft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'waterfall' });
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
// Native-API shape for the compiler parse tests (PascalCase, like the slice-limit tests).
const ndim = name => ({ CategoricalDimensionField: { FieldId: name, Column: { ColumnName: name, DataSetIdentifier: 'data' } } });
const nmeasure = name => ({ NumericalMeasureField: { FieldId: name, Column: { ColumnName: name, DataSetIdentifier: 'data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } });
const nativeInput = (sortConfiguration, withBreakdown = true) => ({
  WaterfallVisual: { VisualId: 'waterfall', ChartConfiguration: {
    FieldWells: { WaterfallChartAggregatedFieldWells: {
      Categories: [ndim('category')],
      ...(withBreakdown ? { Breakdowns: [ndim('breakdown')] } : {}),
      Values: [nmeasure('delta')],
    } },
    SortConfiguration: sortConfiguration,
  } },
});

const rows7 = [
  { category: 'Q1', breakdown: 'A', delta: 10 }, { category: 'Q1', breakdown: 'B', delta: 20 }, { category: 'Q1', breakdown: 'C', delta: 5 },
  { category: 'Q2', breakdown: 'A', delta: -4 }, { category: 'Q2', breakdown: 'B', delta: 6 }, { category: 'Q2', breakdown: 'C', delta: -2 },
  { category: 'Q3', breakdown: 'A', delta: 5 }, { category: 'Q3', breakdown: 'C', delta: 1 },
];

test('breakdownLimitValid accepts only complete, bounded limits', () => {
  assert.equal(breakdownLimitValid({ count: 1, includeOther: true }), true);
  assert.equal(breakdownLimitValid({ count: 100, includeOther: false }), true);
  assert.equal(breakdownLimitValid({ count: 20, includeOther: true }), true);
  for (const bad of [undefined, null, 'limit', [], 5, { count: 5 }, { includeOther: true },
    { count: 0, includeOther: true }, { count: 101, includeOther: true }, { count: -3, includeOther: false },
    { count: 2.5, includeOther: true }, { count: '5', includeOther: true }, { count: NaN, includeOther: true },
    { count: 5, includeOther: 'yes' }, { count: 5, includeOther: true, extra: 1 }]) {
    assert.equal(breakdownLimitValid(bad), false, JSON.stringify(bad));
  }
});

test('reducer sets, clears, and rejects invalid breakdown limits without touching the visual', () => {
  const draft = waterfallDraft(), before = selected(draft);
  assert.equal(before.breakdownLimit, undefined);
  const set = authorReducer(draft, { type: 'breakdown-limit', limit: { count: 3, includeOther: false } });
  assert.deepEqual(selected(set).breakdownLimit, { count: 3, includeOther: false });
  const cleared = authorReducer(set, { type: 'breakdown-limit', limit: undefined });
  assert.equal(selected(cleared).breakdownLimit, undefined);
  for (const bad of [{ count: 0, includeOther: true }, { count: 101, includeOther: true },
    { count: 2.5, includeOther: true }, { count: '5', includeOther: true }, null,
    { count: 5, includeOther: true, extra: 1 }]) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'breakdown-limit', limit: bad })), before, JSON.stringify(bad));
  }
  // Draft storage round-trips the limit.
  const revived = parseDraft(JSON.stringify(set)).sheets[0].visuals.find(v => v.id === selected(set).id);
  assert.deepEqual(revived.breakdownLimit, { count: 3, includeOther: false });
  // Tampered drafts fail validation.
  const tampered = structuredClone(set);
  activeSheet(tampered).visuals.find(v => v.id === selected(set).id).breakdownLimit = { count: 500, includeOther: true };
  assert.throws(() => parseDraft(JSON.stringify(tampered)));
});

test('unassigning the Breakdowns field drops the breakdown limit', () => {
  let draft = authorReducer(waterfallDraft(), { type: 'assign', field: 'category', well: 'breakdown' });
  draft = authorReducer(draft, { type: 'breakdown-limit', limit: { count: 3, includeOther: true } });
  assert.deepEqual(selected(draft).breakdownLimit, { count: 3, includeOther: true });
  const removed = authorReducer(draft, { type: 'unassign', field: 'category', well: 'breakdown' });
  assert.deepEqual(selected(removed).breakdowns, []);
  assert.equal(selected(removed).breakdownLimit, undefined);
  // The generic no-well unassign path drops it too.
  let draft2 = authorReducer(waterfallDraft(), { type: 'assign', field: 'category', well: 'breakdown' });
  draft2 = authorReducer(draft2, { type: 'breakdown-limit', limit: { count: 2, includeOther: false } });
  const cleared2 = authorReducer(draft2, { type: 'unassign', field: 'category' });
  assert.equal(selected(cleared2).breakdownLimit, undefined);
});

test('compiler parses BreakdownItemsLimit into the model; bad shapes fail closed', () => {
  const included = nativeInput({ BreakdownItemsLimit: { ItemsLimit: 3, OtherCategories: 'INCLUDE' } });
  assert.deepEqual(normalizeVisual('api', included).breakdownLimit, { count: 3, includeOther: true });
  const excluded = nativeInput({ BreakdownItemsLimit: { ItemsLimit: 7, OtherCategories: 'EXCLUDE' } });
  assert.deepEqual(normalizeVisual('api', excluded).breakdownLimit, { count: 7, includeOther: false });
  // Missing OtherCategories defaults to INCLUDE, like the existing enumValue default.
  const defaulted = nativeInput({ BreakdownItemsLimit: { ItemsLimit: 2 } });
  assert.deepEqual(normalizeVisual('api', defaulted).breakdownLimit, { count: 2, includeOther: true });
  // No ItemsLimit at all keeps the old honest warning (nothing to compute).
  const degenerate = nativeInput({ BreakdownItemsLimit: { OtherCategories: 'INCLUDE' } });
  const degenerateModel = normalizeVisual('api', degenerate);
  assert.equal(degenerateModel.breakdownLimit, undefined);
  assert.ok(degenerateModel.warnings.some(w => /no breakdown limit specified/));
  // Out-of-range or mistyped counts fail with a located diagnostic.
  for (const shape of [{ ItemsLimit: 0 }, { ItemsLimit: 101 }, { ItemsLimit: '3' }, { ItemsLimit: 2.5 }]) {
    assert.throws(() => normalizeVisual('api', nativeInput({ BreakdownItemsLimit: shape })), /integer between 1 and 100/, JSON.stringify(shape));
  }
  // A limit without a Breakdowns field fails closed.
  assert.throws(() => normalizeVisual('api', nativeInput({ BreakdownItemsLimit: { ItemsLimit: 2, OtherCategories: 'INCLUDE' } }, false)), /require a Breakdowns field/);
  // Limits on non-waterfall visuals stay fail-closed at the unsupported-property gate.
  const bar = { BarChartVisual: { VisualId: 'bar', ChartConfiguration: {
    FieldWells: { BarChartAggregatedFieldWells: { Category: [ndim('category')], Values: [nmeasure('delta')] } },
    SortConfiguration: { BreakdownItemsLimit: { ItemsLimit: 3, OtherCategories: 'INCLUDE' } },
  } } };
  assert.throws(() => normalizeVisual('api', bar), /unsupported property/);
});

test('render keeps the top-N breakdown values in first-appearance order and rolls the rest into Other', () => {
  const c = compileVisual(breakdownInput(rows7, { breakdownItemsLimit: { itemsLimit: 2, otherCategories: 'INCLUDE' } }));
  const [, visible] = c.option.series;
  assert.deepEqual(c.model.breakdownLimit, { count: 2, includeOther: true });
  // First appearance order: A, B kept; C rolls into Other.
  // Q1 subtotal: 10 + 20 + 5(Other) = 35.
  // Q2: A(-4): 35→31; B(6): 31→37; Other(-2): 37→35; subtotal 35.
  // Q3: A(5): 35→40; B missing; Other(1): 40→41; subtotal 41.
  assert.deepEqual(c.option.xAxis.data, ['Q1', 'A', 'B', 'Other', 'Q2', 'A', 'Other', 'Q3']);
  assert.deepEqual(visible.data.map(d => d.value), [35, 4, 6, 2, 35, 5, 1, 41]);
  assert.deepEqual(visible.data.map(d => d.delta), [35, -4, 6, -2, 35, 5, 1, 41]);
  assert.deepEqual(visible.data.map(d => d.name), ['Q1', 'A', 'B', 'Other', 'Q2', 'A', 'Other', 'Q3']);
  assert.ok(!c.option.xAxis.data.includes('Total'));
  // The input rows are not mutated and the data table keeps the supplied rows.
  assert.deepEqual(c.table.rows, rows7.map(r => [r.category, r.breakdown, r.delta]));
});

test('EXCLUDE drops the remaining breakdown values instead of bucketing them', () => {
  const c = compileVisual(breakdownInput(rows7, { breakdownItemsLimit: { itemsLimit: 2, otherCategories: 'EXCLUDE' } }));
  const [, visible] = c.option.series;
  assert.deepEqual(c.model.breakdownLimit, { count: 2, includeOther: false });
  // Q1 subtotal: 10 + 20 = 30. Q2: A(-4): 30→26; B(6): 26→32; subtotal 32.
  // Q3: A(5): 32→37; subtotal 37.
  assert.deepEqual(c.option.xAxis.data, ['Q1', 'A', 'B', 'Q2', 'A', 'Q3']);
  assert.deepEqual(visible.data.map(d => d.delta), [30, -4, 6, 32, 5, 37]);
});

test('no limit shows all breakdown values; a limit above the value count is a no-op', () => {
  const all = compileVisual(breakdownInput(rows7));
  const [, allVisible] = all.option.series;
  // Q1 subtotal; Q2 decomposes A/B/C then subtotal; Q3 decomposes A/C (no B pair) then subtotal.
  assert.deepEqual(allVisible.data.map(d => d.name), ['Q1', 'A', 'B', 'C', 'Q2', 'A', 'C', 'Q3']);
  const noop = compileVisual(breakdownInput(rows7, { breakdownItemsLimit: { itemsLimit: 10, otherCategories: 'INCLUDE' } }));
  const [, noopVisible] = noop.option.series;
  assert.deepEqual(noopVisible.data.map(d => d.name), ['Q1', 'A', 'B', 'C', 'Q2', 'A', 'C', 'Q3']);
});

test('authored breakdown limit exports as breakdownItemsLimit and parses back', () => {
  let draft = authorReducer(waterfallDraft(), { type: 'assign', field: 'category', well: 'breakdown' });
  draft = authorReducer(draft, { type: 'breakdown-limit', limit: { count: 2, includeOther: false } });
  const sortConfiguration = serializeVisual(selected(draft)).waterfallChartVisual.chartConfiguration.sortConfiguration;
  assert.deepEqual(sortConfiguration, { breakdownItemsLimit: { itemsLimit: 2, otherCategories: 'EXCLUDE' } });
  // The authored export parses back into the same model.
  const rows = [{ region: 'East', category: 'Hardware', revenue: 10 }, { region: 'East', category: 'Software', revenue: 20 }];
  const compiled = compileVisual({ ...buildAuthorVisual(selected(draft)), rows: structuredClone(rows) });
  assert.deepEqual(compiled.model.breakdownLimit, { count: 2, includeOther: false });
  // Without a breakdown assignment the export stays minimal.
  const bare = serializeVisual(selected(authorReducer(waterfallDraft(), { type: 'breakdown-limit', limit: { count: 2, includeOther: true } })));
  assert.equal(bare.waterfallChartVisual.chartConfiguration.sortConfiguration, undefined);
  // Draft storage round-trips through serializeDraft.
  const resource = serializeDraft(draft);
  const wf = resource.definition.sheets[0].visuals.find(v => v.waterfallChartVisual).waterfallChartVisual;
  assert.deepEqual(wf.chartConfiguration.sortConfiguration, { breakdownItemsLimit: { itemsLimit: 2, otherCategories: 'EXCLUDE' } });
});

test('imported breakdown limits become editable draft state and survive export', () => {
  let draft = authorReducer(waterfallDraft(), { type: 'assign', field: 'category', well: 'breakdown' });
  const resource = serializeDraft(draft);
  resource.analysisId = 'synthetic-analysis'; resource.name = 'Breakdown limit fixture';
  resource.definition.dataSetIdentifierDeclarations[0].dataSetArn = 'arn:aws:quicksight:us-east-1:123456789012:dataset/imported-sales';
  const wf = resource.definition.sheets[0].visuals.find(v => v.waterfallChartVisual).waterfallChartVisual;
  wf.chartConfiguration.sortConfiguration = { breakdownItemsLimit: { itemsLimit: 2, otherCategories: 'EXCLUDE' } };
  const bundle = { members: [{ path: 'analysis/synthetic-analysis.json', resource }] };
  const imported = importBundle(bundle);
  const visual = activeSheet(imported).visuals.find(v => v.kind === 'waterfall');
  assert.deepEqual(visual.breakdownLimit, { count: 2, includeOther: false });
  // An untouched export keeps the imported limit verbatim.
  const exported = exportBundle(imported);
  const exportedWf = exported.members[0].resource.definition.sheets[0].visuals.find(v => v.waterfallChartVisual).waterfallChartVisual;
  assert.deepEqual(exportedWf.chartConfiguration.sortConfiguration, { breakdownItemsLimit: { itemsLimit: 2, otherCategories: 'EXCLUDE' } });
  // A malformed imported limit stays out of the draft (fail-closed import).
  wf.chartConfiguration.sortConfiguration = { breakdownItemsLimit: { itemsLimit: 0, otherCategories: 'INCLUDE' } };
  const badImported = importBundle({ members: [{ path: 'analysis/synthetic-analysis.json', resource }] });
  assert.equal(activeSheet(badImported).visuals.find(v => v.kind === 'waterfall').breakdownLimit, undefined);
});
