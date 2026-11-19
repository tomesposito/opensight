import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { PivotFieldSortOptions } from '../build/test/PropertiesSections.js';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, pivotFieldSortsValid, parseDraft, serializeVisual } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { baselineInputs, input, rows } from './fixtures/pivot-field-sort-inputs.mjs';

const config = value => Object.values(value.definition)[0].chartConfiguration;
const wells = value => config(value).fieldWells.pivotTableAggregatedFieldWells;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const sortBy = (fieldId = 'region', sortDirection = 'ASC') => ({ fieldId, sortDirection });
const sorted = (value = input(), sorts = [sortBy()]) => {
  config(value).sortConfiguration = { fieldSortOptions: sorts };
  return value;
};
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const malformed = [null, {}, 'sort', 3, [null], [[]], [{}], [sortBy('region', null)], [sortBy('region', 'asc')], [sortBy('region', 'DOWN')],
  [sortBy(null)], [sortBy(1)], [sortBy('')], [sortBy(' ')], [sortBy('missing')], [sortBy('revenue')],
  [{ ...sortBy(), extra: true }], [{ fieldSort: { fieldId: 'region', direction: 'ASC' } }],
  [{ fieldId: 'region', direction: 'ASC' }], [sortBy(), sortBy('region', 'DESC')]];

for (const source of ['bundle', 'api']) {
  test(`${source}: pivot parses row/column sorts, multiple entries, default ASC and empty list`, () => {
    for (const fieldId of ['region', 'category', 'year', 'quarter']) for (const direction of ['ASC', 'DESC']) {
      assert.deepEqual(normalize(dialect(sorted(input(), [sortBy(fieldId, direction)]), source)).fieldSortOptions, [{ fieldId, direction }]);
    }
    assert.deepEqual(normalize(dialect(sorted(input(), [{ fieldId: 'region' }, sortBy('quarter', 'DESC')]), source)).fieldSortOptions,
      [{ fieldId: 'region', direction: 'ASC' }, { fieldId: 'quarter', direction: 'DESC' }]);
    assert.equal(normalize(dialect(sorted(input(), []), source)).fieldSortOptions, undefined);
  });
  test(`${source}: malformed entries, measure sorts, unbound IDs and duplicates raise named CompileErrors`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(sorted(input(), sorts), source)), CompileError, JSON.stringify(sorts));
    assert.throws(() => normalize(dialect(sorted(input(), [sortBy('revenue')]), source)), /bound row or column dimension/);
    assert.throws(() => normalize(dialect(sorted(input(), [sortBy(), sortBy()]), source)), /duplicate pivot field sort/);
    for (const bad of [null, [], 'sort', 3]) {
      const value = input(); config(value).sortConfiguration = bad;
      assert.throws(() => normalize(dialect(value, source)), CompileError);
    }
  });
  test(`${source}: pivot rejects foreign sort keys and keeps display gates unchanged`, () => {
    for (const key of ['categorySort', 'rowSort', 'trendGroupSort', 'columnSort', 'rowLabelSort', 'categoryItemsLimit', 'smallMultiplesSort', 'smallMultiplesLimitConfiguration', 'breakdownItemsLimit', 'breakdownSort', 'extra']) {
      const value = sorted(); config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
    for (const key of ['dataLabels', 'tooltip', 'legend']) {
      const value = input(); config(value)[key] = {};
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
    for (const kind of ['bar', 'bar100', 'line', 'area', 'pie', 'table', 'kpi', 'insight', 'radar', 'sankey', 'waterfall']) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      config(value).sortConfiguration = { fieldSortOptions: [] };
      assert.throws(() => normalize(dialect(value, source)), CompileError, kind);
    }
  });
  test(`${source}: row and column axes order independently at sorted and unsorted levels`, () => {
    const compile = sorts => compileVisual(dialect(sorted(input(), sorts), source)).table;
    const base = compile([]);
    const child = compile([sortBy('category'), sortBy('quarter')]);
    assert.deepEqual(child.rowGroupPaths, [['West', 'A'], ['West', 'B'], ['East', 'A'], ['East', 'B'], [null, null]]);
    assert.deepEqual(child.columns.slice(2).filter((_, i) => i % 2 === 0), [
      'year: 2,025 / quarter: Q1 · revenue', 'year: 2,025 / quarter: Q2 · revenue',
      'year: 2,024 / quarter: Q1 · revenue', 'year: 2,024 / quarter: Q2 · revenue', 'year: (null) / quarter: (null) · revenue',
    ]);
    const parent = compile([sortBy('region'), sortBy('year')]);
    assert.deepEqual(parent.rowGroupPaths, [['East', 'B'], ['East', 'A'], ['West', 'B'], ['West', 'A'], [null, null]]);
    assert.deepEqual(parent.columns.slice(2).filter((_, i) => i % 2 === 0), [
      'year: 2,024 / quarter: Q2 · revenue', 'year: 2,024 / quarter: Q1 · revenue',
      'year: 2,025 / quarter: Q2 · revenue', 'year: 2,025 / quarter: Q1 · revenue', 'year: (null) / quarter: (null) · revenue',
    ]);
    assert.deepEqual(compile([sortBy('region')]).columns, base.columns);
    assert.deepEqual(compile([sortBy('year')]).rowGroupPaths, base.rowGroupPaths);
    const both = [sortBy('region'), sortBy('category', 'DESC'), sortBy('year', 'DESC'), sortBy('quarter')];
    assert.deepEqual(compile(both), compile([...both].reverse()));
    assert.deepEqual(compile(both).rowGroupPaths, [['East', 'B'], ['East', 'A'], ['West', 'B'], ['West', 'A'], [null, null]]);
  });
}

