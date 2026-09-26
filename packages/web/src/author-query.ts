import type { AuthorVisual } from './authoring.js';
import type { createApiClient, QueryRequest } from './api-client.js';
import type { Row } from './model.js';

export type QueryClient = Pick<ReturnType<typeof createApiClient>, 'queryDataset'>;
export interface AuthorRows { rows: Row[] | null; message?: string }

export function buildAuthorQuery(visual: AuthorVisual): QueryRequest | null {
  if (!visual.measures.length || (visual.kind !== 'kpi' && visual.dimension === null)) return null;
  return {
    dimensions: visual.kind === 'kpi' || visual.dimension === null ? [] : [{
      fieldId: visual.dimension, columnName: visual.dimension,
      ...(visual.dimension === 'order_date' ? { granularity: 'MONTH' } : {}),
    }],
    measures: visual.measures.map(name => ({ fieldId: name, columnName: name, aggregation: 'SUM' })),
    filters: [],
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
