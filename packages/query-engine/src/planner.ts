import { definitionParameters, validateDefinitionControls } from './definition-parameters.js';
import { rowFilterSql } from './row-filter.js';
import { mysqlBindings, mysqlTimestamp, mysqlDateCast } from './mysql-sql.js';
import { resolveSecurity, rowSecuritySql } from './security.js';
import { expressionChildren } from './evaluate.js';
import { functionReference, functionError } from './catalog.js';
import { validateParameters, type ParameterValue } from './parameters.js';
import { ExpressionBinder, expressionSql } from './expressions.js';
import { bindMetadata } from './metadata.js';
import { matchingAggregate, validateAggregates } from './live-performance.js';
import type { Aggregation, Dimension, Measure, PlanOptions, PlanRequest, QueryPlan, RowFilter, RowExpression } from './types.js';
import { array, emptyArray, equals, fail, keys, object, quoteIdentifier, string, unique, variant } from './validation.js';
import type { ObjectValue } from './validation.js';

interface Visual { id: string; sheetId: string; kind: string; body: ObjectValue; path: string }

function visuals(raw: unknown): Visual[] {
  const sheets = array(raw, '$.analysis.Definition.Sheets');
  const sheetIds = new Set<string>();
  const visualIds = new Set<string>();
  const result: Visual[] = [];
  for (const [index, value] of sheets.entries()) {
    const path = `$.analysis.Definition.Sheets[${index}]`;
    const sheet = object(value, path);
    keys(sheet, ['SheetId', 'Name', 'ContentType', 'Visuals', 'Layouts', 'FilterControls', 'ParameterControls', 'OpenSightLayoutSettings'], path);
    const sheetId = string(sheet.SheetId, `${path}.SheetId`);
    unique(sheetIds, sheetId, `${path}.SheetId`);
    if (sheet.ContentType !== undefined) equals(sheet.ContentType, 'INTERACTIVE', `${path}.ContentType`);
    array(sheet.FilterControls ?? [], `${path}.FilterControls`);
    array(sheet.ParameterControls ?? [], `${path}.ParameterControls`);
    for (const [vi, value] of array(sheet.Visuals === undefined ? [] : sheet.Visuals, `${path}.Visuals`).entries()) {
      const vp = `${path}.Visuals[${vi}]`;
      const [kind, body] = variant(value, vp);
      const id = string(body.VisualId, `${vp}.${kind}.VisualId`);
      unique(visualIds, id, `${vp}.${kind}.VisualId`);
      result.push({ id, sheetId, kind, body, path: `${vp}.${kind}` });
    }
  }
  return result;
}

/** Resolve every scope fully, even if it ultimately excludes the requested visual. */
function applies(raw: unknown, path: string, target: Visual, all: Visual[], sheetIds: Set<string>): boolean {
  const [kind, body] = variant(raw, path);
  if (kind === 'AllSheets') {
    keys(body, [], `${path}.AllSheets`);
    return true;
  }
  if (kind !== 'SelectedSheets') fail('UNSUPPORTED_FEATURE', path, 'unresolved filter scope blocks the asset');
  const p = `${path}.SelectedSheets`;
  keys(body, ['SheetVisualScopingConfigurations'], p);
  const scopes = array(body.SheetVisualScopingConfigurations, `${p}.SheetVisualScopingConfigurations`);
  if (!scopes.length) fail('INVALID_INPUT', p, 'filter scope cannot be empty');
  let included = false;
  const seen = new Set<string>();
  for (const [index, value] of scopes.entries()) {
    const sp = `${p}.SheetVisualScopingConfigurations[${index}]`;
    const scope = object(value, sp);
    keys(scope, ['SheetId', 'Scope', 'VisualIds'], sp);
    const sheet = string(scope.SheetId, `${sp}.SheetId`);
    unique(seen, sheet, `${sp}.SheetId`);
    if (!sheetIds.has(sheet)) fail('UNRESOLVED_BINDING', `${sp}.SheetId`, 'unknown sheet in filter scope');
    if (scope.Scope === 'ALL_VISUALS') {
      if (scope.VisualIds !== undefined) fail('INVALID_INPUT', `${sp}.VisualIds`, 'unexpected explicit visual list');
      included ||= sheet === target.sheetId;
    } else if (scope.Scope === 'SELECTED_VISUALS') {
      const ids = array(scope.VisualIds, `${sp}.VisualIds`);
      if (!ids.length) fail('INVALID_INPUT', `${sp}.VisualIds`, 'visual scope cannot be empty');
      const seenIds = new Set<string>();
      for (const [i, rawId] of ids.entries()) {
        const id = string(rawId, `${sp}.VisualIds[${i}]`);
        unique(seenIds, id, `${sp}.VisualIds[${i}]`);
        if (!all.some((v) => v.id === id && v.sheetId === sheet)) {
          fail('UNRESOLVED_BINDING', `${sp}.VisualIds[${i}]`, 'visual does not resolve in this sheet');
        }
        included ||= id === target.id;
      }
    } else fail('UNSUPPORTED_FEATURE', `${sp}.Scope`, 'unknown visual scope');
  }
  return included;
}

