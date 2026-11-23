import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withoutBindingAggregation } from './fixtures/compiler-baseline.mjs';
import { readFileSync } from 'node:fs';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { TableSortOptions } from '../build/test/PropertiesSections.js';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, groupSortValid, parseDraft, serializeVisual } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { baselineInputs, input } from './fixtures/table-row-sort-inputs.mjs';

const config = value => Object.values(value.definition)[0].chartConfiguration;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const sortBy = (fieldId = 'region', direction = 'ASC') => [{ fieldSort: { fieldId, direction } }];
const sorted = (value = input(), fieldId = 'region', direction = 'ASC') => {
  config(value).sortConfiguration = { rowSort: sortBy(fieldId, direction) };
  return value;
};
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const malformed = [null, {}, 'sort', [null], [{}], [{ fieldSort: null }], [{ fieldSort: {} }],
  sortBy('region', 'DOWN'), sortBy('region', null), sortBy('region', 'asc'),
  [{ fieldSort: { fieldId: 'region', direction: 'ASC', extra: true } }],
  [{ fieldSort: { fieldId: 'region', direction: 'ASC' }, extra: true }],
  sortBy('missing'), [...sortBy(), ...sortBy()], sortBy('')];

for (const source of ['bundle', 'api']) {
  test(`${source}: table parses bound dimensions and measures, default ASC and empty list`, () => {
    for (const fieldId of ['category', 'region', 'revenue', 'profit']) for (const direction of ['ASC', 'DESC']) {
      assert.deepEqual(normalize(dialect(sorted(input(), fieldId, direction), source)).sort, { fieldId, direction });
    }
    const value = sorted();
    delete config(value).sortConfiguration.rowSort[0].fieldSort.direction;
    assert.deepEqual(normalize(dialect(value, source)).sort, { fieldId: 'region', direction: 'ASC' });
    config(value).sortConfiguration.rowSort = [];
    assert.equal(normalize(dialect(value, source)).sort, undefined);
  });
  test(`${source}: malformed row sorts fail closed with CompileError`, () => {
    for (const rowSort of malformed) {
      const value = input();
      config(value).sortConfiguration = { rowSort };
      assert.throws(() => normalize(dialect(value, source)), CompileError, JSON.stringify(rowSort));
    }
    const value = sorted();
    config(value).sortConfiguration.rowSort.push(...sortBy());
    assert.throws(() => normalize(dialect(value, source)), /only one field sort is supported/);
    config(value).sortConfiguration.rowSort = sortBy('missing');
    assert.throws(() => normalize(dialect(value, source)), /sort references an unbound field/);
  });
  test(`${source}: sort keys and display options stay confined to their visual kinds`, () => {
    for (const key of ['categorySort', 'categoryItemsLimit', 'smallMultiplesSort', 'smallMultiplesLimitConfiguration', 'breakdownItemsLimit', 'extra']) {
      const value = sorted();
      config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
    for (const key of ['dataLabels', 'tooltip', 'legend']) {
      const value = input();
      config(value)[key] = {};
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
    for (const kind of ['bar', 'kpi', 'insight']) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      config(value).sortConfiguration = { rowSort: [] };
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
      if (kind === 'insight') {
        config(value).sortConfiguration = {};
        assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
      } else if (kind === 'kpi') {
        config(value).sortConfiguration = {};
        assert.doesNotThrow(() => normalize(dialect(value, source)));
      }
    }
    // Pivots accept rowSort in the ColumnSort shape (parity-pivot-row-sort);
    // the table wrapper shape stays an unsupported property there.
    const pivotValue = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' }))) };
    config(pivotValue).sortConfiguration = { rowSort: [{ fieldSort: { fieldId: 'region', direction: 'ASC' } }] };
    assert.throws(() => normalize(dialect(pivotValue, source)), /unsupported property/);
  });
}

for (const direction of ['ASC', 'DESC']) {
  test(`${direction}: string, numeric and mixed cells use typed ordering with null last`, () => {
    for (const [cells, asc, desc] of [
      [['Z', null, 'A', 'M'], ['A', 'M', 'Z', null], ['Z', 'M', 'A', null]],
      [[10, null, 2, 30], [2, 10, 30, null], [30, 10, 2, null]],
      [[false, null, 'A', true], ['A', false, true, null], [true, false, 'A', null]],
    ]) {
      const value = input({ data: cells.map((category, i) => ({ category, region: String(i), revenue: i, profit: i })) });
      const original = structuredClone(value.rows);
      assert.deepEqual(compileVisual(sorted(value, 'category', direction)).table.rows.map(r => r[0]), direction === 'ASC' ? asc : desc);
      assert.deepEqual(value.rows, original, 'caller rows are not mutated');
    }
  });
  test(`${direction}: measures and later groupBy dimensions sort plain table rows stably`, () => {
    const byMeasure = compileVisual(sorted(input(), 'revenue', direction)).table.rows;
    assert.deepEqual(byMeasure.map(r => r[2]), direction === 'ASC' ? [10, 20, 30, 40, null] : [40, 30, 20, 10, null]);
    const byRegion = compileVisual(sorted(input(), 'region', direction)).table.rows;
    assert.deepEqual(byRegion.map(r => r.slice(0, 2)), direction === 'ASC'
      ? [['B', 'East'], ['A', 'East'], [null, 'North'], ['A', 'West'], ['B', 'West']]
      : [['A', 'West'], ['B', 'West'], [null, 'North'], ['B', 'East'], ['A', 'East']]);
  });
}
for (const totals of [false, true]) for (const subtotals of [false, true]) {
  if (!totals && !subtotals) continue;
  test(`totals=${totals}, subtotals=${subtotals}: interleaved measure sort keeps groups and rollup values intact`, () => {
    const value = input({ totals, subtotals });
    const unsorted = compileVisual(value).table;
    const table = compileVisual(sorted(value, 'revenue', 'DESC')).table;
    assert.deepEqual(table.rows.filter((_, i) => table.rowKinds[i] === 'detail'), [
      ['B', 'East', 40, 4], ['B', 'West', 20, 2], ['A', 'East', 30, 3], ['A', 'West', 10, 1], [null, 'North', null, null],
    ]);
    const rollups = table => Object.fromEntries(table.rows.flatMap((row, i) => table.rowKinds[i] === 'detail' ? [] : [[JSON.stringify(row.slice(0, 2)), row.slice(2)]]));
    assert.deepEqual(rollups(table), rollups(unsorted));
    if (totals) assert.deepEqual(table.rows.at(-1), ['Grand total', '', 100, 10]);
    if (subtotals) {
      assert.deepEqual(table.rowKinds.slice(0, 6), ['detail', 'detail', 'subtotal', 'detail', 'detail', 'subtotal']);
      assert.deepEqual(table.rows[2], ['B', 'Subtotal', 60, 6]);
      assert.deepEqual(table.rows[5], ['A', 'Subtotal', 40, 4]);
    }
  });
}
test('totals group numeric, string and null keys independently regardless of sorted contiguity', () => {
  const data = [1, '1', null, 1, '1', null].map((category, i) => ({ category, region: String(i), revenue: i + 1, profit: 1 }));
  const table = compileVisual(sorted(input({ data, totals: true, subtotals: true }), 'revenue', 'DESC')).table;
  assert.deepEqual(table.rows, [
    [null, '5', 6, 1], [null, '2', 3, 1], [null, 'Subtotal', 9, 2],
    ['1', '4', 5, 1], ['1', '1', 2, 1], ['1', 'Subtotal', 7, 2],
    [1, '3', 4, 1], [1, '0', 1, 1], [1, 'Subtotal', 5, 2], ['Grand total', '', 21, 6],
  ]);
});

// Captured from ddb9ea7689d32281384e75b2ee438d66d143b3d1 before compiler edits.
// Hash all compiled output, including function source, following the facet-sort precedent.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/table-row-sort-baseline.json', import.meta.url), 'utf8'));
for (const [name, value] of Object.entries(baselineInputs())) test(`unset rowSort preserves base output bytes apart from binding metadata: ${name}`, () => {
  const compiled = compileVisual(value);
  const bytes = JSON.stringify(withoutBindingAggregation(compiled), (_, v) => typeof v === 'function' ? v.toString() : v);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), baseline.hashes[name]);
  config(value).sortConfiguration = { rowSort: [] };
  assert.deepEqual(compileVisual(value), compiled);
});

