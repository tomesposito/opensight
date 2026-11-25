import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual, VISUAL_TYPES } from '../build/test/authoring.js';
import { input, rows, baselineInputs } from './fixtures/pivot-field-sort-inputs.mjs';

const config = value => Object.values(value.definition)[0].chartConfiguration;
const wells = value => config(value).fieldWells.pivotTableAggregatedFieldWells;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const sortBy = (fieldId = 'region', direction = 'ASC') => ({ fieldSort: { fieldId, direction } });
const sorted = (value = input(), sorts = [sortBy()]) => { config(value).sortConfiguration = { rowLabelSort: sorts }; return value; };
const malformed = [null, {}, 'sort', 3, [null], [[]], [{}], [{ fieldSort: null }], [{ fieldSort: [] }], [{ fieldSort: {} }],
  ...[null, 'asc', 'DOWN', '', 3].map(direction => [sortBy('region', direction)]),
  ...[null, 1, '', ' ', 'missing', 'revenue', 'profit', 'year', 'quarter'].map(fieldId => [sortBy(fieldId)]),
  [{ ...sortBy(), extra: true }], [{ ...sortBy(), aggregationSort: {} }], [{ fieldSort: { ...sortBy().fieldSort, extra: true } }],
  [{ fieldId: 'region', direction: 'ASC' }], [{ fieldSort: { fieldId: 'region', sortDirection: 'ASC' } }], [sortBy(), sortBy('region', 'DESC')]];

for (const source of ['bundle', 'api']) {
  test(`${source}: row label sorts parse multiple row fields, default ASC, and empty lists`, () => {
    for (const fieldId of ['region', 'category']) for (const direction of ['ASC', 'DESC']) {
      assert.deepEqual(normalize(dialect(sorted(input(), [sortBy(fieldId, direction)]), source)).rowLabelSort, [{ fieldId, direction }]);
    }
    assert.deepEqual(normalize(dialect(sorted(input(), [{ fieldSort: { fieldId: 'region' } }, sortBy('category', 'DESC')]), source)).rowLabelSort,
      [{ fieldId: 'region', direction: 'ASC' }, { fieldId: 'category', direction: 'DESC' }]);
    assert.equal(normalize(dialect(sorted(input(), []), source)).rowLabelSort, undefined);
    const noRows = input(); wells(noRows).rows = [];
    assert.doesNotThrow(() => normalize(dialect(sorted(noRows, []), source)));
    assert.throws(() => normalize(dialect(sorted(noRows), source)), /bound row dimension/);
  });
  test(`${source}: malformed row label lists, wrappers, fields and directions fail closed`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(sorted(input(), sorts), source)), CompileError, JSON.stringify(sorts));
    assert.throws(() => normalize(dialect(sorted(input(), [sortBy(), sortBy()]), source)), /duplicate row label sort/);
    for (const sortConfiguration of [null, [], 'sort', 3, { rowLabelSort: [], extra: true }]) {
      const value = input(); config(value).sortConfiguration = sortConfiguration;
      assert.throws(() => normalize(dialect(value, source)), CompileError);
    }
    for (const key of ['categorySort', 'trendGroupSort', 'smallMultiplesSort']) {
      const value = sorted(); config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
  });
  test(`${source}: every non-pivot kind rejects rowLabelSort, including an empty list`, () => {
    for (const { kind } of VISUAL_TYPES.filter(v => v.kind !== 'pivot')) for (const sorts of [[], [sortBy()]]) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      assert.throws(() => normalize(dialect(sorted(value, sorts), source)), CompileError, kind);
    }
  });
  test(`${source}: row levels sort independently and preserve column order and unsorted children`, () => {
    const compile = sorts => compileVisual(dialect(sorted(input(), sorts), source)).table;
    const base = compile([]);
    assert.deepEqual(compile([sortBy()]).rowGroupPaths, [['East', 'B'], ['East', 'A'], ['West', 'B'], ['West', 'A'], [null, null]]);
    assert.deepEqual(compile([sortBy('category')]).rowGroupPaths, [['West', 'A'], ['West', 'B'], ['East', 'A'], ['East', 'B'], [null, null]]);
    const both = [sortBy(), sortBy('category')];
    assert.deepEqual(compile(both).rowGroupPaths, [['East', 'A'], ['East', 'B'], ['West', 'A'], ['West', 'B'], [null, null]]);
    assert.deepEqual(compile(both), compile([...both].reverse()));
    assert.deepEqual(compile(both).columns, base.columns);
    assert.deepEqual(compile([sortBy('region', 'DESC')]).rowGroupPaths, base.rowGroupPaths);
  });
  test(`${source}: native RowLabelSort supersedes the same fieldSortOptions entry only`, () => {
    const value = sorted(input(), [sortBy()]);
    config(value).sortConfiguration.fieldSortOptions = [
      { fieldId: 'region', sortDirection: 'DESC' }, { fieldId: 'category', sortDirection: 'ASC' },
      { fieldId: 'year', sortDirection: 'ASC' }, { fieldId: 'quarter', sortDirection: 'ASC' },
    ];
    const base = structuredClone(value); delete config(base).sortConfiguration.rowLabelSort;
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(table.rowGroupPaths, [['East', 'A'], ['East', 'B'], ['West', 'A'], ['West', 'B'], [null, null]]);
    assert.deepEqual(table.columns, compileVisual(dialect(base, source)).table.columns);
    config(value).sortConfiguration.rowLabelSort.push(sortBy('category', 'DESC'));
    assert.deepEqual(compileVisual(dialect(value, source)).table.rowGroupPaths, [['East', 'B'], ['East', 'A'], ['West', 'B'], ['West', 'A'], [null, null]]);
  });
  test(`${source}: measure RowSort overrides only outer RowLabelSort, including stable aggregate ties`, () => {
    const value = sorted(input(), [sortBy(), sortBy('category')]);
    config(value).sortConfiguration.rowSort = [{ sortBy: { dataSetIdentifier: 'data', columnName: 'revenue' }, direction: 'ASC' }];
    config(value).sortConfiguration.columnSort = [{ sortBy: { dataSetIdentifier: 'data', columnName: 'profit' }, direction: 'ASC' }];
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(table.rowGroupPaths, [['West', 'A'], ['West', 'B'], ['East', 'A'], ['East', 'B'], [null, null]]);
    const base = structuredClone(value); delete config(base).sortConfiguration.rowLabelSort;
    assert.deepEqual(table.columns, compileVisual(dialect(base, source)).table.columns);
    // Equal outer aggregates preserve first appearance even against ASC labels.
    value.rows = value.rows.map(row => ({ ...row, revenue: row.region === null ? null : 1 }));
    assert.deepEqual(compileVisual(dialect(value, source)).table.rowGroupPaths, table.rowGroupPaths);
  });
}