for (const direction of ['ASC', 'DESC']) for (const axis of ['rows', 'columns']) {
  test(`${axis} ${direction}: typed numeric/string/boolean groups, equal keys and null ordering`, () => {
    for (const [cells, asc, desc] of [
      [[10, null, 2, 30], [2, 10, 30, null], [30, 10, 2, null]],
      [['Z', null, 'A', 'M'], ['A', 'M', 'Z', null], ['Z', 'M', 'A', null]],
      [[true, null, false], [false, true, null], [true, false, null]],
      [['2', 2, null, '10'], ['10', '2', 2, null], ['2', 2, '10', null]],
    ]) {
      const value = input({ data: cells.map((cell, i) => ({ ...rows[0], region: cell, revenue: i + 1 })) });
      const field = wells(value).rows[0];
      wells(value).rows = axis === 'rows' ? [field] : [];
      wells(value).columns = axis === 'columns' ? [field] : [];
      const before = structuredClone(value.rows);
      const table = compileVisual(sorted(value, [sortBy('region', direction)])).table;
      const expected = direction === 'ASC' ? asc : desc;
      if (axis === 'rows') assert.deepEqual(table.rows.map(row => row[0]), expected);
      else {
        // The distinct typed groups can have identical display labels; their values must remain distinct.
        assert.deepEqual(table.rows[0].filter((_, i) => i % 2 === 0), expected.map(cell => cells.findIndex(v => v === cell) + 1));
      }
      assert.deepEqual(value.rows, before);
    }
  });
}

// Match every detail/subtotal/total cell by row path and column label, not position.
const cellsByIdentity = table => Object.fromEntries(table.rows.flatMap((row, i) => row.slice(table.dimensionCount).map((value, offset) =>
  [JSON.stringify([table.rowKinds[i], table.rowGroupPaths[i], table.columns[table.dimensionCount + offset]]), value])));
for (const totals of [false, true]) for (const subtotals of [false, true]) for (const columnTotals of [false, true]) for (const columnSubtotals of [false, true]) {
  test(`sorted axes preserve every cell and rollup: rows ${totals}/${subtotals}, columns ${columnTotals}/${columnSubtotals}`, () => {
    const value = input({ totals, subtotals, columnTotals, columnSubtotals });
    const base = compileVisual(value).table;
    const table = compileVisual(sorted(value, [sortBy('region'), sortBy('category'), sortBy('year'), sortBy('quarter')])).table;
    assert.deepEqual(cellsByIdentity(table), cellsByIdentity(base));
    if (totals) { assert.equal(table.rowKinds.at(-1), 'total'); assert.deepEqual(table.rowGroupPaths.at(-1), []); }
    if (columnTotals) assert.deepEqual(table.columns.slice(-2), ['Grand total · revenue', 'Grand total · profit']);
    if (subtotals) {
      assert.deepEqual(table.rowKinds.slice(0, 6), ['detail', 'detail', 'subtotal', 'detail', 'detail', 'subtotal']);
      assert.deepEqual(table.rows[2].slice(0, 2), ['East', 'Subtotal']);
      assert.deepEqual(table.rows[5].slice(0, 2), ['West', 'Subtotal']);
    }
    if (columnSubtotals) assert.deepEqual(table.columns.slice(2, 8).filter((_, i) => i % 2 === 0), [
      'year: 2,024 / quarter: Q1 · revenue', 'year: 2,024 / quarter: Q2 · revenue', 'year: 2,024 / Subtotal · revenue',
    ]);
    if (totals && columnTotals) assert.deepEqual(table.rows.at(-1).slice(-2), [100, 10]);
  });
}

