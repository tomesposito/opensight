import type { AuthorVisual } from './authoring.js';
import { hierarchyError, type DimensionHierarchy, type HierarchyLevel } from './drill.js';
import { validFilterActions, type FilterAction } from './interactions.js';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => !!v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const keys = (v: unknown, allowed: string[]): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function fieldIds(body: Obj): Map<string, string> {
  const fields = new Map<string, string>();
  const visit = (raw: unknown): void => {
    const o = obj(raw), column = obj(o.column);
    if (typeof o.fieldId === 'string' && typeof column.columnName === 'string') fields.set(o.fieldId, column.columnName);
    Object.values(o).forEach(v => Array.isArray(v) ? v.forEach(visit) : v && typeof v === 'object' ? visit(v) : undefined);
  };
  visit(obj(body.chartConfiguration).fieldWells); return fields;
}
export function importAction(raw: unknown, fields: Map<string, string>): FilterAction | undefined {
  const a = obj(raw), operations = list(a.actionOperations), op = obj(obj(operations[0]).filterOperation);
  const selected = obj(op.selectedFieldsConfiguration), targets = obj(obj(op.targetVisualsConfiguration).sameSheetTargetVisualConfiguration);
  if (!keys(a, ['customActionId','name','status','trigger','actionOperations','opensightFieldMappings']) || typeof a.customActionId !== 'string' || typeof a.name !== 'string' || a.status !== 'ENABLED' || a.trigger !== 'DATA_POINT_CLICK' || operations.length !== 1 || !keys(operations[0], ['filterOperation']) || !keys(op, ['selectedFieldsConfiguration','targetVisualsConfiguration']) || !keys(selected, ['selectedFieldOptions','selectedFields']) || !keys(op.targetVisualsConfiguration, ['sameSheetTargetVisualConfiguration']) || !keys(targets, ['targetVisualOptions','targetVisuals'])) return;
  const selectedFields = selected.selectedFieldOptions === 'ALL_FIELDS' ? [...fields.keys()] : list(selected.selectedFields);
  // Measures never originate filters. ALL_FIELDS is resolved by the caller's dimension-only field map.
  if (selectedFields.length !== 1 || selected.selectedFieldOptions !== undefined && selected.selectedFieldOptions !== 'ALL_FIELDS' || !fields.has(String(selectedFields[0]))) return;
  const targetIds = targets.targetVisualOptions === 'ALL_VISUALS' ? 'all' : list(targets.targetVisuals);
  if (targets.targetVisualOptions !== undefined && targets.targetVisualOptions !== 'ALL_VISUALS' || targetIds !== 'all' && (!Array.isArray(targets.targetVisuals) || !targetIds.every(id => typeof id === 'string'))) return;
  const action = { id: a.customActionId, name: a.name, sourceField: fields.get(String(selectedFields[0]))!, targets: targetIds, mappings: a.opensightFieldMappings ?? {} };
  return validFilterActions([action]) ? action as FilterAction : undefined;
}
export function importHierarchy(raw: unknown, visual: AuthorVisual, fields: Map<string, string>): DimensionHierarchy | undefined {
  const wrapper = obj(raw), kind = Object.keys(wrapper)[0], h = obj(kind ? wrapper[kind] : undefined);
  if (Object.keys(wrapper).length !== 1 || !['dateTimeHierarchy', 'explicitHierarchy'].includes(kind ?? '') || !keys(h, ['hierarchyId','columns','drillDownFilters','opensightName','opensightLevels']) || typeof h.hierarchyId !== 'string' || h.drillDownFilters !== undefined && (!Array.isArray(h.drillDownFilters) || h.drillDownFilters.length)) return;
  let levels: HierarchyLevel[];
  if (h.opensightLevels !== undefined) levels = h.opensightLevels as HierarchyLevel[];
  else if (kind === 'dateTimeHierarchy') {
    const columnName = fields.get(h.hierarchyId) ?? (visual.dimension === 'order_date' ? visual.dimension : undefined);
    if (!columnName) return;
    levels = ['YEAR','QUARTER','MONTH','DAY'].map(granularity => ({ columnName, granularity: granularity as 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY' }));
  } else {
    if (!Array.isArray(h.columns) || !h.columns.every(c => keys(c, ['columnName','dataSetIdentifier']) && typeof c.columnName === 'string' && typeof c.dataSetIdentifier === 'string')) return;
    levels = h.columns.map(c => ({ columnName: c.columnName }));
  }
  const hierarchy = { id: h.hierarchyId, name: typeof h.opensightName === 'string' ? h.opensightName : 'Drill hierarchy', levels };
  return hierarchyError(hierarchy, [], true) ? undefined : hierarchy;
}
export function serializeAction(action: FilterAction, fields = new Map<string, string>(), targetId: (id: string) => string = id => id): Obj {
  const sourceId = [...fields].find(([, column]) => column === action.sourceField)?.[0] ?? action.sourceField;
  return { customActionId: action.id, name: action.name, status: 'ENABLED', trigger: 'DATA_POINT_CLICK',
    actionOperations: [{ filterOperation: {
      selectedFieldsConfiguration: { selectedFields: [sourceId] },
      targetVisualsConfiguration: { sameSheetTargetVisualConfiguration: action.targets === 'all' ? { targetVisualOptions: 'ALL_VISUALS' } : { targetVisuals: action.targets.map(targetId) } },
    } }],
    ...(Object.keys(action.mappings).length ? { opensightFieldMappings: Object.fromEntries(Object.entries(action.mappings).map(([id, field]) => [targetId(id), field])) } : {}),
  };
}
export function serializeHierarchy(h: DimensionHierarchy, identifier = 'sales_data'): Obj {
  const temporal = h.levels.every(l => l.columnName === h.levels[0]!.columnName && l.granularity);
  return { [temporal ? 'dateTimeHierarchy' : 'explicitHierarchy']: { hierarchyId: h.id,
    ...(!temporal ? { columns: h.levels.map(l => ({ dataSetIdentifier: identifier, columnName: l.columnName })) } : {}),
    opensightName: h.name, opensightLevels: h.levels,
  } };
}
export function serializeInteractions(visual: AuthorVisual): Obj {
  return { ...(visual.filterActions?.length ? { actions: visual.filterActions.map(a => serializeAction(a)) } : {}), ...(visual.hierarchy ? { columnHierarchies: [serializeHierarchy(visual.hierarchy)] } : {}) };
}
/** Strictly recognized semantics may render; unknown action operations remain fail-closed. */
export function importInteractions(body: Obj, visual: AuthorVisual): { actions: unknown[]; columnHierarchies: unknown[] } {
  const fields = fieldIds(body), dimensions = new Map([...fields].filter(([, name]) => !visual.measures.includes(name)));
  const actions = list(body.actions), hierarchies = list(body.columnHierarchies);
  const supported = actions.flatMap(a => { const parsed = importAction(a, dimensions); return parsed ? [parsed] : []; });
  if (supported.length && validFilterActions(supported)) visual.filterActions = supported;
  const hierarchy = hierarchies.length === 1 ? importHierarchy(hierarchies[0], visual, fields) : undefined;
  if (hierarchy && visual.kind !== 'kpi') visual.hierarchy = hierarchy;
  return { actions: validFilterActions(supported) ? actions.filter(a => !importAction(a, dimensions)) : actions, columnHierarchies: hierarchy && visual.kind !== 'kpi' ? [] : hierarchies };
}
/** Patch only modeled interaction arrays; retain unknown entries and untouched native shapes. */
export function exportInteractions(body: Obj, visual: AuthorVisual, targetId: (id: string) => string, identifier: string): void {
  const before = visual.imported?.baseline;
  if (!before || !equal(before.filterActions, visual.filterActions)) {
    const opaque = !before ? [] : list(body.actions).filter(a => !before?.filterActions?.some(b => b.id === obj(a).customActionId));
    const actions = (visual.filterActions ?? []).map(a => serializeAction(a, fieldIds(body), targetId));
    if (actions.length || opaque.length || body.actions !== undefined) body.actions = [...actions, ...opaque];
  }
  if (!before || !equal(before.hierarchy, visual.hierarchy)) {
    const opaque = !before || before.hierarchy ? [] : list(body.columnHierarchies);
    const hierarchies = visual.hierarchy ? [serializeHierarchy(visual.hierarchy, identifier)] : [];
    if (hierarchies.length || opaque.length || body.columnHierarchies !== undefined) body.columnHierarchies = [...hierarchies, ...opaque];
  }
}
