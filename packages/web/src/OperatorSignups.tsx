import { useState } from 'react';
import { OperatorFrame, operatorRequest, useOperatorWork, type OperatorProps, tiers, titleCase } from './operator-provisioning.js';
interface PaidQueueEntry { id: string; tenantId: string; displayName: string | null; tier: 'light' | 'regular' | 'heavy'; requestedByEmail: string; createdAt: string; state: 'pending' }
interface SignupStatus { billingMode: 'checkout' | 'waitlist'; paidRequests: PaidQueueEntry[]; paidRequestsOpen: number; enabled: boolean; paused: boolean; volumeCap: number; trialsToday: number; trialsLast24h: number; convertedToday: number; expiredToday: number; queued: number; pausedAtCap: boolean; retentionDue: { tenantId: string; displayName: string | null; retentionDueAt: string }[] }
export function OperatorSignups(props: OperatorProps) {
  const [key, setKey] = useState<string>(), [status, setStatus] = useState<SignupStatus>(); const work = useOperatorWork();
  const load = async (credential: string) => { setStatus(await operatorRequest(props, credential)<SignupStatus>('signups')); setKey(credential); };
  return <OperatorFrame title="Signups" current="signups" work={work} connected={key !== undefined} connect={load} disconnect={() => { setKey(undefined); setStatus(undefined); }}>
    {status && <><h1>Signups</h1><section className="operator-card"><h2>Trial activity</h2>
      <p>{status.enabled ? 'Deployment signup enabled' : 'Deployment signup disabled — routes return 404'} · Billing mode: <strong>{status.billingMode === 'waitlist' ? 'waiting list' : 'checkout'}</strong>{status.billingMode === 'waitlist' && ' (Stripe not configured)'}</p>
      <dl><dt>Trials started today (UTC)</dt><dd>{status.trialsToday}</dd><dt>Trials started in the last 24 hours</dt><dd>{status.trialsLast24h} / {status.volumeCap}</dd><dt>Converted today</dt><dd>{status.convertedToday}</dd><dt>Expired today</dt><dd>{status.expiredToday}</dd><dt>Verified and queued</dt><dd>{status.queued}</dd><dt>Paid requests open</dt><dd>{status.paidRequestsOpen ?? 0}</dd></dl>
      <p>{status.paused ? 'New trials paused by operator' : status.pausedAtCap ? 'Paused at volume cap — verified signups remain queued' : 'Capacity available'}</p>
      <button disabled={work.busy} onClick={() => void work.run(async () => { setStatus(await operatorRequest(props, key!)<SignupStatus>('signups', 'PATCH', { paused: !status.paused })); })}>{status.paused ? 'Resume signups' : 'Pause signups'}</button>
      <button disabled={work.busy} onClick={() => void work.run(() => load(key!))}>Refresh</button><p>Existing trials and paid workspaces are unaffected. Resuming does not change the deployment switch.</p>
    </section><section className="operator-card"><h2>Paid requests</h2>
      {status.paidRequests?.length ? <div className="operator-table-wrap"><table className="operator-table"><thead><tr><th>Workspace</th><th>Plan</th><th>Requested by</th><th>Requested</th><th>State</th><th>Actions</th></tr></thead>
        <tbody>{status.paidRequests.map(request => <tr key={request.id}>
          <td><a href={`#operator-tenant/${request.tenantId}`}>{request.displayName ?? request.tenantId}</a></td><td>{tiers[request.tier]}</td>
          <td>{request.requestedByEmail}</td><td>{new Date(request.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td><td>{request.state}</td>
          <td><button className="operator-primary" disabled={work.busy} onClick={() => void work.run(async () => {
            await operatorRequest(props, key!)(`tenants/${request.tenantId}/billing/paid-request/grant`, 'POST', { requestId: request.id }); await load(key!);
          })}>Grant {titleCase(request.tier)} (manual)</button><button disabled={work.busy} onClick={() => void work.run(async () => {
            await operatorRequest(props, key!)(`tenants/${request.tenantId}/billing/paid-request/decline`, 'POST', { requestId: request.id }); await load(key!);
          })}>Decline request</button></td>
        </tr>)}</tbody></table></div> : <p>No pending paid requests.</p>}
      <p>Granting sets the tier and restores access immediately. No payment is taken and no subscription is created; the grant is recorded in the operator audit log.</p>
    </section><section className="operator-card"><h2>Retention due</h2>{status.retentionDue.length ? <ul>{status.retentionDue.map(tenant => <li key={tenant.tenantId}><a href={`#operator-tenant/${tenant.tenantId}`}>{tenant.displayName ?? tenant.tenantId}</a> · {new Date(tenant.retentionDueAt).toLocaleDateString('en-US', { timeZone: 'UTC' })} · <a href={`#operator-tenant/${tenant.tenantId}`}>Review erasure</a></li>)}</ul> : <p>No paused workspaces are past their retention date.</p>}<p>Workspaces with an open paid request are held off this list while they wait.</p></section></>}
  </OperatorFrame>;
}
