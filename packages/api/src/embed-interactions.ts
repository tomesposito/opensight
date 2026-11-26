import { definitionParameters, type QueryPlan } from '@opensight/query-engine';
import { parameterValueError, type ParameterDeclaration, type ParameterValue } from '@opensight/query-engine/parameters';
import { embedFailure, type EmbedInteractionFeatures } from './embed-sessions.js';
import { object } from './metadata-resources.js';
import type { JsonObject } from './mapping.js';

export interface EmbedControl extends ParameterDeclaration { id: string; label: string; values: ParameterValue[] }
export interface EmbedControls { filters: EmbedControl[]; parameters: EmbedControl[] }
export interface EmbedInteractionState { filters?: JsonObject; parameters?: JsonObject }
function invalid(): never { return embedFailure('EMBED_STATE_INVALID', 422); }
function stateObject(raw: unknown, keys?: string[]): JsonObject {
  try { return object(raw, keys); } catch { return invalid(); }
}
/** Presence, even an empty map, is a state submission. Flags are server authority. */
export function embedInteractionState(raw: unknown, features?: EmbedInteractionFeatures): EmbedInteractionState {
  if (raw === undefined) return {};
  const input = stateObject(raw, ['filters', 'parameters']);
  const state: EmbedInteractionState = {};
  for (const [key, flag] of [['filters', 'filtering'], ['parameters', 'parameterControls']] as const) {
    if (!Object.hasOwn(input, key)) continue;
    if (!features?.[flag]) embedFailure('EMBED_FEATURE_DISABLED', 403);
    state[key] = stateObject(input[key]);
  }
  return state;
}
function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return invalid();
  return raw;
}
function walk(raw: unknown, visit: (value: JsonObject) => void): void {
  if (Array.isArray(raw)) raw.forEach(v => walk(v, visit));
  else if (raw && typeof raw === 'object') { const value = raw as JsonObject; visit(value); Object.values(value).forEach(v => walk(v, visit)); }
}

/** Derive editable bindings from authorized plans, never from client column names.
 * Mutates only the request-local definition's values. The caller re-plans it with
 * the same security context before any source I/O and sends it to the usual worker.
 */
export function applyEmbedInteractions(definition: JsonObject, plans: QueryPlan[], features: EmbedInteractionFeatures | undefined, state: EmbedInteractionState): EmbedControls {
  const controls: EmbedControls = { filters: [], parameters: [] };
  const activePaths = new Set(plans.flatMap(p => p.filters.map(f => f.path)));
  const usedParameters = new Set<string>();
  const filterTargets = new Map<string, JsonObject>();
  const filterIds = new Set<string>();
  const labels = new Map<string, string>();
  for (const raw of array(definition.Sheets)) {
    const sheet = object(raw);
    for (const [collection, source] of [['FilterControls', 'SourceFilterId'], ['ParameterControls', 'SourceParameterName']] as const) {
      for (const raw of array(sheet[collection] ?? [])) {
        const control = object(Object.values(object(raw))[0]);
        if (typeof control.Title === 'string' && typeof control[source] === 'string') labels.set(`${collection}:${control[source]}`, control.Title);
      }
    }
  }
  for (const [gi, raw] of array(definition.FilterGroups ?? []).entries()) {
    const group = object(raw);
    for (const [fi, raw] of array(group.Filters).entries()) {
      const filter = object(raw), body = object(Object.values(filter)[0]);
      if (typeof body.FilterId !== 'string' || filterIds.has(body.FilterId)) invalid();
      filterIds.add(body.FilterId);
      if (!activePaths.has(`$.analysis.Definition.FilterGroups[${gi}].Filters[${fi}]`)) continue;
      walk(body, value => { for (const k of ['Parameter', 'ParameterName']) if (typeof value[k] === 'string') usedParameters.add(value[k]); });
      if (!features?.filtering || !filter.CategoryFilter) continue;
      const config = object(body.Configuration);
      if (!config.FilterListConfiguration) continue;
      const list = object(config.FilterListConfiguration);
      if (list.ParameterName !== undefined) continue; // Parameter state has its own feature gate.
      const id = body.FilterId, column = object(body.Column);
      const control: EmbedControl = { id, name: id, label: labels.get(`FilterControls:${id}`) ?? String(column.ColumnName), type: 'string', multiple: true, values: array(list.CategoryValues) as string[] };
      filterTargets.set(id, list); controls.filters.push(control);
    }
  }
  // The planner emits only calculations reachable from this session's visuals/filters.
  for (const plan of plans) walk(plan.calculations, value => { if (value.kind === 'parameter' && typeof value.name === 'string') usedParameters.add(value.name); });
  const declared = definitionParameters(definition.ParameterDeclarations);
  if (features?.parameterControls) for (const p of declared.declarations) if (usedParameters.has(p.name)) {
    controls.parameters.push({ ...p, id: p.name, label: labels.get(`ParameterControls:${p.name}`) ?? p.name, values: declared.bindings[p.name]! });
  }
  for (const key of ['filters', 'parameters'] as const) {
    for (const [id, values] of Object.entries(state[key] ?? {})) {
      const control = controls[key].find(c => c.id === id);
      if (!control || parameterValueError(control, values)) invalid();
      control.values = [...values as ParameterValue[]];
      if (key === 'filters') filterTargets.get(id)!.CategoryValues = control.values;
      else {
        const declaration = array(definition.ParameterDeclarations).map(v => object(Object.values(object(v))[0])).find(p => p.Name === id)!;
        declaration.DefaultValues = { StaticValues: control.values };
      }
    }
  }
  return controls;
}
