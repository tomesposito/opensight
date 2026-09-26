import { ExpressionBinder, expressionSql } from './expressions.js';
import { bindMetadata } from './metadata.js';
import type { Aggregation, Dimension, Measure, PlanRequest, QueryPlan, RowFilter } from './types.js';
import { array, emptyArray, equals, fail, keys, object, quoteIdentifier as q, string, unique, variant } from './validation.js';
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
    keys(sheet, ['SheetId', 'Name', 'ContentType', 'Visuals', 'Layouts', 'FilterControls', 'ParameterControls'], path);
    const sheetId = string(sheet.SheetId, `${path}.SheetId`);
    unique(sheetIds, sheetId, `${path}.SheetId`);
    if (sheet.ContentType !== undefined) equals(sheet.ContentType, 'INTERACTIVE', `${path}.ContentType`);
    emptyArray(sheet.FilterControls, `${path}.FilterControls`);
    emptyArray(sheet.ParameterControls, `${path}.ParameterControls`);
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

function filters(raw: unknown, target: Visual, all: Visual[], sheetIds: Set<string>, binder: ExpressionBinder): RowFilter[] {
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
    equals(kind, 'CategoryFilter', fp);
    keys(f, ['FilterId', 'Column', 'Configuration'], `${fp}.${kind}`);
    string(f.FilterId, `${fp}.${kind}.FilterId`);
    const name = column(f.Column, `${fp}.${kind}.Column`, binder);
    if (binder.bind(name, fp).scalarType !== 'string') fail('TYPE_MISMATCH', fp, 'category equality requires a string column');
    const cp = `${fp}.${kind}.Configuration`;
    const [configKind, config] = variant(f.Configuration, cp);
    equals(configKind, 'FilterListConfiguration', cp);
    const lp = `${cp}.${configKind}`;
    keys(config, ['MatchOperator', 'CategoryValues', 'NullOption'], lp);
    equals(config.MatchOperator, 'EQUALS', `${lp}.MatchOperator`);
    equals(config.NullOption, 'NON_NULLS_ONLY', `${lp}.NullOption`);
    const values = array(config.CategoryValues, `${lp}.CategoryValues`);
    if (values.length !== 1 || typeof values[0] !== 'string' || values[0].includes('\0')) {
      fail('UNSUPPORTED_FEATURE', `${lp}.CategoryValues`, 'exactly one string equality value is supported');
    }
    result.push({ columnName: name, value: values[0], path: fp });
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
  keys(body, ['VisualId', 'Title', 'Subtitle', 'ChartConfiguration', 'Actions'], path);
  emptyArray(body.Actions, `${path}.Actions`);
  const cp = `${path}.ChartConfiguration`;
  const config = object(body.ChartConfiguration, cp);
  keys(config, ['FieldWells'], cp);
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
  const outputName = (fieldId: string, month: boolean, path: string) => {
    unique(ids, fieldId, `${path}.FieldId`);
    const alias = month ? 'month' : fieldId;
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
    const type = binder.bind(name, fp).scalarType;
    const month = kind === 'DateDimensionField';
    if (month) equals(f.DateGranularity, 'MONTH', `${fp}.DateGranularity`);
    if (type !== (month ? 'datetime' : 'string')) fail('TYPE_MISMATCH', fp, 'dimension type does not match column type');
    return { fieldId, outputName: outputName(fieldId, month, fp), columnName: name,
      ...(month ? { granularity: 'MONTH' as const } : {}), scalarType: type, path: fp };
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
    return { fieldId, outputName: outputName(fieldId, false, fp), columnName: name,
      aggregation: aggregationValue as Aggregation, path: fp };
  });
  if (!measures.length) fail('INVALID_INPUT', `${wp}.Values`, 'at least one explicit measure is required');
  return { dimensions, measures };
}

