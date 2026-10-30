import { evaluateSqlPlan } from './evaluate.js';
import { Client, types } from 'pg';
import { planVisual } from './planner.js';
import { liveProvenance, liveResultCacheKey, validateLiveCache } from './live-performance.js';
import type { PlanRequest, PostgresExecuteOptions, QueryResult, ResultValue } from './types.js';
import { fail, QueryEngineError, string } from './validation.js';

const numericTypes = new Set<number>([
  types.builtins.INT2, types.builtins.INT4, types.builtins.INT8,
  types.builtins.FLOAT4, types.builtins.FLOAT8, types.builtins.NUMERIC,
]);

function resultValue(value: unknown, oid: number): ResultValue {
  if (value === null) return null;
  if (typeof value !== 'string') return fail('EXECUTION_ERROR', '$.result', 'unsupported result scalar');
  if (oid === types.builtins.BOOL) return value === 't' ? 1 : 0;
  if (!numericTypes.has(oid)) return value;
  // SUM(bigint) is NUMERIC and COUNT is INT8. Preserve large integers exactly.
  if ((oid === types.builtins.INT8 || oid === types.builtins.NUMERIC) && /^[+-]?\d+$/.test(value)) {
    const integer = BigInt(value);
    return integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(integer) : value;
  }
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  return fail('EXECUTION_ERROR', '$.result', 'nonfinite numeric result');
}

/** Validate and plan before connecting. Each call owns and closes one client. */
export async function executePostgres(request: PlanRequest, options: PostgresExecuteOptions): Promise<QueryResult> {
  const plan = planVisual(request, { dialect: 'postgres', aggregates: options?.aggregates });
  const connectionString = string(options?.connectionString, '$.options.connectionString');
  const policy = validateLiveCache(options?.liveCache);
  const cache = request.security === undefined && !plan.securityProtected ? policy : undefined;
  const key = liveResultCacheKey(plan);
  const cached = cache?.cache.get(key);
  if (cached) return { plan, rows: plan.postProcess ? evaluateSqlPlan(plan, cached.rows) : cached.rows,
    provenance: { ...liveProvenance(plan), source: 'cache', cachedAt: cached.cachedAt } };
  try {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query("SET TIME ZONE 'UTC'");
      const result = await client.query<unknown[]>({
        text: plan.sql,
        values: [...plan.parameters],
        rowMode: 'array',
        // Read wire text per query, without modifying pg's process-wide parsers.
        types: { getTypeParser: () => (value: string) => value },
      });
      const rows = result.rows.map(values => Object.fromEntries(result.fields.map((field, i) =>
        [field.name, resultValue(values[i], field.dataTypeID)])));
      const resultRows = plan.postProcess ? evaluateSqlPlan(plan, rows) : rows;
      // Cache SQL rows: post-processing is not represented in the SQL cache key.
      cache?.cache.set(key, rows, cache.ttlMs);
      return { plan, rows: resultRows, provenance: liveProvenance(plan) };
    } finally {
      await client.end();
    }
  } catch (error) {
    if (error instanceof QueryEngineError) throw error;
    // Driver errors may contain credentials or connection details. Never expose them.
    throw new QueryEngineError('EXECUTION_ERROR', '$.postgres', 'Postgres connection or query failed');
  }
}