for (const direction of ['ASC', 'DESC']) test(`${direction}: numeric, text, boolean, typed keys and nulls use the shared field-sort order`, () => {
  for (const [cells, asc, desc] of [
    [[10, null, 2, 30], [2, 10, 30, null], [30, 10, 2, null]],
    [['Z', null, 'A', 'M'], ['A', 'M', 'Z', null], ['Z', 'M', 'A', null]],
    [[true, null, false], [false, true, null], [true, false, null]],
    [['2', 2, null, '10', false], [2, '10', '2', false, null], [false, '2', '10', 2, null]],
  ]) {
    const value = input({ data: cells.map((region, i) => ({ ...rows[0], region, revenue: i + 1 })) });
    wells(value).rows = [wells(value).rows[0]]; wells(value).columns = [];
    const before = structuredClone(value.rows);
    const table = compileVisual(sorted(value, [sortBy('region', direction)])).table;
    const expected = direction === 'ASC' ? asc : desc;
    assert.deepEqual(table.rows.map(row => row[0]), expected);
    assert.deepEqual(table.rows.map(row => row[1]), expected.map(cell => cells.findIndex(v => v === cell) + 1));
    assert.deepEqual(value.rows, before);
    config(value).sortConfiguration = { fieldSortOptions: [{ fieldId: 'region', sortDirection: direction }] };
    assert.deepEqual(compileVisual(value).table, table);
  }
});
const cellsByIdentity = table => Object.fromEntries(table.rows.flatMap((row, i) => row.slice(table.dimensionCount).map((value, offset) =>
  [JSON.stringify([table.rowKinds[i], table.rowGroupPaths[i], table.columns[table.dimensionCount + offset]]), value])));
