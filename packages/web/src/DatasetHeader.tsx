import { useEffect, useState } from 'react';
import type { QueryClient } from './author-query.js';
import type { DatasetRefreshStatus } from './api-client.js';
import sales from './sales.generated.json' with { type: 'json' };

type Result<T> = { client: QueryClient; value?: T; error?: string };

/** Metadata describes the local dataset, independently of the selected visual's filters. */
export function DatasetHeader({ client }: { client?: QueryClient }) {
  const [count, setCount] = useState<Result<number>>();
  const [refresh, setRefresh] = useState<Result<DatasetRefreshStatus>>();
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController(), { signal } = controller;
    // order_id is the non-null key of the local sales dataset. Use the same
    // secured query route as visuals, so denied metadata never falls back to samples.
    void (async () => {
      try {
        const result = await client.queryDataset('sales', { dimensions: [], measures: [{ fieldId: 'row_count', columnName: 'order_id', aggregation: 'COUNT' }], filters: [] }, signal);
        const value = result.rows[0]?.row_count;
        if (result.rows.length !== 1 || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid dataset row count.');
        if (!signal.aborted) setCount({ client, value });
      } catch { if (!signal.aborted) setCount({ client, error: 'Row count unavailable' }); }
    })();
    if (client.getDatasetRefreshStatus) void (async () => {
      try {
        const value = await client.getDatasetRefreshStatus!('sales', signal);
        if (!signal.aborted) setRefresh({ client, value });
      } catch { if (!signal.aborted) setRefresh({ client, error: 'Refresh info unavailable from hosted API' }); }
    })();
    return () => controller.abort();
  }, [client]);
  const currentCount = count?.client === client ? count : undefined;
  const currentRefresh = refresh?.client === client ? refresh : undefined;
  const status = currentRefresh?.value;
  const rows = !client ? `${sales.rows.length} sample rows · offline demo` : currentCount?.value !== undefined ? `${currentCount.value} rows · live query` : currentCount?.error ?? 'Loading row count…';
  return <section className="dataset-header" aria-label="Dataset metadata">
    <span className="dataset-label">Dataset</span>
    <strong className="dataset-name">Local sales dataset</strong>
    <span className="dataset-badge" data-mode={client ? 'direct' : 'spice'} title={client ? 'Queries the hosted API' : 'Local in-memory sample import · offline demo'}>{client ? 'DIRECT QUERY' : 'SPICE'}</span>
    <p className="dataset-metadata" role="status">{rows}<br />
      {!client || !client.getDatasetRefreshStatus ? 'Refresh info needs hosted API' : currentRefresh?.error ?? (status ? <>
        {status.lastGood ? <>Last successful refresh: <time dateTime={status.lastGood}>{status.lastGood.slice(0, 19).replace('T', ' ')} UTC</time></> : 'No successful refresh recorded'}
        {status.state === 'running' && <><br />Refresh running</>}
        {status.state === 'error' && <><br />Refresh failed: {status.error?.code}</>}
      </> : 'Loading refresh info…')}
    </p>
  </section>;
}