const tableDraft = () => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'table' }), { type: 'assign', field: 'category', well: 'rows' });
const invalidDraftSorts = [null, [], 'sort', {}, { fieldId: 'region' }, { direction: 'ASC' },
  { fieldId: '', direction: 'ASC' }, { fieldId: 'region\0', direction: 'ASC' }, { fieldId: 'region', direction: 'asc' }, { fieldId: 'region', direction: 'ASC', extra: 1 }];
test('table group-sort reducer and draft storage round-trip, clone and validate the shared shape', () => {
  const sort = { fieldId: 'region', direction: 'DESC' };
  const draft = authorReducer(tableDraft(), { type: 'group-sort', sort });
  sort.direction = 'ASC';
  assert.deepEqual(selected(draft).groupSort, { fieldId: 'region', direction: 'DESC' });
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  for (const bad of invalidDraftSorts) {
    assert.equal(groupSortValid(bad), false);
    assert.deepEqual(selected(authorReducer(draft, { type: 'group-sort', sort: bad })), selected(draft));
    const tampered = structuredClone(draft);
    selected(tampered).groupSort = bad;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  assert.equal(selected(authorReducer(draft, { type: 'group-sort', sort: undefined })).groupSort, undefined);
});
test('removing each table groupBy dimension or measure clears its sort and preserves unrelated sorts', () => {
  const base = tableDraft();
  const visual = selected(base);
  assert.ok(visual.rows.length >= 2);
  for (const fieldId of [...visual.rows, ...visual.measures]) {
    const draft = authorReducer(base, { type: 'group-sort', sort: { fieldId, direction: 'ASC' } });
    const well = visual.rows.includes(fieldId) ? 'rows' : 'values';
    assert.equal(selected(authorReducer(draft, { type: 'unassign', field: fieldId, well })).groupSort, undefined);
    assert.equal(selected(authorReducer(draft, { type: 'unassign', field: fieldId })).groupSort, undefined);
    const other = [...visual.rows, ...visual.measures].find(f => f !== fieldId);
    assert.deepEqual(selected(authorReducer(draft, { type: 'unassign', field: other })).groupSort, selected(draft).groupSort);
  }
});
test('table serialization emits only rowSort while bar/bar100/pie retain categorySort', () => {
  for (const kind of ['table', 'bar', 'bar100', 'pie']) {
    const draft = authorReducer(authorReducer(emptyDraft(), { type: 'add', kind }), { type: 'group-sort', sort: { fieldId: 'revenue', direction: 'DESC' } });
    const value = { definition: serializeVisual(selected(draft)) };
    assert.deepEqual(config(value).sortConfiguration, { [kind === 'table' ? 'rowSort' : 'categorySort']: sortBy('revenue', 'DESC') });
    assert.deepEqual(normalizeVisual('bundle', value.definition).sort, { fieldId: 'revenue', direction: 'DESC' });
  }
});

test('table bundle import accepts every groupBy dimension and measure with explicit direction', () => {
  const base = tableDraft();
  for (const fieldId of [...selected(base).rows, ...selected(base).measures]) for (const direction of ['ASC', 'DESC']) {
    const draft = authorReducer(base, { type: 'group-sort', sort: { fieldId, direction } });
    const bundle = exportBundle(draft), imported = importBundle(bundle);
    assert.deepEqual(selected(imported).groupSort, { fieldId, direction });
    assert.deepEqual(selected(imported).imported.issues, []);
    assert.deepEqual(parseDraft(JSON.stringify(imported)), JSON.parse(JSON.stringify(imported)));
    assert.deepEqual(exportBundle(imported), bundle);
    const edited = authorReducer(imported, { type: 'group-sort', sort: { fieldId, direction: direction === 'ASC' ? 'DESC' : 'ASC' } });
    assert.deepEqual(selected(importBundle(exportBundle(edited))).groupSort, selected(edited).groupSort);
    const cleared = authorReducer(imported, { type: 'group-sort', sort: undefined });
    assert.equal(selected(importBundle(exportBundle(cleared))).groupSort, undefined);
  }
});
test('malformed, unbound, missing-direction and multiple imported row sorts stay retained read-only', () => {
  for (const rowSort of [...malformed, [{ fieldSort: { fieldId: 'region' } }]]) {
    const bundle = exportBundle(tableDraft());
    const raw = bundle.members[0].resource.definition.sheets[0].visuals[0];
    raw.tableVisual.chartConfiguration.sortConfiguration = { rowSort };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).groupSort, undefined, JSON.stringify(rowSort));
    assert.ok(selected(imported).imported.issues.length, JSON.stringify(rowSort));
    assert.deepEqual(exportBundle(imported), bundle);
  }
});