for (const totals of [false, true]) for (const subtotals of [false, true]) for (const columnTotals of [false, true]) for (const columnSubtotals of [false, true]) {
  test(`row label sorts preserve every cell and rollup: rows ${totals}/${subtotals}, columns ${columnTotals}/${columnSubtotals}`, () => {
    const value = input({ totals, subtotals, columnTotals, columnSubtotals });
    const before = structuredClone(value.rows), base = compileVisual(value).table;
    const table = compileVisual(sorted(value, [sortBy(), sortBy('category')])).table;
    assert.deepEqual(cellsByIdentity(table), cellsByIdentity(base));
    assert.deepEqual(table.columns, base.columns);
    assert.deepEqual(value.rows, before);
    if (totals) { assert.equal(table.rowKinds.at(-1), 'total'); assert.deepEqual(table.rowGroupPaths.at(-1), []); }
    if (columnTotals) assert.deepEqual(table.columns.slice(-2), ['Grand total · revenue', 'Grand total · profit']);
    if (subtotals) {
      assert.deepEqual(table.rowKinds.slice(0, 6), ['detail', 'detail', 'subtotal', 'detail', 'detail', 'subtotal']);
      assert.deepEqual(table.rows[2].slice(0, 2), ['East', 'Subtotal']);
      assert.deepEqual(table.rows[5].slice(0, 2), ['West', 'Subtotal']);
    }
    if (totals && columnTotals) assert.deepEqual(table.rows.at(-1).slice(-2), [100, 10]);
  });
}
test('row label sorting resolves native IDs and result aliases independently of column names', () => {
  const value = input(); wells(value).rows[0].categoricalDimensionField.fieldId = 'native-row';
  value.bindings = { 'native-row': 'alias' };
  value.rows = value.rows.map(({ region, ...row }) => ({ ...row, alias: region }));
  for (const source of ['bundle', 'api']) {
    assert.equal(compileVisual(dialect(sorted(value, [sortBy('native-row')]), source)).table.rows[0][0], 'East');
    assert.throws(() => normalize(dialect(sorted(value), source)), /bound row dimension/);
  }
});
test('converter round-trips the FieldSort wrapper in both dialects', () => {
  const value = sorted(input(), [sortBy(), sortBy('category', 'DESC')]);
  const internal = definition(value.definition), native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].PivotTableVisual.ChartConfiguration.SortConfiguration,
    { RowLabelSort: [{ FieldSort: { FieldId: 'region', Direction: 'ASC' } }, { FieldSort: { FieldId: 'category', Direction: 'DESC' } }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(projectDefinition(convertDefinition(native)), native);
  assert.deepEqual(compileVisual(dialect(value, 'api')), compileVisual(value));
});
test('empty row label sorts preserve full output bytes across all baseline inputs', () => {
  const bytes = value => JSON.stringify(compileVisual(value), (_, v) => typeof v === 'function' ? v.toString() : v);
  for (const value of Object.values(baselineInputs())) assert.equal(bytes(sorted(structuredClone(value), [])), bytes(value));
});

import { parseDraft, pivotRowLabelSortsValid, dataFields } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { interpretQuestion } from '@opensight/o-interpreter';
const pivotDraft = () => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' }), { type: 'assign', field: 'category', well: 'rows' });
const draftSorts = [{ fieldId: 'region', direction: 'ASC' }, { fieldId: 'category', direction: 'DESC' }];
const sortedDraft = () => authorReducer(pivotDraft(), { type: 'pivot-row-label-sorts', sorts: draftSorts });
const bundleConfig = bundle => Object.values(bundle.members[0].resource.definition.sheets[0].visuals[0])[0].chartConfiguration;
const invalidDraftSorts = [null, {}, 'sort', 1, [null], [[]], [{}], [{ fieldId: 'region' }], [{ direction: 'ASC' }],
  ...['', ' ', ' region', 'region\0'].map(fieldId => [{ fieldId, direction: 'ASC' }]),
  ...[null, '', 'asc', 'DOWN', 2].map(direction => [{ fieldId: 'region', direction }]),
  [{ fieldId: 'region', direction: 'ASC', extra: true }], [draftSorts[0], draftSorts[0]]];
test('row label reducer and storage validate, clone, enforce row membership and preserve last valid state', () => {
  const sorts = structuredClone(draftSorts), draft = authorReducer(pivotDraft(), { type: 'pivot-row-label-sorts', sorts });
  sorts[0].direction = 'DESC';
  assert.deepEqual(selected(draft).pivotRowLabelSorts, draftSorts);
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  for (const bad of invalidDraftSorts) assert.equal(pivotRowLabelSortsValid(bad), false, JSON.stringify(bad));
  for (const bad of [...invalidDraftSorts, [{ fieldId: 'revenue', direction: 'ASC' }], [{ fieldId: 'missing', direction: 'ASC' }]]) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'pivot-row-label-sorts', sorts: bad })), selected(draft));
    const tampered = structuredClone(draft); selected(tampered).pivotRowLabelSorts = bad;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  const column = authorReducer(draft, { type: 'assign', field: 'category', well: 'columns' });
  assert.deepEqual(selected(authorReducer(column, { type: 'pivot-row-label-sorts', sorts: draftSorts })).pivotRowLabelSorts, [draftSorts[0]]);
  selected(column).pivotRowLabelSorts = draftSorts;
  assert.throws(() => parseDraft(JSON.stringify(column)));
  assert.equal(selected(authorReducer(draft, { type: 'pivot-row-label-sorts', sorts: undefined })).pivotRowLabelSorts, undefined);
  const empty = authorReducer(draft, { type: 'pivot-row-label-sorts', sorts: [] });
  assert.deepEqual(parseDraft(JSON.stringify(empty)), empty);
});
test('row label sorts clean only fields removed from Rows, including moves and kind changes', () => {
  const draft = sortedDraft();
  for (const field of ['region', 'category']) for (const action of [
    { type: 'unassign', field, well: 'rows' }, { type: 'unassign', field }, { type: 'assign', field, well: 'columns' },
  ]) {
    const next = authorReducer(draft, action);
    assert.deepEqual(selected(next).pivotRowLabelSorts, draftSorts.filter(sort => sort.fieldId !== field));
    const cleared = authorReducer(next, { type: 'unassign', field: field === 'region' ? 'category' : 'region' });
    assert.equal(selected(cleared).pivotRowLabelSorts, undefined);
  }
  assert.deepEqual(selected(authorReducer(draft, { type: 'unassign', field: 'revenue' })).pivotRowLabelSorts, draftSorts);
  for (const { kind } of VISUAL_TYPES.filter(v => v.kind !== 'pivot')) {
    const other = authorReducer(draft, { type: 'kind', kind });
    assert.equal(selected(other).pivotRowLabelSorts, undefined, kind);
    assert.equal(selected(authorReducer(other, { type: 'pivot-row-label-sorts', sorts: draftSorts })).pivotRowLabelSorts, undefined);
    selected(other).pivotRowLabelSorts = [];
    assert.throws(() => parseDraft(JSON.stringify(other)));
  }
});
test('authoring serializes only rowLabelSort for this state and only on pivot', () => {
  const visual = selected(sortedDraft());
  assert.deepEqual(config({ definition: serializeVisual(visual) }).sortConfiguration, { rowLabelSort: draftSorts.map(fieldSort => ({ fieldSort })) });
  for (const { kind } of VISUAL_TYPES.filter(v => v.kind !== 'pivot')) {
    const other = { ...selected(authorReducer(emptyDraft(), { type: 'add', kind })), pivotRowLabelSorts: draftSorts };
    assert.equal(config({ definition: serializeVisual(other) }).sortConfiguration?.rowLabelSort, undefined, kind);
  }
});
for (const source of ['bundle', 'api']) {
  // Native import follows the same converter used by the app before bundle import.
  const roundTripDialect = bundle => {
    const next = structuredClone(bundle);
    if (source === 'api') next.members[0].resource.definition = convertDefinition(projectDefinition(next.members[0].resource.definition));
    return next;
  };
  test(`${source}: explicit row label imports stay editable through save, export, editing and clearing`, () => {
    for (const sorts of [[], ...draftSorts.map(sort => [sort]), draftSorts]) {
      let draft = authorReducer(pivotDraft(), { type: 'pivot-row-label-sorts', sorts });
      draft = authorReducer(draft, { type: 'pivot-field-sorts', sorts: [{ fieldId: 'category', direction: 'ASC' }] });
      draft = authorReducer(draft, { type: 'pivot-row-sort', sort: { measureFieldId: 'revenue', direction: 'DESC', aggregation: 'SUM' } });
      const bundle = roundTripDialect(exportBundle(draft)), imported = importBundle(bundle);
      assert.deepEqual(selected(imported).pivotRowLabelSorts, sorts);
      assert.deepEqual(selected(imported).imported.issues, []);
      assert.deepEqual(parseDraft(JSON.stringify(imported)), JSON.parse(JSON.stringify(imported)));
      assert.deepEqual(exportBundle(imported), bundle);
      const edited = authorReducer(imported, { type: 'pivot-row-label-sorts', sorts: [{ fieldId: 'category', direction: 'ASC' }] });
      assert.deepEqual(selected(importBundle(roundTripDialect(exportBundle(edited)))).pivotRowLabelSorts, [{ fieldId: 'category', direction: 'ASC' }]);
      const cleared = importBundle(roundTripDialect(exportBundle(authorReducer(imported, { type: 'pivot-row-label-sorts', sorts: undefined }))));
      assert.equal(selected(cleared).pivotRowLabelSorts, undefined);
      assert.deepEqual(selected(cleared).pivotFieldSorts, selected(imported).pivotFieldSorts);
      assert.deepEqual(selected(cleared).pivotRowSort, selected(imported).pivotRowSort);
    }
  });
  test(`${source}: malformed, unbound, duplicate, measure, column and missing-direction imports retain diagnostics and export verbatim`, () => {
    for (const rowLabelSort of [...malformed, [{ fieldSort: { fieldId: 'region' } }], [sortBy('category')]]) {
      const bundle = exportBundle(authorReducer(pivotDraft(), { type: 'assign', field: 'category', well: 'columns' }));
      bundleConfig(bundle).sortConfiguration = { rowLabelSort };
      const converted = roundTripDialect(bundle), imported = importBundle(converted);
      assert.equal(selected(imported).pivotRowLabelSorts, undefined, JSON.stringify(rowLabelSort));
      assert.ok(selected(imported).imported.issues.length, JSON.stringify(rowLabelSort));
      assert.deepEqual(exportBundle(imported), converted);
      const edited = authorReducer(imported, { type: 'title', title: 'Retained sort' });
      assert.deepEqual(bundleConfig(exportBundle(edited)).sortConfiguration, bundleConfig(converted).sortConfiguration);
      assert.deepEqual(projectDefinition(exportBundle(imported).members[0].resource.definition), projectDefinition(converted.members[0].resource.definition));
    }
  });
  test(`${source}: native field IDs differing from draft names remain read-only without export-time rebinding`, () => {
    const bundle = exportBundle(pivotDraft());
    bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.rows[0].categoricalDimensionField.fieldId = 'native-row';
    for (const fieldId of ['native-row', 'region']) {
      bundleConfig(bundle).sortConfiguration = { rowLabelSort: [sortBy(fieldId)] };
      const converted = roundTripDialect(bundle), imported = importBundle(converted);
      assert.equal(selected(imported).pivotRowLabelSorts, undefined);
      assert.ok(selected(imported).imported.issues.length);
      assert.deepEqual(exportBundle(imported), converted);
    }
  });
}
test('non-pivot and empty-Rows imports retain unsupported row label sorts', () => {
  for (const kind of ['bar', 'table', 'kpi', 'insight', 'pivot']) for (const sorts of kind === 'pivot' ? [[sortBy()]] : [[], [sortBy()]]) {
    const draft = authorReducer(emptyDraft(), { type: 'add', kind }), bundle = exportBundle(draft);
    if (kind === 'pivot') bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.rows = [];
    bundleConfig(bundle).sortConfiguration = { rowLabelSort: sorts };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).pivotRowLabelSorts, undefined);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});
