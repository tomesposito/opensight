import { useEffect, useRef, useState } from 'react';
import type { createApiClient, ExecutionStatus, ExecutionSettings, ExecutionProvenance, PreparedRows } from './api-client.js';
export type ExecutionClient = Pick<ReturnType<typeof createApiClient>, 'getDatasetExecution' | 'setDatasetExecution' | 'refreshBlaze' | 'getPreparedRows'>;
const message = (e: unknown) => e instanceof Error ? e.message : 'Execution information unavailable';
export function CachedProvenance({ execution }: { execution: ExecutionProvenance }) {
  return <span>{execution.cached ? <>Cached · refreshed <time dateTime={execution.refreshedAt!}>{execution.refreshedAt}</time></> : execution.cachedInputs.length ? 'Direct query · includes cached inputs' : 'Direct query · live source'}{execution.cachedInputs.map(input => <span key={`${input.datasetId}:${input.refreshedAt}`}><br />Cached input {input.datasetId} · <time dateTime={input.refreshedAt}>{input.refreshedAt}</time></span>)}</span>;
}
export function ExecutionBadge({ status }: { status?: ExecutionStatus }) {
  return <span className="dataset-badge" data-mode={status?.mode === 'BLAZE' ? 'blaze' : 'direct'}>{status?.mode === 'BLAZE' ? 'BLAZE' : 'DIRECT QUERY'}</span>;
}
/** Status is scoped to the current client/dataset; late requests cannot relabel another dataset. */
export function DatasetExecution({ client, datasetId, saved = true, dirty = false, onChanged, compact = false }: { client?: ExecutionClient; datasetId: string; saved?: boolean; dirty?: boolean; onChanged?: () => void; compact?: boolean }) {
  const [result, setResult] = useState<{ key: string; client: ExecutionClient; status?: ExecutionStatus; error?: string }>();
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const [interval, setIntervalValue] = useState('');
  const [output, setOutput] = useState<PreparedRows>();
  const generation = useRef(0), requestVersion = useRef(0), acting = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setOutput(undefined); setActionError(''); setBusy(false); acting.current = false;
    if (!client || !saved) return;
    let pending = false;
    const read = async () => {
      if (pending || acting.current) return; pending = true;
      const version = ++requestVersion.current;
      try { const status = await client.getDatasetExecution(datasetId); if (generation.current === current && version === requestVersion.current) { setResult({ key: datasetId, client, status }); setOutput(old => old?.execution.refreshedAt !== status.lastRefreshedAt || status.state !== 'ready' ? undefined : old); } }
      catch (e) { if (generation.current === current && version === requestVersion.current) setResult({ key: datasetId, client, error: message(e) }); }
      finally { pending = false; }
    };
    void read(); const timer = setInterval(() => void read(), 5000);
    return () => { generation.current++; clearInterval(timer); };
  }, [client, datasetId, saved]);
  const current = result?.key === datasetId && result.client === client && saved ? result : undefined, status = current?.status;
  useEffect(() => setIntervalValue(status?.intervalMinutes?.toString() ?? ''), [status?.intervalMinutes, datasetId]);
  const action = async (run: () => Promise<ExecutionStatus | PreparedRows>) => {
    const currentGeneration = generation.current;
    acting.current = true; requestVersion.current++;
    setBusy(true); setActionError(''); setOutput(undefined);
    try {
      const next = await run(); if (generation.current !== currentGeneration) return;
      if ('execution' in next) setOutput(next);
      else { setResult({ key: datasetId, client: client!, status: next }); onChanged?.(); }
    } catch (e) {
      if (generation.current !== currentGeneration) return;
      setActionError(message(e));
      try { const status = await client!.getDatasetExecution(datasetId); if (generation.current === currentGeneration) setResult({ key: datasetId, client: client!, status }); } catch { /* Keep the visible named action failure. */ }
    } finally { if (generation.current === currentGeneration) { setBusy(false); acting.current = false; } }
  };
  const disabled = !client || !saved || dirty || busy || !status;
  const select = (mode: ExecutionSettings['mode']) => { if (!client || disabled) return; void action(() => client.setDatasetExecution(datasetId, { mode, intervalMinutes: mode === 'DIRECT_QUERY' ? null : status!.intervalMinutes })); };
  return <section className={`dataset-execution${compact ? ' compact' : ''}`} aria-label="Dataset execution">
    <div className="execution-controls"><label>Execution mode<select aria-label="Execution mode" disabled={disabled} value={status?.mode ?? 'DIRECT_QUERY'} onChange={e => select(e.target.value as ExecutionSettings['mode'])}><option value="DIRECT_QUERY">DIRECT QUERY</option><option value="BLAZE">BLAZE</option></select></label>
      <button disabled={disabled || status?.mode !== 'BLAZE'} onClick={() => void action(() => client!.refreshBlaze(datasetId))}>{busy ? 'Working…' : 'Refresh Blaze'}</button>
      {!compact && <form onSubmit={e => { e.preventDefault(); if (!disabled && status?.mode === 'BLAZE') void action(() => client!.setDatasetExecution(datasetId, { mode: 'BLAZE', intervalMinutes: interval === '' ? null : Number(interval) })); }}><label>Refresh interval (minutes)<input aria-label="Refresh interval (minutes)" type="number" min="1" max="525600" placeholder="Manual only" disabled={disabled || status?.mode !== 'BLAZE'} value={interval} onChange={e => setIntervalValue(e.target.value)} /></label><button disabled={disabled || status?.mode !== 'BLAZE'}>Apply schedule</button></form>}
      {!compact && <button disabled={disabled || status?.mode !== 'BLAZE' || status.state !== 'ready'} onClick={() => void action(() => client!.getPreparedRows(datasetId))}>View cached output</button>}
    </div>
    <p className="execution-status" role="status">{!client ? 'Needs hosted API · Blaze materialization and refresh are unavailable in the offline demo.' : !saved ? 'Save the pipeline to configure dataset execution.' : current?.error ? current.error : !status ? 'Loading execution status…' : <><ExecutionBadge status={status} /> {status.mode === 'DIRECT_QUERY' ? 'Queries execute the saved pipeline.' : <>Cached data · {status.state}{status.rowCount !== null ? ` · ${status.rowCount} rows` : ' · no readable snapshot'}<br />{status.lastRefreshedAt ? <>Last successful refresh: <time dateTime={status.lastRefreshedAt}>{status.lastRefreshedAt}</time></> : 'No successful refresh recorded'}{status.nextRefreshAt && <><br />Next refresh: <time dateTime={status.nextRefreshAt}>{status.nextRefreshAt}</time></>}</>}{status.error && <><br />{status.error.code}{status.error.causeCode ? ` (${status.error.causeCode})` : ''}: {status.error.message}</>}</>}{client && saved && dirty && <><br />Save pipeline changes before changing execution or refreshing.</>}</p>
    {actionError && <p className="prep-error" role="alert">{actionError}</p>}
    {output && !dirty && <div className="cached-output"><p><CachedProvenance execution={output.execution} /><br />{output.rowCount} cached rows · {output.rows.length} shown</p><div className="prep-table-scroll"><table><thead><tr>{output.columns.map(c => <th key={c.name}>{c.name}</th>)}</tr></thead><tbody>{output.rows.map((r,i) => <tr key={i}>{output.columns.map(c => <td key={c.name}>{r[c.name] === null ? <em>null</em> : String(r[c.name])}</td>)}</tr>)}</tbody></table></div></div>}
  </section>;
}
