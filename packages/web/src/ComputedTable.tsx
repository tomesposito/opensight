import { useEffect, useRef, useState } from 'react';
import type { createApiClient, ExecutionStatus, PreparedRows } from './api-client.js';
import { DataTable } from './DataSectionUI.js';
import { prepMessage } from './data-prep.js';
export type ComputedClient = Partial<Pick<ReturnType<typeof createApiClient>, 'getDatasetExecution' | 'getPreparedRows' | 'publishStoredTable' | 'refreshBlaze' | 'downloadStoredTable'>>;
export const computedStateLabel = (status: ExecutionStatus) => status.state === 'refresh-failed' ? 'refresh failed' : status.state === 'empty' ? 'not published' : status.state;
export function ComputedTable({ client, datasetId, name, status: initialStatus, compact = false, dirty = false, onChanged }: {
  client?: ComputedClient; datasetId: string; name: string; status: ExecutionStatus; compact?: boolean; dirty?: boolean; onChanged?: () => void;
}) {
  const [status, setStatus] = useState(initialStatus), [rows, setRows] = useState<PreparedRows>(), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [showRows, setShowRows] = useState(!compact), [revision, setRevision] = useState(0);
  const active = useRef(true), acting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);
  useEffect(() => {
    let current = true; setRows(undefined);
    if (showRows && status.lastRefreshedAt && client?.getPreparedRows) void client.getPreparedRows(datasetId).then(value => { if (current) setRows(value); }).catch(e => { if (current) setError(prepMessage(e)); });
    return () => { current = false; };
  }, [client, datasetId, showRows, status.lastRefreshedAt, revision]);
  const run = async (work: () => Promise<ExecutionStatus | void>) => {
    if (acting.current) return; acting.current = true; setBusy(true); setError('');
    try {
      const next = await work(); if (!active.current) return;
      if (next) { setStatus(next); setRevision(n => n + 1); onChanged?.(); }
    } catch (e) {
      if (!active.current) return; setError(prepMessage(e));
      if (client?.getDatasetExecution) try { const next = await client.getDatasetExecution(datasetId); if (active.current) { setStatus(next); onChanged?.(); } } catch { /* Keep the named action error. */ }
    } finally { if (active.current) { setBusy(false); acting.current = false; } }
  };
  const download = (format: 'csv' | 'xlsx') => run(async () => {
    const blob = await client!.downloadStoredTable!(datasetId, format);
    if (!active.current) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `${datasetId}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const published = !!status.lastRefreshedAt;
  return <section className="computed-table" aria-label={`Computed table ${name}`}>
    <div className="data-toolbar"><div><h2>{compact ? 'Stored table' : name}</h2><span className="data-badge">computed</span> <span className={`computed-state ${status.state}`}>{computedStateLabel(status)}</span></div>
      <div className="computed-actions">{published ? <>
        {status.downloadsEnabled !== false && client?.downloadStoredTable && <><button disabled={busy} onClick={() => void download('csv')}>Download CSV</button><button disabled={busy} onClick={() => void download('xlsx')}>Download XLSX</button></>}
        <button disabled={!client?.refreshBlaze || busy || dirty} onClick={() => void run(() => client!.refreshBlaze!(datasetId))}>Refresh</button>
      </> : <button className="data-primary" disabled={!client?.publishStoredTable || busy || dirty} onClick={() => void run(() => client!.publishStoredTable!(datasetId))}>Publish</button>}
      {compact && published && <button onClick={() => setShowRows(value => !value)}>{showRows ? 'Hide stored table' : 'View stored table'}</button>}</div>
    </div>
    <p className="data-note">{status.rowCount ?? 0} rows · {status.bytes ?? 0} bytes{status.lastRefreshedAt && <> · Last refreshed <time dateTime={status.lastRefreshedAt}>{status.lastRefreshedAt}</time></>}{dirty && ' · Save pipeline changes before publishing or refreshing.'}</p>
    {status.state === 'stale' && <p>Inputs changed. Stored rows remain available until you refresh.</p>}
    {status.error && <p role="status">{status.error.code}: {status.error.message}{status.failedAt && <> · Failed <time dateTime={status.failedAt}>{status.failedAt}</time></>}</p>}
    {error && <p role="alert">{error}</p>}
    {!client && <p>Needs a local or hosted API.</p>}
    {showRows && published && (rows ? <><p>{rows.rowCount} stored rows · {rows.rows.length} shown</p><DataTable headings={rows.columns.map(c => c.name)}>{rows.rows.map((row, i) => <tr key={i}>{rows.columns.map(column => <td key={column.name}>{row[column.name] === null ? 'null' : String(row[column.name])}</td>)}</tr>)}</DataTable></> : !error && <p role="status">Loading stored rows…</p>)}
  </section>;
}
