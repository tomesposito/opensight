import { Client, Query } from 'pg';
import { PrepError, prepFail } from '@opensight/bundle-parser/prep';
import { planSourceRead, type SourceRead, type SourceConnection } from './source-read.js';
import { boundedPrepSql, ExecutionCancelledError, type PrepReadLimits, type PrepSink, type ExecutionControl } from './prep-stream.js';
import { normalizePrepScalar } from './prep-executor.js';
import { redshiftSessionSql } from './redshift-executor.js';
import { redshiftType } from './redshift-sql.js';
import { fail, QueryEngineError } from './validation.js';

/** One bounded SELECT streamed as pg row events (no accumulated result array, SQL cursor,
 * transaction or pg_cancel_backend). Closing the dedicated socket cancels local work. */
export async function streamSourceRedshift(read: SourceRead, connection: SourceConnection, limits: PrepReadLimits, sink: PrepSink, control?: ExecutionControl): Promise<void> {
  const plan = planSourceRead(read, limits, 'redshift'); // RLS/CLS validation must precede I/O.
  const text = boundedPrepSql(plan, limits, 'redshift');
  if (control?.signal?.aborted) throw new ExecutionCancelledError();
  if (connection.ssl === false && !['127.0.0.1', '::1'].includes(connection.host)) fail('INVALID_INPUT', '$.source', 'Unencrypted Redshift connections are restricted to loopback');
  sink.start(plan.columns);
  const duration = Math.min(control?.executionMs ?? 10_000, 10_000);
  // pg query_timeout installs a callback: it accumulates rows and swallows Query error
  // events. The one execution timer below bounds connection, setup and streaming instead.
  const client = new Client({ ...connection, connectionTimeoutMillis: 3000, query_timeout: 0 });
  let consumerError: unknown, cancelled = false, stop: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    client.on('error', reject);
    stop = () => { cancelled = true; void client.end().catch(() => {}); reject(new ExecutionCancelledError()); };
  });
  const cancel = () => stop();
  control?.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, duration);
  const check = () => { if (cancelled || control?.signal?.aborted) throw new ExecutionCancelledError(); };
  try {
    await Promise.race([stopped, (async () => {
      check(); await client.connect(); check();
      for (const statement of redshiftSessionSql) { await client.query(statement); check(); }
      await new Promise<void>((resolve, reject) => {
        let count = 0;
        const queryConfig = { text, values: plan.parameters, rowMode: 'array' as const, types: { getTypeParser: () => (value: string) => value } };
        const query = new Query<unknown[]>(queryConfig);
        const validateFields = (fields: readonly { dataTypeID: number }[]) => {
          if (fields.length !== plan.columns.length + 1) prepFail('PREP_EXECUTION_FAILED', '$.source', 'Unexpected Redshift result schema');
          fields.forEach(f => redshiftType(f.dataTypeID));
          if (fields.at(-1)?.dataTypeID !== 16) prepFail('PREP_EXECUTION_FAILED', '$.source', 'Unexpected Redshift row guard');
        };
        query.on('error', reject).on('end', result => {
          try { validateFields(result.fields); resolve(); } catch (error) { reject(error); }
        }).on('row', (raw, result) => {
          if (consumerError !== undefined || cancelled) return;
          try {
            check(); validateFields(result?.fields ?? []);
            const guard = raw[plan.columns.length];
            if (++count > limits.maxRows + (limits.allowProbeRow ? 1 : 0) || guard === 't') sink.oversized();
            if (guard !== 'f') prepFail('PREP_EXECUTION_FAILED', '$.source', 'Unexpected Redshift row guard');
            const values = plan.columns.map((c, i) => normalizePrepScalar(raw[i], c));
            if (values.reduce<number>((n, v) => n + String(v ?? '').length, 0) > limits.cellChars) sink.oversized();
            sink.row(values);
          } catch (error) { consumerError = error; void client.end().catch(() => {}); reject(error); }
        });
        client.query(query);
      });
      check();
    })()]);
  } catch (error) {
    if (cancelled || control?.signal?.aborted || error instanceof ExecutionCancelledError) throw new ExecutionCancelledError();
    if (error === consumerError || error instanceof PrepError || error instanceof QueryEngineError) throw error;
    prepFail('PREP_EXECUTION_FAILED', '$.source', 'Redshift connection or source query failed');
  } finally { clearTimeout(timer); control?.signal?.removeEventListener('abort', cancel); await client.end().catch(() => {}); }
}
