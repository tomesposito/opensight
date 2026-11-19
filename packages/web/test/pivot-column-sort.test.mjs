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
