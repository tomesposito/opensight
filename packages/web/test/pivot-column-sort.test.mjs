import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../build/test/authoring.js';
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
const sorted = (value = input(), sorts = [sort()]) => { config(value).sortConfiguration = { columnSort: sorts }; return value; };
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
  test(`${source}: column sort resolves bound measure IDs and defaults direction/aggregation`, () => {
    const value = sorted(); wells(value).values[0].numericalMeasureField.fieldId = 'native-measure';
    assert.deepEqual(normalize(dialect(value, source)).columnSort, { measureFieldId: 'native-measure', direction: 'DESC', aggregation: 'SUM' });
    delete config(value).sortConfiguration.columnSort[0].direction;
    delete config(value).sortConfiguration.columnSort[0].aggregationFunction;
    assert.deepEqual(normalize(dialect(value, source)).columnSort, { measureFieldId: 'native-measure', direction: 'ASC', aggregation: 'SUM' });
    assert.equal(normalize(dialect(sorted(input(), []), source)).columnSort, undefined);
    assert.deepEqual(compileVisual(dialect(sorted(input(), []), source)), compileVisual(dialect(input(), source)));
  });
  test(`${source}: malformed entries and unknown keys at every level fail closed`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(sorted(input(), sorts), source)), CompileError, JSON.stringify(sorts));
    for (const key of ['unknown', 'rowLabelSort', 'categorySort', 'rowSort', 'trendGroupSort']) {
      const value = sorted(); config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), CompileError, key);
    }
    const value = sorted(); wells(value).columns = [];
    assert.throws(() => normalize(dialect(value, source)), /column sort requires a Columns dimension/);
    assert.doesNotThrow(() => normalize(dialect(sorted(value, []), source)));
  });
  test(`${source}: all non-pivot kinds reject column sort, including an empty list`, () => {
    for (const kind of ['bar','bar100','line','area','combo','pie','table','kpi','insight','radar','sankey','waterfall','treemap','funnel','heatmap','box','histogram','scatter','wordCloud','pointMap','filledMap','gauge']) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      for (const sorts of [[], [sort()]]) assert.throws(() => normalize(dialect(sorted(value, sorts), source)), CompileError, kind);
    }
  });
}
test('converter maps ColumnSort without a FieldId and round-trips both dialects', () => {
  const internal = definition(sorted().definition), native = projectDefinition(internal);
  assert.deepEqual(native.Sheets[0].Visuals[0].PivotTableVisual.ChartConfiguration.SortConfiguration, { ColumnSort: [{
    SortBy: { DataSetIdentifier: 'data', ColumnName: 'revenue' }, Direction: 'DESC',
    AggregationFunction: { NumericalAggregationFunction: { SimpleNumericalAggregation: 'SUM' } },
  }] });
  assert.deepEqual(convertDefinition(native), internal);
  assert.deepEqual(projectDefinition(convertDefinition(native)), native);
});

const data = [
  { year: 'A', revenue: 4 }, { year: 'B', revenue: 9 }, { year: 'C', revenue: 6 }, { year: 'Null', revenue: null },
  { year: 'A', revenue: 4 }, { year: 'C', revenue: 2 }, { year: 'D', revenue: 8 }, { year: 'A', revenue: 4 },
  { year: 'B', revenue: null }, { year: 'Null', revenue: null },
].map((row, i) => ({ region: 'West', category: `Product ${i}`,  quarter: 'Q1', profit: 1, ...row }));
const asc = { SUM: ['C','D','B','A','Null'], AVERAGE: ['A','C','D','B','Null'], MIN: ['C','A','D','B','Null'],
  MAX: ['A','C','D','B','Null'], COUNT: ['B','D','C','A','Null'], DISTINCT_COUNT: ['A','B','D','C','Null'] };
const desc = { SUM: ['A','B','C','D','Null'], AVERAGE: ['B','D','A','C','Null'], MIN: ['B','D','A','C','Null'],
  MAX: ['B','D','C','A','Null'], COUNT: ['A','C','B','D','Null'], DISTINCT_COUNT: ['C','A','B','D','Null'] };