test('Row sort controls list table fields, use display names, default directions and preserve valid selections', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, authorReducer(tableDraft(), { type: 'formatting', formatting: { names: { region: 'Sales region', revenue: 'Sales' } } }));
    return createElement(TableSortOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const control = () => renderer.root.findByProps({ 'aria-label': 'Sort rows by' });
  assert.deepEqual(control().findAllByType('option').map(o => [o.props.value, o.children[0]]), [['', 'Default order'], ['region', 'Sales region'], ['category', 'category'], ['revenue', 'Sales']]);
  assert.equal(control().props.value, '');
  assert.equal(renderer.root.findAllByType('button').length, 0);
  for (const [fieldId, direction] of [['category', 'ASC'], ['revenue', 'DESC'], ['region', 'ASC']]) {
    await act(() => control().props.onChange({ target: { value: fieldId } }));
    assert.deepEqual(selected(current).groupSort, { fieldId, direction });
  }
  for (const direction of ['DESC', 'ASC']) {
    const button = renderer.root.findByProps({ 'aria-label': direction === 'ASC' ? 'Sort rows ascending' : 'Sort rows descending' });
    await act(() => button.props.onClick());
    assert.deepEqual(selected(current).groupSort, { fieldId: 'region', direction });
    assert.equal(button.props['aria-pressed'], true);
  }
  await act(() => control().props.onChange({ target: { value: 'missing' } }));
  assert.deepEqual(selected(current).groupSort, { fieldId: 'region', direction: 'ASC' });
  await act(() => dispatch({ type: 'unassign', field: 'region', well: 'rows' }));
  assert.equal(control().props.value, '');
  await act(() => control().props.onChange({ target: { value: 'revenue' } }));
  await act(() => control().props.onChange({ target: { value: '' } }));
  assert.equal(selected(current).groupSort, undefined);
  assert.equal(renderer.root.findAllByType('button').length, 0);
  for (const kind of ['bar', 'pivot', 'kpi', 'insight']) {
    await act(() => dispatch({ type: 'kind', kind }));
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Sort rows by' }).length, 0);
  }
});

