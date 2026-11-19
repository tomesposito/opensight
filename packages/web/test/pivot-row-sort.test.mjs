import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../build/test/authoring.js';
import { interpretQuestion } from '@opensight/o-interpreter';
import { dataFields } from '../build/test/authoring.js';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { PivotRowSortOptions } from '../build/test/PropertiesSections.js';
import { parseDraft, pivotRowSortValid } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { input } from './fixtures/pivot-field-sort-inputs.mjs';

const config = value => Object.values(value.definition)[0].chartConfiguration;
const wells = value => config(value).fieldWells.pivotTableAggregatedFieldWells;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const sort = (aggregation = 'SUM', direction = 'DESC', dataSetIdentifier = 'data') => ({
  sortBy: { dataSetIdentifier, columnName: 'revenue' }, direction,
  aggregationFunction: { numericalAggregationFunction: { simpleNumericalAggregation: aggregation } },
});
const sorted = (value = input(), sorts = [sort()]) => { config(value).sortConfiguration = { rowSort: sorts }; return value; };
const mutate = fn => { const value = sort(); fn(value); return [value]; };
const malformed = [null, {}, 'sort', 3, [null], [[]], [{}], [sort(), sort()],
  ...['extra', 'fieldId', 'sortBy', 'direction', 'aggregationFunction'].map(key => mutate(s => { s[key] = null; })),
  ...['asc', '', 1].map(direction => mutate(s => { s.direction = direction; })),
  ...[{}, [], { columnName: 'revenue' }, { dataSetIdentifier: 'data' }, { dataSetIdentifier: 'other', columnName: 'revenue' },
    { dataSetIdentifier: 'data', columnName: 'region' }, { dataSetIdentifier: 'data', columnName: 'missing' },
    { dataSetIdentifier: 'data', columnName: 'revenue', extra: true }, { dataSetIdentifier: '', columnName: 'revenue' },
    { dataSetIdentifier: 'data', columnName: '' }].map(sortBy => mutate(s => { s.sortBy = sortBy; })),
  ...[{}, [], { dateAggregationFunction: 'MAX' }, { categoricalAggregationFunction: 'COUNT' },
    { numericalAggregationFunction: {} }, { numericalAggregationFunction: [] },
    { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM', extra: true } },
    { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM' }, extra: true },
    ...['AVG', 'MEDIAN', 'STDEV', null, 5].map(simpleNumericalAggregation => ({ numericalAggregationFunction: { simpleNumericalAggregation } }))
  ].map(aggregationFunction => mutate(s => { s.aggregationFunction = aggregationFunction; }))];

for (const source of ['bundle', 'api']) {
  test(`${source}: row sort resolves bound measure IDs and defaults direction/aggregation`, () => {
    const value = sorted(); wells(value).values[0].numericalMeasureField.fieldId = 'native-measure';
    assert.deepEqual(normalize(dialect(value, source)).rowSort, { measureFieldId: 'native-measure', direction: 'DESC', aggregation: 'SUM' });
    delete config(value).sortConfiguration.rowSort[0].direction;
    delete config(value).sortConfiguration.rowSort[0].aggregationFunction;
    assert.deepEqual(normalize(dialect(value, source)).rowSort, { measureFieldId: 'native-measure', direction: 'ASC', aggregation: 'SUM' });
    assert.equal(normalize(dialect(sorted(input(), []), source)).rowSort, undefined);
    assert.deepEqual(compileVisual(dialect(sorted(input(), []), source)), compileVisual(dialect(input(), source)));
  });
  test(`${source}: malformed entries and unknown keys at every level fail closed`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(sorted(input(), sorts), source)), CompileError, JSON.stringify(sorts));
    for (const key of ['unknown', 'rowLabelSort', 'categorySort', 'trendGroupSort']) {
      const value = sorted(); config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), CompileError, key);
    }
    const value = sorted(); wells(value).rows = [];
    assert.throws(() => normalize(dialect(value, source)), /row sort requires a Rows dimension/);
    assert.doesNotThrow(() => normalize(dialect(sorted(value, []), source)));
  });
  test(`${source}: non-pivot kinds reject the pivot row sort shape`, () => {
    for (const kind of ['bar','bar100','line','area','combo','pie','table','kpi','insight','radar','sankey','waterfall','treemap','funnel','heatmap','box','histogram','scatter','wordCloud','pointMap','filledMap','gauge']) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      assert.throws(() => normalize(dialect(sorted(value, [sort()]), source)), CompileError, kind);
      // An empty list is a no-op only where rowSort is a native key (pivot, table).
      if (kind !== 'table') assert.throws(() => normalize(dialect(sorted(value, []), source)), CompileError, kind);
    }
  });
}
test('converter maps pivot RowSort without a FieldId and round-trips both dialects', () => {
  const internal = definition(sorted().definition), native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].PivotTableVisual.ChartConfiguration.SortConfiguration, { RowSort: [{
    SortBy: { DataSetIdentifier: 'data', ColumnName: 'revenue' }, Direction: 'DESC',
    AggregationFunction: { NumericalAggregationFunction: { SimpleNumericalAggregation: 'SUM' } },
  }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(projectDefinition(convertDefinition(native)), native);
});
test('converter keeps table RowSort wrapper entries in their own shape', () => {
  const tableDraft = authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'table' }),
    { type: 'group-sort', sort: { fieldId: 'region', direction: 'ASC' } });
  const internal = definition(serializeVisual(selected(tableDraft)));
  assert.deepEqual(config({ definition: internal.sheets[0].visuals[0] }).sortConfiguration,
    { rowSort: [{ fieldSort: { fieldId: 'region', direction: 'ASC' } }] });
  const native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].TableVisual.ChartConfiguration.SortConfiguration,
    { RowSort: [{ FieldSort: { FieldId: 'region', Direction: 'ASC' } }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(projectDefinition(convertDefinition(native)), native);
});

