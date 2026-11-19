import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { projectDefinition, convertDefinition } from '../build/test/definition-converter.js';
const measure = (id = 'target', column = 'budget', aggregation = 'SUM') => ({ numericalMeasureField: {
  fieldId: id, column: { dataSetIdentifier: 'data', columnName: column }, aggregationFunction: { simpleNumericalAggregation: aggregation },
} });
const dimension = () => ({ categoricalDimensionField: { fieldId: 'period', column: { dataSetIdentifier: 'data', columnName: 'period' } } });
const input = (trend = false) => ({ source: 'bundle', path: '$', bindings: {}, rows: [{ period: 'A', revenue: 10, budget: 20 }], definition: {
  kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: { values: [measure('value', 'revenue')], targetValues: [measure()], ...(trend ? { trendGroups: [dimension()] } : {}) } } },
} });
const config = v => v.definition.kpiVisual.chartConfiguration;
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (v, source) => source === 'api' ? { ...v, source, definition: projectDefinition(definition(v.definition)).Sheets[0].Visuals[0] } : v;
const normalize = v => normalizeVisual(v.source, v.definition, v.path);
for (const source of ['bundle', 'api']) {
  test(`${source}: one KPI target uses the measure parser and joins result bindings`, () => {
    const v = dialect(input(), source);
    assert.deepEqual(normalize(v).targetMeasure, { id: 'target', column: 'budget', dataSet: 'data' });
    assert.deepEqual(compileVisual({ ...v, bindings: { target: 'goal' }, rows: [{ revenue: 10, goal: 20 }] }).table.rows, [[10, 20]]);
    assert.throws(() => compileVisual({ ...v, rows: [{ revenue: 10 }] }), /missing result column budget/);
    for (const budget of ['20', true, Infinity, NaN]) assert.throws(() => compileVisual({ ...v, rows: [{ revenue: 10, budget }] }), CompileError);
  });
  test(`${source}: target well rejects malformed/multiple fields, duplicate IDs and mixed datasets`, () => {
    for (const targetValues of [null, {}, [null], [{}], [dimension()], [measure(), measure('other')]]) {
      const v = input(); config(v).fieldWells.targetValues = targetValues;
      assert.throws(() => normalize(dialect(v, source)), CompileError);
    }
    const v = input(); config(v).fieldWells.targetValues = [measure('value')];
    assert.throws(() => normalize(dialect(v, source)), /duplicate field IDs/);
    config(v).fieldWells.targetValues = [measure()]; config(v).fieldWells.targetValues[0].numericalMeasureField.column.dataSetIdentifier = 'other';
    assert.throws(() => normalize(dialect(v, source)), /multiple datasets/);
    config(v).fieldWells.targetValues = [measure()]; delete config(v).fieldWells.targetValues[0].numericalMeasureField.aggregationFunction;
    assert.throws(() => normalize(dialect(v, source)), /expected an object/);
  });
  test(`${source}: absent and empty target wells preserve complete compiled output`, () => {
    for (const trend of [false, true]) {
      const v = input(trend); delete config(v).fieldWells.targetValues;
      const empty = structuredClone(v); config(empty).fieldWells.targetValues = [];
      assert.deepEqual(compileVisual(dialect(v, source)), compileVisual(dialect(empty, source)));
      assert.equal('targetMeasure' in normalize(dialect(v, source)), false);
    }
  });
  test(`${source}: other kinds reject nonempty targets and retain empty no-ops`, () => {
    for (const [variant, well, category] of [['barChartVisual', 'barChartAggregatedFieldWells', 'category'], ['tableVisual', 'tableAggregatedFieldWells', 'groupBy'], ['pivotTableVisual', 'pivotTableAggregatedFieldWells', 'rows']]) {
      const v = input(); v.definition = { [variant]: { visualId: 'v', chartConfiguration: { fieldWells: { [well]: { [category]: [dimension()], values: [measure('value', 'revenue')], targetValues: [measure()] } } } } };
      assert.throws(() => normalize(dialect(v, source)), /field well not supported/);
      v.definition[variant].chartConfiguration.fieldWells[well].targetValues = [];
      const empty = compileVisual(dialect(v, source)); delete v.definition[variant].chartConfiguration.fieldWells[well].targetValues;
      assert.deepEqual(empty, compileVisual(dialect(v, source)));
    }
  });
}
