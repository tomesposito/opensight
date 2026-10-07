import { validateInsightConfiguration } from './insight-validation.js';
import type { SyntheticAnalysisDocument } from './types.js';

import { array, enumeration, fail, nonempty, object, optional, required, singleVariant, string, type Validator } from './validation.js';
export { ValidationError, singleVariant } from './validation.js';

const title: Validator = (value, path) => {
  const t = object(value, path);
  optional(t, 'Visibility', path, enumeration('VISIBLE', 'HIDDEN'));
  optional(t, 'FormatText', path, (format, formatPath) => {
    const f = object(format, formatPath);
    optional(f, 'PlainText', formatPath, string);
    optional(f, 'RichText', formatPath, string);
  });
};

const visual: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  const bodyPath = `${path}.${kind}`;
  required(body, 'VisualId', bodyPath, nonempty);
  optional(body, 'Title', bodyPath, title);
  optional(body, 'Subtitle', bodyPath, title);
  if (kind === 'InsightVisual') optional(body, 'InsightConfiguration', bodyPath, (value, path) => validateInsightConfiguration(value, path, true));
};

const parameter: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  const bodyPath = `${path}.${kind}`;
  switch (kind) {
    case 'StringParameterDeclaration':
    case 'IntegerParameterDeclaration':
    case 'DecimalParameterDeclaration':
      required(body, 'ParameterValueType', bodyPath, enumeration('SINGLE_VALUED', 'MULTI_VALUED'));
      break;
    case 'DateTimeParameterDeclaration':
      optional(body, 'TimeGranularity', bodyPath,
        enumeration('YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MILLISECOND'));
      break;
    default:
      fail(`${path}.${kind}`, 'unsupported parameter variant');
  }
  required(body, 'Name', bodyPath, nonempty);
};

const matchOperator = enumeration('EQUALS', 'DOES_NOT_EQUAL', 'CONTAINS',
  'DOES_NOT_CONTAIN', 'STARTS_WITH', 'ENDS_WITH');
const nullOption = enumeration('ALL_VALUES', 'NULLS_ONLY', 'NON_NULLS_ONLY');

const filter: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  // Unmodeled filters remain opaque. The inventory does not execute any filters.
  if (kind !== 'CategoryFilter') return;
  const bodyPath = `${path}.${kind}`;
  required(body, 'FilterId', bodyPath, nonempty);
  required(body, 'Column', bodyPath, (column, columnPath) => {
    const c = object(column, columnPath);
    required(c, 'ColumnName', columnPath, nonempty);
    required(c, 'DataSetIdentifier', columnPath, nonempty);
  });
  required(body, 'Configuration', bodyPath, (config, configPath) => {
    const [configKind, c] = singleVariant(config, configPath);
    const p = `${configPath}.${configKind}`;
    if (configKind === 'CustomFilterConfiguration') {
      required(c, 'MatchOperator', p, matchOperator);
      required(c, 'NullOption', p, nullOption);
      optional(c, 'ParameterName', p, nonempty);
      optional(c, 'CategoryValue', p, string);
      if (Object.hasOwn(c, 'ParameterName') && Object.hasOwn(c, 'CategoryValue')) {
        fail(p, 'ParameterName and CategoryValue are mutually exclusive');
      }
      optional(c, 'SelectAllOptions', p, enumeration('FILTER_ALL_VALUES'));
    } else if (configKind === 'FilterListConfiguration') {
      required(c, 'MatchOperator', p, matchOperator);
      optional(c, 'CategoryValues', p, array(string));
      optional(c, 'NullOption', p, nullOption);
      optional(c, 'SelectAllOptions', p, enumeration('FILTER_ALL_VALUES'));
    }
  });
};

const scope: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (kind !== 'SelectedSheets') return;
  optional(body, 'SheetVisualScopingConfigurations', `${path}.${kind}`, array((value, p) => {
    const s = object(value, p);
    required(s, 'SheetId', p, nonempty);
    required(s, 'Scope', p, enumeration('ALL_VISUALS', 'SELECTED_VISUALS'));
    optional(s, 'VisualIds', p, array(nonempty));
  }));
};

const filterGroup: Validator = (value, path) => {
  const f = object(value, path);
  required(f, 'FilterGroupId', path, nonempty);
  required(f, 'CrossDataset', path, enumeration('ALL_DATASETS', 'SINGLE_DATASET'));
  required(f, 'Filters', path, array(filter));
  required(f, 'ScopeConfiguration', path, scope);
  optional(f, 'Status', path, enumeration('ENABLED', 'DISABLED'));
};

/** Validate every typed/consumed inventory property without mutating the input. */
export function assertSyntheticAnalysis(raw: unknown): asserts raw is SyntheticAnalysisDocument {
  const b = object(raw, '$');
  required(b, 'ResourceType', '$', enumeration('Analysis'));
  required(b, 'AnalysisId', '$', nonempty);
  required(b, 'Name', '$', nonempty);
  const path = '$.Definition';
  const d = object(b.Definition, path);
  required(d, 'DataSetIdentifierDeclarations', path, array((value, p) => {
    const ds = object(value, p);
    required(ds, 'Identifier', p, nonempty);
    required(ds, 'DataSetArn', p, nonempty);
  }));
  optional(d, 'Sheets', path, array((value, p) => {
    const s = object(value, p);
    required(s, 'SheetId', p, nonempty);
    optional(s, 'Name', p, string);
    optional(s, 'Visuals', p, array(visual));
  }));
  optional(d, 'CalculatedFields', path, array((value, p) => {
    const c = object(value, p);
    for (const key of ['DataSetIdentifier', 'Name', 'Expression']) required(c, key, p, nonempty);
  }));
  optional(d, 'ParameterDeclarations', path, array(parameter));
  optional(d, 'FilterGroups', path, array(filterGroup));
}
