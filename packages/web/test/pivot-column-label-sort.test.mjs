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
const sortBy = (fieldId = 'year', direction = 'ASC') => ({ fieldSort: { fieldId, direction } });
const sorted = (value = input(), sorts = [sortBy()]) => { config(value).sortConfiguration = { columnLabelSort: sorts }; return value; };
const malformed = [null, {}, 'sort', 3, [null], [[]], [{}], [{ fieldSort: null }], [{ fieldSort: [] }], [{ fieldSort: {} }],
  ...[null, 'asc', 'DOWN', '', 3].map(direction => [sortBy('year', direction)]),
  ...[null, 1, '', ' ', 'missing', 'revenue', 'profit', 'region', 'category'].map(fieldId => [sortBy(fieldId)]),
  [{ ...sortBy(), extra: true }], [{ ...sortBy(), aggregationSort: {} }], [{ fieldSort: { ...sortBy().fieldSort, extra: true } }],
  [{ fieldId: 'year', direction: 'ASC' }], [{ fieldSort: { fieldId: 'year', sortDirection: 'ASC' } }], [sortBy(), sortBy('year', 'DESC')]];
const headers = paths => ['region', 'category', ...paths.flatMap(([year, quarter]) => ['revenue', 'profit'].map(measure =>
  `year: ${typeof year === 'number' ? year.toLocaleString('en-US') : year ?? '(null)'} / quarter: ${quarter ?? '(null)'} · ${measure}`))];
const cellsByIdentity = table => Object.fromEntries(table.rows.flatMap((row, i) => row.slice(table.dimensionCount).map((value, offset) =>
  [JSON.stringify([table.rowKinds[i], table.rowGroupPaths[i], table.columns[table.dimensionCount + offset]]), value])));

