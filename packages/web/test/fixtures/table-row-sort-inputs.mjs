// Shared fixed inputs for the pre-slice byte baselines and ordering tests.
const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
export const rows = [
  { category: 'A', region: 'West', revenue: 10, profit: 1 },
  { category: 'B', region: 'East', revenue: 40, profit: 4 },
  { category: 'A', region: 'East', revenue: 30, profit: 3 },
  { category: 'B', region: 'West', revenue: 20, profit: 2 },
  { category: null, region: 'North', revenue: null, profit: null },
];
export const input = ({ totals = false, subtotals = false, data = rows } = {}) => ({
  source: 'bundle', path: '$.test', bindings: {}, rows: structuredClone(data),
  definition: { tableVisual: { visualId: 'table', chartConfiguration: {
    fieldWells: { tableAggregatedFieldWells: { groupBy: [dim('category'), dim('region')], values: [measure('revenue'), measure('profit')] } },
    totalOptions: { totalsVisibility: totals ? 'VISIBLE' : 'HIDDEN' },
    opensightSubtotalOptions: { totalsVisibility: subtotals ? 'VISIBLE' : 'HIDDEN' },
  } } },
});
export const baselineInputs = () => Object.fromEntries([false, true].flatMap(totals => [false, true].flatMap(subtotals =>
  [['rows', rows], ['empty', []], ['unavailable', null]].map(([name, data]) => [`totals-${totals}/subtotals-${subtotals}/${name}`, input({ totals, subtotals, data })]))));
