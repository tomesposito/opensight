import { authorVisualProblem, dataFields, visualDimensions, type AuthorSheet, type AuthorVisual, type CalculatedField } from './authoring.js';
import type { ParameterDeclaration, ParameterValue } from './parameters.js';

export interface FilterAction {
  id: string; name: string; sourceField: string; targets: 'all' | string[];
  mappings: Record<string, string>;
}
export interface Selection { values: Record<string, string | number>; range?: [string, string] }
export interface InteractionFilter { columnName: string; type: ParameterDeclaration['type']; values: ParameterValue[]; operator?: 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO' }
export type ActionSelections = Record<string, Selection>;
export const fieldType = (name: string, calculations: readonly CalculatedField[] = []): ParameterDeclaration['type'] | undefined => {
  const field = dataFields(calculations).find(f => f.name === name);
  return !field ? undefined : field.type === 'DATETIME' ? 'datetime' : field.type === 'STRING' ? 'string' : 'number';
};
export function originProblem(visual: AuthorVisual): string | undefined {
  return authorVisualProblem(visual) ?? (visual.kind === 'kpi' ? 'KPI has no selectable dimension.'
    : !visualDimensions(visual).length ? 'Assign a dimension to originate an action.'
    : !visual.measures.length ? 'Assign a measure to produce selectable results.'
    : visual.kind === 'line' && visual.dimension !== 'order_date' ? 'Line actions require a datetime axis for range brushing.' : undefined);
}
export function targetProblem(source: AuthorVisual, target: AuthorVisual, action: FilterAction, calculations: readonly CalculatedField[] = []): string | undefined {
  const field = action.mappings[target.id] ?? action.sourceField;
  return originProblem(source) ?? authorVisualProblem(target) ?? (source.id === target.id ? 'The source visual is not its own target.'
    : !visualDimensions(source).includes(action.sourceField) ? `Source does not group by ${action.sourceField}.`
    : !visualDimensions(target).includes(field) ? `${target.kind === 'kpi' ? 'KPI has no grouped dimensions' : `Target does not group by ${field}`}.`
    : !fieldType(field, calculations) || fieldType(field, calculations) !== fieldType(action.sourceField, calculations) ? 'Source and target fields must have the same supported type.' : undefined);
}
export function toggleSelection(selections: ActionSelections, sourceId: string, selection: Selection): ActionSelections {
  const next = { ...selections };
  if (JSON.stringify(next[sourceId]) === JSON.stringify(selection)) delete next[sourceId];
  else next[sourceId] = selection;
  return next;
}
/** UTC inclusive bounds for an aggregated date bucket; source data is date-only. */
export function dateBounds(value: string): [string, string] | undefined {
  const match = /^(\d{4})(?:-(\d{2})|(-Q[1-4]))?(?:-(\d{2}))?$/.exec(value);
  if (!match) return;
  const year = Number(match[1]), month = match[3] ? (Number(match[3].slice(2)) - 1) * 3 : Number(match[2] ?? 1) - 1;
  const start = new Date(Date.UTC(year, month, Number(match[4] ?? 1)));
  const end = match[4] ? new Date(start) : new Date(Date.UTC(year + (!match[2] && !match[3] ? 1 : 0), month + (match[3] ? 3 : match[2] ? 1 : 0), 0));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
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
export function withActionFilters(sheet: AuthorSheet, visual: AuthorVisual, selections: ActionSelections, calculations: readonly CalculatedField[] = []): AuthorVisual {
  const filters = sheet.visuals.flatMap(source => (source.filterActions ?? []).flatMap(action => {
    const selection = selections[source.id], value = selection?.values[action.sourceField];
    if (!selection || value === undefined || action.targets !== 'all' && !action.targets.includes(visual.id) || targetProblem(source, visual, action, calculations)) return [];
    return selectionFilters(action.mappings[visual.id] ?? action.sourceField, fieldType(action.sourceField, calculations)!, value, selection.range);
  }));
  return filters.length ? { ...visual, interactionFilters: [...(visual.interactionFilters ?? []), ...filters] } : visual;
}
export function validFilterActions(raw: unknown): raw is FilterAction[] {
  return Array.isArray(raw) && new Set(raw.map(a => a?.id)).size === raw.length && raw.every(a => a && typeof a === 'object' && Object.keys(a).every(k => ['id','name','sourceField','targets','mappings'].includes(k)) && typeof a.id === 'string' && !!a.id && typeof a.name === 'string' && typeof a.sourceField === 'string' && !!a.sourceField && (a.targets === 'all' || Array.isArray(a.targets) && a.targets.every((v: unknown) => typeof v === 'string')) && a.mappings && typeof a.mappings === 'object' && !Array.isArray(a.mappings) && Object.values(a.mappings).every(v => typeof v === 'string'));
}