test('visual and sheet remaps remove only row label sorts whose dimensions leave the wells', () => {
  const bundle = exportBundle(sortedDraft());
  const field = bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.rows[0].categoricalDimensionField;
  field.fieldId = field.column.columnName = 'unavailable';
  bundleConfig(bundle).sortConfiguration.rowLabelSort[0] = sortBy('unavailable');
  const imported = importBundle(bundle); selected(imported).imported.local = false;
  for (const action of [{ type: 'remap', id: selected(imported).id }, { type: 'sheet-remap', id: activeSheet(imported).id }]) {
    const remapped = authorReducer(imported, action);
    assert.deepEqual(selected(remapped).rows, ['category']);
    assert.deepEqual(selected(remapped).pivotRowLabelSorts, [draftSorts[1]]);
    assert.deepEqual(parseDraft(JSON.stringify(remapped)), JSON.parse(JSON.stringify(remapped)));
    assert.deepEqual(bundleConfig(exportBundle(remapped)).sortConfiguration.rowLabelSort, [sortBy('category', 'DESC')]);
  }
});
test('O-generated well replacement clears row label sorts that leave Rows before validation', () => {
  const draft = sortedDraft(), visual = selected(draft);
  visual.o = { question: 'sum revenue by region', interpretation: interpretQuestion('sum revenue by region', dataFields([])).interpretations[0] };
  for (const replacement of [{ ...visual, rows: ['category'], columns: ['region'], dimension: 'category' }, { ...visual, kind: 'table' }]) {
    const next = authorReducer(draft, { type: 'o-replace', id: visual.id, visual: replacement, calculatedFields: [] });
    assert.deepEqual(selected(next).rows, replacement.rows);
    assert.equal(selected(next).kind, replacement.kind);
    assert.deepEqual(selected(next).pivotRowLabelSorts, replacement.kind === 'pivot' ? [draftSorts[1]] : undefined);
    assert.doesNotThrow(() => parseDraft(JSON.stringify(next)));
  }
});

