import { useEffect, useState } from 'react';
import { ROLES, type Role } from '@opensight/query-engine/browser';
import { allowed, useAccess, type Session } from './access.js';
import type { Invitation, createApiClient } from './api-client.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'listUsers' | 'saveUser' | 'deleteUser' | 'listInvitations' | 'inviteUser' | 'revokeInvitation'>;
const roleLabels: Record<Role, string> = { administrator: 'Administrator', author: 'Author', author_ai: 'Author AI', reader: 'Reader', reader_ai: 'Reader AI' };
function RoleSelect({ value, onChange, disabled, tenant }: { value: Role; onChange: (role: Role) => void; disabled?: boolean; tenant?: boolean }) {
  return <select aria-label="Role" value={value} disabled={disabled} onChange={e => onChange(e.target.value as Role)}>{ROLES.map(role => <option key={role} value={role}>{tenant ? roleLabels[role] : role}</option>)}</select>;
}
export function UserManagement({ client }: { client: Client }) {
  const access = useAccess();
  if (access.mode !== 'hosted' || !allowed(access, 'admin')) return <p role="alert">SECURITY_ADMIN_REQUIRED: Hosted administrator access required.</p>;
  return <Users key={access.session?.tenantId ?? 'local'} client={client} tenant={!!access.session?.tenantId} />;
}
function Users({ client, tenant }: { client: Client; tenant: boolean }) {
  const [users, setUsers] = useState<Session[]>([]), [invitations, setInvitations] = useState<Invitation[]>([]);
  const [id, setId] = useState(''), [name, setName] = useState(''), [role, setRole] = useState<Role>('reader');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [link, setLink] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => { const [users, invites] = await Promise.all([client.listUsers(), client.listInvitations()]); setUsers(users); setInvitations(invites); };
  useEffect(() => {
    let active = true;
    void Promise.all([client.listUsers(), client.listInvitations()]).then(([users, invites]) => { if (active) { setUsers(users); setInvitations(invites); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [client]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); await load(); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="admin-settings" aria-labelledby="users-title"><h1 id="users-title">Users and invitations</h1>
    <p>Manage users in this {tenant ? 'workspace' : 'namespace'}. Administrators configure the system and invite users. Authors build analyses; readers view published dashboards. Administrators and roles ending in _ai can use AI.</p>
    {tenant && <p>Member removal is operator-managed because it requires transferring or stopping the member’s refresh, report and alert schedules. Tenant administrator sessions cannot remove members.</p>}
    <form aria-label="Invite user" onSubmit={e => { e.preventDefault(); setLink(''); void run(async () => {
      const created = await client.inviteUser({ ...(tenant ? { email: id } : { id }), name, role });
      const url = new URL(window.location.href); url.search = ''; url.hash = `invite=${created.token}`;
      setLink(url.href); setId(''); setName('');
    }, 'Invitation created. Share the single-use link with the invited person.'); }}>
      <label>{tenant ? 'Email address' : 'Sign-in user ID'}<input type={tenant ? 'email' : 'text'} required value={id} maxLength={512} pattern={tenant ? undefined : '[A-Za-z0-9_-]+'} onChange={e => setId(e.target.value)} disabled={busy} /></label>
      <label>Display name<input required value={name} maxLength={512} onChange={e => setName(e.target.value)} disabled={busy} /></label>
      <label>Role<RoleSelect value={role} onChange={setRole} disabled={busy} tenant={tenant} /></label><button type="submit" disabled={busy}>Create invitation</button>
    </form>
    {tenant ? <p>Invitations expire after 7 days and are bound to the invited email address. Share the single-use link shown below; an invitation email is also sent. Enrollment currently uses the OpenSight enrollment API.</p>
      : <p>Use the identity supplied by your configured sign-in service. Invitations expire after 7 days. The invited person must sign in as that identity to accept; creating an invitation does not create login credentials or send email.</p>}
    {link && <label>Single-use invitation link<input readOnly value={link} onFocus={e => e.target.select()} /></label>}
    <h2>Users</h2>{tenant ? <ul>{users.map(user => <li key={user.id}>{user.name} · {roleLabels[user.role]}</li>)}</ul>
      : users.map(user => <UserRow key={`${user.id}/${user.role}/${user.name}`} user={user} busy={busy} onSave={value => void run(() => client.saveUser(user.id, value), 'User updated.')} onDelete={() => void run(() => client.deleteUser(user.id), 'User removed.')} />)}
    <h2>Pending invitations</h2>{invitations.length ? <ul>{invitations.map(invite => <li key={invite.id}>{invite.name} ({invite.email ?? invite.id}) · {tenant ? roleLabels[invite.role] : invite.role} · Expires {invite.expiresAt} <button type="button" disabled={busy} onClick={() => void run(async () => { await client.revokeInvitation(invite.id); setLink(''); }, 'Invitation revoked.')}>Revoke {invite.email ?? invite.id}</button></li>)}</ul> : <p>No pending invitations.</p>}
    {busy && <p role="status">Working…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
function UserRow({ user, busy, onSave, onDelete }: { user: Session; busy: boolean; onSave: (value: { name: string; role: Role }) => void; onDelete: () => void }) {
  const [name, setName] = useState(user.name), [role, setRole] = useState(user.role);
  return <form aria-label={`Manage ${user.id}`} onSubmit={e => { e.preventDefault(); onSave({ name, role }); }}>
    <strong>{user.id}</strong><label>Display name<input required value={name} maxLength={512} disabled={busy} onChange={e => setName(e.target.value)} /></label><label>Role<RoleSelect value={role} onChange={setRole} disabled={busy} /></label>
    <button type="submit" disabled={busy}>Save {user.id}</button><button type="button" disabled={busy} onClick={onDelete}>Remove {user.id}</button>
  </form>;
}
export function AcceptInvitation({ token, client, onAccepted }: { token: string; client: Pick<ReturnType<typeof createApiClient>, 'acceptInvitation'>; onAccepted: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <section className="admin-settings"><h1>Accept invitation</h1><p>Sign in through your configured authentication service as the invited user, then accept this invitation.</p>
    <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(''); void client.acceptInvitation(token).then(onAccepted).catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}>Accept invitation</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