test('sorting uses native field IDs and result aliases without requiring column-name IDs', () => {
  const value = input();
  wells(value).rows[0].categoricalDimensionField.fieldId = 'row-id';
  wells(value).columns[0].categoricalDimensionField.fieldId = 'column-id';
  value.bindings = { 'row-id': 'region_alias', 'column-id': 'year_alias' };
  value.rows = value.rows.map(({ region, year, ...row }) => ({ ...row, region_alias: region, year_alias: year }));
  for (const source of ['bundle', 'api']) {
    const table = compileVisual(dialect(sorted(value, [sortBy('row-id'), sortBy('column-id')]), source)).table;
    assert.equal(table.rows[0][0], 'East');
    assert.match(table.columns[2], /2,024/);
    assert.throws(() => normalize(dialect(sorted(value, [sortBy('region')]), source)), /bound row or column dimension/);
  }
});

// Full-output hashes captured from 809591f0 before compiler edits, including function source.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/pivot-field-sort-baseline.json', import.meta.url), 'utf8'));
for (const [name, value] of Object.entries(baselineInputs())) test(`no field sort preserves baseline bytes: ${name}`, () => {
  const compiled = compileVisual(value);
  const bytes = JSON.stringify(compiled, (_, v) => typeof v === 'function' ? v.toString() : v);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), baseline.hashes[name]);
  assert.deepEqual(compileVisual(sorted(value, [])), compiled);
});

const pivotDraft = () => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' }), { type: 'assign', field: 'category', well: 'columns' });
const draftSorts = [{ fieldId: 'region', direction: 'ASC' }, { fieldId: 'category', direction: 'DESC' }];
const invalidDraftSorts = [null, {}, 'sort', [null], [[]], [{}], [{ fieldId: 'region' }], [{ direction: 'ASC' }],
  [{ fieldId: '', direction: 'ASC' }], [{ fieldId: ' ', direction: 'ASC' }], [{ fieldId: 'region\0', direction: 'ASC' }],
  [{ fieldId: 'region', direction: 'asc' }], [{ fieldId: 'region', direction: null }],
  [{ fieldId: 'region', direction: 'ASC', extra: true }], [draftSorts[0], draftSorts[0]]];
