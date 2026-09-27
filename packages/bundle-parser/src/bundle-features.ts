/** Provisional camelCase feature inventory, exercised by synthetic fixtures only.
 * Validation certifies inventory structure, never QuickSight execution semantics.
 */
import {
  array, enumeration, fail, nonempty, object, optional, required, singleVariant,
  string, type ObjectValue, type Validator,
} from './validation.js';

const finiteNumber: Validator = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
};
const integer: Validator = (value, path) => {
  finiteNumber(value, path);
  if (!Number.isSafeInteger(value)) fail(path, 'expected a safe integer');
};
const boolean: Validator = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
};
const nullOption = enumeration('ALL_VALUES', 'NULLS_ONLY', 'NON_NULLS_ONLY');
const granularity = enumeration('YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MILLISECOND');
export const bundleColumn: Validator = (value, path) => {
  const c = object(value, path);
  required(c, 'dataSetIdentifier', path, nonempty);
  required(c, 'columnName', path, nonempty);
};
const parameterKinds = new Set(['stringParameterDeclaration', 'integerParameterDeclaration', 'decimalParameterDeclaration', 'dateTimeParameterDeclaration']);
const filterKinds = new Set(['categoryFilter', 'numericRangeFilter', 'relativeDatesFilter', 'timeRangeFilter']);

export const bundleParameter: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (!parameterKinds.has(kind)) {
    if (!kind.endsWith('ParameterDeclaration') || /^[A-Z]/u.test(kind)) fail(path, 'expected a camelCase parameter declaration');
    return; // A future variant is retained and explicitly reported as unsupported.
  }
  const p = `${path}.${kind}`;
  required(body, 'name', p, nonempty);
  if (kind !== 'dateTimeParameterDeclaration') {
    required(body, 'parameterValueType', p, enumeration('SINGLE_VALUED', 'MULTI_VALUED'));
  } else optional(body, 'parameterValueType', p, enumeration('SINGLE_VALUED'));
  optional(body, 'timeGranularity', p, granularity);
  const scalar = kind === 'integerParameterDeclaration' ? integer
    : kind === 'decimalParameterDeclaration' ? finiteNumber : kind === 'dateTimeParameterDeclaration' ? nonempty : string;
  optional(body, 'defaultValues', p, (value, p) => {
    const defaults = object(value, p);
    optional(defaults, 'staticValues', p, array(scalar));
    if ((body.parameterValueType === 'SINGLE_VALUED' || kind === 'dateTimeParameterDeclaration') && Array.isArray(defaults.staticValues) && defaults.staticValues.length > 1) {
      fail(`${p}.staticValues`, 'single-valued parameter has multiple defaults');
    }
    optional(defaults, 'dynamicValue', p, (value, p) => {
      const dynamic = object(value, p);
      required(dynamic, 'dataSetIdentifier', p, nonempty);
      required(dynamic, 'defaultValueColumn', p, nonempty);
      optional(dynamic, 'groupNameColumn', p, nonempty);
      optional(dynamic, 'userNameColumn', p, nonempty);
    });
    optional(defaults, 'rollingDate', p, (value, p) => required(object(value, p), 'expression', p, nonempty));
  });
  optional(body, 'valueWhenUnset', p, (value, p) => {
    const unset = object(value, p);
    optional(unset, 'valueWhenUnsetOption', p, enumeration('RECOMMENDED_VALUE', 'NULL'));
    optional(unset, 'customValue', p, scalar);
  });
};