function column(raw: unknown, path: string, binder: ExpressionBinder): string {
  const c = object(raw, path);
  keys(c, ['DataSetIdentifier', 'ColumnName'], path);
  if (c.DataSetIdentifier !== binder.dataSetIdentifier) fail('UNRESOLVED_BINDING', `${path}.DataSetIdentifier`, 'cross-dataset bindings are unsupported');
  const name = string(c.ColumnName, `${path}.ColumnName`);
  binder.bind(name, `${path}.ColumnName`);
  return name;
}

function parameterPredicate(columnName: string, rawName: unknown, operator: unknown, path: string, binder: ExpressionBinder, parameters: ReturnType<typeof validateParameters>): RowFilter {
  const name = string(rawName, `${path}.ParameterName`), p = parameters.declarations.find(p => p.name === name);
  if (!p) fail('UNRESOLVED_BINDING', path, `undeclared parameter ${name}`);
  const type = binder.bind(columnName, path).scalarType;
  if (type !== p.type) fail('TYPE_MISMATCH', path, `parameter ${name} (${p.type}) does not match ${columnName} (${type})`);
  if (!['EQUALS', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'].includes(String(operator)) || operator !== 'EQUALS' && (p.multiple || type === 'string')) fail('TYPE_MISMATCH', path, 'range comparisons require a single number or datetime parameter');
  const values = parameters.bindings[name]!;
  return { columnName, path, scalarType: type, operator: operator as 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO', ...(values.length === 1 ? { value: values[0]! } : { values }) };
}

function filters(raw: unknown, target: Visual, all: Visual[], sheetIds: Set<string>, binder: ExpressionBinder, parameters: ReturnType<typeof validateParameters>): RowFilter[] {
  const result: RowFilter[] = [];
  const ids = new Set<string>();
  for (const [i, value] of array(raw === undefined ? [] : raw, '$.analysis.Definition.FilterGroups').entries()) {
    const p = `$.analysis.Definition.FilterGroups[${i}]`;
    const group = object(value, p);
    keys(group, ['FilterGroupId', 'Status', 'CrossDataset', 'ScopeConfiguration', 'Filters'], p);
    unique(ids, string(group.FilterGroupId, `${p}.FilterGroupId`), `${p}.FilterGroupId`);
    const active = applies(group.ScopeConfiguration, `${p}.ScopeConfiguration`, target, all, sheetIds);
    if (group.Status !== 'ENABLED' && group.Status !== 'DISABLED') fail('UNSUPPORTED_FEATURE', `${p}.Status`, 'filter status must be explicit');
    if (!active || group.Status === 'DISABLED') continue;
    equals(group.CrossDataset, 'SINGLE_DATASET', `${p}.CrossDataset`);
    const entries = array(group.Filters, `${p}.Filters`);
    if (entries.length !== 1) fail('UNSUPPORTED_FEATURE', `${p}.Filters`, 'exactly one filter per group is supported');
    const fp = `${p}.Filters[0]`;
    const [kind, f] = variant(entries[0], fp);
    if (kind === 'NumericEqualityFilter') {
      keys(f, ['FilterId', 'Column', 'MatchOperator', 'NullOption', 'ParameterName'], fp);
      string(f.FilterId, `${fp}.FilterId`); equals(f.MatchOperator, 'EQUALS', `${fp}.MatchOperator`); equals(f.NullOption, 'NON_NULLS_ONLY', `${fp}.NullOption`);
      const name = column(f.Column, `${fp}.Column`, binder);
      if (binder.bind(name, fp).scalarType !== 'number') fail('TYPE_MISMATCH', fp, 'Numeric filter requires a number column');
      result.push(parameterPredicate(name, f.ParameterName, 'EQUALS', fp, binder, parameters)); continue;
    }
    if (kind === 'NumericRangeFilter' || kind === 'TimeRangeFilter') {
      const date = kind === 'TimeRangeFilter', minKey = date ? 'RangeMinimumValue' : 'RangeMinimum', maxKey = date ? 'RangeMaximumValue' : 'RangeMaximum';
      keys(f, ['FilterId', 'Column', 'NullOption', minKey, maxKey, 'IncludeMinimum', 'IncludeMaximum', ...(date ? ['TimeGranularity'] : [])], fp);
      string(f.FilterId, `${fp}.FilterId`); equals(f.NullOption, 'NON_NULLS_ONLY', `${fp}.NullOption`);
      if (date && f.TimeGranularity !== undefined && !['SECOND', 'MILLISECOND'].includes(String(f.TimeGranularity))) fail('UNSUPPORTED_FEATURE', fp, 'Only exact datetime ranges are supported');
      const name = column(f.Column, `${fp}.Column`, binder);
      if (binder.bind(name, fp).scalarType !== (date ? 'datetime' : 'number')) fail('TYPE_MISMATCH', fp, 'Range filter column type does not match its variant');
      if (f[minKey] === undefined && f[maxKey] === undefined) fail('INVALID_INPUT', fp, 'A range bound is required');
      for (const [key, include, operator] of [[minKey, 'IncludeMinimum', 'GREATER_THAN_OR_EQUAL_TO'], [maxKey, 'IncludeMaximum', 'LESS_THAN_OR_EQUAL_TO']] as const) if (f[key] !== undefined) {
        const bound = object(f[key], `${fp}.${key}`); keys(bound, ['Parameter'], `${fp}.${key}`);
        if (f[include] !== true) fail('UNSUPPORTED_FEATURE', fp, 'Only inclusive parameter ranges are supported');
        result.push(parameterPredicate(name, bound.Parameter, operator, fp, binder, parameters));
      }
      continue;
    }
    equals(kind, 'CategoryFilter', fp);
    keys(f, ['FilterId', 'Column', 'Configuration'], `${fp}.${kind}`);
    string(f.FilterId, `${fp}.${kind}.FilterId`);
    const name = column(f.Column, `${fp}.${kind}.Column`, binder);
    if (binder.bind(name, fp).scalarType !== 'string') fail('TYPE_MISMATCH', fp, 'category equality requires a string column');
    const cp = `${fp}.${kind}.Configuration`;
    const [configKind, config] = variant(f.Configuration, cp);
    if (['CustomFilterConfiguration', 'CustomFilterListConfiguration', 'FilterListConfiguration'].includes(configKind) && config.ParameterName !== undefined) {
      if (config.CategoryValues !== undefined) fail('UNSUPPORTED_FEATURE', `${cp}.${configKind}.ParameterName`, 'Static values and a parameter binding cannot be combined');
      keys(config, ['MatchOperator', 'ParameterName', 'NullOption'], cp);
      equals(config.MatchOperator, 'EQUALS', `${cp}.MatchOperator`); equals(config.NullOption, 'NON_NULLS_ONLY', `${cp}.NullOption`);
      result.push(parameterPredicate(name, config.ParameterName, 'EQUALS', cp, binder, parameters)); continue;
    }
    equals(configKind, 'FilterListConfiguration', cp);
    const lp = `${cp}.${configKind}`;
    keys(config, ['MatchOperator', 'CategoryValues', 'NullOption'], lp);
    equals(config.MatchOperator, 'EQUALS', `${lp}.MatchOperator`);
    equals(config.NullOption, 'NON_NULLS_ONLY', `${lp}.NullOption`);
    const values = array(config.CategoryValues, `${lp}.CategoryValues`);
    if (!values.every((v): v is string => typeof v === 'string' && !v.includes('\0'))) {
      fail('UNSUPPORTED_FEATURE', `${lp}.CategoryValues`, 'category values must be strings without NUL');
    }
    result.push({ columnName: name, ...(values.length === 1 ? { value: values[0]! } : { values }), path: fp });
  }
  return result;
}

const wellKinds: Record<string, string> = {
  BarChartVisual: 'BarChartAggregatedFieldWells', LineChartVisual: 'LineChartAggregatedFieldWells',
  TableVisual: 'TableAggregatedFieldWells', PieChartVisual: 'PieChartAggregatedFieldWells', KPIVisual: '',
};
function fieldWells(visual: Visual, binder: ExpressionBinder): { dimensions: Dimension[]; measures: Measure[] } {
  const { path, body, kind } = visual;
  if (!Object.hasOwn(wellKinds, kind)) fail('UNSUPPORTED_FEATURE', path, 'unsupported visual kind');
  keys(body, ['VisualId', 'Title', 'Subtitle', 'ChartConfiguration', 'Actions', 'OpenSightPalette', 'OpenSightFormatting', 'OpenSightReferenceLines'], path);
  emptyArray(body.Actions, `${path}.Actions`);
  const cp = `${path}.ChartConfiguration`;
  const config = object(body.ChartConfiguration, cp);
  // These properties affect rendering only; query-affecting properties still fail closed.
  keys(config, ['FieldWells', 'Legend', 'DataLabels', 'Tooltip', 'Orientation', 'BarsArrangement', 'DonutOptions', 'TotalOptions', 'OpenSightSubtotalOptions'], cp);
  let wp = `${cp}.FieldWells`;
  let wells = object(config.FieldWells, wp);
  const expectedKind = wellKinds[kind];
  if (expectedKind) {
    const [wellKind, wellBody] = variant(wells, wp);
    equals(wellKind, expectedKind, wp);
    wells = wellBody;
    wp += `.${wellKind}`;
  }
  const dimKey = kind === 'TableVisual' ? 'GroupBy' : 'Category';
  keys(wells, kind === 'KPIVisual' ? ['Values'] : [dimKey, 'Values'], wp);
  const ids = new Set<string>();
  const outputs = new Set<string>();
  // Field IDs are stable output names; one month dimension keeps the fixture's 'month' alias.
  const outputName = (fieldId: string, grain: string | undefined, path: string) => {
    unique(ids, fieldId, `${path}.FieldId`);
    const alias = grain ? grain.toLowerCase() : fieldId;
    unique(outputs, alias, path);
    return alias;
  };
  const dimensions: Dimension[] = array(wells[dimKey] === undefined ? [] : wells[dimKey], `${wp}.${dimKey}`).map((value, i) => {
    const p = `${wp}.${dimKey}[${i}]`;
    const [kind, f] = variant(value, p);
    const fp = `${p}.${kind}`;
    if (kind !== 'CategoricalDimensionField' && kind !== 'DateDimensionField') fail('UNSUPPORTED_FEATURE', fp, 'unsupported dimension kind');
    keys(f, kind === 'DateDimensionField' ? ['FieldId', 'Column', 'DateGranularity'] : ['FieldId', 'Column'], fp);
    const fieldId = string(f.FieldId, `${fp}.FieldId`);
    const name = column(f.Column, `${fp}.Column`, binder);
    const binding = binder.bind(name, fp), type = binding.scalarType;
    if (binding.level === 'aggregate' || binding.level === 'table') fail('TYPE_MISMATCH', fp, 'an aggregate calculation cannot be a grouping dimension');
    const month = kind === 'DateDimensionField';
    const grain = month ? string(f.DateGranularity, `${fp}.DateGranularity`) : undefined;
    if (grain && !['YEAR', 'QUARTER', 'MONTH', 'DAY'].includes(grain)) fail('UNSUPPORTED_FEATURE', `${fp}.DateGranularity`, 'unsupported date granularity');
    if (type !== (month ? 'datetime' : 'string')) fail('TYPE_MISMATCH', fp, 'dimension type does not match column type');
    return { fieldId, outputName: outputName(fieldId, grain, fp), columnName: name,
      ...(month ? { granularity: grain as NonNullable<Dimension['granularity']> } : {}), scalarType: type, path: fp };
  });
  const measures: Measure[] = array(wells.Values, `${wp}.Values`).map((value, i) => {
    const p = `${wp}.Values[${i}]`;
    const [kind, f] = variant(value, p);
    equals(kind, 'NumericalMeasureField', p);
    const fp = `${p}.${kind}`;
    keys(f, ['FieldId', 'Column', 'AggregationFunction'], fp);
    const fieldId = string(f.FieldId, `${fp}.FieldId`);
    const name = column(f.Column, `${fp}.Column`, binder);
    if (binder.bind(name, fp).scalarType !== 'number') fail('TYPE_MISMATCH', fp, 'numerical measure requires a numeric column');
    const aggregationObject = object(f.AggregationFunction, `${fp}.AggregationFunction`);
    keys(aggregationObject, ['SimpleNumericalAggregation'], `${fp}.AggregationFunction`);
    const aggregationValue = aggregationObject.SimpleNumericalAggregation;
    if (typeof aggregationValue !== 'string' ||
        !['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(aggregationValue)) {
      fail('UNSUPPORTED_FEATURE', `${fp}.AggregationFunction`, 'expected explicit SUM, AVG, COUNT, MIN or MAX');
    }
    return { fieldId, outputName: outputName(fieldId, undefined, fp), columnName: name,
      aggregation: aggregationValue as Aggregation, path: fp };
  });
  if (!measures.length) fail('INVALID_INPUT', `${wp}.Values`, 'at least one explicit measure is required');
  return { dimensions, measures };
}

function sql(plan: Omit<QueryPlan, 'sql' | 'parameters'>, parameters: ParameterValue[], countColumn?: string): string {
  const q = (value: string) => quoteIdentifier(value, plan.dialect);
  const bind = (value: ParameterValue): string => { parameters.push(value); return `$${parameters.length}`; };
  const ctes: string[] = [];
  // Choose internal relation names distinct from the physical name to avoid CTE shadowing.
  let prefix = '__opensight_';
  while (plan.tableName.toLowerCase().startsWith(prefix)) prefix += '_';
  let from = plan.tableSchema === undefined ? q(plan.tableName) : `${q(plan.tableSchema)}.${q(plan.tableName)}`;
  if (plan.rowSecurity) {
    const relation = q(`${prefix}security`);
    ctes.push(`${relation} AS (SELECT * FROM ${from} WHERE ${rowSecuritySql(plan.rowSecurity, plan.sourceColumns, bind, plan.dialect)})`);
    from = relation;
  }
  for (const [i, calculation] of plan.calculations.entries()) {
    if (calculation.expression.level !== 'row') continue;
    const relation = q(`${prefix}row_${i}`);
    ctes.push(`${relation} AS (SELECT *, ${expressionSql(calculation.expression, plan.dialect, bind)} AS ${q(calculation.name)} FROM ${from})`);
    from = relation;
  }
  if (plan.postProcess) {
    const columns = [...plan.sourceColumns.filter(c => !plan.deniedColumns?.includes(c.name)).map(c => ({ name: c.name, type: c.scalarType })), ...plan.calculations.filter(c => c.expression.level === 'row').map(c => ({ name: c.name, type: c.expression.scalarType }))];
    const projections = columns.map(c => `${c.type === 'datetime' ? plan.dialect === 'mysql' ? mysqlTimestamp(q(c.name)) : plan.dialect === 'postgres' ? `TO_CHAR(${q(c.name)}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` : `STRFTIME(${q(c.name)}, '%Y-%m-%dT%H:%M:%S.%gZ')` : q(c.name)} AS ${q(c.name)}`);
    return `${ctes.length ? `WITH ${ctes.join(',\n')}\n` : ''}SELECT ${projections.join(', ')} FROM ${from}`;
  }
  if (plan.filters.length) {
    const relation = q(`${prefix}filtered`);
    const predicates = plan.filters.map(f => rowFilterSql(f, plan.dialect, bind));
    ctes.push(`${relation} AS (SELECT * FROM ${from} WHERE ${predicates.join(' AND ')})`);
    from = relation;
  }
  const dimensions = plan.dimensions.map(d => {
    if (!d.granularity) return plan.dialect === 'mysql' && d.scalarType === 'string' ? `${q(d.columnName)} COLLATE utf8mb4_0900_bin` : q(d.columnName);
    if (plan.dialect === 'mysql') return d.granularity === 'QUARTER' ? `CONCAT(YEAR(${q(d.columnName)}), '-Q', QUARTER(${q(d.columnName)}))` : `DATE_FORMAT(${q(d.columnName)}, '${d.granularity === 'YEAR' ? '%Y' : d.granularity === 'DAY' ? '%Y-%m-%d' : '%Y-%m'}')`;
    const grain = d.granularity.toLowerCase(), value = `date_trunc('${grain}', ${q(d.columnName)})`;
    if (d.granularity === 'QUARTER') return plan.dialect === 'postgres'
      ? `to_char(${value}, 'YYYY-"Q"Q')`
      : `strftime(${value}, '%Y') || '-Q' || CAST(quarter(${value}) AS VARCHAR)`;
    const format = d.granularity === 'YEAR' ? ['YYYY', '%Y'] : d.granularity === 'DAY' ? ['YYYY-MM-DD', '%Y-%m-%d'] : ['YYYY-MM', '%Y-%m'];
    return plan.dialect === 'postgres' ? `to_char(${value}, '${format[0]}')` : `strftime(${value}, '${format[1]}')`;
  });
  const expand = (e: RowExpression): RowExpression => {
    if (e.kind === 'column') { const c = plan.calculations.find(c => c.name === e.columnName && c.expression.level !== 'row'); if (c) return expand(c.expression); }
    if (e.kind === 'binary') return { ...e, left: expand(e.left), right: expand(e.right) };
    if (e.kind === 'unary') return { ...e, operand: expand(e.operand) };
    if (e.kind === 'call') return { ...e, args: e.args.map(expand) };
    return e;
  };
  const projections = [
    ...dimensions.map((expression, i) => `${expression} AS ${q(plan.dimensions[i]!.outputName)}`),
    ...plan.measures.map(m => { const c = plan.calculations.find(c => c.name === m.columnName && c.expression.level === 'aggregate');
      return `${c ? expressionSql(expand(c.expression), plan.dialect, bind) : m.aggregation === 'COUNT' && countColumn !== undefined ? `COALESCE(SUM(${q(countColumn)}), 0)` : `${m.aggregation}(${q(m.columnName)})`} AS ${q(m.outputName)}`; }),
  ];
  const positions = dimensions.map((_, i) => i + 1).join(', ');
  return `${ctes.length ? `WITH ${ctes.join(',\n')}\n` : ''}SELECT ${projections.join(', ')}\nFROM ${from}` +
    (dimensions.length ? `\nGROUP BY ${positions}\nORDER BY ${dimensions.map((_, i) => `${i + 1} ASC${plan.dialect === 'mysql' ? '' : ' NULLS FIRST'}`).join(', ')}` : '');
}

/** Plan a synthetic local visual. Unknown execution semantics fail closed. */
export function planVisual(request: PlanRequest, options: PlanOptions = {}): QueryPlan {
  const opts = object(options, '$.options');
  keys(opts, ['dialect', 'aggregates'], '$.options');
  const dialect = opts.dialect === undefined ? 'duckdb' : opts.dialect;
  if (dialect !== 'duckdb' && dialect !== 'postgres' && dialect !== 'mysql') fail('UNSUPPORTED_FEATURE', '$.options.dialect', 'expected duckdb, postgres or mysql');
  const r = object(request, '$');
  keys(r, ['analysis', 'dataSet', 'dataSource', 'localData', 'visualId', 'parameterDeclarations', 'parameterBindings', 'parameterFilters', 'security'], '$');
  const metadata = bindMetadata(r.dataSet, r.dataSource, r.localData, r.security !== undefined);
  const aggregates = opts.aggregates === undefined ? [] : validateAggregates(opts.aggregates, metadata.columns);
  const security = r.security === undefined ? undefined : resolveSecurity(r.security, metadata.columns, metadata.localData.dataSetArn);
  if (metadata.localData.security.dataset === 'protected' && !security?.protected) fail('SECURITY_REJECTED', '$.security', 'protected dataset requires an active policy');
  const rowSecurity = security?.rowPredicate;
  const analysis = object(r.analysis, '$.analysis');
  keys(analysis, ['ResourceType', 'AnalysisId', 'Name', 'Definition'], '$.analysis');
  equals(analysis.ResourceType, 'Analysis', '$.analysis.ResourceType');
  string(analysis.AnalysisId, '$.analysis.AnalysisId');
  string(analysis.Name, '$.analysis.Name');
  const dp = '$.analysis.Definition';
  const definition = object(analysis.Definition, dp);
  keys(definition, ['DataSetIdentifierDeclarations', 'CalculatedFields', 'FilterGroups', 'Sheets', 'ParameterDeclarations', 'OpenSightTheme', 'OpenSightDescription'], dp);
  const declaredParameters = definitionParameters(definition.ParameterDeclarations);
  const declarations = array(definition.DataSetIdentifierDeclarations, `${dp}.DataSetIdentifierDeclarations`);
  if (declarations.length !== 1) fail('UNSUPPORTED_FEATURE', `${dp}.DataSetIdentifierDeclarations`, 'exactly one dataset is supported');
  const declaration = object(declarations[0], `${dp}.DataSetIdentifierDeclarations[0]`);
  keys(declaration, ['Identifier', 'DataSetArn'], `${dp}.DataSetIdentifierDeclarations[0]`);
  if (declaration.DataSetArn !== metadata.localData.dataSetArn) {
    fail('UNRESOLVED_BINDING', `${dp}.DataSetIdentifierDeclarations[0].DataSetArn`, 'dataset metadata does not resolve');
  }
  const identifier = string(declaration.Identifier, `${dp}.DataSetIdentifierDeclarations[0].Identifier`);
  validateDefinitionControls(definition.Sheets, definition.FilterGroups, declaredParameters.declarations);
  const all = visuals(definition.Sheets);
  const visualId = string(r.visualId, '$.visualId');
  const visual = all.find((v) => v.id === visualId);
  if (!visual) fail('UNRESOLVED_BINDING', '$.visualId', `unknown visual: ${visualId}`);
  let parameters: ReturnType<typeof validateParameters>;
  try {
    const supplied = validateParameters(r.parameterDeclarations, r.parameterBindings);
    parameters = validateParameters([...supplied.declarations, ...declaredParameters.declarations], { ...declaredParameters.bindings, ...supplied.bindings });
  } catch (e) { fail('INVALID_INPUT', '$.parameterBindings', e instanceof Error ? e.message : String(e)); }
  const binder = new ExpressionBinder(identifier, metadata.columns, definition.CalculatedFields, parameters.declarations, parameters.bindings, (name, path) => {
    if (security?.deniedColumns.includes(name)) fail('COLUMN_ACCESS_DENIED', path, `access denied to column: ${name}`);
  });
  const fields = fieldWells(visual, binder);
  const sheetIds = new Set(array(definition.Sheets, `${dp}.Sheets`).map((s, i) => string(object(s, `${dp}.Sheets[${i}]`).SheetId, `${dp}.Sheets[${i}].SheetId`)));
  const predicates = filters(definition.FilterGroups, visual, all, sheetIds, binder, parameters);
  for (const [i, raw] of array(r.parameterFilters ?? [], '$.parameterFilters').entries()) {
    const path = `$.parameterFilters[${i}]`, f = object(raw, path);
    keys(f, ['columnName', 'parameterName', 'operator'], path);
    predicates.push(parameterPredicate(string(f.columnName, `${path}.columnName`), f.parameterName, f.operator ?? 'EQUALS', path, binder, parameters));
  }
  const nodes = (e: RowExpression): RowExpression[] => [e, ...expressionChildren(e).flatMap(nodes)];
  const allNodes = binder.calculations.flatMap(c => nodes(c.expression));
  const checkGroupField = (e: RowExpression, call: Extract<RowExpression, { kind: 'call' }>): void => {
    if (e.kind === 'column' && e.level === 'aggregate' || e.kind === 'call' && functionReference(e.name)?.stage) return;
    if (e.kind === 'column' && !fields.dimensions.some(d => d.columnName === e.columnName)) functionError(functionReference(call.name)!, call.location.path, `field ${e.columnName} must be a visual grouping dimension`);
    expressionChildren(e).forEach(a => checkGroupField(a, call));
  };
  for (const node of allNodes) if (node.kind === 'call' && node.level === 'table') {
    for (const arg of node.args) if (arg.kind === 'list') checkGroupField(arg, node);
    if (node.name.startsWith('periodOverPeriod')) checkGroupField(node.args[1]!, node);
  }
  let plan: Omit<QueryPlan, 'sql' | 'parameters'> = {
    executionSource: { kind: 'source' },
    ...(security?.protected ? { securityProtected: true, deniedColumns: security.deniedColumns } : {}),
    ...(rowSecurity ? { rowSecurity } : {}),
    dialect, mode: 'synthetic-local', visualId, dataSetIdentifier: identifier,
    tableName: metadata.tableName, sourceColumns: metadata.columns, localData: metadata.localData,
    ...(dialect !== 'duckdb' ? { tableSchema: metadata.tableSchema } : {}),
    calculations: binder.calculations, filters: predicates, ...fields,
    ...(allNodes.some(e => ['table', 'pre_filter', 'pre_agg'].includes(e.level)) || predicates.some(f => ['aggregate', 'table'].includes(binder.bind(f.columnName, f.path).level ?? 'row')) ? { postProcess: true } : {}),
    stages: ['source', 'row-calculations', 'row-filters', 'visual-aggregation', 'order'],
  };
  const aggregate = matchingAggregate(plan, aggregates);
  if (aggregate) {
    plan = { ...plan, tableName: aggregate.tableName, tableSchema: dialect === 'duckdb' ? undefined : aggregate.tableSchema,
      executionSource: { kind: 'aggregate', name: aggregate.name } };
  }
  const values: ParameterValue[] = [];
  const statement = sql(plan, values, aggregate?.countColumn);
  return { ...plan, ...(dialect === 'mysql' ? mysqlBindings(statement, values) : { sql: statement, parameters: values }) };
}
