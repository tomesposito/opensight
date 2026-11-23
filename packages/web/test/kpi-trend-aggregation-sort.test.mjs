import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withoutBindingAggregation } from './fixtures/compiler-baseline.mjs';
import { readFileSync } from 'node:fs';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual, parseDraft, kpiTrendSortValid, DRAFT_KEY, dataFields } from '../build/test/authoring.js';
import { createDraftStore, draftStorageKey } from '../build/test/local-drafts.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { projectDefinition, convertDefinition } from '../build/test/definition-converter.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { KpiTrendSortOptions } from '../build/test/PropertiesSections.js';
import { SORT_AGGREGATIONS } from '../build/test/model.js';
import { interpretQuestion } from '@opensight/o-interpreter';
import { baselineInputs } from './fixtures/kpi-trend-aggregation-sort-inputs.mjs';

const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const draft = () => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }), { type: 'assign', well: 'trend', field: 'region' });
const config = visual => Object.values(visual)[0].chartConfiguration;
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const sort = (aggregation = 'SUM', direction = 'DESC') => ({ aggregationSort: { fieldId: 'region', direction,
  column: { columnName: 'revenue', dataSetIdentifier: 'sales_data' },
  aggregationFunction: { numericalAggregationFunction: { simpleNumericalAggregation: aggregation } } } });
