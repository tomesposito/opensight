import { normalizeVisual } from './compiler.js';
import { actionActivation, interpolateUrl, selectionFilters, type ActionSelections, type FilterAction, type InteractionFilter, type NavigationAction, type Selection, type UrlAction } from './interactions.js';
import type { Fixture, FixtureVisual } from './model.js';

type MenuAction = FilterAction | UrlAction | NavigationAction;
type ViewResult<T> = { value: T; problem?: never } | { problem: string; value?: never };

const bodyVisualId = (definition: FixtureVisual['definition']): string | undefined => {
  if (!definition || typeof definition !== 'object') return undefined;
  const body = Object.values(definition)[0];
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const id = record.visualId ?? record.VisualId;
  return typeof id === 'string' && id ? id : undefined;
};

/**
 * View-mode visual identity. Action targets and field mappings reference
 * visual IDs (the bundle VisualId or the authored visual id); the fixture
 * path is the fallback when the definition carries none.
 */
export const viewVisualId = (visual: FixtureVisual): string => bodyVisualId(visual.definition) ?? visual.path;

/** Fixture-visual equivalent of interactions.hasVisualActions. */
export const hasViewActions = (visual: FixtureVisual): boolean =>
  !!(visual.filterActions?.length || visual.urlActions?.length || visual.navigationActions?.length);

/** Menu-option actions for the visual's ⋯ menu. */
export function viewMenuActions(visual: FixtureVisual): MenuAction[] {
  return [...visual.filterActions ?? [], ...visual.urlActions ?? [], ...visual.navigationActions ?? []].filter(action => actionActivation(action) === 'menu');
}

/**
 * View-mode origin check mirroring interactions.originProblem against the
 * fixture definition: a visual needs a grouped dimension and a measure to
 * originate actions; KPIs have no selectable dimension.
 */
export function viewOriginProblem(visual: FixtureVisual): string | undefined {
  let dimensions = 0, measures = 0, kind = '';
  try {
    const model = normalizeVisual(visual.source, visual.definition, visual.path);
    dimensions = model.dimensions.length; measures = model.measures.length; kind = model.kind;
  } catch {
    return 'ACTION_ORIGIN_INVALID: The visual definition could not be read; actions are unavailable.';
  }
  if (kind === 'kpi') return 'KPI has no selectable dimension.';
  if (!dimensions) return 'Assign a dimension to originate an action.';
  if (!measures) return 'Assign a measure to produce selectable results.';
  return undefined;
}

const selectedValue = (values: Selection['values'], field: string): boolean => {
  const value = values[field];
  return value !== undefined && (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value));
};

/** View-mode URL firing: template interpolation plus HTTP(S) validation. Author-mode origin checks do not apply to pinned rows. */
export function resolveViewUrlAction(action: UrlAction, selection: Selection): ViewResult<string> {
  if (selection.range) return { problem: 'URL_SELECTION_RANGE: URL actions require a data point click.' };
  return interpolateUrl(action.urlTemplate, selection.values);
}

/**
 * View-mode navigation: switches the dashboard sheet. Parameter mapping is
 * out of scope — previews declare no parameters, so mapped navigations stay
 * fail-closed with a named problem.
 */
export function resolveViewNavigationAction(sheets: Fixture['sheets'], action: NavigationAction, selection: Selection): ViewResult<{ targetSheetId: string }> {
  if (!sheets.some(sheet => sheet.id === action.targetSheetId)) return { problem: 'NAVIGATION_TARGET_UNKNOWN: Choose an existing sheet in this dashboard.' };
  if (Object.keys(action.parameterMappings ?? {}).length) return { problem: 'NAVIGATION_PARAMETERS_UNSUPPORTED: Parameter mapping needs declared dashboard parameters, which previews do not have.' };
  if (selection.range) return { problem: 'NAVIGATION_SELECTION_RANGE: Navigation requires a data point click.' };
  if (!selectedValue(selection.values, action.sourceField)) return { problem: `NAVIGATION_SELECTION_MISSING: No clicked value for ${action.sourceField}.` };
  return { value: { targetSheetId: action.targetSheetId } };
}

/**
 * Applies select- and menu-activated filter actions to a target visual's
 * pinned rows. View-mode fixtures carry precomputed rows — there is no live
 * query — so InteractionFilters become local row predicates.
 * InteractionFilter.columnName (a field name) maps through the fixture's
 * bindings to the row's result alias; a column with no row key fails closed
 * with a per-visual problem note — never silently ignored, never silently
 * dropped. Pinned rows hold pre-aggregated buckets and the clicked value is
 * the bucket label, so equality on the label is the predicate; range brushes
 * stay author-only.
 */
export function applyViewActionFilters(target: FixtureVisual, sources: FixtureVisual[], selections: ActionSelections, menuSelections: ActionSelections): { visual: FixtureVisual; problems: Record<string, string> } {
  const targetId = viewVisualId(target);
  const problems: Record<string, string> = {};
  const filters: InteractionFilter[] = [];
  for (const source of sources) {
    const sourceId = viewVisualId(source);
    if (sourceId === targetId) continue; // a visual is not its own target, like author mode
    for (const action of source.filterActions ?? []) {
      const activation = actionActivation(action);
      const selection = activation === 'select' ? selections[sourceId] : menuSelections[sourceId];
      if (!selection) continue;
      const value = selection.values[action.sourceField];
      if (value === undefined || !(typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))) continue;
      // Filter scope mirrors author mode: the selection must hold a scoped field value.
      const scoped = action.scopeFields?.length ? action.scopeFields : [action.sourceField];
      if (!scoped.some(field => selectedValue(selection.values, field))) continue;
      if (action.targets !== 'all' && !action.targets.includes(targetId)) continue;
      const columnName = action.mappings?.[targetId] ?? action.sourceField;
      const alias = Object.hasOwn(target.bindings, columnName) ? target.bindings[columnName]! : columnName;
      const rows = target.rows;
      if (!rows?.some(row => Object.hasOwn(row, alias))) {
        problems[action.id] = rows
          ? `FILTER_COLUMN_UNMAPPED: ${columnName} is not a pinned result column for this visual.`
          : 'FILTER_ROWS_UNAVAILABLE: This visual has no pinned rows to filter.';
        continue;
      }
      filters.push(...selectionFilters(columnName, typeof value === 'number' ? 'number' : 'string', value));
    }
  }
  const source = target.rows;
  if (!filters.length || !source) return { visual: target, problems };
  const rows = source.filter(row => filters.every(filter => {
    const alias = Object.hasOwn(target.bindings, filter.columnName) ? target.bindings[filter.columnName]! : filter.columnName;
    return row[alias] === filter.values[0];
  }));
  return { visual: { ...target, rows }, problems };
}
