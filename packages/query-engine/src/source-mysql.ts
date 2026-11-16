import { createConnection } from 'mysql2';
import { PrepError, prepFail } from '@opensight/bundle-parser/prep';
import { planSourceRead, type SourceRead, type SourceConnection } from './source-read.js';
import { boundedPrepSql, ExecutionCancelledError, type PrepReadLimits, type PrepSink, type ExecutionControl } from './prep-stream.js';
import { normalizePrepScalar } from './prep-executor.js';
import { mysqlSessionSql } from './mysql-session.js';

/** Text-protocol binding must honor NO_BACKSLASH_ESCAPES and skip quoted question marks.
 * mysql2's default formatter assumes backslash escaping, so use its queryFormat hook with
 * UTF-8 hex literals. No user string can become SQL syntax, including quotes/backslashes. */
function queryFormat(sql: string, values: unknown): string {
  if (values === undefined) return sql;
  if (!Array.isArray(values)) return prepFail('PREP_EXECUTION_FAILED', '$.source', 'Invalid source parameters');
  let index = 0;
  const result = sql.replace(/`(?:``|[^`])*`|'(?:''|[^'])*'|\?/g, token => {
    if (token !== '?') return token;
    const value: unknown = values[index++];
    if (typeof value === 'string') return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return prepFail('PREP_EXECUTION_FAILED', '$.source', 'Invalid source parameter');
  });
  if (index !== values.length) return prepFail('PREP_EXECUTION_FAILED', '$.source', 'Invalid source parameter count');
  return result;
}

/** Operator-owned connection policy, including explicit ssl:false, matches hosted PostgreSQL. */
export async function streamSourceMySql(read: SourceRead, connection: SourceConnection, limits: PrepReadLimits, sink: PrepSink, control?: ExecutionControl): Promise<void> {
  const variant = read.source.connectorId === 'mariadb' ? 'mariadb' : 'mysql';
  const plan = planSourceRead(read, limits, 'mysql', { mysqlVariant: variant });
  if (control?.signal?.aborted) throw new ExecutionCancelledError();
  sink.start(plan.columns);
  const duration = Math.min(control?.executionMs ?? 10_000, 10_000);
  const client = createConnection({ ...connection, ssl: connection.ssl || undefined, connectTimeout: Math.min(duration, 3000),
    charset: 'utf8mb4', timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    rowsAsArray: true, multipleStatements: false, enableKeepAlive: false, queryFormat });
  client.on('error', () => {});
  let consumerError: unknown, cancelRead: (() => void) | undefined, cancelled = false;
  const stopped = new Promise<never>((_resolve, reject) => {
    cancelRead = () => { cancelled = true; client.destroy(); reject(new ExecutionCancelledError()); };
  });
  const cancel = () => cancelRead!();
  control?.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, duration);
  const check = () => { if (cancelled || control?.signal?.aborted) throw new ExecutionCancelledError(); };
  try {
    await Promise.race([stopped, (async () => {
      check();
      await client.promise().query({ sql: mysqlSessionSql(variant), timeout: duration });
      check();
      // The SQL guard suppresses oversized payloads before driver allocation; the sink still
      // checks every row and the maxRows+1 sentinel, just as for PostgreSQL source reads.
      await new Promise<void>((resolve, reject) => {
        let count = 0;
        const query = client.query({ sql: boundedPrepSql(plan, limits, 'mysql'), values: plan.parameters, timeout: duration });
        query.on('error', reject).on('end', resolve).on('result', (raw: unknown[]) => {
          if (consumerError !== undefined || cancelled) return;
          try {
            check();
            if (++count > limits.maxRows || raw[plan.columns.length] === 1 || raw[plan.columns.length] === '1') sink.oversized();
            const values = plan.columns.map((c, i) => normalizePrepScalar(c.type === 'BOOLEAN' && [0, 1, '0', '1'].includes(raw[i] as number | string) ? Number(raw[i]) === 1 : raw[i], c));
            if (values.reduce<number>((n, v) => n + String(v ?? '').length, 0) > limits.cellChars) sink.oversized();
            sink.row(values);
          } catch (error) { consumerError = error; client.destroy(); reject(error); }
        });
      });
      check();
    })()]);
  } catch (error) {
    if (cancelled || control?.signal?.aborted || error instanceof ExecutionCancelledError) throw new ExecutionCancelledError();
    if (error === consumerError || error instanceof PrepError) throw error;
    prepFail('PREP_EXECUTION_FAILED', '$.source', 'MySQL connection or source query failed');
  } finally {
    clearTimeout(timer); control?.signal?.removeEventListener('abort', cancel); client.destroy();
  }
}