const draftSort = (aggregation = 'SUM', direction = 'DESC') => ({ fieldId: 'region', direction, measureFieldId: 'revenue', aggregation });
const sortedDraft = () => authorReducer(draft(), { type: 'kpi-trend-sort', sort: draftSort() });
const input = (rows = [{ region: 'B', revenue: 10 }, { region: 'A', revenue: 20 }], sorts = [sort()]) => {
  const value = { source: 'bundle', path: '$.trendAggregation', bindings: {}, rows, definition: serializeVisual(selected(draft())) };
  config(value.definition).sortConfiguration = { trendGroupSort: sorts };
  return value;
};
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const mutate = fn => { const wrapper = sort(); fn(wrapper.aggregationSort, wrapper); return [wrapper]; };
const malformed = [null, {}, 'sort', [], [null], [[]], [{}], [{ extra: true }], [sort(), sort()], [sort(), { fieldSort: { fieldId: 'region' } }],
  ...[null, [], {}, 'sort'].map(aggregationSort => [{ aggregationSort }]),
  mutate((s, w) => { w.fieldSort = { fieldId: 'region' }; }), mutate((s, w) => { w.extra = true; }),
  ...['fieldId', 'column', 'aggregationFunction'].map(key => mutate(s => { delete s[key]; })),
  ...['extra', 'fieldId', 'direction', 'column', 'aggregationFunction'].map(key => mutate(s => { s[key] = null; })),
  ...['', ' ', 'revenue', 'missing', 7].map(fieldId => mutate(s => { s.fieldId = fieldId; })),
  ...['asc', '', 1].map(direction => mutate(s => { s.direction = direction; })),
  ...[{}, [], { columnName: 'revenue' }, { dataSetIdentifier: 'sales_data' }, { dataSetIdentifier: 'other', columnName: 'revenue' },
    { dataSetIdentifier: 'sales_data', columnName: 'region' }, { dataSetIdentifier: 'sales_data', columnName: 'missing' },
    { dataSetIdentifier: 'sales_data', columnName: 'revenue', extra: true }].map(column => mutate(s => { s.column = column; })),
  ...[{}, [], { dateAggregationFunction: 'MAX' }, { categoricalAggregationFunction: 'COUNT' },
    { numericalAggregationFunction: {} }, { numericalAggregationFunction: [] }, { numericalAggregationFunction: null },
    { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM', extra: true } },
    { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM' }, extra: true },
    ...['AVG', 'MEDIAN', 'STDEV', null, 5].map(simpleNumericalAggregation => ({ numericalAggregationFunction: { simpleNumericalAggregation } }))
  ].map(aggregationFunction => mutate(s => { s.aggregationFunction = aggregationFunction; }))];

for (const source of ['bundle', 'api']) {
  test(`${source}: KPI aggregation sorts resolve measure IDs, all aggregations, default ASC and converter round-trip`, () => {
    for (const aggregation of SORT_AGGREGATIONS) {
      const value = input(undefined, [sort(aggregation)]);
      config(value.definition).fieldWells.values[0].numericalMeasureField.fieldId = 'native-measure-id';
      assert.deepEqual(normalize(dialect(value, source)).trendGroupSort, { ...draftSort(aggregation), measureFieldId: 'native-measure-id' });
      delete config(value.definition).sortConfiguration.trendGroupSort[0].aggregationSort.direction;
      assert.equal(normalize(dialect(value, source)).trendGroupSort.direction, 'ASC');
      assert.deepEqual(convertDefinition(projectDefinition(definition(value.definition))), definition(value.definition));
    }
  });
  test(`${source}: every invalid aggregation sort nesting, field binding and entry fails closed`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(input([], sorts), source)), CompileError, JSON.stringify(sorts));
    const noTrend = input(); delete config(noTrend.definition).fieldWells.trendGroups;
    assert.throws(() => normalize(dialect(noTrend, source)), /bound trend dimension/);
    const target = input(); config(target.definition).fieldWells.targetValues = [{ numericalMeasureField: { fieldId: 'target', column: { dataSetIdentifier: 'sales_data', columnName: 'profit' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }];
    config(target.definition).sortConfiguration.trendGroupSort[0].aggregationSort.column.columnName = 'profit';
    assert.throws(() => normalize(dialect(target, source)), /bound measure/);
  });
}
const rows = [{ region: 'C', revenue: 20 }, { region: 'B', revenue: 5 }, { region: 'Z', revenue: null }, { region: 'A', revenue: 20 }, { region: null, revenue: 10 }];
for (const source of ['bundle', 'api']) for (const aggregation of SORT_AGGREGATIONS) for (const direction of ['ASC', 'DESC']) {
  test(`${source}: KPI ${aggregation} ${direction} is stable, null-last and does not mutate rows`, () => {
    const value = input(structuredClone(rows), [sort(aggregation, direction)]), before = structuredClone(value);
    const result = compileVisual(dialect(value, source));
    const expected = ['COUNT', 'DISTINCT_COUNT'].includes(aggregation) ? ['C', 'B', 'A', null, 'Z']
      : direction === 'ASC' ? ['B', null, 'C', 'A', 'Z'] : ['C', 'A', null, 'B', 'Z'];
    assert.deepEqual(result.table.rows, expected.map(key => { const row = rows.find(r => r.region === key); return [row.region, row.revenue]; }));
    assert.deepEqual(result.option.series[0].data, result.table.rows.map(row => row[1]));
    assert.equal(result.option.series[0].connectNulls, false);
    assert.equal(result.option.graphic[0].style.text, '55');
    assert.deepEqual(value, before);
  });
}
for (const grain of ['DAY', 'MONTH', 'QUARTER', 'YEAR']) test(`measure sorts validate ${grain} date keys, duplicates and use binding aliases`, () => {
  const keys = { DAY: ['2025-03-01', '2025-01-01', '2025-02-01'], MONTH: ['2025-03', '2025-01', '2025-02'], QUARTER: ['2025-Q3', '2025-Q1', '2025-Q2'], YEAR: ['2025', '2023', '2024'] }[grain];
  const value = input(keys.map((period, i) => ({ period, amount: [10, 20, 5][i] })));
  config(value.definition).fieldWells.trendGroups = [{ dateDimensionField: { fieldId: 'region', column: { dataSetIdentifier: 'sales_data', columnName: 'order_date' }, dateGranularity: grain } }];
  value.bindings = { region: 'period', revenue: 'amount' };
  assert.deepEqual(compileVisual(value).table.rows.map(row => row[0]), [keys[1], keys[0], keys[2]]);
  value.rows[0].period = 'invalid'; assert.throws(() => compileVisual(value), /invalid date trend key/);
  value.rows[0].period = keys[1]; assert.throws(() => compileVisual(value), /duplicate trend groups/);
});
test('missing/non-finite measures fail closed; null, empty and unavailable rows invent no aggregate', () => {
  for (const row of [{ region: 'A' }, { region: 'A', revenue: '4' }, { region: 'A', revenue: Infinity }]) assert.throws(() => compileVisual(input([row])), CompileError);
  for (const [data, label] of [[[{ region: 'A', revenue: null }, { region: 'B', revenue: null }], 'No value'], [[], 'No results'], [null, 'Needs data']]) {
    assert.equal(compileVisual(input(data)).option.graphic[0].style.text, label);
  }
  assert.throws(() => compileVisual(input([{ region: 'A', revenue: 1 }, { region: 'A', revenue: 2 }])), /duplicate trend groups/);
});
for (const direction of ['ASC', 'DESC']) test(`KPI comparison, target totals and sparkline consume ${direction} measure order`, () => {
  const value = input([{ region: 'A', revenue: 40, profit: 50 }, { region: 'C', revenue: 10, profit: 20 }, { region: 'B', revenue: 20, profit: 30 }], [sort('SUM', direction)]);
  const c = config(value.definition);
  c.kpiOptions = { comparison: { comparisonMethod: 'DIFFERENCE' }, sparkline: { type: 'AREA' }, progressBar: {}, trendArrows: {} };
  c.fieldWells.targetValues = [{ numericalMeasureField: { fieldId: 'target', column: { dataSetIdentifier: 'sales_data', columnName: 'profit' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }];
  const result = compileVisual(value);
  assert.deepEqual(result.table.rows, direction === 'ASC' ? [['C', 10, 20], ['B', 20, 30], ['A', 40, 50]] : [['A', 40, 50], ['B', 20, 30], ['C', 10, 20]]);
  assert.equal(result.option.graphic[0].style.text, '70');
  assert.equal(result.option.graphic[1].style.text, direction === 'ASC' ? '↑ 20' : '↓ -10');
  assert.ok(result.option.graphic.some(g => g.style?.text === 'Target: 100'));
  assert.ok(result.option.series[0].areaStyle);
  c.kpiOptions.primaryValueDisplayType = 'COMPARISON';
  assert.equal(compileVisual(value).option.graphic[0].style.text, direction === 'ASC' ? '↑ 20' : '↓ -10');
  c.kpiOptions.comparison.comparisonMethod = 'PERCENT_DIFFERENCE';
  assert.equal(compileVisual(value).option.graphic[0].style.text, direction === 'ASC' ? '↑ 100%' : '↓ -50%');
});
test('84 field-sort/no-sort outputs match base 124b6f76 apart from preserved aggregation metadata (#313)', () => {
  const { hashes } = JSON.parse(readFileSync(new URL('./fixtures/kpi-trend-aggregation-sort-baseline.json', import.meta.url), 'utf8'));
  const cases = baselineInputs(); assert.equal(Object.keys(cases).length, 84); assert.deepEqual(Object.keys(hashes), Object.keys(cases));
  for (const [name, value] of Object.entries(cases)) {
    const compiled = withoutBindingAggregation(compileVisual(value));
    assert.equal(createHash('sha256').update(JSON.stringify(compiled)).digest('hex'), hashes[name], name);
  }
});
const invalidDraftSorts = [null, [], {}, { ...draftSort(), extra: true },
  ...['fieldId', 'direction', 'measureFieldId', 'aggregation'].flatMap(key => [null, '', ' ', 5].map(value => ({ ...draftSort(), [key]: value }))),
  ...['fieldId', 'direction', 'measureFieldId', 'aggregation'].map(key => { const s = draftSort(); delete s[key]; return s; }),
  { ...draftSort(), fieldId: 'region\0' }, { ...draftSort(), fieldId: ' region' }, { ...draftSort(), fieldId: 'missing' },
  { ...draftSort(), direction: 'DOWN' }, { ...draftSort(), measureFieldId: 'revenue\0' }, { ...draftSort(), measureFieldId: ' revenue' },
  { ...draftSort(), measureFieldId: 'profit' }, { ...draftSort(), measureFieldId: 'region' }, { ...draftSort(), aggregation: 'AVG' }];
test('draft reducer/storage accept complete pairs, reject malformed/unbound sorts and clone action input', () => {
  for (const aggregation of SORT_AGGREGATIONS) {
    const d = authorReducer(draft(), { type: 'kpi-trend-sort', sort: draftSort(aggregation) });
    assert.deepEqual(selected(d).kpiTrendSort, draftSort(aggregation)); assert.deepEqual(parseDraft(JSON.stringify(d)), d);
    assert.deepEqual(config(serializeVisual(selected(d))).sortConfiguration.trendGroupSort, [sort(aggregation)]);
    assert.equal(compileVisual(buildAuthorPreview(selected(d))).state, 'ready');
  }
  const d = sortedDraft();
  for (const sort of invalidDraftSorts) {
    assert.equal(selected(authorReducer(d, { type: 'kpi-trend-sort', sort })), selected(d), JSON.stringify(sort));
    const bad = structuredClone(d); selected(bad).kpiTrendSort = sort; assert.throws(() => parseDraft(JSON.stringify(bad)), undefined, JSON.stringify(sort));
  }
  assert.equal(kpiTrendSortValid({ ...draftSort(), measureFieldId: 'revenue ' }), false);
  const actionSort = draftSort(), copied = authorReducer(draft(), { type: 'kpi-trend-sort', sort: actionSort }); actionSort.aggregation = 'COUNT';
  assert.equal(selected(copied).kpiTrendSort.aggregation, 'SUM');
  const cleared = authorReducer(d, { type: 'kpi-trend-sort', sort: undefined });
  assert.deepEqual(serializeVisual(selected(cleared)), serializeVisual(selected(draft())));
  for (const kind of ['bar', 'table', 'pivot', 'gauge']) {
    const other = authorReducer(emptyDraft(), { type: 'add', kind });
    assert.equal(selected(authorReducer(other, { type: 'kpi-trend-sort', sort: draftSort() })).kpiTrendSort, undefined);
  }
});
test('draft migrations and collection restores validate sorts before accepting or writing them', () => {
  const values = new Map(), storage = () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  const access = { mode: 'local' }, store = createDraftStore(storage, access), legacyKey = `local.${DRAFT_KEY}`, key = draftStorageKey(access);
  const d = sortedDraft(); values.set(legacyKey, JSON.stringify(d));
  assert.deepEqual(store.restore().draft, d); store.save(d, 'legacy'); assert.deepEqual(store.open('legacy'), d);
  const good = values.get(key);
  for (const sort of invalidDraftSorts) {
    const bad = structuredClone(d); selected(bad).kpiTrendSort = sort;
    values.delete(key); values.set(legacyKey, JSON.stringify(bad));
    assert.throws(() => store.restore()); assert.equal(values.has(key), false);
    const collection = JSON.parse(good); collection.entries[0].draft = bad; values.set(key, JSON.stringify(collection));
    assert.throws(() => store.restore()); assert.throws(() => store.save(bad)); assert.equal(values.get(key), JSON.stringify(collection));
  }
  const legacy = { version: 1, visuals: [{ id: 'visual-1', kind: 'kpi', title: '', dimension: null, measures: ['revenue'], donut: false, kpiTrendSort: draftSort() }], selectedId: 'visual-1' };
  assert.throws(() => parseDraft(JSON.stringify(legacy)), /Invalid legacy visual/);
});
test('trend/measure removal or replacement clears stale sorts; unrelated edits preserve them', () => {
  const d = sortedDraft();
  for (const action of [{ type: 'unassign', well: 'trend', field: 'region' }, { type: 'unassign', field: 'region' }, { type: 'assign', well: 'trend', field: 'order_date' },
    { type: 'unassign', well: 'values', field: 'revenue' }, { type: 'unassign', field: 'revenue' }, { type: 'assign', well: 'values', field: 'profit' }, { type: 'kind', kind: 'bar' }]) {
    const next = authorReducer(d, action); assert.equal(selected(next).kpiTrendSort, undefined, JSON.stringify(action)); assert.doesNotThrow(() => parseDraft(JSON.stringify(next)));
  }
  for (const action of [{ type: 'title', title: 'Changed' }, { type: 'assign', well: 'target', field: 'profit' }, { type: 'assign', well: 'trend', field: 'region' }, { type: 'assign', well: 'values', field: 'revenue' }]) assert.deepEqual(selected(authorReducer(d, action)).kpiTrendSort, draftSort());
  const visual = selected(d); visual.o = { question: 'sum revenue', interpretation: interpretQuestion('sum revenue', dataFields([])).interpretations[0] };
  for (const changes of [{ measures: [] }, { measures: ['profit'] }, { trendField: 'order_date' }]) {
    const next = authorReducer(d, { type: 'o-replace', id: visual.id, visual: { ...visual, ...changes }, calculatedFields: [] });
    assert.equal(selected(next).kpiTrendSort, undefined); assert.doesNotThrow(() => parseDraft(JSON.stringify(next)));
  }
});
const bundleVisual = b => b.members[0].resource.definition.sheets[0].visuals[0];
const bundleConfig = b => config(bundleVisual(b));
for (const source of ['bundle', 'api']) for (const wrapped of [false, true]) test(`${source}, wrapped=${wrapped}: editable import preserves native IDs, dataset, edits and clearing`, () => {
  const bundle = exportBundle(sortedDraft()), c = bundleConfig(bundle);
  c.fieldWells.trendGroups[0].categoricalDimensionField.fieldId = 'native-trend';
  c.fieldWells.values[0].numericalMeasureField.fieldId = 'native-value';
  c.sortConfiguration.trendGroupSort[0].aggregationSort.fieldId = 'native-trend';
  if (wrapped) c.fieldWells = { kpiFieldWells: c.fieldWells };
  if (source === 'api') bundle.members[0].resource.definition = convertDefinition(projectDefinition(bundle.members[0].resource.definition));
  const imported = importBundle(bundle);
  assert.deepEqual(selected(imported).kpiTrendSort, draftSort()); assert.deepEqual(selected(imported).imported.issues, []);
  assert.deepEqual(parseDraft(JSON.stringify(imported)), JSON.parse(JSON.stringify(imported)));
  assert.deepEqual(exportBundle(imported), bundle);
  const edited = authorReducer(imported, { type: 'kpi-trend-sort', sort: draftSort('AVERAGE', 'ASC') }), output = exportBundle(edited);
  const expected = sort('AVERAGE', 'ASC'); expected.aggregationSort.fieldId = 'native-trend'; expected.aggregationSort.column.dataSetIdentifier = c.sortConfiguration.trendGroupSort[0].aggregationSort.column.dataSetIdentifier;
  assert.deepEqual(bundleConfig(output).sortConfiguration.trendGroupSort, [expected]);
  assert.deepEqual(selected(importBundle(output)).kpiTrendSort, draftSort('AVERAGE', 'ASC'));
  assert.equal(normalizeVisual('bundle', bundleVisual(output)).trendGroupSort.measureFieldId, 'native-value');
  for (const action of [{ type: 'kpi-trend-sort', sort: undefined }, { type: 'unassign', well: 'trend', field: 'region' }, { type: 'assign', well: 'values', field: 'profit' }]) {
    assert.equal(bundleConfig(exportBundle(authorReducer(imported, action))).sortConfiguration?.trendGroupSort, undefined);
  }
  const fieldSorted = exportBundle(authorReducer(imported, { type: 'kpi-trend-sort', sort: { fieldId: 'region', direction: 'ASC' } }));
  assert.deepEqual(bundleConfig(fieldSorted).sortConfiguration.trendGroupSort, [{ fieldSort: { fieldId: 'native-trend', direction: 'ASC' } }]);
});
for (const source of ['bundle', 'api']) test(`${source}: malformed/direction-less imports retain read-only diagnostics and raw definitions`, () => {
  for (const sorts of [...malformed, mutate(s => { delete s.direction; })]) {
    const bundle = exportBundle(draft()); bundleConfig(bundle).sortConfiguration = { trendGroupSort: sorts };
    if (source === 'api') bundle.members[0].resource.definition = convertDefinition(projectDefinition(bundle.members[0].resource.definition));
    const imported = importBundle(bundle);
    assert.equal(selected(imported).kpiTrendSort, undefined, JSON.stringify(sorts)); assert.ok(selected(imported).imported.issues.length, JSON.stringify(sorts));
    assert.deepEqual(exportBundle(imported), bundle);
    assert.deepEqual(bundleConfig(exportBundle(authorReducer(imported, { type: 'title', title: 'Retained' }))).sortConfiguration, bundleConfig(bundle).sortConfiguration);
    assert.doesNotThrow(() => parseDraft(JSON.stringify(imported)));
  }
});
for (const type of ['remap', 'sheet-remap']) test(`${type}: dataset rebind preserves valid native trend IDs and clears absent sort measures`, () => {
  const bundle = exportBundle(sortedDraft()), c = bundleConfig(bundle);
  bundle.members[0].resource.definition.dataSetIdentifierDeclarations[0].dataSetArn = 'urn:synthetic:kpi-source';
  const oldIdentifier = c.sortConfiguration.trendGroupSort[0].aggregationSort.column.dataSetIdentifier;
  const newIdentifier = 'remote_data';
  bundle.members[0].resource.definition.dataSetIdentifierDeclarations[0].identifier = newIdentifier;
  for (const f of [...c.fieldWells.trendGroups, ...c.fieldWells.values]) Object.values(f)[0].column.dataSetIdentifier = newIdentifier;
  c.sortConfiguration.trendGroupSort[0].aggregationSort.column.dataSetIdentifier = newIdentifier;
  assert.notEqual(oldIdentifier, newIdentifier);
  c.fieldWells.trendGroups[0].categoricalDimensionField.fieldId = 'native-trend'; c.sortConfiguration.trendGroupSort[0].aggregationSort.fieldId = 'native-trend';
  const imported = importBundle(bundle), action = { type, id: type === 'remap' ? selected(imported).id : activeSheet(imported).id };
  const remapped = authorReducer(imported, action), output = exportBundle(remapped);
  assert.deepEqual(selected(remapped).kpiTrendSort, draftSort());
  assert.equal(bundleConfig(output).sortConfiguration.trendGroupSort[0].aggregationSort.column.dataSetIdentifier, 'opensight_local_sales');
  assert.equal(normalizeVisual('bundle', bundleVisual(output)).trendGroupSort.fieldId, 'native-trend');
  assert.doesNotThrow(() => parseDraft(JSON.stringify(remapped)));
  c.fieldWells.values[0].numericalMeasureField.column.columnName = 'missing'; c.sortConfiguration.trendGroupSort[0].aggregationSort.column.columnName = 'missing';
  const clean = authorReducer(importBundle(bundle), action);
  assert.equal(selected(clean).kpiTrendSort, undefined); assert.equal(bundleConfig(exportBundle(clean)).sortConfiguration?.trendGroupSort, undefined);
});
test('Properties switches modes, validates measure/aggregation, preserves direction and resets defaults', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() { [current, dispatch] = useReducer(authorReducer, draft()); return createElement(KpiTrendSortOptions, { visual: selected(current), dispatch }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const control = label => renderer.root.findByProps({ 'aria-label': label });
  const change = async (label, value) => act(() => control(label).props.onChange({ target: { value } }));
  assert.equal(control('Trend sort mode').props.value, 'field');
  await change('Trend sort mode', 'measure'); assert.deepEqual(selected(current).kpiTrendSort, draftSort('SUM', 'ASC'));
  assert.deepEqual(control('Trend sort measure').findAllByType('option').map(o => o.props.value), ['revenue']);
  assert.deepEqual(control('Trend sort aggregation').findAllByType('option').map(o => o.props.value), [...SORT_AGGREGATIONS]);
  await change('Trend sort aggregation', 'AVERAGE');
  await act(() => control('Trend sort descending').props.onClick()); assert.deepEqual(selected(current).kpiTrendSort, draftSort('AVERAGE', 'DESC'));
  for (const [label, value] of [['Trend sort measure', 'profit'], ['Trend sort aggregation', 'AVG'], ['Trend sort mode', 'invalid']]) { await change(label, value); assert.deepEqual(selected(current).kpiTrendSort, draftSort('AVERAGE', 'DESC')); }
  await change('Trend sort mode', 'field'); assert.deepEqual(selected(current).kpiTrendSort, { fieldId: 'region', direction: 'DESC' });
  await change('Trend sort mode', 'measure'); assert.deepEqual(selected(current).kpiTrendSort, draftSort());
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'Reset trend sort').props.onClick());
  assert.equal(selected(current).kpiTrendSort, undefined); assert.equal(control('Trend sort mode').props.value, 'field'); assert.equal(control('Trend sort ascending').props['aria-pressed'], true);
  await act(() => dispatch({ type: 'unassign', well: 'values', field: 'revenue' }));
  assert.equal(control('Trend sort mode').findAllByType('option').find(o => o.props.value === 'measure').props.disabled, true);
  await change('Trend sort mode', 'measure'); assert.equal(selected(current).kpiTrendSort, undefined);
  await act(() => dispatch({ type: 'unassign', well: 'trend', field: 'region' })); assert.equal(renderer.toJSON(), null);
});
