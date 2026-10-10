import { useEffect, useRef, useState } from 'react';
import type { createApiClient, ExecutionStatus } from './api-client.js';
import { prepMessage } from './data-prep.js';
import { DataDialog, DataTable } from './DataSectionUI.js';
export type RefreshClient = Pick<ReturnType<typeof createApiClient>, 'getDatasetExecution' | 'setDatasetExecution' | 'refreshBlaze'>;

export function DatasetRefresh({ datasetId, client, onChanged }: { datasetId: string; client?: RefreshClient; onChanged?: (status: ExecutionStatus) => void }) {
  const [result, setResult] = useState<{ client: RefreshClient; id: string; status?: ExecutionStatus; error?: string }>();
  const [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [interval, setIntervalValue] = useState('60');
  const [editingVersion, setEditingVersion] = useState<number>();
  const generation = useRef(0), version = useRef(0), acting = useRef(false);
  useEffect(() => {
    const current = ++generation.current; acting.current = false; setBusy(false); setEditing(false); setActionError('');
    if (!client) return;
    let pending = false;
    const read = async () => {
      if (acting.current || pending) return; pending = true; const request = ++version.current;
      try { const status = await client.getDatasetExecution(datasetId); if (generation.current === current && request === version.current) setResult({ client, id: datasetId, status }); }
      catch (error) { if (generation.current === current && request === version.current) setResult({ client, id: datasetId, error: prepMessage(error) }); }
      finally { pending = false; }
    };
    void read(); const timer = setInterval(() => void read(), 5000);
    return () => { generation.current++; clearInterval(timer); };
  }, [client, datasetId]);
  const current = result?.client === client && result?.id === datasetId ? result : undefined, status = current?.status;
  const enabled = !!client && !!status && status.mode === 'BLAZE' && status.state !== 'running' && !busy;
  const action = async (run: () => Promise<ExecutionStatus>) => {
    if (!enabled || acting.current) return;
    acting.current = true; version.current++; const currentGeneration = generation.current; setBusy(true); setActionError('');
    try { const next = await run(); if (generation.current === currentGeneration) { setResult({ client: client!, id: datasetId, status: next }); setEditing(false); onChanged?.(next); } }
    catch (error) { if (generation.current === currentGeneration) setActionError(prepMessage(error)); }
    finally { if (generation.current === currentGeneration) { acting.current = false; setBusy(false); } }
  };
  const configure = (minutes: number | null) => {
    const expectedVersion = editing ? editingVersion : status?.version;
    if (client) void action(() => client.setDatasetExecution(datasetId, { mode: 'BLAZE', intervalMinutes: minutes, ...(expectedVersion === undefined ? {} : { expectedVersion }) }));
  };
  const editSchedule = (minutes: string) => { setIntervalValue(minutes); setEditingVersion(status?.version); setEditing(true); };
  const intervalValid = Number.isInteger(Number(interval)) && Number(interval) >= 1 && Number(interval) <= 525600;
  return <div className="data-refresh">
    <div className="data-tools"><span role="status">{!client ? 'Needs local or hosted API.' : current?.error ? current.error : !status ? 'Loading refresh status…' : status.mode === 'DIRECT_QUERY' ? 'Direct query · Enable Blaze in Summary to cache and schedule refreshes.' : status.state === 'unknown' ? 'Blaze · Cache status is not supplied by the hosted API.' : `Blaze · ${status.state}`}</span><button className="data-reload" disabled={!enabled || !!status?.intervalMinutes} onClick={() => { editSchedule('60'); }}>Add new schedule</button><button className="data-primary" disabled={!enabled} onClick={() => { if (client) void action(() => client.refreshBlaze(datasetId)); }}>Refresh now</button></div>
    {actionError && <p role="alert">{actionError}</p>}{status?.error && <p role="alert">{status.error.code}: {status.error.message}</p>}
    <label className="data-email"><input type="checkbox" checked={false} disabled aria-describedby="refresh-email-note" /> Email owners when a refresh fails</label><p className="data-note" id="refresh-email-note">Failure emails need a hosted notification API for prepared datasets.</p>
    <section className="data-card"><h2>Schedules</h2><DataTable headings={['Refresh type', 'Occurrence', 'Start time', 'Timezone', 'Actions']} empty={!status?.intervalMinutes ? current?.error ? 'Schedules could not be loaded.' : !status ? 'Schedules unavailable.' : 'No schedules.' : undefined}>
      {!!status?.intervalMinutes && <tr><td>Full refresh</td><td>Every {status.intervalMinutes} minutes</td><td>Not supplied by API</td><td>UTC</td><td><button disabled={!enabled} onClick={() => { editSchedule(String(status.intervalMinutes)); }}>Edit</button> <button disabled={!enabled} onClick={() => configure(null)}>Remove</button></td></tr>}
    </DataTable>{status?.nextRefreshAt && <p>Next refresh: <time dateTime={status.nextRefreshAt}>{status.nextRefreshAt}</time></p>}<p className="data-note">One interval schedule per dataset. The API schedules full refreshes in UTC.</p></section>
    <section className="data-card"><div className="data-toolbar"><h2>History</h2><div className="data-tools"><label>Show times within <select aria-label="Refresh history time range" disabled defaultValue="90"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><label>with status of <select aria-label="Refresh history status" disabled defaultValue="all"><option value="all">All</option><option>Completed</option><option>Failed</option></select></label></div></div>
      <DataTable headings={['Refresh start', 'Status', 'Duration', 'Skipped rows', 'Ingested rows', 'Dataset rows', 'Refresh type']} empty="Refresh history is not supplied by the prepared dataset API." />
      {status?.lastRefreshedAt && <p>Last successful refresh: <time dateTime={status.lastRefreshedAt}>{status.lastRefreshedAt}</time>{status.rowCount !== null && ` · ${status.rowCount.toLocaleString()} dataset rows`}. Run duration and skipped rows are not available.</p>}
    </section>
    {editing && <DataDialog title="Refresh schedule" description="Schedule a full Blaze refresh at a regular interval." onClose={() => { if (!busy) setEditing(false); }}><form onSubmit={event => { event.preventDefault(); if (intervalValid) configure(Number(interval)); }}><div className="data-dialog-body"><label>Occurrence (minutes)<input aria-label="Occurrence (minutes)" type="number" min="1" max="525600" required value={interval} onChange={event => setIntervalValue(event.target.value)} disabled={busy} /></label><p>Timezone: UTC</p>{actionError && <p role="alert">{actionError}</p>}</div><footer><button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="data-primary" disabled={!enabled || !intervalValid}>Save schedule</button></footer></form></DataDialog>}
  </div>;
}
