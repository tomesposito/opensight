// Compile the public declaration entry just as a workspace consumer would.
import { parseSyntheticAnalysis, summarizeBundle } from '@opensight/bundle-parser';
import type { AnalysisDefinition, ParameterDeclaration, FilterGroup } from '@opensight/bundle-parser';
const definition: AnalysisDefinition = { DataSetIdentifierDeclarations: [] };
summarizeBundle(parseSyntheticAnalysis({
  ResourceType: 'Analysis', AnalysisId: 'a', Name: 'A', Definition: definition,
}));
const date: ParameterDeclaration = { DateTimeParameterDeclaration: { Name: 'date' } };
// @ts-expect-error Value parameters must specify their cardinality.
const missingCardinality: ParameterDeclaration = { StringParameterDeclaration: { Name: 'region' } };
// @ts-expect-error Arbitrary cardinality strings are not valid.
const invalidCardinality: ParameterDeclaration = { IntegerParameterDeclaration: { Name: 'count', ParameterValueType: 'ANY' } };
// @ts-expect-error Only one parameter variant can be present.
const ambiguous: ParameterDeclaration = { StringParameterDeclaration: { Name: 's', ParameterValueType: 'SINGLE_VALUED' }, DateTimeParameterDeclaration: { Name: 'd' } };
// @ts-expect-error CrossDataset, Filters and ScopeConfiguration are required.
const incompleteFilter: FilterGroup = { FilterGroupId: 'filter' };
void [ambiguous, date, missingCardinality, invalidCardinality, incompleteFilter];