for (const source of ['bundle', 'api']) {
  test(`${source}: column label sorts parse multiple column fields, default ASC, and empty lists`, () => {
    for (const fieldId of ['year', 'quarter']) for (const direction of ['ASC', 'DESC']) {
      assert.deepEqual(normalize(dialect(sorted(input(), [sortBy(fieldId, direction)]), source)).columnLabelSort, [{ fieldId, direction }]);
    }
    assert.deepEqual(normalize(dialect(sorted(input(), [{ fieldSort: { fieldId: 'year' } }, sortBy('quarter', 'DESC')]), source)).columnLabelSort,
      [{ fieldId: 'year', direction: 'ASC' }, { fieldId: 'quarter', direction: 'DESC' }]);
    assert.equal(normalize(dialect(sorted(input(), []), source)).columnLabelSort, undefined);
    const noColumns = input(); wells(noColumns).columns = [];
    assert.doesNotThrow(() => normalize(dialect(sorted(noColumns, []), source)));
    assert.throws(() => normalize(dialect(sorted(noColumns), source)), /bound column dimension/);
  });
  test(`${source}: malformed column label lists, wrappers, fields and directions fail closed`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(sorted(input(), sorts), source)), CompileError, JSON.stringify(sorts));
    assert.throws(() => normalize(dialect(sorted(input(), [sortBy(), sortBy()]), source)), /duplicate column label sort/);
    for (const sortConfiguration of [null, [], 'sort', 3, { columnLabelSort: [], extra: true }]) {
      const value = input(); config(value).sortConfiguration = sortConfiguration;
      assert.throws(() => normalize(dialect(value, source)), CompileError);
    }
    for (const key of ['categorySort', 'trendGroupSort', 'smallMultiplesSort']) {
      const value = sorted(); config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
  });
  test(`${source}: every non-pivot kind rejects columnLabelSort, including an empty list`, () => {
    for (const { kind } of VISUAL_TYPES.filter(v => v.kind !== 'pivot')) for (const sorts of [[], [sortBy()]]) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      assert.throws(() => normalize(dialect(sorted(value, sorts), source)), CompileError, kind);
    }
  });
  test(`${source}: column levels sort independently and preserve row order and unsorted children`, () => {
    const compile = sorts => compileVisual(dialect(sorted(input(), sorts), source)).table;
    const base = compile([]);
    assert.deepEqual(compile([sortBy()]).columns, headers([[2024, 'Q2'], [2024, 'Q1'], [2025, 'Q2'], [2025, 'Q1'], [null, null]]));
    assert.deepEqual(compile([sortBy('quarter')]).columns, headers([[2025, 'Q1'], [2025, 'Q2'], [2024, 'Q1'], [2024, 'Q2'], [null, null]]));
    const both = [sortBy(), sortBy('quarter')];
    assert.deepEqual(compile(both).columns, headers([[2024, 'Q1'], [2024, 'Q2'], [2025, 'Q1'], [2025, 'Q2'], [null, null]]));
    assert.deepEqual(compile(both), compile([...both].reverse()));
    assert.deepEqual(compile(both).rowGroupPaths, base.rowGroupPaths);
    assert.deepEqual(compile([sortBy('year', 'DESC')]).columns, base.columns);
  });
  test(`${source}: native ColumnLabelSort supersedes the same fieldSortOptions entry only`, () => {
    const value = sorted(input(), [sortBy()]);
    config(value).sortConfiguration.fieldSortOptions = [
      { fieldId: 'year', sortDirection: 'DESC' }, { fieldId: 'quarter', sortDirection: 'ASC' },
      { fieldId: 'region', sortDirection: 'ASC' }, { fieldId: 'category', sortDirection: 'ASC' },
    ];
    const base = structuredClone(value); delete config(base).sortConfiguration.columnLabelSort;
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(table.columns, headers([[2024, 'Q1'], [2024, 'Q2'], [2025, 'Q1'], [2025, 'Q2'], [null, null]]));
    assert.deepEqual(table.rowGroupPaths, compileVisual(dialect(base, source)).table.rowGroupPaths);
    config(value).sortConfiguration.columnLabelSort.push(sortBy('quarter', 'DESC'));
    assert.deepEqual(compileVisual(dialect(value, source)).table.columns, headers([[2024, 'Q2'], [2024, 'Q1'], [2025, 'Q2'], [2025, 'Q1'], [null, null]]));
  });
  test(`${source}: RowLabelSort applies independently without a measure RowSort`, () => {
    const value = sorted(input(), [sortBy(), sortBy('quarter', 'DESC')]);
    config(value).sortConfiguration.rowLabelSort = [sortBy('region'), sortBy('category')];
    const base = structuredClone(value); delete config(base).sortConfiguration.columnLabelSort;
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(table.rowGroupPaths, [['East', 'A'], ['East', 'B'], ['West', 'A'], ['West', 'B'], [null, null]]);
    assert.deepEqual(table.rowGroupPaths, compileVisual(dialect(base, source)).table.rowGroupPaths);
    assert.deepEqual(cellsByIdentity(table), cellsByIdentity(compileVisual(dialect(base, source)).table));
  });
  test(`${source}: measure ColumnSort overrides only outer ColumnLabelSort, including stable aggregate ties`, () => {
    const value = sorted(input(), [sortBy(), sortBy('quarter')]);
    config(value).sortConfiguration.columnSort = [{ sortBy: { dataSetIdentifier: 'data', columnName: 'revenue' }, direction: 'ASC' }];
    config(value).sortConfiguration.rowSort = [{ sortBy: { dataSetIdentifier: 'data', columnName: 'profit' }, direction: 'ASC' }];
    config(value).sortConfiguration.rowLabelSort = [sortBy('region'), sortBy('category')];
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(table.columns, headers([[2025, 'Q1'], [2025, 'Q2'], [2024, 'Q1'], [2024, 'Q2'], [null, null]]));
    const base = structuredClone(value); delete config(base).sortConfiguration.columnLabelSort;
    assert.deepEqual(table.rowGroupPaths, compileVisual(dialect(base, source)).table.rowGroupPaths);
    assert.deepEqual(table.rowGroupPaths, [['West', 'A'], ['West', 'B'], ['East', 'A'], ['East', 'B'], [null, null]]);
    // Equal outer aggregates preserve first appearance even against ASC labels.
    value.rows = value.rows.map(row => ({ ...row, revenue: row.year === null ? null : 1 }));
    assert.deepEqual(compileVisual(dialect(value, source)).table.columns, table.columns);
  });
}
for (const direction of ['ASC', 'DESC']) test(`${direction}: numeric, text, boolean, typed keys and nulls use the shared field-sort order`, () => {
  for (const [cells, asc, desc] of [
    [[10, null, 2, 30], [2, 10, 30, null], [30, 10, 2, null]],
    [['Z', null, 'A', 'M'], ['A', 'M', 'Z', null], ['Z', 'M', 'A', null]],
    [[true, null, false], [false, true, null], [true, false, null]],
    [['2', 2, null, '10', false], [2, '10', '2', false, null], [false, '2', '10', 2, null]],
  ]) {
    const value = input({ data: cells.map((year, i) => ({ ...rows[0], year, revenue: i + 1 })) });
    wells(value).rows = []; wells(value).columns = [wells(value).columns[0]];
    const before = structuredClone(value.rows);
    const table = compileVisual(sorted(value, [sortBy('year', direction)])).table;
    const expected = direction === 'ASC' ? asc : desc;
    assert.deepEqual(table.columns, expected.flatMap(cell => ['revenue', 'profit'].map(measure => `year: ${cell ?? '(null)'} · ${measure}`)));
    assert.deepEqual(table.rows[0].filter((_, i) => i % 2 === 0), expected.map(cell => cells.findIndex(v => v === cell) + 1));
    assert.deepEqual(value.rows, before);
    config(value).sortConfiguration = { fieldSortOptions: [{ fieldId: 'year', sortDirection: direction }] };
    assert.deepEqual(compileVisual(value).table, table);
  }
});
for (const totals of [false, true]) for (const subtotals of [false, true]) for (const columnTotals of [false, true]) for (const columnSubtotals of [false, true]) {
  test(`column label sorts preserve every cell and rollup: rows ${totals}/${subtotals}, columns ${columnTotals}/${columnSubtotals}`, () => {
    const value = input({ totals, subtotals, columnTotals, columnSubtotals });
    const before = structuredClone(value.rows), base = compileVisual(value).table;
    const table = compileVisual(sorted(value, [sortBy(), sortBy('quarter')])).table;
    assert.deepEqual(cellsByIdentity(table), cellsByIdentity(base));
    assert.deepEqual(table.rowGroupPaths, base.rowGroupPaths);
    assert.deepEqual(table.rowKinds, base.rowKinds);
    assert.deepEqual(value.rows, before);
    if (totals) { assert.equal(table.rowKinds.at(-1), 'total'); assert.deepEqual(table.rowGroupPaths.at(-1), []); }
    if (columnTotals) assert.deepEqual(table.columns.slice(-2), ['Grand total · revenue', 'Grand total · profit']);
    if (columnSubtotals) {
      assert.deepEqual(table.columns.slice(2, 8), [...headers([[2024, 'Q1'], [2024, 'Q2']]).slice(2), 'year: 2,024 / Subtotal · revenue', 'year: 2,024 / Subtotal · profit']);
      assert.deepEqual(table.columns.slice(12, 14), ['year: 2,025 / Subtotal · revenue', 'year: 2,025 / Subtotal · profit']);
    }
    if (totals && columnTotals) assert.deepEqual(table.rows.at(-1).slice(-2), [100, 10]);
  });
}
test('column label sorting resolves native IDs and result aliases independently of column names', () => {
  const value = input(); wells(value).columns[0].categoricalDimensionField.fieldId = 'native-column';
  value.bindings = { 'native-column': 'alias' };
  value.rows = value.rows.map(({ year, ...row }) => ({ ...row, alias: year }));
  for (const source of ['bundle', 'api']) {
    assert.match(compileVisual(dialect(sorted(value, [sortBy('native-column')]), source)).table.columns[2], /year: 2,024/);
    assert.throws(() => normalize(dialect(sorted(value), source)), /bound column dimension/);
  }
});
test('converter round-trips the FieldSort wrapper in both dialects', () => {
  const value = sorted(input(), [sortBy(), sortBy('quarter', 'DESC')]);
  const internal = definition(value.definition), native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].PivotTableVisual.ChartConfiguration.SortConfiguration,
    { ColumnLabelSort: [{ FieldSort: { FieldId: 'year', Direction: 'ASC' } }, { FieldSort: { FieldId: 'quarter', Direction: 'DESC' } }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(projectDefinition(convertDefinition(native)), native);
  assert.deepEqual(compileVisual(dialect(value, 'api')), compileVisual(value));
});
test('empty column label sorts preserve full output bytes across all baseline inputs', () => {
  const bytes = value => JSON.stringify(compileVisual(value), (_, v) => typeof v === 'function' ? v.toString() : v);
  for (const value of Object.values(baselineInputs())) assert.equal(bytes(sorted(structuredClone(value), [])), bytes(value));
});

const draftSortBy = (fieldId = 'region', direction = 'ASC') => sortBy(fieldId, direction);
import { parseDraft, pivotColumnLabelSortsValid, dataFields } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { interpretQuestion } from '@opensight/o-interpreter';
const pivotDraft = () => ['region', 'category'].reduce((draft, field) => authorReducer(draft, { type: 'assign', field, well: 'columns' }), authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' }));
const draftSorts = [{ fieldId: 'region', direction: 'ASC' }, { fieldId: 'category', direction: 'DESC' }];
const sortedDraft = () => authorReducer(pivotDraft(), { type: 'pivot-column-label-sorts', sorts: draftSorts });
const bundleConfig = bundle => Object.values(bundle.members[0].resource.definition.sheets[0].visuals[0])[0].chartConfiguration;
const invalidDraftSorts = [null, {}, 'sort', 1, [null], [[]], [{}], [{ fieldId: 'region' }], [{ direction: 'ASC' }],
  ...['', ' ', ' region', 'region\0'].map(fieldId => [{ fieldId, direction: 'ASC' }]),
  ...[null, '', 'asc', 'DOWN', 2].map(direction => [{ fieldId: 'region', direction }]),
  [{ fieldId: 'region', direction: 'ASC', extra: true }], [draftSorts[0], draftSorts[0]]];
test('column label reducer and storage validate, clone, enforce column membership and preserve last valid state', () => {
  const sorts = structuredClone(draftSorts), draft = authorReducer(pivotDraft(), { type: 'pivot-column-label-sorts', sorts });
  sorts[0].direction = 'DESC';
  assert.deepEqual(selected(draft).pivotColumnLabelSorts, draftSorts);
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  for (const bad of invalidDraftSorts) assert.equal(pivotColumnLabelSortsValid(bad), false, JSON.stringify(bad));
  for (const bad of [...invalidDraftSorts, [{ fieldId: 'revenue', direction: 'ASC' }], [{ fieldId: 'missing', direction: 'ASC' }]]) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'pivot-column-label-sorts', sorts: bad })), selected(draft));
    const tampered = structuredClone(draft); selected(tampered).pivotColumnLabelSorts = bad;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  const row = authorReducer(draft, { type: 'assign', field: 'category', well: 'rows' });
  assert.deepEqual(selected(authorReducer(row, { type: 'pivot-column-label-sorts', sorts: draftSorts })).pivotColumnLabelSorts, [draftSorts[0]]);
  selected(row).pivotColumnLabelSorts = draftSorts;
  assert.throws(() => parseDraft(JSON.stringify(row)));
  assert.equal(selected(authorReducer(draft, { type: 'pivot-column-label-sorts', sorts: undefined })).pivotColumnLabelSorts, undefined);
  const empty = authorReducer(draft, { type: 'pivot-column-label-sorts', sorts: [] });
  assert.deepEqual(parseDraft(JSON.stringify(empty)), empty);
});
test('column label sorts clean only fields removed from Columns, including moves and kind changes', () => {
  const draft = sortedDraft();
  for (const field of ['region', 'category']) for (const action of [
    { type: 'unassign', field, well: 'columns' }, { type: 'unassign', field }, { type: 'assign', field, well: 'rows' },
  ]) {
    const next = authorReducer(draft, action);
    assert.deepEqual(selected(next).pivotColumnLabelSorts, draftSorts.filter(sort => sort.fieldId !== field));
    const cleared = authorReducer(next, { type: 'unassign', field: field === 'region' ? 'category' : 'region' });
    assert.equal(selected(cleared).pivotColumnLabelSorts, undefined);
  }
  assert.deepEqual(selected(authorReducer(draft, { type: 'unassign', field: 'revenue' })).pivotColumnLabelSorts, draftSorts);
  for (const { kind } of VISUAL_TYPES.filter(v => v.kind !== 'pivot')) {
    const other = authorReducer(draft, { type: 'kind', kind });
    assert.equal(selected(other).pivotColumnLabelSorts, undefined, kind);
    assert.equal(selected(authorReducer(other, { type: 'pivot-column-label-sorts', sorts: draftSorts })).pivotColumnLabelSorts, undefined);
    selected(other).pivotColumnLabelSorts = [];
    assert.throws(() => parseDraft(JSON.stringify(other)));
  }
});
test('authoring serializes only columnLabelSort for this state and only on pivot', () => {
  const visual = selected(sortedDraft());
  assert.deepEqual(config({ definition: serializeVisual(visual) }).sortConfiguration, { columnLabelSort: draftSorts.map(fieldSort => ({ fieldSort })) });
  for (const { kind } of VISUAL_TYPES.filter(v => v.kind !== 'pivot')) {
    const other = { ...selected(authorReducer(emptyDraft(), { type: 'add', kind })), pivotColumnLabelSorts: draftSorts };
    assert.equal(config({ definition: serializeVisual(other) }).sortConfiguration?.columnLabelSort, undefined, kind);
  }
});
for (const source of ['bundle', 'api']) {
  // Native import follows the same converter used by the app before bundle import.
  const roundTripDialect = bundle => {
    const next = structuredClone(bundle);
    if (source === 'api') next.members[0].resource.definition = convertDefinition(projectDefinition(next.members[0].resource.definition));
    return next;
  };
  test(`${source}: explicit column label imports stay editable through save, export, editing and clearing`, () => {
    for (const sorts of [[], ...draftSorts.map(sort => [sort]), draftSorts]) {
      let draft = authorReducer(pivotDraft(), { type: 'pivot-column-label-sorts', sorts });
      draft = authorReducer(draft, { type: 'pivot-field-sorts', sorts: [{ fieldId: 'category', direction: 'ASC' }] });
      draft = authorReducer(draft, { type: 'pivot-column-sort', sort: { measureFieldId: 'revenue', direction: 'DESC', aggregation: 'SUM' } });
      draft = authorReducer(draft, { type: 'assign', field: 'order_id', well: 'rows' });
      draft = authorReducer(draft, { type: 'pivot-row-label-sorts', sorts: [{ fieldId: 'order_id', direction: 'DESC' }] });
      draft = authorReducer(draft, { type: 'pivot-row-sort', sort: { measureFieldId: 'revenue', direction: 'ASC', aggregation: 'SUM' } });
      const bundle = roundTripDialect(exportBundle(draft)), imported = importBundle(bundle);
      assert.deepEqual(selected(imported).pivotColumnLabelSorts, sorts);
      assert.deepEqual(selected(imported).imported.issues, []);
      assert.deepEqual(parseDraft(JSON.stringify(imported)), JSON.parse(JSON.stringify(imported)));
      assert.deepEqual(exportBundle(imported), bundle);
      const edited = authorReducer(imported, { type: 'pivot-column-label-sorts', sorts: [{ fieldId: 'category', direction: 'ASC' }] });
      assert.deepEqual(selected(importBundle(roundTripDialect(exportBundle(edited)))).pivotColumnLabelSorts, [{ fieldId: 'category', direction: 'ASC' }]);
      const cleared = importBundle(roundTripDialect(exportBundle(authorReducer(imported, { type: 'pivot-column-label-sorts', sorts: undefined }))));
      assert.equal(selected(cleared).pivotColumnLabelSorts, undefined);
      assert.deepEqual(selected(cleared).pivotFieldSorts, selected(imported).pivotFieldSorts);
      assert.deepEqual(selected(cleared).pivotColumnSort, selected(imported).pivotColumnSort);
      assert.deepEqual(selected(cleared).pivotRowLabelSorts, [{ fieldId: 'order_id', direction: 'DESC' }]);
      assert.deepEqual(selected(cleared).pivotRowSort, selected(imported).pivotRowSort);
    }
  });
  test(`${source}: malformed, unbound, duplicate, measure, row and missing-direction imports retain diagnostics and export verbatim`, () => {
    for (const columnLabelSort of [...malformed.map(value => JSON.parse(JSON.stringify(value), (key, cell) => key === 'fieldId' ? ({ year: 'region', quarter: 'category', region: 'year', category: 'quarter' }[cell] ?? cell) : cell)), [{ fieldSort: { fieldId: 'region' } }], [draftSortBy('category')]]) {
      const bundle = exportBundle(authorReducer(pivotDraft(), { type: 'assign', field: 'category', well: 'rows' }));
      bundleConfig(bundle).sortConfiguration = { columnLabelSort };
      const converted = roundTripDialect(bundle), imported = importBundle(converted);
      assert.equal(selected(imported).pivotColumnLabelSorts, undefined, JSON.stringify(columnLabelSort));
      assert.ok(selected(imported).imported.issues.length, JSON.stringify(columnLabelSort));
      assert.deepEqual(exportBundle(imported), converted);
      const edited = authorReducer(imported, { type: 'title', title: 'Retained sort' });
      assert.deepEqual(bundleConfig(exportBundle(edited)).sortConfiguration, bundleConfig(converted).sortConfiguration);
      assert.deepEqual(projectDefinition(exportBundle(imported).members[0].resource.definition), projectDefinition(converted.members[0].resource.definition));
    }
  });
  test(`${source}: native field IDs differing from draft names remain read-only without export-time rebinding`, () => {
    const bundle = exportBundle(pivotDraft());
    bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.columns[0].categoricalDimensionField.fieldId = 'native-column';
    for (const fieldId of ['native-column', 'region']) {
      bundleConfig(bundle).sortConfiguration = { columnLabelSort: [draftSortBy(fieldId)] };
      const converted = roundTripDialect(bundle), imported = importBundle(converted);
      assert.equal(selected(imported).pivotColumnLabelSorts, undefined);
      assert.ok(selected(imported).imported.issues.length);
      assert.deepEqual(exportBundle(imported), converted);
    }
  });
}
test('non-pivot and empty-Columns imports retain unsupported column label sorts', () => {
  for (const kind of ['bar', 'table', 'kpi', 'insight', 'pivot']) for (const sorts of kind === 'pivot' ? [[draftSortBy()]] : [[], [draftSortBy()]]) {
    const draft = authorReducer(emptyDraft(), { type: 'add', kind }), bundle = exportBundle(draft);
    if (kind === 'pivot') bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.columns = [];
    bundleConfig(bundle).sortConfiguration = { columnLabelSort: sorts };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).pivotColumnLabelSorts, undefined);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});