const data = [
  { region: 'West', revenue: 4 }, { region: 'East', revenue: 9 }, { region: 'South', revenue: 6 }, { region: 'North', revenue: 8 },
  { region: 'West', revenue: 4 }, { region: 'East', revenue: null }, { region: 'South', revenue: 2 }, { region: 'West', revenue: 4 },
  { region: null, revenue: null }, { region: null, revenue: null },
].map((row, i) => ({ category: `Product ${i}`, year: 2024, quarter: 'Q1', profit: 1, ...row }));
const asc = { SUM: ['South','North','East','West',null], AVERAGE: ['West','South','North','East',null], MIN: ['South','West','North','East',null],
  MAX: ['West','South','North','East',null], COUNT: ['East','North','South','West',null], DISTINCT_COUNT: ['West','East','North','South',null] };
const desc = { SUM: ['West','East','South','North',null], AVERAGE: ['East','North','West','South',null], MIN: ['East','North','West','South',null],
  MAX: ['East','North','South','West',null], COUNT: ['West','South','East','North',null], DISTINCT_COUNT: ['South','West','East','North',null] };
const outerGroups = table => [...new Set(table.rowGroupPaths.filter(p => p.length).map(p => p[0]))];
for (const aggregation of Object.keys(asc)) for (const direction of ['ASC','DESC']) for (const source of ['bundle','api']) {
  test(`${source}: ${aggregation} ${direction} ranks outer row groups with stable ties and null aggregates last`, () => {
    const value = sorted(input({ data, totals: true }), [sort(aggregation, direction)]), before = structuredClone(value.rows);
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(outerGroups(table), (direction === 'ASC' ? asc : desc)[aggregation]);
    assert.deepEqual(table.rows.at(-1).slice(2), [37, 10]);
    assert.deepEqual(value.rows, before);
  });
}
test('multi-level rows preserve inner first appearance and explicit sorts; outer sort overrides only its field sort', () => {
  const table = compileVisual(sorted()).table;
  assert.deepEqual(table.rowGroupPaths, [['East','B'],['East','A'],['West','B'],['West','A'],[null,null]]);
  assert.deepEqual(table.columns.slice(2).filter((_, i) => i % 2 === 0), [
    'year: 2,025 / quarter: Q2 · revenue', 'year: 2,025 / quarter: Q1 · revenue',
    'year: 2,024 / quarter: Q2 · revenue', 'year: 2,024 / quarter: Q1 · revenue', 'year: (null) / quarter: (null) · revenue',
  ]);
  const value = sorted(input(), [sort('SUM', 'ASC')]);
  config(value).sortConfiguration.fieldSortOptions = [{ fieldId: 'region', sortDirection: 'DESC' },
    { fieldId: 'category', sortDirection: 'ASC' }, { fieldId: 'year', sortDirection: 'ASC' }];
  const sortedTable = compileVisual(value).table;
  assert.deepEqual(sortedTable.rowGroupPaths, [['West','A'],['West','B'],['East','A'],['East','B'],[null,null]]);
  const tied = sorted(input({ data: data.filter(row => row.region !== null).map(row => ({ ...row, revenue: 1 })) }), [sort('MAX')]);
  config(tied).sortConfiguration.fieldSortOptions = [{ fieldId: 'region', sortDirection: 'DESC' }];
  assert.deepEqual(outerGroups(compileVisual(tied).table), ['West','East','South','North']);
});
test('row and column sorts compose: each orders its own outer axis', () => {
  const value = input();
  config(value).sortConfiguration = { rowSort: [sort('SUM', 'ASC')], columnSort: [sort('SUM', 'DESC')] };
  const model = normalize(value);
  assert.deepEqual(model.rowSort, { measureFieldId: 'revenue', direction: 'ASC', aggregation: 'SUM' });
  assert.deepEqual(model.columnSort, { measureFieldId: 'revenue', direction: 'DESC', aggregation: 'SUM' });
  const table = compileVisual(value).table;
  assert.deepEqual(outerGroups(table), ['West','East',null]);
  assert.deepEqual(table.columns.slice(2).filter((_, i) => i % 2 === 0), [
    'year: 2,024 / quarter: Q2 · revenue', 'year: 2,024 / quarter: Q1 · revenue',
    'year: 2,025 / quarter: Q2 · revenue', 'year: 2,025 / quarter: Q1 · revenue', 'year: (null) / quarter: (null) · revenue',
  ]);
});
test('typed groups remain distinct, arbitrary measure IDs resolve aliases, and input rows stay frozen', () => {
  const value = sorted(input({ data: ['1', 1, null, false].map((region, i) => ({ ...data[0], region, revenue: i + 1 })) }));
  wells(value).values[0].numericalMeasureField.fieldId = 'native-measure';
  value.bindings = { 'native-measure': 'result_alias' };
  value.rows = value.rows.map(({ revenue, ...row }) => Object.freeze({ ...row, result_alias: revenue }));
  Object.freeze(value.rows);
  for (const source of ['bundle','api']) {
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(outerGroups(table), [false, null, 1, '1']);
    assert.deepEqual(table.rows.map(row => row[2]), [4,3,2,1]);
  }
});
test('empty/unavailable data works; non-finite aggregates and invalid result cells fail closed', () => {
  assert.equal(compileVisual(sorted(input({ data: [] }))).state, 'empty');
  assert.equal(compileVisual(sorted(input({ data: null }))).state, 'unavailable');
  for (const aggregation of ['SUM','AVERAGE']) assert.throws(() => compileVisual(sorted(input({ data: [data[0],data[1]].map(row => ({ ...row, region: 'West', revenue: 1e308 })) }), [sort(aggregation)])), /aggregation sort result must be finite/);
  for (const revenue of [Infinity, NaN, 'bad']) assert.throws(() => compileVisual(sorted(input({ data: [{ ...data[0], revenue }] }))), CompileError);
});
const cellsByIdentity = table => Object.fromEntries(table.rows.flatMap((row, i) => row.slice(table.dimensionCount).map((value, offset) =>
  [JSON.stringify([table.rowKinds[i], table.rowGroupPaths[i], table.columns[table.dimensionCount + offset]]), value])));
