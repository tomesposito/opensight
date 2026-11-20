// Complete compiled-output baselines captured from base commit 124b6f76.
import { projectDefinition } from '../../build/test/definition-converter.js';
export function baselineInputs() {
  const inputs = {};
  for (const source of ['bundle', 'api']) for (const trend of ['none', 'category', 'date'])
    for (const direction of [undefined, 'ASC', 'DESC']) for (const data of ['rows', 'empty', 'unavailable']) for (const target of [false, true]) {
      if (trend === 'none' && direction) continue;
      const field = (name) => ({ numericalMeasureField: { fieldId: name, column: { dataSetIdentifier: 'data', columnName: name }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
      const config = { fieldWells: { values: [field('revenue')], ...(target ? { targetValues: [field('goal')] } : {}),
        ...(trend === 'none' ? {} : { trendGroups: [{ [trend === 'date' ? 'dateDimensionField' : 'categoricalDimensionField']: {
          fieldId: 'period', column: { dataSetIdentifier: 'data', columnName: 'period' }, ...(trend === 'date' ? { dateGranularity: 'MONTH' } : {}) } }] }) },
        kpiOptions: { sparkline: { type: 'AREA' }, comparison: { comparisonMethod: 'DIFFERENCE' }, progressBar: { visibility: 'VISIBLE' }, trendArrows: { visibility: 'VISIBLE' } },
        ...(direction ? { sortConfiguration: { trendGroupSort: [{ fieldSort: { fieldId: 'period', direction } }] } } : {}) };
      let definition = { kpiVisual: { visualId: 'kpi', chartConfiguration: config } };
      if (source === 'api') definition = projectDefinition({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [definition] }] }).Sheets[0].Visuals[0];
      const rows = trend === 'none' ? [{ revenue: 30, goal: 40 }] : [
        { period: trend === 'date' ? '2025-03' : 'C', revenue: 20, goal: 25 },
        { period: null, revenue: null, goal: null },
        { period: trend === 'date' ? '2025-01' : 'A', revenue: 10, goal: 15 },
        { period: trend === 'date' ? '2025-02' : 'B', revenue: null, goal: 5 },
      ];
      inputs[`${source}/${trend}/${direction ?? 'none'}/${data}/${target}`] = { source, path: '$.baseline', definition, bindings: {}, rows: data === 'empty' ? [] : data === 'unavailable' ? null : rows };
    }
  return inputs;
}
