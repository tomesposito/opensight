import { authorVisualProblem, dataFields, visualDimensions, type AuthorDataset, type AuthorSheet, type AuthorVisual, type CalculatedField } from './authoring.js';
import type { ParameterDeclaration, ParameterValue } from './parameters.js';

export interface FilterAction {
  id: string; name: string; sourceField: string; targets: 'all' | string[];
  mappings: Record<string, string>;
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