for (const totals of [false, true]) for (const subtotals of [false, true]) for (const columnTotals of [false, true]) for (const columnSubtotals of [false, true]) {
  test(`row ordering preserves detail and rollup values: rows ${totals}/${subtotals}, columns ${columnTotals}/${columnSubtotals}`, () => {
    const value = input({ totals, subtotals, columnTotals, columnSubtotals });
    const base = compileVisual(value).table, table = compileVisual(sorted(value)).table;
    assert.deepEqual(cellsByIdentity(table), cellsByIdentity(base));
    assert.deepEqual(table.columns, base.columns);
    if (totals) { assert.equal(table.rowKinds.at(-1), 'total'); assert.deepEqual(table.rowGroupPaths.at(-1), []); }
    if (columnTotals) assert.deepEqual(table.columns.slice(-2), ['Grand total · revenue','Grand total · profit']);
    if (totals && columnTotals) assert.deepEqual(table.rows.at(-1).slice(-2), [100,10]);
  });
}

const draftSort = (aggregation = 'SUM', direction = 'DESC') => ({ measureFieldId: 'revenue', aggregation, direction });
const pivotDraft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' });
const sortedDraft = () => authorReducer(pivotDraft(), { type: 'pivot-row-sort', sort: draftSort() });
const bundleVisual = bundle => bundle.members[0].resource.definition.sheets[0].visuals[0];
const bundleConfig = bundle => config({ definition: bundleVisual(bundle) });
test('draft reducer/storage validate structure, kind and measure membership and preserve last valid edits', () => {
  const sort = draftSort(), draft = authorReducer(pivotDraft(), { type: 'pivot-row-sort', sort });
  sort.direction = 'ASC'; assert.deepEqual(selected(draft).pivotRowSort, draftSort());
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  const invalid = [null, {}, [], 'sort', { ...draftSort(), extra: 1 }, { ...draftSort(), aggregation: 'AVG' },
    { ...draftSort(), direction: 'DOWN' }, { ...draftSort(), measureFieldId: '' }, { ...draftSort(), measureFieldId: ' ' },
    { ...draftSort(), measureFieldId: 'revenue\0' }, { ...draftSort(), measureFieldId: 'profit' }, { ...draftSort(), measureFieldId: 'category' }];
  for (const bad of invalid.slice(0,10)) assert.equal(pivotRowSortValid(bad), false);
  for (const sort of invalid) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'pivot-row-sort', sort })), selected(draft));
    const tampered = structuredClone(draft); selected(tampered).pivotRowSort = sort;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  assert.equal(selected(authorReducer(draft, { type: 'pivot-row-sort', sort: undefined })).pivotRowSort, undefined);
  const noRows = authorReducer(draft, { type: 'unassign', field: 'region' });
  assert.equal(selected(noRows).pivotRowSort, undefined);
  assert.equal(selected(authorReducer(noRows, { type: 'pivot-row-sort', sort: draftSort() })).pivotRowSort, undefined);
  selected(noRows).pivotRowSort = draftSort(); assert.throws(() => parseDraft(JSON.stringify(noRows)));
});
test('removing/replacing measures, removing Rows and changing kind clear stale sorts; unrelated edits preserve them', () => {
  const draft = sortedDraft();
  for (const action of [{ type: 'unassign', field: 'revenue' }, { type: 'unassign', field: 'revenue', well: 'values' },
    { type: 'unassign', field: 'region' }, { type: 'kind', kind: 'table' }]) {
    assert.equal(selected(authorReducer(draft, action)).pivotRowSort, undefined, JSON.stringify(action));
  }
  for (const action of [{ type: 'assign', field: 'profit' }, { type: 'title', title: 'Sorted' },
    { type: 'pivot-field-sorts', sorts: [{ fieldId: 'region', direction: 'ASC' }] }]) {
    assert.deepEqual(selected(authorReducer(draft, action)).pivotRowSort, draftSort());
  }
  const changed = authorReducer(draft, { type: 'kind', kind: 'pie' });
  assert.equal(selected(authorReducer(changed, { type: 'assign', field: 'profit' })).pivotRowSort, undefined);
  for (const kind of ['bar','bar100','pie','line','area','combo','table','kpi','insight']) {
    const other = authorReducer(emptyDraft(), { type: 'add', kind });
    assert.equal(selected(authorReducer(other, { type: 'pivot-row-sort', sort: draftSort() })).pivotRowSort, undefined);
    selected(other).pivotRowSort = draftSort();
    assert.equal(config({ definition: serializeVisual(selected(other)) }).sortConfiguration?.rowSort, undefined);
    assert.throws(() => parseDraft(JSON.stringify(other)));
  }
});
for (const aggregation of Object.keys(asc)) for (const source of ['bundle','api']) {
  test(`${source}: ${aggregation} import stays editable through storage, export, edit and clearing`, () => {
    const draft = authorReducer(pivotDraft(), { type: 'pivot-row-sort', sort: draftSort(aggregation) });
    const together = authorReducer(draft, { type: 'pivot-field-sorts', sorts: [{ fieldId: 'region', direction: 'ASC' }] });
    const bundle = exportBundle(together);
    if (source === 'api') bundle.members[0].resource.definition = convertDefinition(projectDefinition(bundle.members[0].resource.definition));
    assert.deepEqual(bundleConfig(bundle).sortConfiguration, { fieldSortOptions: [{ fieldId: 'region', sortDirection: 'ASC' }], rowSort: [sort(aggregation, 'DESC', 'sales_data')] });
    const imported = importBundle(bundle);
    assert.deepEqual(selected(imported).pivotRowSort, draftSort(aggregation));
    assert.deepEqual(selected(imported).imported.issues, []);
    assert.deepEqual(parseDraft(JSON.stringify(imported)), JSON.parse(JSON.stringify(imported)));
    assert.deepEqual(exportBundle(imported), bundle);
    const edited = authorReducer(imported, { type: 'pivot-row-sort', sort: draftSort(aggregation, 'ASC') });
    assert.deepEqual(selected(importBundle(exportBundle(edited))).pivotRowSort, draftSort(aggregation, 'ASC'));
    const cleared = authorReducer(imported, { type: 'pivot-row-sort', sort: undefined });
    assert.equal(selected(importBundle(exportBundle(cleared))).pivotRowSort, undefined);
    assert.deepEqual(selected(importBundle(exportBundle(cleared))).pivotFieldSorts, [{ fieldId: 'region', direction: 'ASC' }]);
  });
}
for (const source of ['bundle','api']) test(`${source}: invalid and missing-direction imports retain diagnostics and verbatim exports`, () => {
  for (const sorts of [...malformed, mutate(s => { delete s.direction; })]) {
    const bundle = exportBundle(pivotDraft());
    bundleConfig(bundle).sortConfiguration = { rowSort: JSON.parse(JSON.stringify(sorts).replaceAll('"data"', '"sales_data"')) };
    if (source === 'api') bundle.members[0].resource.definition = convertDefinition(projectDefinition(bundle.members[0].resource.definition));
    const imported = importBundle(bundle);
    assert.equal(selected(imported).pivotRowSort, undefined, JSON.stringify(sorts));
    assert.ok(selected(imported).imported.issues.length, JSON.stringify(sorts));
    assert.deepEqual(exportBundle(imported), bundle);
    const edited = authorReducer(imported, { type: 'title', title: 'Retained sort' });
    assert.deepEqual(bundleConfig(exportBundle(edited)).sortConfiguration, bundleConfig(bundle).sortConfiguration);
  }
  for (const extra of ['unknown','rowLabelSort']) {
    const bundle = exportBundle(sortedDraft()); bundleConfig(bundle).sortConfiguration[extra] = [];
    const imported = importBundle(bundle);
    assert.equal(selected(imported).pivotRowSort, undefined);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});
test('imports accept default SUM, empty lists and arbitrary measure IDs without rewriting original sort columns', () => {
  const bundle = exportBundle(sortedDraft());
  bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.values[0].numericalMeasureField.fieldId = 'native-measure';
  delete bundleConfig(bundle).sortConfiguration.rowSort[0].aggregationFunction;
  const imported = importBundle(bundle);
  assert.deepEqual(selected(imported).pivotRowSort, draftSort());
  assert.deepEqual(selected(imported).imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
  const remote = JSON.parse(JSON.stringify(bundle).replaceAll('sales_data','remote_data'));
  const edited = authorReducer(importBundle(remote), { type: 'pivot-row-sort', sort: draftSort('MAX','ASC') });
  const output = exportBundle(edited);
  assert.equal(bundleConfig(output).sortConfiguration.rowSort[0].sortBy.dataSetIdentifier, 'remote_data');
  assert.equal(normalize({ source: 'bundle', definition: bundleVisual(output), path: '$' }).rowSort.measureFieldId, 'native-measure');
  bundleConfig(bundle).sortConfiguration.rowSort = [];
  const empty = importBundle(bundle);
  assert.equal(selected(empty).pivotRowSort, undefined);
  assert.ok(selected(empty).imported.issues.every(issue => issue.includes('retained, read-only')));
  assert.deepEqual(exportBundle(empty), bundle);
});
for (const type of ['remap','sheet-remap']) test(`${type}: drops stale measure/row references and rebinds surviving sort columns`, () => {
  const remote = JSON.parse(JSON.stringify(exportBundle(sortedDraft())).replaceAll('sales_data','remote_data'));
  const imported = importBundle(remote), visual = selected(imported); visual.imported.local = false;
  const action = { type, id: type === 'remap' ? visual.id : activeSheet(imported).id };
  const remapped = authorReducer(imported, action);
  assert.deepEqual(selected(remapped).pivotRowSort, draftSort());
  const output = exportBundle(remapped);
  assert.equal(bundleConfig(output).sortConfiguration.rowSort[0].sortBy.dataSetIdentifier, 'opensight_local_sales');
  assert.deepEqual(normalize({ source: 'bundle', definition: bundleVisual(output), path: '$' }).rowSort, draftSort());
  assert.doesNotThrow(() => parseDraft(JSON.stringify(remapped)));
  for (const field of ['measure','row']) {
    const unavailable = structuredClone(remote);
    const well = bundleConfig(unavailable).fieldWells.pivotTableAggregatedFieldWells;
    if (field === 'measure') {
      well.values[0].numericalMeasureField.column.columnName = 'missing';
      bundleConfig(unavailable).sortConfiguration.rowSort[0].sortBy.columnName = 'missing';
    } else well.rows[0].categoricalDimensionField.column.columnName = 'missing';
    const stale = importBundle(unavailable); selected(stale).imported.local = false;
    assert.ok(selected(stale).pivotRowSort);
    const clean = authorReducer(stale, action);
    assert.equal(selected(clean).pivotRowSort, undefined);
    assert.equal(bundleConfig(exportBundle(clean)).sortConfiguration?.rowSort, undefined);
    assert.doesNotThrow(() => parseDraft(JSON.stringify(clean)));
  }
});

test('Properties expose display names, SUM/DESC defaults, all aggregations, directions, clearing and invalid-edit preservation', async t => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, authorReducer(authorReducer(pivotDraft(), { type: 'assign', field: 'profit' }),
      { type: 'formatting', formatting: { names: { revenue: 'Sales', profit: 'Margin' } } }));
    return createElement(PivotRowSortOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const control = label => renderer.root.findByProps({ 'aria-label': label });
  const change = (label, value) => act(() => control(label).props.onChange({ target: { value } }));
  assert.equal(renderer.root.findByType('summary').children[0], 'Row sort');
  assert.deepEqual(control('Row sort measure').findAllByType('option').map(o => [o.props.value, o.children[0]]), [['','Default'],['revenue','Sales'],['profit','Margin']]);
  assert.equal(control('Row sort measure').props.value, '');
  await change('Row sort measure','revenue');
  assert.deepEqual(selected(current).pivotRowSort, draftSort());
  assert.equal(control('Row sort descending').props['aria-pressed'], true);
  assert.deepEqual(control('Row sort aggregation').findAllByType('option').map(o => o.children[0]), ['Sum','Average','Min','Max','Count','Distinct count']);
  for (const aggregation of Object.keys(asc)) {
    await change('Row sort aggregation', aggregation);
    assert.equal(selected(current).pivotRowSort.aggregation, aggregation);
  }
  await change('Row sort measure','profit');
  await act(() => control('Row sort ascending').props.onClick());
  assert.deepEqual(selected(current).pivotRowSort, { measureFieldId: 'profit', aggregation: 'DISTINCT_COUNT', direction: 'ASC' });
  const before = structuredClone(selected(current));
  for (const bad of ['unknown', null]) await change('Row sort measure', bad);
  for (const bad of ['AVG', '', null]) await change('Row sort aggregation', bad);
  assert.deepEqual(selected(current), before);
  await change('Row sort measure',''); assert.equal(selected(current).pivotRowSort, undefined);
  await change('Row sort measure','revenue'); assert.deepEqual(selected(current).pivotRowSort, draftSort());
  await act(() => dispatch({ type: 'unassign', field: 'revenue' }));
  assert.equal(control('Row sort measure').props.value, '');
  await change('Row sort measure','profit');
  await act(() => dispatch({ type: 'unassign', field: 'region' }));
  assert.equal(control('Row sort measure').props.disabled, true);
  assert.equal(selected(current).pivotRowSort, undefined);
  await change('Row sort measure','profit'); assert.equal(selected(current).pivotRowSort, undefined);
  for (const kind of ['table','bar','pie','kpi','insight']) {
    await act(() => dispatch({ type: 'kind', kind }));
    assert.equal(renderer.root.findAllByType('details').length, 0);
  }
});

test('non-pivot and no-row imports remain read-only and preserve the original definition', () => {
  for (const kind of ['bar','table','kpi','insight']) {
    const draft = authorReducer(emptyDraft(), { type: 'add', kind }), bundle = exportBundle(draft);
    bundleConfig(bundle).sortConfiguration = { rowSort: [sort('SUM','DESC','sales_data')] };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).pivotRowSort, undefined);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported), bundle);
  }
  const bundle = exportBundle(sortedDraft());
  bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.rows = [];
  const imported = importBundle(bundle);
  assert.equal(selected(imported).pivotRowSort, undefined);
  assert.ok(selected(imported).imported.issues.length);
  assert.deepEqual(exportBundle(imported), bundle);
});

test('replacing O-generated wells clears a stale row measure sort before validating the new draft', () => {
  const draft = sortedDraft(), visual = selected(draft);
  visual.o = { question: 'sum revenue by region', interpretation: interpretQuestion('sum revenue by region', dataFields([])).interpretations[0] };
  for (const replacement of [{ ...visual, measures: ['profit'] }, { ...visual, kind: 'table', rows: [], dimension: null }]) {
    const next = authorReducer(draft, { type: 'o-replace', id: visual.id, visual: replacement, calculatedFields: [] });
    assert.deepEqual(selected(next).measures, replacement.measures);
    assert.equal(selected(next).kind, replacement.kind);
    assert.equal(selected(next).pivotRowSort, undefined);
    assert.doesNotThrow(() => parseDraft(JSON.stringify(next)));
  }
});
