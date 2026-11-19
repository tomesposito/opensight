import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';

const dimension = (name = 'period', date = false) => ({ [date ? 'dateDimensionField' : 'categoricalDimensionField']: {
  fieldId: name, column: { dataSetIdentifier: 'data', columnName: name }, ...(date ? { dateGranularity: 'MONTH' } : {}),
} });
const input = (trend = true) => ({ source: 'bundle', path: '$', bindings: {}, rows: [{ period: 'B', revenue: 10 }], definition: {
  kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: {
    values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'data', columnName: 'revenue' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
    ...(trend ? { trendGroups: [dimension()] } : {}),
  } } },
} });
const config = v => v.definition.kpiVisual.chartConfiguration;
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (v, source) => source === 'api' ? { ...v, source, definition: projectDefinition(definition(v.definition)).Sheets[0].Visuals[0] } : v;
const normalize = v => normalizeVisual(v.source, v.definition, v.path);
for (const source of ['bundle', 'api']) {
  test(`${source}: KPI accepts one categorical or date trend dimension`, () => {
    for (const date of [false, true]) {
      const v = input(); config(v).fieldWells.trendGroups = [dimension('period', date)];
      assert.deepEqual(normalize(dialect(v, source)).trendDimension, { id: 'period', column: 'period', dataSet: 'data', ...(date ? { dateGranularity: 'MONTH' } : {}) });
      assert.deepEqual(normalize(dialect(v, source)).dimensions, []);
    }
  });
  test(`${source}: KPI trend well rejects malformed, multiple and unsupported variants`, () => {
    for (const bad of [null, {}, [dimension(), dimension()], [{}], [config(input()).fieldWells.values[0]], [{ numericalDimensionField: Object.values(dimension())[0] }]]) {
      const v = input(); config(v).fieldWells.trendGroups = bad;
      assert.throws(() => normalize(dialect(v, source)), CompileError);
    }
    const v = input(); config(v).fieldWells.trendGroups[0].categoricalDimensionField.fieldId = 'value';
    assert.throws(() => normalize(dialect(v, source)), /duplicate field IDs/);
  });
  test(`${source}: empty trend well leaves complete trend-less output unchanged`, () => {
    const v = input(false), empty = structuredClone(v); config(empty).fieldWells.trendGroups = [];
    assert.deepEqual(compileVisual(dialect(v, source)), compileVisual(dialect(empty, source)));
    assert.equal('trendDimension' in normalize(dialect(v, source)), false);
  });
}
