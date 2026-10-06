import { activeSheet, authorVisualProblem, dataFields, sheetParameters, visualDimensions, type AuthorDraft, type AuthorDataset, type AuthorSheet, type AuthorVisual, type CalculatedField } from './authoring.js';
import { parameterValueError } from './parameters.js';
import type { ParameterDeclaration, ParameterValue } from './parameters.js';

export interface FilterAction {
  id: string; name: string; sourceField: string; targets: 'all' | string[];
  mappings: Record<string, string>;
}
export interface UrlAction {
  id: string; name: string; sourceField: string; urlTemplate: string; target?: '_blank' | '_self';
}
export interface NavigationAction {
  id: string; name: string; sourceField: string; targetSheetId: string; parameterMappings: Record<string, string>;
}
type ActionResult<T> = { value: T; problem?: never } | { problem: string; value?: never };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Shape validation keeps unfinished/invalid templates editable, with diagnostics below. */
export function urlActionDefinitionsValid(raw: unknown): raw is UrlAction[] {
  return Array.isArray(raw) && raw.every(a => record(a) && Object.keys(a).every(k => ['id', 'name', 'sourceField', 'urlTemplate', 'target'].includes(k)) && typeof a.id === 'string' && !!a.id && typeof a.name === 'string' && typeof a.sourceField === 'string' && !!a.sourceField && typeof a.urlTemplate === 'string' && (a.target === undefined || a.target === '_blank' || a.target === '_self')) && new Set(raw.map(a => a.id)).size === raw.length;
}
function interpolateUrl(template: string, values: Selection['values']): ActionResult<string> {
  if (!template.trim()) return { problem: 'URL_TEMPLATE_EMPTY: Enter an HTTP(S) URL template.' };
  if (/[{}]/.test(template.replace(/\{([^{}]+)\}/g, ''))) return { problem: 'URL_PLACEHOLDER_INVALID: Use {FieldName} placeholders.' };
  let problem: string | undefined;
  const url = template.replace(/\{([^{}]+)\}/g, (_, field: string) => {
    const value = values[field];
    if (!Object.hasOwn(values, field) || (typeof value !== 'string' && typeof value !== 'number') || typeof value === 'number' && !Number.isFinite(value)) {
      problem = `URL_SELECTION_MISSING: No clicked value for ${field}.`; return '';
    }
    try { return encodeURIComponent(String(value)); }
    catch { problem = `URL_SELECTION_INVALID: Cannot encode ${field}.`; return ''; }
  });
  if (problem) return { problem };
  try {
    const parsed = new URL(url);
    if (!/^https?:\/\//i.test(url) || !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || /[\s\\\u0000-\u001f\u007f]/.test(url)) throw new Error('invalid URL');
    return { value: parsed.href };
  } catch { return { problem: 'URL_INVALID: The interpolated URL must be an absolute HTTP(S) URL.' }; }
}
export function urlActionProblem(source: AuthorVisual, action: UrlAction, selection?: Selection): string | undefined {
  const origin = originProblem(source);
  if (origin) return `URL_ORIGIN_INVALID: ${origin}`;
  const dimensions = actionDimensions(source);
  if (!dimensions.includes(action.sourceField)) return `URL_SOURCE_UNKNOWN: Source does not group by ${action.sourceField}.`;
  for (const [, field] of action.urlTemplate.matchAll(/\{([^{}]+)\}/g)) {
    if (!dimensions.includes(field!)) return `URL_FIELD_UNKNOWN: Source does not group by ${field}.`;
  }
  if (selection && (!Object.hasOwn(selection.values, action.sourceField) || selection.values[action.sourceField] === undefined)) return `URL_SELECTION_MISSING: No clicked value for ${action.sourceField}.`;
  return interpolateUrl(action.urlTemplate, selection?.values ?? Object.fromEntries(dimensions.map(field => [field, 'value']))).problem;
}
export function validUrlActions(raw: unknown, source?: AuthorVisual): raw is UrlAction[] {
  return urlActionDefinitionsValid(raw) && raw.every(action => source ? !urlActionProblem(source, action) : !interpolateUrl(action.urlTemplate, Object.fromEntries([...action.urlTemplate.matchAll(/\{([^{}]+)\}/g)].map(([, field]) => [field!, 'value']))).problem);
}
export function resolveUrlAction(source: AuthorVisual, action: UrlAction, selection: Selection): ActionResult<string> {
  const problem = urlActionProblem(source, action, selection);
  return problem ? { problem } : interpolateUrl(action.urlTemplate, selection.values);
}
export function hasVisualActions(visual: AuthorVisual): boolean {
  return !!(visual.filterActions?.length || visual.urlActions?.length || visual.navigationActions?.length);
}
/** Definition shape only: unresolved destinations/mappings stay editable and visibly disabled. */
export function navigationActionDefinitionsValid(raw: unknown): raw is NavigationAction[] {
  return Array.isArray(raw) && raw.every(a => record(a) && Object.keys(a).every(k => ['id', 'name', 'sourceField', 'targetSheetId', 'parameterMappings'].includes(k)) && typeof a.id === 'string' && !!a.id && typeof a.name === 'string' && typeof a.sourceField === 'string' && !!a.sourceField && typeof a.targetSheetId === 'string' && record(a.parameterMappings) && Object.values(a.parameterMappings).every(p => typeof p === 'string')) && new Set(raw.map(a => a.id)).size === raw.length;
}
export function navigationSheets(draft: AuthorDraft): AuthorSheet[] {
  const memberPath = activeSheet(draft).imported?.memberPath ?? draft.bundle?.primaryPath;
  // Cross-analysis/dashboard navigation is out of scope: no dashboard registry can resolve it.
  return draft.sheets.filter(sheet => (sheet.imported?.memberPath ?? draft.bundle?.primaryPath) === memberPath);
}
export function navigationActionProblem(draft: AuthorDraft, source: AuthorVisual, action: NavigationAction): string | undefined {
  const origin = originProblem(source);
  if (origin) return `NAVIGATION_ORIGIN_INVALID: ${origin}`;
  const dimensions = actionDimensions(source);
  if (!dimensions.includes(action.sourceField)) return `NAVIGATION_SOURCE_UNKNOWN: Source does not group by ${action.sourceField}.`;
  if (!navigationSheets(draft).some(s => s.id === action.targetSheetId)) return 'NAVIGATION_TARGET_UNKNOWN: Choose an existing sheet in this analysis.';
  const parameters = sheetParameters(draft), mapped = new Set<string>();
  for (const [field, name] of Object.entries(action.parameterMappings)) {
    if (!dimensions.includes(field)) return `NAVIGATION_FIELD_UNKNOWN: Source does not group by ${field}.`;
    const matches = parameters.filter(p => p.name === name), parameter = matches[0];
    if (matches.length !== 1 || !parameter) return `NAVIGATION_PARAMETER_UNKNOWN: ${name || '(missing)'} must name one declared analysis parameter.`;
    if (mapped.has(name)) return `NAVIGATION_PARAMETER_DUPLICATE: Map only one source field to ${name}.`;
    mapped.add(name);
    if (fieldType(field, draft.calculatedFields, draft.dataset) !== parameter.type) return `NAVIGATION_TYPE_MISMATCH: ${field} and ${name} must have the same supported type.`;
  }
}
export function validNavigationActions(raw: unknown, draft: AuthorDraft, source: AuthorVisual): raw is NavigationAction[] {
  return navigationActionDefinitionsValid(raw) && raw.every(action => !navigationActionProblem(draft, source, action));
}
export function resolveNavigationAction(draft: AuthorDraft, source: AuthorVisual, action: NavigationAction, selection: Selection): ActionResult<{ targetSheetId: string; parameters: { id: string; values: ParameterValue[] }[] }> {
  const problem = navigationActionProblem(draft, source, action);
  if (problem) return { problem };
  if (selection.range) return { problem: 'NAVIGATION_SELECTION_RANGE: Navigation requires a data point click.' };
  const parameters = [];
  for (const field of new Set([action.sourceField, ...Object.keys(action.parameterMappings)])) {
    const value = selection.values[field];
    if (!Object.hasOwn(selection.values, field) || (typeof value !== 'string' && typeof value !== 'number') || typeof value === 'number' && !Number.isFinite(value)) return { problem: `NAVIGATION_SELECTION_MISSING: No clicked value for ${field}.` };
    if (!Object.hasOwn(action.parameterMappings, field)) continue;
    const parameter = sheetParameters(draft).find(p => p.name === action.parameterMappings[field])!;
    // A grouped datetime denotes its bucket's UTC start, using the existing filter date semantics.
    const values = [parameter.type === 'datetime' ? dateBounds(String(value))?.[0] ?? value : value];
    const error = parameterValueError(parameter, values);
    if (error) return { problem: `NAVIGATION_VALUE_INVALID: ${parameter.name}: ${error}.` };
    parameters.push({ id: parameter.id, values });
  }
  return { value: { targetSheetId: action.targetSheetId, parameters } };
}
export interface Selection { values: Record<string, string | number>; range?: [string, string] }
export interface InteractionFilter { columnName: string; type: ParameterDeclaration['type']; values: ParameterValue[]; operator?: 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO' }
export type ActionSelections = Record<string, Selection>;
export const fieldType = (name: string, calculations: readonly CalculatedField[] = [], dataset?: AuthorDataset): ParameterDeclaration['type'] | undefined => {
  const field = dataFields(calculations, dataset).find(f => f.name === name);
  return !field ? undefined : field.type === 'DATETIME' ? 'datetime' : field.type === 'STRING' ? 'string' : 'number';
};
export function originProblem(visual: AuthorVisual): string | undefined {
  return authorVisualProblem(visual) ?? (visual.kind === 'kpi' ? 'KPI has no selectable dimension.'
    : !visualDimensions(visual).length ? 'Assign a dimension to originate an action.'
    : visualDimensions(visual).includes('order_id') ? 'Numeric grouping is not supported by the current query engine.'
    : !visual.measures.length ? 'Assign a measure to produce selectable results.'
    : visual.kind === 'line' && visual.dimension !== 'order_date' ? 'Line actions require a datetime axis for range brushing.' : undefined);
}
export const actionDimensions = (visual: AuthorVisual): string[] => visual.kind === 'kpi' ? [] : [...new Set([...visualDimensions(visual), ...(visual.hierarchy?.levels.map(l => l.columnName) ?? [])])];
export function targetProblem(source: AuthorVisual, target: AuthorVisual, action: FilterAction, calculations: readonly CalculatedField[] = [], dataset?: AuthorDataset): string | undefined {
  const field = action.mappings[target.id] ?? action.sourceField;
  return originProblem(source) ?? authorVisualProblem(target) ?? (!target.measures.length ? 'Assign a measure to the target to produce results.' : undefined) ?? (visualDimensions(target).includes('order_id') ? 'Numeric grouping is not supported by the current query engine.' : undefined) ?? (source.id === target.id ? 'The source visual is not its own target.'
    : !actionDimensions(source).includes(action.sourceField) ? `Source does not group by ${action.sourceField}.`
    : !actionDimensions(target).includes(field) ? `${target.kind === 'kpi' ? 'KPI has no grouped dimensions' : `Target does not group by ${field}`}.`
    : !fieldType(field, calculations, dataset) || fieldType(field, calculations, dataset) !== fieldType(action.sourceField, calculations, dataset) ? 'Source and target fields must have the same supported type.' : undefined);
}
export function toggleSelection(selections: ActionSelections, sourceId: string, selection: Selection): ActionSelections {
  const next = { ...selections };
  if (JSON.stringify(next[sourceId]) === JSON.stringify(selection)) delete next[sourceId];
  else next[sourceId] = selection;
  return next;
}
/** UTC inclusive bounds for an aggregated date bucket; source data is date-only. */
export function dateBounds(value: string): [string, string] | undefined {
  if (!/^\d{4}(?:-Q[1-4]|-\d{2}(?:-\d{2})?)?$/.test(value)) return;
  const year = Number(value.slice(0, 4)), quarter = value.includes('-Q'), day = value.length === 10;
  const month = quarter ? (Number(value.slice(6)) - 1) * 3 + 1 : value.length >= 7 ? Number(value.slice(5, 7)) : 1;
  if (month < 1 || month > 12) return;
  const startText = `${value.slice(0, 4)}-${String(month).padStart(2, '0')}-${day ? value.slice(8) : '01'}`;
  const start = new Date(`${startText}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startText) return;
  const end = new Date(start);
  if (!day) {
    if (value.length === 4) end.setUTCFullYear(year + 1);
    else end.setUTCMonth(end.getUTCMonth() + (quarter ? 3 : 1));
    end.setUTCDate(end.getUTCDate() - 1);
  }
  return [startText, end.toISOString().slice(0, 10)];
}
export function selectionFilters(columnName: string, type: ParameterDeclaration['type'], value: string | number, range?: [string, string]): InteractionFilter[] {
  if (type === 'datetime') {
    const bounds = range ? [dateBounds(range[0])?.[0], dateBounds(range[1])?.[1]] : dateBounds(String(value));
    return bounds?.[0] && bounds[1] ? [
      { columnName, type, values: [bounds[0]], operator: 'GREATER_THAN_OR_EQUAL_TO' },
      { columnName, type, values: [bounds[1]], operator: 'LESS_THAN_OR_EQUAL_TO' },
    ] : [];
  }
  return typeof value === (type === 'number' ? 'number' : 'string') ? [{ columnName, type, values: [value] }] : [];
}
export function withActionFilters(sheet: AuthorSheet, visual: AuthorVisual, selections: ActionSelections, calculations: readonly CalculatedField[] = [], dataset?: AuthorDataset): AuthorVisual {
  const filters = sheet.visuals.flatMap(source => (source.filterActions ?? []).flatMap(action => {
    const selection = selections[source.id], value = selection?.values[action.sourceField];
    if (!selection || value === undefined || action.targets !== 'all' && !action.targets.includes(visual.id) || targetProblem(source, visual, action, calculations, dataset)) return [];
    return selectionFilters(action.mappings[visual.id] ?? action.sourceField, fieldType(action.sourceField, calculations, dataset)!, value, selection.range);
  }));
  return filters.length ? { ...visual, interactionFilters: [...(visual.interactionFilters ?? []), ...filters] } : visual;
}
export function validFilterActions(raw: unknown): raw is FilterAction[] {
  return Array.isArray(raw) && new Set(raw.map(a => a?.id)).size === raw.length && raw.every(a => a && typeof a === 'object' && Object.keys(a).every(k => ['id','name','sourceField','targets','mappings'].includes(k)) && typeof a.id === 'string' && !!a.id && typeof a.name === 'string' && typeof a.sourceField === 'string' && !!a.sourceField && (a.targets === 'all' || Array.isArray(a.targets) && a.targets.every((v: unknown) => typeof v === 'string')) && a.mappings && typeof a.mappings === 'object' && !Array.isArray(a.mappings) && Object.values(a.mappings).every(v => typeof v === 'string'));
}