import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { PivotRowLabelSortOptions } from '../build/test/PropertiesSections.js';
test('Properties lists only Rows with display names, independent choices, invalid-edit protection and prerequisite text', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, authorReducer(pivotDraft(), { type: 'formatting', formatting: { names: { region: 'Sales region', category: 'Product' } } }));
    return createElement(PivotRowLabelSortOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const control = name => renderer.root.findByProps({ 'aria-label': `Row label sort ${name}` });
  assert.equal(renderer.root.findByType('summary').children[0], 'Row label sort');
  assert.deepEqual(renderer.root.findAllByType('label').map(label => label.children[0]), ['Sales region', 'Product']);
  for (const name of ['Sales region', 'Product']) {
    assert.equal(control(name).props.value, '');
    assert.deepEqual(control(name).findAllByType('option').map(o => [o.props.value, o.children[0]]), [['', 'Default'], ['ASC', 'Ascending'], ['DESC', 'Descending']]);
  }
  const change = async (name, value) => act(() => control(name).props.onChange({ target: { value } }));
  await change('Sales region', 'ASC'); await change('Product', 'DESC');
  assert.deepEqual(selected(current).pivotRowLabelSorts, draftSorts);
  await change('Sales region', 'DESC');
  assert.equal(selected(current).pivotRowLabelSorts.length, 2);
  assert.equal(control('Sales region').props.value, 'DESC');
  const before = structuredClone(selected(current).pivotRowLabelSorts);
  for (const invalid of ['invalid', 'asc', null]) await change('Sales region', invalid);
  assert.deepEqual(selected(current).pivotRowLabelSorts, before);
  await change('Sales region', '');
  assert.deepEqual(selected(current).pivotRowLabelSorts, [draftSorts[1]]);
  await act(() => dispatch({ type: 'assign', field: 'category', well: 'columns' }));
  assert.equal(selected(current).pivotRowLabelSorts, undefined);
  assert.equal(renderer.root.findAllByType('select').length, 1);
  await act(() => dispatch({ type: 'unassign', field: 'region', well: 'rows' }));
  assert.equal(renderer.root.findAllByType('select').length, 0);
  assert.equal(renderer.root.findByType('p').children[0], 'Assign a Rows field to sort row labels.');
  for (const kind of ['table', 'bar', 'kpi', 'insight']) {
    await act(() => dispatch({ type: 'kind', kind }));
    assert.equal(renderer.root.findAllByType('details').length, 0);
  }
});