test('visual and sheet remaps remove only column label sorts whose dimensions leave the wells', () => {
  const bundle = exportBundle(sortedDraft());
  const field = bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.columns[0].categoricalDimensionField;
  field.fieldId = field.column.columnName = 'unavailable';
  bundleConfig(bundle).sortConfiguration.columnLabelSort[0] = draftSortBy('unavailable');
  const imported = importBundle(bundle); selected(imported).imported.local = false;
  for (const action of [{ type: 'remap', id: selected(imported).id }, { type: 'sheet-remap', id: activeSheet(imported).id }]) {
    const remapped = authorReducer(imported, action);
    assert.deepEqual(selected(remapped).columns, ['category']);
    assert.deepEqual(selected(remapped).pivotColumnLabelSorts, [draftSorts[1]]);
    assert.deepEqual(parseDraft(JSON.stringify(remapped)), JSON.parse(JSON.stringify(remapped)));
    assert.deepEqual(bundleConfig(exportBundle(remapped)).sortConfiguration.columnLabelSort, [draftSortBy('category', 'DESC')]);
  }
});
test('O-generated well replacement clears column label sorts that leave Columns before validation', () => {
  const draft = sortedDraft(), visual = selected(draft);
  visual.o = { question: 'sum revenue by region', interpretation: interpretQuestion('sum revenue by region', dataFields([])).interpretations[0] };
  for (const replacement of [{ ...visual, columns: ['category'], rows: ['region'], dimension: 'region' }, { ...visual, kind: 'table', columns: [], rows: ['region'], dimension: 'region' }]) {
    const next = authorReducer(draft, { type: 'o-replace', id: visual.id, visual: replacement, calculatedFields: [] });
    assert.deepEqual(selected(next).columns, replacement.columns);
    assert.equal(selected(next).kind, replacement.kind);
    assert.deepEqual(selected(next).pivotColumnLabelSorts, replacement.kind === 'pivot' ? [draftSorts[1]] : undefined);
    assert.doesNotThrow(() => parseDraft(JSON.stringify(next)));
  }
});

