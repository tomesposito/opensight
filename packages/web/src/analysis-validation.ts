/** Shared authoring admission: the UI parser, parameter library and visual compiler
 * remain the semantic authorities. Dataset schemas here are already authorized. */
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import type { BundleDefinition } from '@opensight/bundle-parser';
import { ExpressionBinder, parseExpression, planPreparedVisual, QueryEngineError, type BoundColumn } from '@opensight/query-engine/browser';
import { validateParameters } from '@opensight/query-engine/parameters';
import { normalizeVisual, CompileError } from './compiler.js';
import { importParameter, declaration } from './parameters.js';
import { projectDefinition } from './definition-converter.js';
export { convertDefinition, projectDefinition } from './definition-converter.js';

export interface AnalysisSchema { columns: readonly { name: string; type: string }[]; deniedColumns?: readonly string[] }
export interface AnalysisDiagnostic { errorCode: string; path: string; message: string }
type Obj = Record<string, unknown>;
export function analysisFail(code: ConstructorParameters<typeof QueryEngineError>[0], path: string, message: string): never {
  throw new QueryEngineError(code, path, message);
}
export function analysisObject(value: unknown, path: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) analysisFail('INVALID_INPUT', path, 'Expected an object');
  return value as Obj;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > 10000) analysisFail('INVALID_INPUT', path, 'Expected an array of at most 10000 items');
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) analysisFail('INVALID_INPUT', path, 'Expected a nonempty string');
  return value;
}
export function analysisId(value: unknown, path: string): string {
  const id = text(value, path);
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) analysisFail('INVALID_INPUT', path, 'Invalid resource identity');
  return id;
}
function unique(set: Set<string>, value: string, path: string): void {
  if (set.has(value)) analysisFail('INVALID_INPUT', path, 'Duplicate identity');
  set.add(value);
}
function walk(value: unknown, path: string, visit: (o: Obj, p: string) => void, depth = 0): void {
  if (depth > 100) analysisFail('INVALID_INPUT', path, 'Definition nesting exceeds 100');
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, visit, depth + 1));
  else if (value && typeof value === 'object') {
    const o = value as Obj; visit(o, path);
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, visit, depth + 1);
  }
}
/** Reject executable envelopes and assertions without inspecting string data. */
export function checkAnalysisInput(value: unknown, path = '$'): void {
  walk(value, path, (o, p) => {
    for (const k of Object.keys(o)) {
      if (/^(tenantId|namespaceId|userId|ownerId|datasetBindingOwnerId|principal|principals|security|grants|folderId|capabilities|credentials|role|roles)$/i.test(k)) analysisFail('SECURITY_REJECTED', `${p}.${k}`, 'Caller authority or placement assertions are forbidden');
      if (/^(sql|rawSql|customSql|sqlExpression|sqlOperator|query|queryString|statement)$/i.test(k)) analysisFail('UNSUPPORTED_FEATURE', `${p}.${k}`, 'SQL and query envelopes are forbidden');
    }
  });
}
export function visualIdentity(raw: unknown, path: string): string {
  const entries = Object.entries(analysisObject(raw, path));
  if (entries.length !== 1 || !/^[a-z][A-Za-z]*Visual$/.test(entries[0]![0])) analysisFail('INVALID_INPUT', path, 'Expected one camelCase visual variant');
  return analysisId(analysisObject(entries[0]![1], path).visualId, `${path}.${entries[0]![0]}.visualId`);
}

