import { declaration, type AuthorParameter } from './parameters.js';
import type { AuthorControl } from './controls.js';
import { authorVisualProblem, noDimensions, visualDimensions, dataFields, type CalculatedField, type AuthorVisual } from './authoring.js';
import type { createApiClient, QueryRequest } from './api-client.js';
import type { Row } from './model.js';

export type QueryClient = Pick<ReturnType<typeof createApiClient>, 'queryDataset'>;
export interface AuthorRows { rows: Row[] | null; message?: string }

export function buildAuthorQuery(visual: AuthorVisual, calculations: readonly CalculatedField[] = [], parameters: readonly AuthorParameter[] = []): QueryRequest | null {
  if (authorVisualProblem(visual)) return null;
  const dimensions = visualDimensions(visual);
  if (!visual.measures.length || (!noDimensions(visual.kind) && !dimensions.length)) return null;
  const relevant = queryDependencies([...dimensions, ...visual.measures, ...visual.filters.map(f => f.columnName), ...(visual.interactionFilters ?? []).map(f => f.columnName)], calculations);
  const names = new Set([...visual.filters.flatMap(f => f.parameterName ? [f.parameterName] : []), ...relevant.flatMap(c => [...c.expression.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]!))]);
  const used = parameters.filter(p => names.has(p.name));
  const dynamic = (visual.interactionFilters ?? []).map((filter, i) => {
    let name = `OSInteraction${i}`;
    while (parameters.some(p => p.name === name)) name += 'X';
    return { filter, parameter: { name, type: filter.type, multiple: filter.values.length !== 1, id: name, values: filter.values, defaultValues: filter.values } };
  });
  const bound = [...used, ...dynamic.map(d => d.parameter)];
  return {
    dimensions: dimensions.map(name => ({ fieldId: name, columnName: name, ...(dataFields(calculations).find(f => f.name === name)?.type === 'DATETIME' ? { granularity: visual.dateGrain ?? 'MONTH' } : {}) })),
    measures: visual.measures.map(name => ({ fieldId: name, columnName: name, aggregation: 'SUM' })),
    filters: [...visual.filters.map(f => f.parameterName ? { columnName: f.columnName, parameterName: f.parameterName, ...(f.operator ? { operator: f.operator } : {}) } : { columnName: f.columnName, values: f.values }), ...dynamic.map(({ filter, parameter }) => ({ columnName: filter.columnName, parameterName: parameter.name, ...(filter.operator ? { operator: filter.operator } : {}) }))],
    ...(relevant.length ? { calculatedFields: relevant.map(({ name, expression }) => ({ name, expression })) } : {}),
    ...(bound.length ? { parameterDeclarations: bound.map(declaration), parameterBindings: Object.fromEntries(bound.map(p => [p.name, p.values])) } : {}),
  };
}

/** One grouped query supplies category choices; its SUM is discarded, never used as preview data. */
export function buildDistinctQuery(columnName: string, calculations: readonly CalculatedField[], parameters: readonly AuthorParameter[] = []): QueryRequest {
  const relevant = queryDependencies([columnName], calculations);
  const names = new Set(relevant.flatMap(c => [...c.expression.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]!)));
  const used = parameters.filter(p => names.has(p.name));
  return { dimensions: [{ fieldId: columnName, columnName }], measures: [{ fieldId: '__distinct_count', columnName: 'revenue', aggregation: 'COUNT' }], filters: [],
    ...(relevant.length ? { calculatedFields: relevant.map(({ name, expression }) => ({ name, expression })) } : {}),
    ...(used.length ? { parameterDeclarations: used.map(declaration), parameterBindings: Object.fromEntries(used.map(p => [p.name, p.values])) } : {}),
  };
}

/** Errors never fall back to fixture rows. Cancellation remains a rejected request. */
export async function loadAuthorRows(client: QueryClient, request: QueryRequest, signal: AbortSignal): Promise<AuthorRows> {
  try {
    const result = await client.queryDataset('sales', request, signal);
    signal.throwIfAborted();
    return { rows: result.rows };
  } catch (error) {
    signal.throwIfAborted();
    return { rows: null, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Reachability prevents unrelated controls/calculations from invalidating visual results. */
export function queryDependencies(fields: readonly string[], calculations: readonly CalculatedField[]): CalculatedField[] {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return; seen.add(name);
    const c = calculations.find(c => c.name === name);
    if (c) for (const m of c.expression.matchAll(/(?<!\$)\{([^}]+)\}/g)) visit(m[1]!);
  };
  fields.forEach(visit);
  return calculations.filter(c => seen.has(c.name));
}
export function buildControlQuery(control: AuthorControl, controls: readonly AuthorControl[], parameters: readonly AuthorParameter[]): QueryRequest | undefined {
  if (!control.source?.local) return;
  const parents = (control.cascade ?? []).map(c => ({ ...c, parameter: parameters.find(p => p.id === controls.find(parent => parent.id === c.controlId)?.parameterId) }));
  if (parents.some(p => !p.parameter)) return;
  const used = [...new Map(parents.map(p => [p.parameter!.name, p.parameter!])).values()];
  return { dimensions: [{ fieldId: control.source.columnName, columnName: control.source.columnName }], measures: [{ fieldId: '__count', columnName: 'revenue', aggregation: 'COUNT' }],
    filters: parents.map(p => ({ columnName: p.columnName, parameterName: p.parameter!.name })),
    ...(used.length ? { parameterDeclarations: used.map(declaration), parameterBindings: Object.fromEntries(used.map(p => [p.name, p.values])) } : {}),
  };
}