function sql(plan: Omit<QueryPlan, 'sql' | 'parameters'>): string {
  const ctes: string[] = [];
  // Choose internal relation names distinct from the physical name to avoid CTE shadowing.
  let prefix = '__opensight_';
  while (plan.tableName.toLowerCase().startsWith(prefix)) prefix += '_';
  let from = q(plan.tableName);
  for (const [i, calculation] of plan.calculations.entries()) {
    const relation = q(`${prefix}row_${i}`);
    ctes.push(`${relation} AS (SELECT *, ${expressionSql(calculation.expression)} AS ${q(calculation.name)} FROM ${from})`);
    from = relation;
  }
  if (plan.filters.length) {
    const relation = q(`${prefix}filtered`);
    ctes.push(`${relation} AS (SELECT * FROM ${from} WHERE ${plan.filters.map((f, i) => `${q(f.columnName)} = $${i + 1}`).join(' AND ')})`);
    from = relation;
  }
  const dimensions = plan.dimensions.map((d) => d.granularity === 'MONTH'
    ? `strftime(date_trunc('month', ${q(d.columnName)}), '%Y-%m')` : q(d.columnName));
  const projections = [
    ...dimensions.map((expression, i) => `${expression} AS ${q(plan.dimensions[i]!.outputName)}`),
    ...plan.measures.map((m) => `${m.aggregation}(${q(m.columnName)}) AS ${q(m.outputName)}`),
  ];
  const positions = dimensions.map((_, i) => i + 1).join(', ');
  return `${ctes.length ? `WITH ${ctes.join(',\n')}\n` : ''}SELECT ${projections.join(', ')}\nFROM ${from}` +
    (dimensions.length ? `\nGROUP BY ${positions}\nORDER BY ${dimensions.map((_, i) => `${i + 1} ASC NULLS FIRST`).join(', ')}` : '');
}

/** Plan a synthetic local visual. Unknown execution semantics fail closed. */
export function planVisual(request: PlanRequest): QueryPlan {
  const r = object(request, '$');
  keys(r, ['analysis', 'dataSet', 'dataSource', 'localData', 'visualId'], '$');
  const metadata = bindMetadata(r.dataSet, r.dataSource, r.localData);
  const analysis = object(r.analysis, '$.analysis');
  keys(analysis, ['ResourceType', 'AnalysisId', 'Name', 'Definition'], '$.analysis');
  equals(analysis.ResourceType, 'Analysis', '$.analysis.ResourceType');
  string(analysis.AnalysisId, '$.analysis.AnalysisId');
  string(analysis.Name, '$.analysis.Name');
  const dp = '$.analysis.Definition';
  const definition = object(analysis.Definition, dp);
  keys(definition, ['DataSetIdentifierDeclarations', 'CalculatedFields', 'FilterGroups', 'Sheets', 'ParameterDeclarations'], dp);
  emptyArray(definition.ParameterDeclarations, `${dp}.ParameterDeclarations`);
  const declarations = array(definition.DataSetIdentifierDeclarations, `${dp}.DataSetIdentifierDeclarations`);
  if (declarations.length !== 1) fail('UNSUPPORTED_FEATURE', `${dp}.DataSetIdentifierDeclarations`, 'exactly one dataset is supported');
  const declaration = object(declarations[0], `${dp}.DataSetIdentifierDeclarations[0]`);
  keys(declaration, ['Identifier', 'DataSetArn'], `${dp}.DataSetIdentifierDeclarations[0]`);
  if (declaration.DataSetArn !== metadata.localData.dataSetArn) {
    fail('UNRESOLVED_BINDING', `${dp}.DataSetIdentifierDeclarations[0].DataSetArn`, 'dataset metadata does not resolve');
  }
  const identifier = string(declaration.Identifier, `${dp}.DataSetIdentifierDeclarations[0].Identifier`);
  const all = visuals(definition.Sheets);
  const visualId = string(r.visualId, '$.visualId');
  const visual = all.find((v) => v.id === visualId);
  if (!visual) fail('UNRESOLVED_BINDING', '$.visualId', `unknown visual: ${visualId}`);
  const binder = new ExpressionBinder(identifier, metadata.columns, definition.CalculatedFields);
  const fields = fieldWells(visual, binder);
  const sheetIds = new Set(array(definition.Sheets, `${dp}.Sheets`).map((s, i) => string(object(s, `${dp}.Sheets[${i}]`).SheetId, `${dp}.Sheets[${i}].SheetId`)));
  const predicates = filters(definition.FilterGroups, visual, all, sheetIds, binder);
  const plan: Omit<QueryPlan, 'sql' | 'parameters'> = {
    dialect: 'duckdb', mode: 'synthetic-local', visualId, dataSetIdentifier: identifier,
    tableName: metadata.tableName, sourceColumns: metadata.columns, localData: metadata.localData,
    calculations: binder.calculations, filters: predicates, ...fields,
    stages: ['source', 'row-calculations', 'row-filters', 'visual-aggregation', 'order'],
  };
  return { ...plan, sql: sql(plan), parameters: predicates.map((f) => f.value) };
}
