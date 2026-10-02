import { useState } from 'react';

export interface RemovalPreview { userId: string; preview: string; status: string; jobs: { id: string; kind: string; enabled: boolean }[]; candidates: { id: string; name: string }[] }
interface OperatorUser { id: string; name: string; role: string; status: string }
export interface RemovalChoice { action: 'stop' | 'transfer'; preview: string; transferTo?: string }
export function RemovalPrompt({ preview, busy, onCancel, onRemove }: { preview: RemovalPreview; busy: boolean; onCancel: () => void; onRemove: (choice: RemovalChoice) => void }) {
  const [action, setAction] = useState<'' | 'stop' | 'transfer'>(''), [target, setTarget] = useState('');
  return <section role="dialog" aria-labelledby="remove-user-title" className="automation-notice">
    <h2 id="remove-user-title">Remove user {preview.userId}</h2>
    <p>This user owns {preview.jobs.length} refresh, report or alert schedules. Choose what happens to their schedules before removing access. Work already queued or running will be cancelled.</p>
    {preview.jobs.length > 0 && <ul>{preview.jobs.map(job => <li key={job.id}>{job.kind} · {job.id} · {job.enabled ? 'Enabled' : 'Disabled'}</li>)}</ul>}
    <fieldset disabled={busy}><legend>Owned schedules</legend>
      <label><input type="radio" name="job-disposition" checked={action === 'transfer'} onChange={() => setAction('transfer')} disabled={!preview.candidates.length} />Transfer schedules to another user</label>
      {action === 'transfer' && <label>New schedule owner<select aria-label="New schedule owner" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose a user</option>{preview.candidates.map(user => <option key={user.id} value={user.id}>{user.name} ({user.id})</option>)}</select></label>}
      <label><input type="radio" name="job-disposition" checked={action === 'stop'} onChange={() => setAction('stop')} />Stop schedules</label>
    </fieldset>
    <p>Transfer keeps the existing targets and recipients. The new owner must have access; private sources and prepared datasets stay with their current owner.</p>
    <button type="button" disabled={busy || !action || action === 'transfer' && !target} onClick={() => { if (action) onRemove({ action, preview: preview.preview, ...(action === 'transfer' ? { transferTo: target } : {}) }); }}>Remove user and {action === 'transfer' ? 'transfer' : 'stop'} schedules</button>
    <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
  </section>;
}
/** Separate operator plane. Credentials live only in this component's memory. */
export function OperatorUsers({ baseUrl = '/api', fetcher = fetch }: { baseUrl?: string; fetcher?: typeof fetch }) {
  const [tenant, setTenant] = useState(''), [key, setKey] = useState('');
  const [connection, setConnection] = useState<{ tenant: string; key: string }>();
  const [users, setUsers] = useState<OperatorUser[]>([]), [preview, setPreview] = useState<RemovalPreview>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const request = async <T,>(conn: { tenant: string; key: string }, suffix = '', method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/api/host/tenants/${encodeURIComponent(conn.tenant)}/users${suffix}`, { method, credentials: 'omit', headers: { Authorization: `Operator ${conn.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json() as T & { errorCode?: string };
    if (!response.ok) throw new Error(result.errorCode ?? 'Request failed'); return result;
  };
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); } };
  return <main className="admin-settings"><h1>Operator · User removal</h1><p>Manage membership in one tenant. Transfer or stop a user's schedules when removing access.</p>
    <form aria-label="Operator connection" onSubmit={e => { e.preventDefault(); void run(async () => { const conn = { tenant, key }; const users = await request<OperatorUser[]>(conn); setConnection(conn); setUsers(users); setPreview(undefined); setKey(''); }); }}>
      <label>Tenant ID<input required value={tenant} onChange={e => setTenant(e.target.value)} disabled={busy} /></label>
      <label>Operator credential<input type="password" required autoComplete="off" value={key} onChange={e => setKey(e.target.value)} disabled={busy} /></label>
      <button disabled={busy} type="submit">Load tenant users</button>
    </form>
    {connection && <><p>Connected to tenant {connection.tenant}. The credential is held in memory until this page closes.</p>
      <button type="button" disabled={busy} onClick={() => { setConnection(undefined); setUsers([]); setPreview(undefined); setMessage('Disconnected.'); }}>Disconnect</button>
      <ul>{users.map(user => <li key={user.id}>{user.name} · {user.role} · {user.status} <button type="button" disabled={busy} onClick={() => void run(async () => setPreview(await request<RemovalPreview>(connection, `/${encodeURIComponent(user.id)}`)))}>Remove {user.name}</button></li>)}</ul>
      {preview && <RemovalPrompt key={preview.preview} preview={preview} busy={busy} onCancel={() => setPreview(undefined)} onRemove={choice => void run(async () => {
        await request(connection, `/${encodeURIComponent(preview.userId)}`, 'DELETE', { jobs: choice });
        setPreview(undefined); setUsers(await request<OperatorUser[]>(connection)); setMessage(choice.action === 'transfer' ? 'User removed. Schedules transferred; unfinished work cancelled.' : 'User removed. Schedules stopped; unfinished work cancelled.');
      })} />}
    </>}
    {busy && <p role="status">Working…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}{error === 'JOB_DISPOSITION_STALE' ? ': Cancel and reopen removal to review the changed schedules.' : ''}</p>}
  </main>;
}
