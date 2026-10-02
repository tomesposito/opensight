import { useEffect, useState } from 'react';
import { allowed, useAccess } from './access.js';
import type { createApiClient, TenantJob, JobHistory, JobDelivery } from './api-client.js';
type Client = Pick<ReturnType<typeof createApiClient>, 'listJobs' | 'jobRecipients' | 'jobHistory' | 'jobDeliveries' | 'runJob'>;
export function JobManagement({ client }: { client: Client }) {
  const access = useAccess(), canBuild = allowed(access, 'build');
  const [jobs, setJobs] = useState<TenantJob[]>([]), [recipients, setRecipients] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selected, setSelected] = useState(''), [runs, setRuns] = useState<JobHistory[]>([]), [deliveries, setDeliveries] = useState<JobDelivery[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async () => { setJobs(await client.listJobs()); if (canBuild) setRecipients(await client.jobRecipients()); };
  useEffect(() => { let active = true; setLoading(true); void Promise.all([client.listJobs(), canBuild ? client.jobRecipients() : Promise.resolve([])]).then(([jobs, recipients]) => { if (active) { setJobs(jobs); setRecipients(recipients); } }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [client, canBuild]);
  const inspect = async (id: string) => { setSelected(id); setRuns([]); setDeliveries([]); const [runs, deliveries] = await Promise.all([client.jobHistory(id), client.jobDeliveries(id)]); setRuns(runs); setDeliveries(deliveries); };
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <section className="job-management" aria-labelledby="jobs-title"><h1 id="jobs-title">Schedules, reports & alerts</h1>
    <p>Jobs run as their owner. Reports and alerts use each recipient's current data permissions. Mail delivery retries can produce duplicate email.</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => { await load(); if (selected) await inspect(selected); })}>Refresh jobs and history</button>
    <table><thead><tr><th>Job</th><th>Kind</th><th>Owner</th><th>Status</th><th>Next run</th><th>Actions</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}>
      <td>{job.id}</td><td>{job.spec.kind}</td><td>{job.ownerId}</td><td>{job.stopped ? 'Stopped' : job.spec.enabled ? 'Enabled' : 'Disabled'}</td><td>{job.nextRun ?? (job.spec.kind === 'alert' ? 'After refresh' : '—')}</td>
      <td><button disabled={busy} type="button" onClick={() => void run(() => inspect(job.id))}>History {job.id}</button>{job.spec.kind !== 'alert' && !job.stopped && job.spec.enabled && <button disabled={busy} type="button" onClick={() => void run(async () => { await client.runJob(job.id); await inspect(job.id); })}>Run {job.id}</button>}</td>
    </tr>)}</tbody></table>{!loading && !error && !jobs.length && <p>No jobs are visible to your account. Create schedules through the hosted jobs API.</p>}
    {canBuild && <><h2>Tenant recipients</h2><ul>{recipients.map(user => <li key={user.id}>{user.name} · {user.email}</li>)}</ul></>}
    {selected && <><h2>History · {selected}</h2><table><thead><tr><th>Occurrence</th><th>State</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.state}</td><td>{r.createdAt}</td><td>{r.finishedAt ?? '—'}</td><td>{r.errorCode ?? '—'}</td></tr>)}</tbody></table>
      <h3>Deliveries</h3><table><thead><tr><th>Recipient</th><th>State</th><th>Attempts</th><th>Error</th></tr></thead><tbody>{deliveries.map(d => <tr key={d.delivery_id}><td>{recipients.find(r => r.id === d.recipient_id)?.name ?? d.recipient_id}</td><td>{d.state}</td><td>{d.attempts}</td><td>{d.error_code ?? '—'}</td></tr>)}</tbody></table></>}
    {(loading || busy) && <p role="status">Loading…</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