test('native RowSort and internal rowSort round-trip through the existing definition converter', () => {
  const value = sorted(input(), 'region', 'DESC');
  const internal = definition(value.definition);
  const native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].TableVisual.ChartConfiguration.SortConfiguration,
    { RowSort: [{ FieldSort: { FieldId: 'region', Direction: 'DESC' } }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(compileVisual(dialect(value, 'api')).table, compileVisual(value).table);
});
test('row sorting resolves bound field IDs and result aliases independently of column names', () => {
  const value = input();
  config(value).fieldWells.tableAggregatedFieldWells.groupBy[1].categoricalDimensionField.fieldId = 'region-id';
  value.bindings = { 'region-id': 'region_alias' };
  value.rows = value.rows.map(({ region, ...row }) => ({ ...row, region_alias: region }));
  for (const source of ['bundle', 'api']) {
    const compiled = compileVisual(dialect(sorted(value, 'region-id', 'DESC'), source));
    assert.deepEqual(compiled.table.rows.map(r => r[1]), ['West', 'West', 'North', 'East', 'East']);
    assert.throws(() => normalize(dialect(sorted(value, 'region', 'DESC'), source)), /unbound field/);
  }
});
test('bundle imports with unmapped native field IDs stay read-only and round-trip verbatim', () => {
  const bundle = exportBundle(tableDraft());
  const body = bundle.members[0].resource.definition.sheets[0].visuals[0].tableVisual;
  body.chartConfiguration.fieldWells.tableAggregatedFieldWells.groupBy[0].categoricalDimensionField.fieldId = 'region-id';
  for (const fieldId of ['region-id', 'region']) {
    body.chartConfiguration.sortConfiguration = { rowSort: sortBy(fieldId, 'DESC') };
    const imported = importBundle(bundle);
    assert.equal(selected(imported).groupSort, undefined);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});
