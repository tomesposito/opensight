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
