// Fixed inputs captured before the pivot field-sort compiler changes.
const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
export const rows = [
  { region: 'West', category: 'B', year: 2025, quarter: 'Q2', revenue: 10, profit: 1 },
  { region: 'East', category: 'B', year: 2024, quarter: 'Q2', revenue: 40, profit: 4 },
  { region: 'West', category: 'A', year: 2025, quarter: 'Q1', revenue: 30, profit: 3 },
  { region: 'East', category: 'A', year: 2024, quarter: 'Q1', revenue: 20, profit: 2 },
  { region: null, category: null, year: null, quarter: null, revenue: null, profit: null },
];
export const input = ({ totals = false, subtotals = false, columnTotals = false, columnSubtotals = false, data = rows } = {}) => ({
  source: 'bundle', path: '$.test', bindings: {}, rows: structuredClone(data),
  definition: { pivotTableVisual: { visualId: 'pivot', chartConfiguration: {
    fieldWells: { pivotTableAggregatedFieldWells: { rows: [dim('region'), dim('category')], columns: [dim('year'), dim('quarter')], values: [measure('revenue'), measure('profit')] } },
    totalOptions: Object.fromEntries(Object.entries({ rowTotalOptions: totals, rowSubtotalOptions: subtotals, columnTotalOptions: columnTotals, columnSubtotalOptions: columnSubtotals })
      .map(([key, visible]) => [key, { totalsVisibility: visible ? 'VISIBLE' : 'HIDDEN' }])),
  } } },
});
export const baselineInputs = () => Object.fromEntries([false, true].flatMap(totals => [false, true].flatMap(subtotals =>
  [false, true].flatMap(columnTotals => [false, true].flatMap(columnSubtotals =>
    [['rows', rows], ['empty', []], ['unavailable', null]].map(([name, data]) =>
      [`rows-${totals}-${subtotals}/columns-${columnTotals}-${columnSubtotals}/${name}`, input({ totals, subtotals, columnTotals, columnSubtotals, data })]))))));