for (const aggregation of Object.keys(asc)) for (const direction of ['ASC','DESC']) for (const source of ['bundle','api']) {
  test(`${source}: ${aggregation} ${direction} ranks outer groups with stable ties and null aggregates last`, () => {
    const value = sorted(input({ data, totals: true }), [sort(aggregation, direction)]), before = structuredClone(value.rows);
    const table = compileVisual(dialect(value, source)).table;
    const expected = (direction === 'ASC' ? asc : desc)[aggregation];
    assert.deepEqual(table.columns.slice(2).filter((_, i) => i % 2 === 0), expected.map(group => `year: ${group} / quarter: Q1 · revenue`));
    assert.deepEqual(table.rows.at(-1).slice(2).filter((_, i) => i % 2 === 0), expected.map(group => {
      const values = data.filter(row => row.year === group && row.revenue !== null).map(row => row.revenue);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    }));
    assert.deepEqual(value.rows, before);
  });
}
test('multi-level columns preserve inner first appearance and explicit sorts; outer sort overrides only its field sort', () => {
  const value = sorted();
  const base = compileVisual(input()).table;
  const table = compileVisual(value).table;
  assert.deepEqual(table.rowGroupPaths, base.rowGroupPaths);
  assert.deepEqual(table.columns.slice(2).filter((_, i) => i % 2 === 0), [
    'year: 2,024 / quarter: Q2 · revenue', 'year: 2,024 / quarter: Q1 · revenue',
    'year: 2,025 / quarter: Q2 · revenue', 'year: 2,025 / quarter: Q1 · revenue', 'year: (null) / quarter: (null) · revenue',
  ]);
  config(value).sortConfiguration.fieldSortOptions = [{ fieldId: 'year', sortDirection: 'DESC' },
    { fieldId: 'quarter', sortDirection: 'ASC' }, { fieldId: 'region', sortDirection: 'ASC' }, { fieldId: 'category', sortDirection: 'ASC' }];
  const sortedTable = compileVisual(value).table;
  assert.match(sortedTable.columns[2], /2,024 \/ quarter: Q1/);
  assert.match(sortedTable.columns[4], /2,024 \/ quarter: Q2/);
  assert.deepEqual(sortedTable.rowGroupPaths, [['East','A'],['East','B'],['West','A'],['West','B'],[null,null]]);
  const tied = sorted(input({ data: data.filter(row => row.year !== 'Null').map(row => ({ ...row, revenue: 1 })) }), [sort('MAX')]);
  config(tied).sortConfiguration.fieldSortOptions = [{ fieldId: 'year', sortDirection: 'DESC' }];
  assert.deepEqual(compileVisual(tied).table.columns.slice(2).filter((_, i) => i % 2 === 0), ['A','B','C','D'].map(group => `year: ${group} / quarter: Q1 · revenue`));
});
test('typed groups remain distinct, arbitrary measure IDs resolve aliases, and input rows stay frozen', () => {
  const value = sorted(input({ data: ['1', 1, null, false].map((year, i) => ({ ...data[0], year, revenue: i + 1 })) }));
  wells(value).values[0].numericalMeasureField.fieldId = 'native-measure';
  value.bindings = { 'native-measure': 'result_alias' };
  value.rows = value.rows.map(({ revenue, ...row }) => Object.freeze({ ...row, result_alias: revenue }));
  Object.freeze(value.rows);
  for (const source of ['bundle','api']) {
    const table = compileVisual(dialect(value, source)).table;
    assert.deepEqual(table.rows[0].slice(2).filter((_, i) => i % 2 === 0), [4,3,2,1]);
    assert.equal(table.columns[6], table.columns[8]);
  }
});
test('empty/unavailable data works; non-finite aggregates and invalid result cells fail closed', () => {
  assert.equal(compileVisual(sorted(input({ data: [] }))).state, 'empty');
  assert.equal(compileVisual(sorted(input({ data: null }))).state, 'unavailable');
  for (const aggregation of ['SUM','AVERAGE']) assert.throws(() => compileVisual(sorted(input({ data: [data[0],data[1]].map(row => ({ ...row, year: 'A', revenue: 1e308 })) }), [sort(aggregation)])), /aggregation sort result must be finite/);
  for (const revenue of [Infinity, NaN, 'bad']) assert.throws(() => compileVisual(sorted(input({ data: [{ ...data[0], revenue }] }))), CompileError);
});
const cellsByIdentity = table => Object.fromEntries(table.rows.flatMap((row, i) => row.slice(table.dimensionCount).map((value, offset) =>
  [JSON.stringify([table.rowKinds[i], table.rowGroupPaths[i], table.columns[table.dimensionCount + offset]]), value])));
for (const totals of [false, true]) for (const subtotals of [false, true]) for (const columnTotals of [false, true]) for (const columnSubtotals of [false, true]) {
  test(`column ordering preserves detail and rollup values: rows ${totals}/${subtotals}, columns ${columnTotals}/${columnSubtotals}`, () => {
    const value = input({ totals, subtotals, columnTotals, columnSubtotals });
    const base = compileVisual(value).table, table = compileVisual(sorted(value)).table;
    assert.deepEqual(cellsByIdentity(table), cellsByIdentity(base));
    assert.deepEqual(table.rowGroupPaths, base.rowGroupPaths);
    if (totals) { assert.equal(table.rowKinds.at(-1), 'total'); assert.deepEqual(table.rowGroupPaths.at(-1), []); }
    if (columnTotals) assert.deepEqual(table.columns.slice(-2), ['Grand total · revenue','Grand total · profit']);
    if (columnSubtotals) assert.deepEqual(table.columns.slice(2,8).filter((_, i) => i % 2 === 0), [
      'year: 2,024 / quarter: Q2 · revenue', 'year: 2,024 / quarter: Q1 · revenue', 'year: 2,024 / Subtotal · revenue',
    ]);
    if (totals && columnTotals) assert.deepEqual(table.rows.at(-1).slice(-2), [100,10]);
  });
}
