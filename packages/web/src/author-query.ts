import { visualDimensions, type CalculatedField, type AuthorVisual } from './authoring.js';
import type { createApiClient, QueryRequest } from './api-client.js';
import type { Row } from './model.js';

export type QueryClient = Pick<ReturnType<typeof createApiClient>, 'queryDataset'>;
export interface AuthorRows { rows: Row[] | null; message?: string }

export function buildAuthorQuery(visual: AuthorVisual, calculations: readonly CalculatedField[] = []): QueryRequest | null {
  const dimensions = visualDimensions(visual);
  if (!visual.measures.length || (visual.kind !== 'kpi' && !dimensions.length)) return null;
  return {
    dimensions: dimensions.map(name => ({ fieldId: name, columnName: name, ...(name === 'order_date' ? { granularity: 'MONTH' } : {}) })),
    measures: visual.measures.map(name => ({ fieldId: name, columnName: name, aggregation: 'SUM' })),
    filters: visual.filters.map(f => ({ columnName: f.columnName, values: f.values })),
    ...(calculations.length ? { calculatedFields: calculations.map(({ name, expression }) => ({ name, expression })) } : {}),
  };
}

/** One grouped query supplies category choices; its SUM is discarded, never used as preview data. */
export function buildDistinctQuery(columnName: string, calculations: readonly CalculatedField[]): QueryRequest {
  return { dimensions: [{ fieldId: columnName, columnName }], measures: [{ fieldId: '__distinct_count', columnName: 'revenue', aggregation: 'COUNT' }],
    filters: [], ...(calculations.length ? { calculatedFields: calculations.map(({ name, expression }) => ({ name, expression })) } : {}) };
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
