import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtureRoot = fileURLToPath(new URL('../../../fixtures/renderable-sales/', import.meta.url));
export const read = (name) => readFileSync(join(fixtureRoot, name), 'utf8');
export const json = (name) => JSON.parse(read(name));
export const expected = json('expected-queries.json');
export const semantics = json('semantic-cases.json');
export function request(visualId = 'total-revenue') {
  return { analysis: json('analysis.json'), dataSet: json('describe-data-set.response.json'),
    dataSource: json('describe-data-source.response.json'), localData: json('local-data.json'), visualId };
}
export function body(r) {
  return Object.values(r.analysis.Definition.Sheets[0].Visuals.find((v) => Object.values(v)[0].VisualId === r.visualId))[0];
}
export function wells(r) {
  const w = body(r).ChartConfiguration.FieldWells;
  return r.visualId === 'total-revenue' ? w : Object.values(w)[0];
}
export function measure(name, aggregation = 'SUM', fieldId = name) {
  return { NumericalMeasureField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: name },
    AggregationFunction: { SimpleNumericalAggregation: aggregation } } };
}
export function dimension(name, fieldId = name) {
  return { CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: name } } };
}
export function calculation(r, expression, name = 'calculated') {
  r.analysis.Definition.CalculatedFields.push({ Name: name, DataSetIdentifier: 'sales_data', Expression: expression });
  wells(r).Values = [measure(name)];
}
export function temporaryCsv(t, content, name = 'sales.csv') {
  const root = mkdtempSync(join(tmpdir(), 'opensight-query-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, name), content);
  return { dataRoot: root };
}
export function selectedScope(ids) {
  return { SelectedSheets: { SheetVisualScopingConfigurations: [{ SheetId: 'overview', Scope: 'SELECTED_VISUALS', VisualIds: ids }] } };
}
export const deferredExpressions = {
  'missing-period': ['periodOverPeriodDifference(sum({revenue}), {order_date}, MONTH, 1)'],
  'null-and-zero-denominator': ['{profit} * 100 / {revenue}'],
  'row-ratio-versus-aggregate-ratio': ['avg({profit} * 100 / {revenue})', 'sum({profit}) * 100 / sum({revenue})'],
};