const range = (scalar: Validator): Validator => (value, path) => {
  const r = object(value, path);
  const keys = ['staticValue', 'parameter'].filter(key => Object.hasOwn(r, key));
  if (keys.length !== 1) fail(path, 'expected exactly one of staticValue or parameter');
  optional(r, 'staticValue', path, scalar);
  optional(r, 'parameter', path, nonempty);
};
const categoryConfiguration: Validator = (value, path) => {
  const [kind, c] = singleVariant(value, path);
  const p = `${path}.${kind}`;
  if (!['filterListConfiguration', 'customFilterConfiguration', 'customFilterListConfiguration'].includes(kind)) {
    fail(p, 'unsupported category configuration');
  }
  required(c, 'matchOperator', p, enumeration('EQUALS', 'DOES_NOT_EQUAL', 'CONTAINS', 'DOES_NOT_CONTAIN', 'STARTS_WITH', 'ENDS_WITH'));
  optional(c, 'nullOption', p, nullOption);
  optional(c, 'selectAllOptions', p, enumeration('FILTER_ALL_VALUES'));
  optional(c, 'categoryValues', p, array(string));
  optional(c, 'categoryValue', p, string);
  optional(c, 'parameterName', p, nonempty);
  const selectors = ['categoryValues', 'categoryValue', 'parameterName', 'selectAllOptions'].filter(key => Object.hasOwn(c, key));
  if (selectors.length > 1) fail(p, 'category selectors are mutually exclusive');
  if (selectors.length === 0 && c.nullOption !== 'NULLS_ONLY') fail(p, 'expected a category selector');
};
export const bundleFilter: Validator = (value, path) => {
  const [kind, body] = singleVariant(value, path);
  if (!filterKinds.has(kind)) {
    if (!kind.endsWith('Filter') || /^[A-Z]/u.test(kind)) fail(path, 'expected a camelCase filter');
    return;
  }
  const p = `${path}.${kind}`;
  required(body, 'filterId', p, nonempty);
  required(body, 'column', p, bundleColumn);
  if (kind === 'categoryFilter') {
    required(body, 'configuration', p, categoryConfiguration);
    return;
  }
  required(body, 'nullOption', p, nullOption);
  optional(body, 'timeGranularity', p, granularity);
  optional(body, 'aggregationFunction', p, (value, p) => {
    optional(object(value, p), 'simpleNumericalAggregation', p, nonempty);
  });
  if (kind === 'relativeDatesFilter') {
    required(body, 'timeGranularity', p, granularity);
    required(body, 'relativeDateType', p, enumeration('PREVIOUS', 'THIS', 'LAST', 'NOW', 'NEXT'));
    optional(body, 'relativeDateValue', p, (value, p) => {
      integer(value, p);
      if ((value as number) <= 0) fail(p, 'expected a positive relative date count');
    });
    optional(body, 'parameterName', p, nonempty);
    if (Object.hasOwn(body, 'relativeDateValue') && Object.hasOwn(body, 'parameterName')) fail(p, 'relativeDateValue and parameterName are mutually exclusive');
    if (['LAST', 'NEXT'].includes(body.relativeDateType as string) && !Object.hasOwn(body, 'relativeDateValue') && !Object.hasOwn(body, 'parameterName')) fail(p, 'expected a relative date count or parameter');
    required(body, 'anchorDateConfiguration', p, (value, p) => {
      const anchor = object(value, p);
      required(anchor, 'anchorOption', p, enumeration('NOW', 'PARAMETER'));
      optional(anchor, 'parameterName', p, nonempty);
      if (anchor.anchorOption === 'PARAMETER') required(anchor, 'parameterName', p, nonempty);
      else if (Object.hasOwn(anchor, 'parameterName')) fail(p, 'NOW anchor cannot name a parameter');
    });
    optional(body, 'excludePeriodConfiguration', p, (value, p) => {
      const exclude = object(value, p);
      required(exclude, 'amount', p, integer);
      if ((exclude.amount as number) < 0) fail(`${p}.amount`, 'expected a nonnegative amount');
      required(exclude, 'granularity', p, granularity);
      required(exclude, 'status', p, enumeration('ENABLED', 'DISABLED'));
    });
    return;
  }
  const numeric = kind === 'numericRangeFilter';
  const minimum = numeric ? 'rangeMinimum' : 'rangeMinimumValue';
  const maximum = numeric ? 'rangeMaximum' : 'rangeMaximumValue';
  optional(body, minimum, p, range(numeric ? finiteNumber : nonempty));
  optional(body, maximum, p, range(numeric ? finiteNumber : nonempty));
  optional(body, 'includeMinimum', p, boolean);
  optional(body, 'includeMaximum', p, boolean);
  if (!Object.hasOwn(body, minimum) && !Object.hasOwn(body, maximum) && body.nullOption !== 'NULLS_ONLY') fail(p, 'expected a range bound');
  if (numeric && body[minimum] && body[maximum]) {
    const low = (body[minimum] as ObjectValue).staticValue;
    const high = (body[maximum] as ObjectValue).staticValue;
    if (typeof low === 'number' && typeof high === 'number' && low > high) fail(p, 'range minimum exceeds maximum');
  }
};