export function validateAnalysisDefinition(raw: unknown, schemas: ReadonlyMap<string, AnalysisSchema>): { definition: BundleDefinition; Errors: AnalysisDiagnostic[] } {
  checkAnalysisInput(raw, '$.definition');
  const d = analysisObject(raw, '$.definition'), root = '$.definition';
  for (const key of ['analysisDefaults', 'options', 'queryExecutionOptions']) if (d[key] !== undefined) analysisObject(d[key], `${root}.${key}`);
  let apiDefinition: Record<string, unknown>;
  try { apiDefinition = projectDefinition(d as unknown as BundleDefinition); }
  catch (error) { analysisFail('INVALID_INPUT', error instanceof Error ? /^(\$[^:]+):/.exec(error.message)?.[1] ?? root : root, String(error)); }
  const declarations = array(d.dataSetIdentifierDeclarations, `${root}.dataSetIdentifierDeclarations`), identifiers = new Set<string>();
  for (const [i, value] of declarations.entries()) {
    const p = `${root}.dataSetIdentifierDeclarations[${i}]`, dec = analysisObject(value, p);
    const id = text(dec.identifier, `${p}.identifier`); text(dec.dataSetArn, `${p}.dataSetArn`); unique(identifiers, id, `${p}.identifier`);
    if (!schemas.has(id)) analysisFail('UNRESOLVED_BINDING', `${p}.identifier`, 'Dataset binding is unresolved');
  }
  if (schemas.size !== identifiers.size) analysisFail('UNRESOLVED_BINDING', '$.datasetBindings', 'Bindings must exactly match declarations');
  const parameters = array(d.parameterDeclarations ?? [], `${root}.parameterDeclarations`).map((v, i) => {
    const p = `${root}.parameterDeclarations[${i}]`;
    if (Object.keys(analysisObject(v, p)).length !== 1) analysisFail('INVALID_INPUT', p, 'Expected one parameter variant');
    const imported = importParameter(v, `parameter-${i + 1}`, '');
    if (!imported) analysisFail('INVALID_INPUT', p, 'Invalid parameter declaration or defaults');
    return imported;
  });
  let bound: ReturnType<typeof validateParameters>;
  try { bound = validateParameters(parameters.map(declaration), Object.fromEntries(parameters.map(p => [p.name, p.defaultValues]))); }
  catch (error) { analysisFail('INVALID_INPUT', `${root}.parameterDeclarations`, String(error)); }
  const calculations = array(d.calculatedFields ?? [], `${root}.calculatedFields`);
  const binders = new Map<string, ExpressionBinder>();
  for (const [id, schema] of schemas) {
    const columns: BoundColumn[] = schema.columns.map(c => ({ name: c.name, type: (c.type === 'BOOLEAN' ? 'STRING' : c.type) as BoundColumn['type'], scalarType: c.type === 'STRING' ? 'string' : c.type === 'DATETIME' ? 'datetime' : c.type === 'BOOLEAN' ? 'boolean' : 'number', nullable: true }));
    const selected = calculations.map((v, i) => ({ c: analysisObject(v, `${root}.calculatedFields[${i}]`), i })).filter(({ c }) => c.dataSetIdentifier === id);
    try {
      const binder = new ExpressionBinder(id, columns, selected.map(({ c }) => ({ Name: c.name, DataSetIdentifier: c.dataSetIdentifier, Expression: c.expression })), bound.declarations, bound.bindings,
        (name, p) => { if (schema.deniedColumns?.includes(name)) analysisFail('COLUMN_ACCESS_DENIED', p, 'Column access denied'); });
      // Admission deliberately binds every field, even when no visual uses it.
      for (const { c, i } of selected) binder.bind(text(c.name, `${root}.calculatedFields[${i}].name`), `${root}.calculatedFields[${i}].expression`);
      binders.set(id, binder);
    } catch (error) {
      if (error instanceof QueryEngineError) {
        const path = error.path.replace(/\$\.analysis\.Definition\.CalculatedFields\[(\d+)\](.*)/, (_, n: string, suffix: string) => `${root}.calculatedFields[${selected[Number(n)]!.i}]${suffix.replace('.Expression', '.expression').replace('.Name', '.name').replace('.DataSetIdentifier', '.dataSetIdentifier')}`);
        analysisFail(error.code, path, error.message);
      }
      throw error;
    }
  }
  calculations.forEach((v, i) => {
    const p = `${root}.calculatedFields[${i}]`, c = analysisObject(v, p);
    if (Object.keys(c).some(k => !['name', 'dataSetIdentifier', 'expression'].includes(k))) analysisFail('INVALID_INPUT', p, 'Unknown calculation property');
    if (!identifiers.has(String(c.dataSetIdentifier))) analysisFail('UNRESOLVED_BINDING', `${p}.dataSetIdentifier`, 'Unknown dataset identifier');
  });
  const sheets = array(d.sheets ?? [], `${root}.sheets`), sheetIds = new Set<string>(), visualIds = new Set<string>();
  const sheetVisuals = new Map<string, Set<string>>(), filterIds = new Set<string>(), groupIds = new Set<string>();
  for (const [i, s] of sheets.entries()) {
    const p = `${root}.sheets[${i}]`, sheet = analysisObject(s, p), id = analysisId(sheet.sheetId, `${p}.sheetId`);
    for (const key of ['name', 'contentType']) if (sheet[key] !== undefined && typeof sheet[key] !== 'string') analysisFail('INVALID_INPUT', `${p}.${key}`, 'Expected a string');
    unique(sheetIds, id, `${p}.sheetId`); const ids = new Set<string>(); sheetVisuals.set(id, ids);
    for (const [j, v] of array(sheet.visuals ?? [], `${p}.visuals`).entries()) {
      const vp = `${p}.visuals[${j}]`, vid = visualIdentity(v, vp); unique(visualIds, vid, vp); ids.add(vid);
      const [kind, value] = Object.entries(analysisObject(v, vp))[0]!, body = analysisObject(value, `${vp}.${kind}`);
      for (const key of ['title', 'subtitle', 'chartConfiguration']) if (body[key] !== undefined) analysisObject(body[key], `${vp}.${kind}.${key}`);
      for (const key of ['actions', 'columnHierarchies']) if (body[key] !== undefined) array(body[key], `${vp}.${kind}.${key}`);
      const configuration = body.chartConfiguration as Obj | undefined;
      if (configuration?.fieldWells !== undefined) {
        const wp = `${vp}.${kind}.chartConfiguration.fieldWells`, wells = analysisObject(configuration.fieldWells, wp);
        walk(wells, wp, (o, at) => {
          for (const [key, value] of Object.entries(o)) {
            if (/FieldWells$/.test(key)) analysisObject(value, `${at}.${key}`);
            if (['values', 'category', 'groupBy', 'rows', 'columns', 'color', 'size', 'targetValues', 'trendGroups', 'smallMultiples', 'breakdowns'].includes(key)) array(value, `${at}.${key}`).forEach((field, i) => analysisObject(field, `${at}.${key}[${i}]`));
          }
        });
      }
    }
  }
  for (const [i, v] of array(d.filterGroups ?? [], `${root}.filterGroups`).entries()) {
    const p = `${root}.filterGroups[${i}]`, g = analysisObject(v, p);
    unique(groupIds, analysisId(g.filterGroupId, `${p}.filterGroupId`), `${p}.filterGroupId`);
    if (!['ENABLED', 'DISABLED'].includes(String(g.status))) analysisFail('INVALID_INPUT', `${p}.status`, 'Expected ENABLED or DISABLED');
    const scope = analysisObject(g.scopeConfiguration, `${p}.scopeConfiguration`);
    if (Object.keys(scope).length !== 1 || !('allSheets' in scope || 'selectedSheets' in scope)) analysisFail('INVALID_INPUT', `${p}.scopeConfiguration`, 'Expected an explicit filter scope');
    if ('allSheets' in scope && Object.keys(analysisObject(scope.allSheets, p)).length) analysisFail('INVALID_INPUT', p, 'Invalid allSheets scope');
    if ('selectedSheets' in scope) {
      const scopes = array(analysisObject(scope.selectedSheets, p).sheetVisualScopingConfigurations, `${p}.scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations`), seen = new Set<string>();
      if (!scopes.length) analysisFail('INVALID_INPUT', p, 'Filter scope cannot be empty');
      for (const [j, v] of scopes.entries()) {
        const sp = `${p}.scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations[${j}]`, s = analysisObject(v, sp), id = text(s.sheetId, `${sp}.sheetId`);
        unique(seen, id, `${sp}.sheetId`);
        if (!sheetIds.has(id)) analysisFail('UNRESOLVED_BINDING', `${sp}.sheetId`, 'Unknown sheet');
        if (s.scope === 'SELECTED_VISUALS') {
          const ids = array(s.visualIds, `${sp}.visualIds`), seenIds = new Set<string>();
          if (!ids.length) analysisFail('INVALID_INPUT', `${sp}.visualIds`, 'Visual scope cannot be empty');
          ids.forEach((v, k) => { const vp = `${sp}.visualIds[${k}]`, vid = text(v, vp); unique(seenIds, vid, vp); if (!sheetVisuals.get(id)!.has(vid)) analysisFail('UNRESOLVED_BINDING', vp, 'Unknown visual in sheet'); });
        } else if (s.scope !== 'ALL_VISUALS' || s.visualIds !== undefined) analysisFail('INVALID_INPUT', `${sp}.scope`, 'Invalid visual scope');
      }
    }
    for (const [j, f] of array(g.filters, `${p}.filters`).entries()) {
      const fp = `${p}.filters[${j}]`, entries = Object.entries(analysisObject(f, fp));
      if (entries.length !== 1) analysisFail('INVALID_INPUT', fp, 'Expected one filter variant');
      const b = analysisObject(entries[0]![1], fp); unique(filterIds, analysisId(b.filterId, `${fp}.filterId`), `${fp}.filterId`);
    }
  }
  // All columns, expressions and parameter references are checked, including
  // disabled filters and incomplete visuals which cannot reach query planning.
  const validateReferences = (value: unknown, path: string, datasetIds?: Set<string>) => walk(value, path, (o, p) => {
    if ('dataSetIdentifier' in o) {
      const id = text(o.dataSetIdentifier, `${p}.dataSetIdentifier`);
      if (!identifiers.has(id)) analysisFail('UNRESOLVED_BINDING', `${p}.dataSetIdentifier`, 'Unknown dataset identifier');
      datasetIds?.add(id);
    }
    for (const [key, value] of Object.entries(o)) {
      const expected = /^(numericalMeasureField|numericalDimensionField|numericRangeFilter)$/.test(key) ? 'number'
        : /^(dateDimensionField|dateMeasureField|timeRangeFilter|relativeDatesFilter)$/.test(key) ? 'datetime'
        : /^(categoricalDimensionField|categoricalMeasureField|categoryFilter)$/.test(key) ? 'string' : undefined;
      if (expected && value && typeof value === 'object' && 'column' in value) {
        const c = analysisObject(value.column, `${p}.${key}.column`), binder = binders.get(String(c.dataSetIdentifier));
        if (!binder) analysisFail('UNRESOLVED_BINDING', `${p}.${key}.column`, 'Unknown dataset identifier');
        if (binder.bind(text(c.columnName, `${p}.${key}.column.columnName`), `${p}.${key}.column.columnName`).scalarType !== expected) analysisFail('TYPE_MISMATCH', `${p}.${key}.column`, `Expected a ${expected} field`);
      }
    }
    if ('columnName' in o) {
      const binder = binders.get(String(o.dataSetIdentifier));
      if (!binder) analysisFail('UNRESOLVED_BINDING', p, 'Column requires a resolved dataset identifier');
      binder.bind(text(o.columnName, `${p}.columnName`), `${p}.columnName`);
    }
    for (const k of ['parameterName', 'sourceParameterName']) if (k in o && !bound.declarations.some(b => b.name === o[k])) analysisFail('UNRESOLVED_BINDING', `${p}.${k}`, 'Unknown parameter');
    for (const k of ['sourceFilterId']) if (k in o && !filterIds.has(String(o[k]))) analysisFail('UNRESOLVED_BINDING', `${p}.${k}`, 'Unknown filter');
    if ('sheetId' in o && !sheetIds.has(String(o.sheetId))) analysisFail('UNRESOLVED_BINDING', `${p}.sheetId`, 'Unknown sheet');
    for (const k of ['targetVisuals', 'visualIds']) if (k in o) array(o[k], `${p}.${k}`).forEach((id, i) => { if (!visualIds.has(String(id))) analysisFail('UNRESOLVED_BINDING', `${p}.${k}[${i}]`, 'Unknown visual'); });
    for (const k of ['sourceVisualId', 'targetVisualId']) if (k in o && !visualIds.has(String(o[k]))) analysisFail('UNRESOLVED_BINDING', `${p}.${k}`, 'Unknown visual');
    if ('matchOperator' in o && !['EQUALS', 'DOES_NOT_EQUAL', 'CONTAINS', 'DOES_NOT_CONTAIN', 'STARTS_WITH', 'ENDS_WITH', 'EXACT'].includes(String(o.matchOperator))) analysisFail('UNSUPPORTED_FEATURE', `${p}.matchOperator`, 'Unknown filter match operator');
    if ('operator' in o && !['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN', 'LESS_THAN_OR_EQUAL_TO', 'CONTAINS', 'DOES_NOT_CONTAIN', 'STARTS_WITH', 'ENDS_WITH', 'BETWEEN'].includes(String(o.operator))) analysisFail('UNSUPPORTED_FEATURE', `${p}.operator`, 'Unknown filter operator');
  });
  validateReferences(d.filterGroups, `${root}.filterGroups`);
  const Errors: AnalysisDiagnostic[] = [];
  for (const [i, s] of sheets.entries()) {
    const p = `${root}.sheets[${i}]`, sheet = analysisObject(s, p), elements = new Set(sheetVisuals.get(String(sheet.sheetId)));
    for (const [key, idKey] of [['textBoxes', 'sheetTextBoxId'], ['images', 'sheetImageId']] as const) {
      for (const [j, v] of array(sheet[key] ?? [], `${p}.${key}`).entries()) unique(elements, text(analysisObject(v, p)[idKey], `${p}.${key}[${j}].${idKey}`), `${p}.${key}[${j}]`);
    }
    for (const key of ['parameterControls', 'filterControls']) walk(sheet[key], `${p}.${key}`, (o, at) => { for (const id of ['parameterControlId', 'filterControlId']) if (id in o) unique(elements, text(o[id], `${at}.${id}`), `${at}.${id}`); });
    for (const [j, layout] of array(sheet.layouts ?? [], `${p}.layouts`).entries()) {
      const lp = `${p}.layouts[${j}]`; analysisObject(layout, lp);
      walk(layout, lp, (o, at) => { if ('elementId' in o && !elements.has(String(o.elementId))) analysisFail('UNRESOLVED_BINDING', `${at}.elementId`, 'Unknown sheet element'); });
    }
    validateReferences(sheet.parameterControls, `${p}.parameterControls`); validateReferences(sheet.filterControls, `${p}.filterControls`);
    for (const [j, v] of array(sheet.visuals ?? [], `${p}.visuals`).entries()) {
      const vp = `${p}.visuals[${j}]`, ids = new Set<string>(); validateReferences(v, vp, ids);
      const fields = new Set<string>();
      walk(v, vp, (o, at) => {
        if ('fieldId' in o && (at.includes('.fieldWells.') || at.includes('.insightConfiguration.'))) unique(fields, text(o.fieldId, `${at}.fieldId`), `${at}.fieldId`);
      });
      walk(v, vp, (o, at) => {
        if ('selectedFields' in o) array(o.selectedFields, `${at}.selectedFields`).forEach((id, i) => { if (!fields.has(String(id))) analysisFail('UNRESOLVED_BINDING', `${at}.selectedFields[${i}]`, 'Unknown visual field'); });
        if ('fieldId' in o && !fields.has(String(o.fieldId))) analysisFail('UNRESOLVED_BINDING', `${at}.fieldId`, 'Unknown visual field');
        if ('expression' in o) {
          const id = ids.size === 1 ? [...ids][0]! : ids.size === 0 && identifiers.size === 1 ? [...identifiers][0]! : undefined;
          const binder = id === undefined ? undefined : binders.get(id);
          if (!binder) analysisFail('UNRESOLVED_BINDING', `${at}.expression`, 'Expression requires one unambiguous dataset');
          const expression = parseExpression(text(o.expression, `${at}.expression`), `${at}.expression`, binder);
          if (at.endsWith('.calculatedMeasureField') && expression.scalarType !== 'number') analysisFail('TYPE_MISMATCH', `${at}.expression`, 'Calculated measure must be numeric');
        }
      });
      try {
        normalizeVisual('bundle', v, vp);
        if (ids.size > 1 || identifiers.size !== 1) throw new CompileError(vp, 'Current visual query path requires one dataset');
        const id = [...identifiers][0]!, schema = schemas.get(id)!;
        planPreparedVisual(schema.columns as readonly PrepColumn[], { ResourceType: 'Analysis', AnalysisId: 'validation', Name: 'Validation', Definition: apiDefinition }, visualIdentity(v, vp), String(analysisObject(declarations[0], root).dataSetArn));
      }
      catch (error) {
        if (!(error instanceof CompileError) && !(error instanceof QueryEngineError)) throw error;
        Errors.push({ errorCode: 'ANALYSIS_VISUAL_NOT_EXECUTABLE', path: error.path, message: error.message });
      }
    }
  }
  const definition = structuredClone(d) as unknown as BundleDefinition;
  return { definition, Errors };
}
