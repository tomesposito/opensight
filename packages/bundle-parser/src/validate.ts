import type { SyntheticAnalysisDocument } from './types.js';

type ObjectValue = Record<string, unknown>;
type Validator = (value: unknown, path: string) => void;

export class ValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new ValidationError(path, message);
}

function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as ObjectValue;
}

const string: Validator = (value, path) => {
  if (typeof value !== 'string') fail(path, 'expected a string');
};
const nonempty: Validator = (value, path) => {
  string(value, path);
  if (value === '') fail(path, 'expected a nonempty string');
};
const enumeration = (...allowed: string[]): Validator => (value, path) => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(path, `expected one of ${allowed.join(', ')}`);
  }
};
const array = (item: Validator): Validator => (value, path) => {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  value.forEach((entry: unknown, index: number) => item(entry, `${path}[${index}]`));
};
function optional(value: ObjectValue, key: string, path: string, validate: Validator): void {
  if (Object.hasOwn(value, key)) validate(value[key], `${path}.${key}`);
}
function required(value: ObjectValue, key: string, path: string, validate: Validator): void {
  validate(value[key], `${path}.${key}`);
}

/** Used both during validation and resolution; no unchecked key/body indexing. */
export function singleVariant(value: unknown, path: string): [string, ObjectValue] {
  const entries = Object.entries(object(value, path));
  const entry = entries[0];
  if (entries.length !== 1 || !entry) fail(path, 'expected exactly one variant');
  const [kind, body] = entry;
  return [kind, object(body, `${path}.${kind}`)];
}

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