import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { PivotColumnLabelSortOptions } from '../build/test/PropertiesSections.js';
test('Properties lists only Columns with display names, independent choices, invalid-edit protection and prerequisite text', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, authorReducer(pivotDraft(), { type: 'formatting', formatting: { names: { region: 'Sales region', category: 'Product' } } }));
    return createElement(PivotColumnLabelSortOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const control = name => renderer.root.findByProps({ 'aria-label': `Column label sort ${name}` });
  assert.equal(renderer.root.findByType('summary').children[0], 'Column label sort');
  assert.deepEqual(renderer.root.findAllByType('label').map(label => label.children[0]), ['Sales region', 'Product']);
  for (const name of ['Sales region', 'Product']) {
    assert.equal(control(name).props.value, '');
    assert.deepEqual(control(name).findAllByType('option').map(o => [o.props.value, o.children[0]]), [['', 'Default'], ['ASC', 'Ascending'], ['DESC', 'Descending']]);
  }
  const change = async (name, value) => act(() => control(name).props.onChange({ target: { value } }));
  await change('Sales region', 'ASC'); await change('Product', 'DESC');
  assert.deepEqual(selected(current).pivotColumnLabelSorts, draftSorts);
  await change('Sales region', 'DESC');
  assert.equal(selected(current).pivotColumnLabelSorts.length, 2);
  assert.equal(control('Sales region').props.value, 'DESC');
  const before = structuredClone(selected(current).pivotColumnLabelSorts);
  for (const invalid of ['invalid', 'asc', null]) await change('Sales region', invalid);
  assert.deepEqual(selected(current).pivotColumnLabelSorts, before);
  await change('Sales region', '');
  assert.deepEqual(selected(current).pivotColumnLabelSorts, [draftSorts[1]]);
  await act(() => dispatch({ type: 'assign', field: 'category', well: 'rows' }));
  assert.equal(selected(current).pivotColumnLabelSorts, undefined);
  assert.equal(renderer.root.findAllByType('select').length, 1);
  await act(() => dispatch({ type: 'unassign', field: 'region', well: 'columns' }));
  assert.equal(renderer.root.findAllByType('select').length, 0);
  assert.equal(renderer.root.findByType('p').children[0], 'Assign a Columns field to sort column labels.');
  for (const kind of ['table', 'bar', 'kpi', 'insight']) {
    await act(() => dispatch({ type: 'kind', kind }));
    assert.equal(renderer.root.findAllByType('details').length, 0);
  }
});
