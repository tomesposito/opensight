import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand, StopQueryExecutionCommand, type ColumnInfo } from '@aws-sdk/client-athena';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateConnectorConfig, ConnectorError } from './connectors.js';
import { planVisual } from './planner.js';
import { evaluateSqlPlan } from './evaluate.js';
import { ExecutionCancelledError } from './prep-stream.js';
import { athenaResultValue, athenaType } from './athena-sql.js';
import { fail, QueryEngineError } from './validation.js';
import type { PlanRequest, QueryResult, ResultRow } from './types.js';

export type AthenaQueryClient = Pick<AthenaClient, 'send' | 'destroy'>;
export interface AthenaExecuteOptions {
  config: unknown;
  /** Trusted server configuration only, never request-supplied values. */
  environment?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
  /** Hard deadline across SDK requests, polling sleeps and result retrieval. Default 60 seconds. */
  timeoutMs?: number;
  /** May lower the hard result limits (100,000 rows, 1,000 pages). Never truncate results. */
  maxRows?: number;
  maxPages?: number;
  /** SDK boundary and time injection for offline tests. The executor owns the returned client. */
  clientFactory?: (config: { region: string }) => AthenaQueryClient;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
function limit(value: number, maximum: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('INVALID_INPUT', path, 'Expected a positive integer within the execution limit');
  return value;
}
const executionError = (message: string) => new QueryEngineError('EXECUTION_ERROR', '$.athena', message);
/** Generated Athena SELECT only. Security, SQL and config validation precede client creation. */
export async function executeAthena(request: PlanRequest, options: AthenaExecuteOptions): Promise<QueryResult> {
  const plan = planVisual(request, { dialect: 'athena' });
  const config = validateConnectorConfig('athena', options?.config), environment = options.environment ?? process.env;
  const env = Object.fromEntries(Object.entries(config).map(([key, name]) => {
    const value = environment[name];
    if (!value || value.includes('\0')) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', `$.config.${key}`, 'Environment value is missing or invalid');
    return [key, value];
  }));
  if (plan.tableSchema !== env.databaseEnv) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.databaseEnv', 'Planned database must match configured database');
  const parameters = plan.parameters.map(value => {
    if (value === null) return fail('UNSUPPORTED_FEATURE', '$.parameters', 'Athena null execution parameters are not supported');
    return String(value);
  });
  const timeoutMs = limit(options.timeoutMs ?? 60_000, 2_147_483_647, '$.options.timeoutMs');
  const maxRows = limit(options.maxRows ?? 100_000, 100_000, '$.options.maxRows');
  const maxPages = limit(options.maxPages ?? 1_000, 1_000, '$.options.maxPages');
  const now = options.now ?? (() => performance.now()), deadline = now() + timeoutMs;
  let timedOut = false, client: AthenaQueryClient | undefined, executionId: string | undefined;
  const timeout = (): QueryEngineError => { timedOut = true; return executionError('Athena query timed out'); };
  const check = (): void => {
    if (options.signal?.aborted) throw new ExecutionCancelledError();
    if (now() >= deadline) throw timeout();
  };
  // Race even an unresponsive SDK/fake, abort its transport, and remove all timers/listeners.
  const bounded = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    check();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      const result = await new Promise<T>((resolve, reject) => {
        abort = () => { reject(new ExecutionCancelledError()); controller.abort(); };
        options.signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { reject(timeout()); controller.abort(); }, Math.max(1, deadline - now()));
        Promise.resolve().then(() => { check(); return operation(controller.signal); }).then(resolve, reject);
      });
      check(); return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) options.signal?.removeEventListener('abort', abort);
    }
  };
  let stoppedId: string | undefined;
  const stop = async (): Promise<void> => {
    if (!client || !executionId || stoppedId === executionId) return;
    stoppedId = executionId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => client!.send(new StopQueryExecutionCommand({ QueryExecutionId: executionId }), { abortSignal: controller.signal })),
        new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, 1_000); }),
      ]);
    } catch { /* Stop is best-effort; never replace the original sanitized error. */ }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
  try {
    check();
    client = (options.clientFactory ?? (configuration => new AthenaClient(configuration)))({ region: env.regionEnv! });
    await bounded(async signal => {
      const started = await client!.send(new StartQueryExecutionCommand({
        QueryString: plan.sql, ...(parameters.length ? { ExecutionParameters: parameters } : {}),
        QueryExecutionContext: { Database: env.databaseEnv! },
        ...(env.workGroupEnv ? { WorkGroup: env.workGroupEnv } : {}),
        ResultConfiguration: { OutputLocation: env.outputLocationEnv! },
      }), { abortSignal: signal });
      executionId = started.QueryExecutionId;
      // A start response can arrive after its transport was cancelled; stop when an ID becomes available.
      if (signal.aborted) await stop();
    });
    if (!executionId) throw executionError('Athena did not return a query execution identifier');
    let interval = 100;
    for (;;) {
      const response = await bounded(signal => client!.send(new GetQueryExecutionCommand({ QueryExecutionId: executionId }), { abortSignal: signal }));
      const state = response.QueryExecution?.Status?.State;
      if (state === 'SUCCEEDED') break;
      if (state === 'FAILED' || state === 'CANCELLED') throw executionError('Athena query failed or was cancelled');
      if (state !== 'QUEUED' && state !== 'RUNNING') throw executionError('Athena returned an invalid execution state');
      await bounded(signal => options.sleep ? options.sleep(Math.min(interval, Math.max(1, deadline - now())), signal) : sleep(Math.min(interval, Math.max(1, deadline - now())), undefined, { signal }));
      interval = Math.min(interval * 2, 1_000);
    }
    const rows: ResultRow[] = [], tokens = new Set<string>();
    let columns: ColumnInfo[] | undefined, nextToken: string | undefined, bytes = 0;
    for (let page = 0; ; page++) {
      if (page >= maxPages) throw executionError('Athena result page limit exceeded');
      const response = await bounded(signal => client!.send(new GetQueryResultsCommand({ QueryExecutionId: executionId, MaxResults: 1_000, ...(nextToken ? { NextToken: nextToken } : {}) }), { abortSignal: signal }));
      const metadata = response.ResultSet?.ResultSetMetadata?.ColumnInfo;
      if (!metadata?.length || metadata.some(c => !c.Name || !c.Type) || new Set(metadata.map(c => c.Name)).size !== metadata.length) throw executionError('Athena returned invalid column metadata');
      metadata.forEach(c => athenaType(c.Type!));
      if (columns && (metadata.length !== columns.length || metadata.some((c, i) => c.Name !== columns![i]!.Name || c.Type !== columns![i]!.Type))) throw executionError('Athena result metadata changed between pages');
      columns = metadata;
      const wireRows = response.ResultSet?.Rows ?? [];
      if (page === 0) {
        const header = wireRows[0]?.Data;
        if (!header || header.length !== columns.length || header.some((cell, i) => cell.VarCharValue !== columns![i]!.Name)) throw executionError('Athena result header does not match column metadata');
      }
      for (const row of page === 0 ? wireRows.slice(1) : wireRows) {
        check();
        if (rows.length >= maxRows) throw executionError('Athena result row limit exceeded');
        if (!row.Data || row.Data.length !== columns.length) throw executionError('Athena result row does not match column metadata');
        const values = row.Data.map((cell, i) => {
          bytes += Buffer.byteLength(cell.VarCharValue ?? '', 'utf8');
          if (bytes > 64 * 1024 * 1024) throw executionError('Athena result byte limit exceeded');
          return athenaResultValue(cell.VarCharValue ?? null, columns![i]!.Type!);
        });
        rows.push(Object.fromEntries(columns.map((column, i) => [column.Name!, values[i]!])));
      }
      nextToken = response.NextToken;
      if (!nextToken) break;
      if (tokens.has(nextToken)) throw executionError('Athena repeated a result pagination token');
      tokens.add(nextToken);
    }
    const result = plan.postProcess ? evaluateSqlPlan(plan, rows) : rows;
    check();
    return { plan, rows: result, provenance: { source: 'live' } };
  } catch (error) {
    if (options.signal?.aborted || error instanceof ExecutionCancelledError || timedOut) {
      await stop();
      if (options.signal?.aborted || error instanceof ExecutionCancelledError) throw new ExecutionCancelledError();
      throw timeout();
    }
    if (error instanceof QueryEngineError) throw error;
    throw executionError('Athena connection or query failed');
  } finally { try { client?.destroy(); } catch { /* Cleanup must not expose SDK error details. */ } }
}
