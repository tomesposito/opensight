import { evaluatePlan, interactiveRequest, planVisual } from '@opensight/query-engine/browser';
import type { QueryRequest } from './api-client.js';
import type { AuthorRows } from './author-query.js';
import sales from './sales.generated.json' with { type: 'json' };
export function executeFixtureQuery(request: QueryRequest): AuthorRows {
  try { return { rows: evaluatePlan(planVisual(interactiveRequest(request, sales.metadata)), sales.rows) }; }
  catch (e) { return { rows: null, message: e instanceof Error ? e.message : String(e) }; }
}
