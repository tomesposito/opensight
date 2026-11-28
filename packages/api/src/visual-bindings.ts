import type { QueryPlan } from '@opensight/query-engine';

/** Bind host context names to unambiguous physical columns in this viewer's plan.
 * Result aliases and user-supplied field IDs are never column permissions. */
export function visualBindings(plan: QueryPlan, includeContext: boolean) {
  const fields = [...plan.dimensions, ...plan.measures];
  const bindings = Object.fromEntries(fields.map(f => [f.fieldId, f.outputName]));
  if (!includeContext) return { bindings };
  const allowed = new Set(plan.sourceColumns.map(c => c.name));
  for (const denied of plan.deniedColumns ?? []) allowed.delete(denied);
  const columns = new Map<string, string | null>();
  for (const field of fields) {
    if (allowed.has(field.columnName)) columns.set(field.columnName, columns.has(field.columnName) ? null : field.outputName);
  }
  const contextColumns = Object.fromEntries([...columns].filter((pair): pair is [string, string] => pair[1] !== null));
  return { bindings, contextColumns };
}