test('pivot reducer and storage clone, validate structure, enforce membership and preserve last valid state', () => {
  const sorts = structuredClone(draftSorts);
  const draft = authorReducer(pivotDraft(), { type: 'pivot-field-sorts', sorts });
  sorts[0].direction = 'DESC';
  assert.deepEqual(selected(draft).pivotFieldSorts, draftSorts);
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  for (const bad of invalidDraftSorts) assert.equal(pivotFieldSortsValid(bad), false, JSON.stringify(bad));
  for (const bad of [...invalidDraftSorts, [{ fieldId: 'revenue', direction: 'ASC' }], [{ fieldId: 'missing', direction: 'ASC' }]]) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'pivot-field-sorts', sorts: bad })), selected(draft));
    const tampered = structuredClone(draft); selected(tampered).pivotFieldSorts = bad;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  assert.equal(selected(authorReducer(draft, { type: 'pivot-field-sorts', sorts: undefined })).pivotFieldSorts, undefined);
  const empty = authorReducer(draft, { type: 'pivot-field-sorts', sorts: [] });
  assert.deepEqual(parseDraft(JSON.stringify(empty)), empty);
});
test('removing sorted row/column fields cleans only their entries; moving between axes keeps the sort', () => {
  const draft = authorReducer(pivotDraft(), { type: 'pivot-field-sorts', sorts: draftSorts });
  for (const [field, well] of [['region', 'rows'], ['category', 'columns']]) {
    for (const removal of [{ type: 'unassign', field, well }, { type: 'unassign', field }]) {
      const next = authorReducer(draft, removal);
      assert.deepEqual(selected(next).pivotFieldSorts, draftSorts.filter(sort => sort.fieldId !== field));
      const cleared = authorReducer(next, { type: 'unassign', field: field === 'region' ? 'category' : 'region' });
      assert.equal(selected(cleared).pivotFieldSorts, undefined);
    }
  }
  assert.deepEqual(selected(authorReducer(draft, { type: 'unassign', field: 'revenue' })).pivotFieldSorts, draftSorts);
  assert.deepEqual(selected(authorReducer(draft, { type: 'assign', field: 'region', well: 'columns' })).pivotFieldSorts, draftSorts);
  const other = authorReducer(draft, { type: 'kind', kind: 'table' });
  assert.equal(selected(other).pivotFieldSorts, undefined);
  assert.equal(selected(authorReducer(other, { type: 'pivot-field-sorts', sorts: draftSorts })).pivotFieldSorts, undefined);
  selected(other).pivotFieldSorts = draftSorts;
  assert.throws(() => parseDraft(JSON.stringify(other)));
});
test('authoring emits only pivot fieldSortOptions; other kinds never emit pivot sorts', () => {
  const draft = authorReducer(pivotDraft(), { type: 'pivot-field-sorts', sorts: draftSorts });
  const visual = selected(draft);
  visual.groupSort = { fieldId: 'revenue', direction: 'DESC' };
  assert.deepEqual(config({ definition: serializeVisual(visual) }).sortConfiguration,
    { fieldSortOptions: [sortBy('region'), sortBy('category', 'DESC')] });
  for (const kind of ['bar', 'bar100', 'pie', 'line', 'table', 'kpi', 'insight']) {
    const other = { ...selected(authorReducer(emptyDraft(), { type: 'add', kind })), pivotFieldSorts: draftSorts };
    assert.equal(config({ definition: serializeVisual(other) }).sortConfiguration?.fieldSortOptions, undefined);
  }
});
test('native and internal converter round-trip flat FieldSortOptions without FieldSort wrappers', () => {
  const value = sorted(input(), [sortBy('region'), sortBy('quarter', 'DESC')]);
  const internal = definition(value.definition), native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].PivotTableVisual.ChartConfiguration.SortConfiguration,
    { FieldSortOptions: [{ FieldId: 'region', SortDirection: 'ASC' }, { FieldId: 'quarter', SortDirection: 'DESC' }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(projectDefinition(convertDefinition(native)), native);
  assert.deepEqual(compileVisual(dialect(value, 'api')), compileVisual(value));
});
const bundleConfig = bundle => bundle.members[0].resource.definition.sheets[0].visuals[0].pivotTableVisual.chartConfiguration;
test('valid explicit imported pivot sorts stay editable through save, native conversion, edits and clearing', () => {
  for (const sorts of [[], ...draftSorts.map(sort => [sort]), draftSorts]) {
    const draft = authorReducer(pivotDraft(), { type: 'pivot-field-sorts', sorts });
    const bundle = exportBundle(draft), imported = importBundle(bundle);
    assert.deepEqual(selected(imported).pivotFieldSorts, sorts);
    assert.deepEqual(selected(imported).imported.issues, []);
    assert.deepEqual(parseDraft(JSON.stringify(imported)), JSON.parse(JSON.stringify(imported)));
    assert.deepEqual(exportBundle(imported), bundle);
    const internal = bundle.members[0].resource.definition;
    assert.deepEqual(convertDefinition(projectDefinition(internal)), internal);
    const edited = authorReducer(imported, { type: 'pivot-field-sorts', sorts: [{ fieldId: 'category', direction: 'ASC' }] });
    assert.deepEqual(selected(importBundle(exportBundle(edited))).pivotFieldSorts, [{ fieldId: 'category', direction: 'ASC' }]);
    const cleared = authorReducer(imported, { type: 'pivot-field-sorts', sorts: undefined });
    assert.equal(selected(importBundle(exportBundle(cleared))).pivotFieldSorts, undefined);
  }
});
test('malformed, duplicate, unbound, measure and missing-direction imports stay read-only with verbatim export', () => {
  for (const fieldSortOptions of [...malformed, [{ fieldId: 'region' }]]) {
    const bundle = exportBundle(pivotDraft()); bundleConfig(bundle).sortConfiguration = { fieldSortOptions };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).pivotFieldSorts, undefined, JSON.stringify(fieldSortOptions));
    assert.ok(selected(imported).imported.issues.length, JSON.stringify(fieldSortOptions));
    assert.deepEqual(exportBundle(imported), bundle);
  }
  for (const sortConfiguration of [{ fieldSortOptions: [], rowSort: [] }, { fieldSortOptions: [], unknown: true }]) {
    const bundle = exportBundle(pivotDraft()); bundleConfig(bundle).sortConfiguration = sortConfiguration;
    const imported = importBundle(bundle);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});
