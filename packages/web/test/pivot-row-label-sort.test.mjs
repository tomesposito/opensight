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
    for (const key of ['categorySort', 'columnLabelSort', 'trendGroupSort', 'smallMultiplesSort']) {
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
