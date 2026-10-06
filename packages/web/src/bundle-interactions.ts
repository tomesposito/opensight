import type { AuthorVisual } from './authoring.js';
import { hierarchyError, type DimensionHierarchy, type HierarchyLevel } from './drill.js';
import { validFilterActions, urlActionDefinitionsValid, navigationActionDefinitionsValid, type UrlAction, type NavigationAction, type FilterAction } from './interactions.js';
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
  if (selected.selectedFieldOptions === 'ALL_FIELDS' && list(selected.selectedFields).length || targets.targetVisualOptions === 'ALL_VISUALS' && list(targets.targetVisuals).length) return;
  const selectedFields = selected.selectedFieldOptions === 'ALL_FIELDS' ? [...fields.keys()] : list(selected.selectedFields);
  // Measures never originate filters. ALL_FIELDS is resolved by the caller's dimension-only field map.
  if (selectedFields.length !== 1 || selected.selectedFieldOptions !== undefined && selected.selectedFieldOptions !== 'ALL_FIELDS' || !fields.has(String(selectedFields[0]))) return;
  const targetIds = targets.targetVisualOptions === 'ALL_VISUALS' ? 'all' : list(targets.targetVisuals);
  if (targets.targetVisualOptions !== undefined && targets.targetVisualOptions !== 'ALL_VISUALS' || targetIds !== 'all' && (!Array.isArray(targets.targetVisuals) || !targetIds.every(id => typeof id === 'string'))) return;
  const action = { id: a.customActionId, name: a.name, sourceField: fields.get(String(selectedFields[0]))!, targets: targetIds, mappings: a.opensightFieldMappings ?? {} };
  return validFilterActions([action]) ? action as FilterAction : undefined;
}
function customOperation(raw: unknown, kind: string): { action: Obj; operation: Obj } | undefined {
  const action = obj(raw), operations = list(action.actionOperations);
  if (!keys(action, ['customActionId', 'name', 'status', 'trigger', 'actionOperations', 'opensightSourceField']) || typeof action.customActionId !== 'string' || !action.customActionId || typeof action.name !== 'string' || action.status !== 'ENABLED' || action.trigger !== 'DATA_POINT_CLICK' || operations.length !== 1 || !keys(operations[0], [kind]) || !Object.hasOwn(obj(operations[0]), kind)) return;
  return { action, operation: obj(obj(operations[0])[kind]) };
}
function sourceField(action: Obj, fields: Map<string, string>): string | undefined {
  // Operations without an explicit selection field use the first grouped dimension.
  // The extension preserves the author's choice, including stale fields for diagnostics.
  return action.opensightSourceField === undefined ? fields.values().next().value
    : typeof action.opensightSourceField === 'string' && action.opensightSourceField ? action.opensightSourceField : undefined;
}
export function importUrlAction(raw: unknown, fields: Map<string, string>): UrlAction | undefined {
  const parsed = customOperation(raw, 'urlOperation');
  if (!parsed) return;
  const { action: a, operation: op } = parsed;
  if (!keys(op, ['URL', 'url', 'target', 'urlTarget']) || Object.hasOwn(op, 'URL') === Object.hasOwn(op, 'url') || Object.hasOwn(op, 'target') && Object.hasOwn(op, 'urlTarget')) return;
  const urlTemplate = op.URL ?? op.url;
  if (typeof urlTemplate !== 'string' || op.target !== undefined && !['_blank', '_self'].includes(String(op.target)) || op.urlTarget !== undefined && !['NEW_TAB', 'SAME_TAB'].includes(String(op.urlTarget))) return;
  const target = op.urlTarget === 'NEW_TAB' ? '_blank' : op.urlTarget === 'SAME_TAB' ? '_self' : op.target;
  const action = { id: a.customActionId, name: a.name, sourceField: sourceField(a, fields), urlTemplate, ...(target !== undefined ? { target } : {}) };
  return urlActionDefinitionsValid([action]) ? action as UrlAction : undefined;
}
export function importNavigationAction(raw: unknown, fields: Map<string, string>): NavigationAction | undefined {
  const parsed = customOperation(raw, 'navigationOperation');
  if (!parsed) return;
  const { action: a, operation: op } = parsed;
  // Cross-dashboard navigation and unknown navigationTarget shapes stay opaque;
  // no registry exists to resolve a different analysis/dashboard.
  if (!keys(op, ['targetSheetId', 'navigationTarget', 'parameterMappings']) || op.navigationTarget !== undefined || typeof op.targetSheetId !== 'string' || !op.targetSheetId) return;
  const action = { id: a.customActionId, name: a.name, sourceField: sourceField(a, fields), targetSheetId: op.targetSheetId, parameterMappings: op.parameterMappings === undefined ? {} : op.parameterMappings };
  return navigationActionDefinitionsValid([action]) ? action as NavigationAction : undefined;
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
  if (hierarchyError(hierarchy, [], true)) return;
  if (kind === 'dateTimeHierarchy' && !levels.every(l => l.columnName === levels[0]!.columnName && l.granularity)) return;
  if (kind === 'explicitHierarchy' && !equal(list(h.columns).map(c => obj(c).columnName), levels.map(l => l.columnName))) return;
  return hierarchy;
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
export function serializeUrlAction(action: UrlAction): Obj {
  return { customActionId: action.id, name: action.name, status: 'ENABLED', trigger: 'DATA_POINT_CLICK', opensightSourceField: action.sourceField,
    actionOperations: [{ urlOperation: { URL: action.urlTemplate, ...(action.target !== undefined ? { target: action.target } : {}) } }],
  };
}
export function serializeNavigationAction(action: NavigationAction, sheetId: (id: string) => string = id => id): Obj {
  return { customActionId: action.id, name: action.name, status: 'ENABLED', trigger: 'DATA_POINT_CLICK', opensightSourceField: action.sourceField,
    actionOperations: [{ navigationOperation: { targetSheetId: sheetId(action.targetSheetId), parameterMappings: action.parameterMappings } }],
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
  const actions = [...(visual.filterActions ?? []).map(a => serializeAction(a)), ...(visual.urlActions ?? []).map(serializeUrlAction), ...(visual.navigationActions ?? []).map(a => serializeNavigationAction(a))];
  return { ...(actions.length ? { actions } : {}), ...(visual.hierarchy ? { columnHierarchies: [serializeHierarchy(visual.hierarchy)] } : {}) };
}
/** Strictly recognized semantics may render; unknown action operations remain fail-closed. */
export function importInteractions(body: Obj, visual: AuthorVisual): { actions: unknown[]; columnHierarchies: unknown[] } {
  const fields = fieldIds(body), dimensions = new Map([...fields].filter(([, name]) => !visual.measures.includes(name)));
  const actions = list(body.actions), hierarchies = list(body.columnHierarchies);
  const recognized = new Set<unknown>();
  for (const raw of actions) {
    // Duplicate identities cannot be safely patched, even if one operation is opaque.
    if (actions.filter(a => obj(a).customActionId === obj(raw).customActionId).length !== 1) continue;
    const filter = importAction(raw, dimensions), url = importUrlAction(raw, dimensions), navigation = importNavigationAction(raw, dimensions);
    if (filter) { (visual.filterActions ??= []).push(filter); recognized.add(raw); }
    else if (url) { (visual.urlActions ??= []).push(url); recognized.add(raw); }
    else if (navigation) { (visual.navigationActions ??= []).push(navigation); recognized.add(raw); }
  }
  const hierarchy = hierarchies.length === 1 ? importHierarchy(hierarchies[0], visual, fields) : undefined;
  if (hierarchy && visual.kind !== 'kpi') visual.hierarchy = hierarchy;
  return { actions: actions.filter(a => !recognized.has(a)), columnHierarchies: hierarchy && visual.kind !== 'kpi' ? [] : hierarchies };
}
/** Patch only modeled interaction arrays; retain unknown entries and untouched native shapes. */
export function exportInteractions(body: Obj, visual: AuthorVisual, targetId: (id: string) => string, identifier: string, sheetId: (id: string) => string = id => id): void {
  const before = visual.imported?.baseline;
  const kinds = ['filterActions', 'urlActions', 'navigationActions'] as const;
  if (!before || kinds.some(kind => !equal(before[kind], visual[kind]))) {
    const current = [...(visual.filterActions ?? []).map(a => serializeAction(a, fieldIds(body), targetId)), ...(visual.urlActions ?? []).map(serializeUrlAction), ...(visual.navigationActions ?? []).map(a => serializeNavigationAction(a, sheetId))];
    const pending = new Map(current.map(a => [a.customActionId, a]));
    const actions = !before ? [] : list(body.actions).flatMap(raw => {
      const id = obj(raw).customActionId;
      const kind = kinds.find(kind => before[kind]?.some(a => a.id === id));
      if (!kind) return [raw]; // Unknown entries survive byte-for-byte at the JSON value level.
      const previous = before[kind]?.find(a => a.id === id), next = visual[kind]?.find(a => a.id === id);
      const serialized = pending.get(id); pending.delete(id);
      return !next || !serialized ? [] : equal(previous, next) ? [raw] : [serialized];
    });
    actions.push(...pending.values());
    if (actions.length || body.actions !== undefined) body.actions = actions;
  }
  if (!before || !equal(before.hierarchy, visual.hierarchy)) {
    const opaque = !before || before.hierarchy ? [] : list(body.columnHierarchies);
    const hierarchies = visual.hierarchy ? [serializeHierarchy(visual.hierarchy, identifier)] : [];
    if (hierarchies.length || opaque.length || body.columnHierarchies !== undefined) body.columnHierarchies = [...hierarchies, ...opaque];
  }
}
