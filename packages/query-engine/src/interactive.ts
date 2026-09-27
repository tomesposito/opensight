import type { ParameterBindings, ParameterDeclaration } from './parameters.js';
import type { ParameterFilter, PlanRequest } from './types.js';
export interface InteractiveQuery {
  dimensions: { fieldId: string; columnName: string; granularity?: string }[];
  measures: { fieldId: string; columnName: string; aggregation: string }[];
  filters: ({ columnName: string; value: string } | { columnName: string; values: string[] } | ParameterFilter)[];
  calculatedFields?: { name: string; expression: string }[];
  parameterDeclarations?: ParameterDeclaration[];
  parameterBindings?: ParameterBindings;
}
/** Transport projection shared by the local API and pinned browser fixture execution. */
export function interactiveRequest(body: InteractiveQuery, metadata: Pick<PlanRequest, 'dataSet' | 'dataSource' | 'localData'>): PlanRequest {
  const column = (columnName: string) => ({ DataSetIdentifier: 'sales_data', ColumnName: columnName });
  return { ...metadata, visualId: 'query', parameterDeclarations: body.parameterDeclarations, parameterBindings: body.parameterBindings,
    parameterFilters: body.filters.filter((f): f is ParameterFilter => 'parameterName' in f),
    analysis: { ResourceType: 'Analysis', AnalysisId: 'live-query', Name: 'Local sales query', Definition: {
      DataSetIdentifierDeclarations: [{ Identifier: 'sales_data', DataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales' }],
      CalculatedFields: (body.calculatedFields ?? []).map(field => ({ DataSetIdentifier: 'sales_data', Name: field.name, Expression: field.expression })),
      FilterGroups: body.filters.filter((f): f is { columnName: string; value: string } | { columnName: string; values: string[] } => !('parameterName' in f)).map((filter, i) => ({ FilterGroupId: `filter-${i}`, Status: 'ENABLED', CrossDataset: 'SINGLE_DATASET', ScopeConfiguration: { AllSheets: {} },
        Filters: [{ CategoryFilter: { FilterId: `filter-${i}`, Column: column(filter.columnName), Configuration: { FilterListConfiguration: { MatchOperator: 'EQUALS', NullOption: 'NON_NULLS_ONLY', CategoryValues: 'values' in filter ? filter.values : [filter.value] } } } }],
      })),
      Sheets: [{ SheetId: 'query', Visuals: [{ TableVisual: { VisualId: 'query', ChartConfiguration: { FieldWells: { TableAggregatedFieldWells: {
        GroupBy: body.dimensions.map(field => ({ [field.granularity === undefined ? 'CategoricalDimensionField' : 'DateDimensionField']: { FieldId: field.fieldId, Column: column(field.columnName), ...(field.granularity === undefined ? {} : { DateGranularity: field.granularity }) } })),
        Values: body.measures.map(field => ({ NumericalMeasureField: { FieldId: field.fieldId, Column: column(field.columnName), AggregationFunction: { SimpleNumericalAggregation: field.aggregation } } })),
      } } } } }] }],
    } },
  };
}