export const bundleFilterGroup: Validator = (value, path) => {
  const group = object(value, path);
  required(group, 'filterGroupId', path, nonempty);
  required(group, 'crossDataset', path, enumeration('ALL_DATASETS', 'SINGLE_DATASET'));
  optional(group, 'status', path, enumeration('ENABLED', 'DISABLED'));
  required(group, 'filters', path, array(bundleFilter));
  if ((group.filters as unknown[]).length === 0) fail(`${path}.filters`, 'expected at least one filter');
  required(group, 'scopeConfiguration', path, (value, p) => {
    const [kind, scope] = singleVariant(value, p);
    if (kind === 'allSheets') return;
    if (kind !== 'selectedSheets') fail(p, 'unsupported filter scope');
    required(scope, 'sheetVisualScopingConfigurations', `${p}.${kind}`, array((value, p) => {
      const s = object(value, p);
      required(s, 'sheetId', p, nonempty);
      required(s, 'scope', p, enumeration('ALL_VISUALS', 'SELECTED_VISUALS'));
      optional(s, 'visualIds', p, array(nonempty));
      if (s.scope === 'SELECTED_VISUALS' && (!Array.isArray(s.visualIds) || s.visualIds.length === 0)) fail(`${p}.visualIds`, 'expected selected visual IDs');
    }));
    if ((scope.sheetVisualScopingConfigurations as unknown[]).length === 0) fail(`${p}.${kind}.sheetVisualScopingConfigurations`, 'expected at least one sheet');
  });
};
export const bundleCalculation: Validator = (value, path) => {
  const c = object(value, path);
  for (const key of ['dataSetIdentifier', 'name', 'expression']) required(c, key, path, nonempty);
};

export interface BundleParameterSummary {
  kind: string;
  supported: boolean;
  name?: string;
  /** Complete body retained, including defaults and future configuration. */
  configuration: ObjectValue;
}
export interface BundleFilterSummary {
  kind: string;
  supported: boolean;
  filterId?: string;
  column?: { dataSetIdentifier: string; columnName: string };
  configuration: ObjectValue;
}
export interface BundleFilterGroupSummary {
  filterGroupId: string;
  crossDataset: string;
  status?: string;
  scopeConfiguration: ObjectValue;
  filters: BundleFilterSummary[];
}
export interface BundleCalculatedFieldSummary {
  dataSet: string;
  name: string;
  expression: string;
  /** Direct lexical references only; no evaluation or transitive expansion. */
  dependencies: { columns: string[]; calculatedFields: string[]; parameters: string[] };
}

export function summarizeParameter(value: unknown): BundleParameterSummary {
  const [kind, body] = singleVariant(value, '$');
  return { kind, supported: parameterKinds.has(kind),
    ...(parameterKinds.has(kind) ? { name: body.name as string } : {}), configuration: body };
}
export function summarizeFilterGroup(value: unknown): BundleFilterGroupSummary {
  const group = object(value, '$');
  return { filterGroupId: group.filterGroupId as string, crossDataset: group.crossDataset as string,
    ...(group.status === undefined ? {} : { status: group.status as string }),
    scopeConfiguration: group.scopeConfiguration as ObjectValue,
    filters: (group.filters as unknown[]).map(value => {
      const [kind, body] = singleVariant(value, '$');
      return { kind, supported: filterKinds.has(kind), configuration: body,
        ...(filterKinds.has(kind) ? { filterId: body.filterId as string, column: body.column as BundleFilterSummary['column'] } : {}),
      };
    }),
  };
}

/** Skip quoted literals (including doubled/backslash escapes) and comments.
 * Braced fields and ${parameters} are listed once, in first-use order.
 */
function calculationDependencies(expression: string, calculationNames: ReadonlySet<string>): BundleCalculatedFieldSummary['dependencies'] {
  const columns = new Set<string>();
  const calculatedFields = new Set<string>();
  const parameters = new Set<string>();
  const tokens = /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|\$\{([^{}]+)\}|\{([^{}]+)\}/gu;
  for (const match of expression.matchAll(tokens)) {
    if (match[1] !== undefined) parameters.add(match[1]);
    if (match[2] !== undefined) (calculationNames.has(match[2]) ? calculatedFields : columns).add(match[2]);
  }
  return { columns: [...columns], calculatedFields: [...calculatedFields], parameters: [...parameters] };
}
export function summarizeCalculations(values: unknown[]): BundleCalculatedFieldSummary[] {
  const fields = values.map(value => object(value, '$'));
  return fields.map(c => ({ dataSet: c.dataSetIdentifier as string, name: c.name as string, expression: c.expression as string,
    dependencies: calculationDependencies(c.expression as string, new Set(fields.filter(other => other.dataSetIdentifier === c.dataSetIdentifier).map(other => other.name as string))),
  }));
}