test('bundle envelope rejects a non-object sort configuration before importing a visual', () => {
  for (const sortConfiguration of [null, [], 'sort']) {
    const bundle = exportBundle(pivotDraft()); bundleConfig(bundle).sortConfiguration = sortConfiguration;
    assert.throws(() => importBundle(bundle), /sortConfiguration: expected an object/);
  }
});
test('imports with native IDs differing from draft column names stay read-only without ID rebinding', () => {
  for (const [well, name] of [['rows', 'region'], ['columns', 'category']]) {
    const bundle = exportBundle(pivotDraft());
    bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells[well][0].categoricalDimensionField.fieldId = 'native-id';
    for (const fieldId of ['native-id', name]) {
      bundleConfig(bundle).sortConfiguration = { fieldSortOptions: [sortBy(fieldId)] };
      const imported = importBundle(bundle);
      assert.equal(selected(imported).pivotFieldSorts, undefined);
      assert.ok(selected(imported).imported.issues.length);
      assert.deepEqual(exportBundle(imported), bundle);
    }
  }
});

test('Properties lists each dimension by display name, sets/replaces/clears independently and ignores invalid selections', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, authorReducer(pivotDraft(), { type: 'formatting', formatting: { names: { region: 'Sales region', category: 'Product' } } }));
    return createElement(PivotFieldSortOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const control = name => renderer.root.findByProps({ 'aria-label': `Sort ${name}` });
  assert.equal(renderer.root.findByType('summary').children[0], 'Field sort');
  assert.deepEqual(renderer.root.findAllByType('label').map(label => label.children[0]), ['Sales region', 'Product']);
  for (const name of ['Sales region', 'Product']) {
    assert.equal(control(name).props.value, '');
    assert.deepEqual(control(name).findAllByType('option').map(o => [o.props.value, o.children[0]]), [['', 'Default'], ['ASC', 'Ascending'], ['DESC', 'Descending']]);
  }
  await act(() => control('Sales region').props.onChange({ target: { value: 'ASC' } }));
  await act(() => control('Product').props.onChange({ target: { value: 'DESC' } }));
  assert.deepEqual(selected(current).pivotFieldSorts, draftSorts);
  await act(() => control('Sales region').props.onChange({ target: { value: 'DESC' } }));
  assert.equal(selected(current).pivotFieldSorts.length, 2);
  assert.equal(control('Sales region').props.value, 'DESC');
  const before = structuredClone(selected(current).pivotFieldSorts);
  for (const invalid of ['invalid', 'asc', null]) await act(() => control('Sales region').props.onChange({ target: { value: invalid } }));
  assert.deepEqual(selected(current).pivotFieldSorts, before);
  await act(() => control('Sales region').props.onChange({ target: { value: '' } }));
  assert.deepEqual(selected(current).pivotFieldSorts, [draftSorts[1]]);
  await act(() => dispatch({ type: 'unassign', field: 'category', well: 'columns' }));
  assert.equal(selected(current).pivotFieldSorts, undefined);
  assert.equal(renderer.root.findAllByType('select').length, 1);
  for (const kind of ['table', 'bar', 'kpi', 'insight']) {
    await act(() => dispatch({ type: 'kind', kind }));
    assert.equal(renderer.root.findAllByType('details').length, 0);
  }
});

test('visual and sheet remaps remove sorts whose dimensions leave the wells', () => {
  const bundle = exportBundle(pivotDraft());
  const field = bundleConfig(bundle).fieldWells.pivotTableAggregatedFieldWells.rows[0].categoricalDimensionField;
  field.fieldId = field.column.columnName = 'unavailable';
  bundleConfig(bundle).sortConfiguration = { fieldSortOptions: [sortBy('unavailable'), sortBy('category', 'DESC')] };
  const imported = importBundle(bundle);
  selected(imported).imported.local = false;
  for (const action of [{ type: 'remap', id: selected(imported).id }, { type: 'sheet-remap', id: activeSheet(imported).id }]) {
    const remapped = authorReducer(imported, action);
    assert.deepEqual(selected(remapped).rows, []);
    assert.deepEqual(selected(remapped).pivotFieldSorts, [{ fieldId: 'category', direction: 'DESC' }]);
    assert.deepEqual(parseDraft(JSON.stringify(remapped)), JSON.parse(JSON.stringify(remapped)));
  }
});
