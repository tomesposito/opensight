import { useState } from 'react';
import { erasureNote, OperatorError, OperatorFrame, operatorRequest, PaymentLink, StateChip, tiers, titleCase, useOperatorWork,
  type Billing, type OperatorMember, type OperatorProps, type OperatorRequest, type TenantDetail, type Tier, type UsageOverview } from './operator-provisioning.js';

interface DetailView { tenant: TenantDetail; billing?: Billing; billingError?: string; billingMissing: boolean; users?: OperatorMember[]; peopleError?: string; usage?: UsageOverview | null; usageError?: string }
async function readView(request: OperatorRequest, path: string, tenantId: string): Promise<DetailView> {
  const tenant = await request<TenantDetail>(path);
  if (tenant.state === 'deleted' || tenant.state === 'deleting') return { tenant, billingMissing: false };
  const period = new Date().toISOString().slice(0, 7);
  const [billing, people, usage] = await Promise.allSettled([
    request<{ billing: Billing }>(`${path}/billing`), request<OperatorMember[]>(`${path}/users`), request<{ overview: UsageOverview | null }>(`usage/${period}/tenants/${tenantId}`),
  ]);
  for (const result of [billing, people, usage]) if (result.status === 'rejected' && result.reason instanceof OperatorError && result.reason.code === 'OPERATOR_REQUIRED') throw result.reason;
  const error = (reason: unknown) => reason instanceof Error ? reason.message : 'Request failed';
  return { tenant,
    ...(billing.status === 'fulfilled' ? { billing: billing.value.billing } : { billingError: error(billing.reason) }),
    billingMissing: billing.status === 'rejected' && billing.reason instanceof OperatorError && billing.reason.status === 404,
    ...(people.status === 'fulfilled' ? { users: people.value } : { peopleError: error(people.reason) }),
    ...(usage.status === 'fulfilled' ? { usage: usage.value.overview } : { usageError: error(usage.reason) }),
  };
}
function UsageStrip({ usage }: { usage: UsageOverview }) {
  const number = (value: number) => value.toLocaleString('en-US');
  const bytes = (value: number) => value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(1)} GB` : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${number(value)} B`;
  const metrics = [
    { name: 'API calls', used: usage.apiCalls, cap: usage.quotas.apiCalls, period: usage.day, format: number },
    { name: 'Queries', used: usage.queries, cap: usage.quotas.queries, period: usage.day, format: number },
    { name: 'Storage', used: usage.storageBytes, cap: usage.quotas.storageBytes, period: 'Current', format: bytes },
    { name: 'NLQ', used: usage.nlq, cap: usage.quotas.nlq, period: usage.period, format: number },
  ];
  return <div className="operator-usage" aria-label="Tenant usage">{metrics.map(metric => <div key={metric.name}>
    <strong>{metric.format(metric.used)}</strong> / {metric.cap === null ? 'Not configured' : metric.format(metric.cap)}
    <small>{metric.name} · {metric.period}</small>
    {metric.cap !== null && <progress aria-label={`${metric.name} usage`} value={Math.min(metric.used, metric.cap)} max={Math.max(1, metric.cap)} />}
  </div>)}</div>;
}
export function OperatorTenant({ tenantId, ...props }: OperatorProps & { tenantId: string }) {
  const [key, setKey] = useState<string>(), [view, setView] = useState<DetailView>();
  const [tier, setTier] = useState<Tier>('regular'), [payment, setPayment] = useState<{ url: string; tier: Tier }>();
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [role, setRole] = useState('reader');
  const [inviteKey, setInviteKey] = useState(() => crypto.randomUUID());
  const [dialog, setDialog] = useState<'delete' | 'resolve'>(), [confirmation, setConfirmation] = useState('');
  const work = useOperatorWork(), path = `tenants/${encodeURIComponent(tenantId)}`;
  const load = async (credential: string) => { const result = await readView(operatorRequest(props, credential), path, encodeURIComponent(tenantId)); setView(result); };
  const transition = (action: 'suspend' | 'resume' | 'delete') => void work.run(async () => {
    if (key === undefined) return;
    const request = operatorRequest(props, key);
    // Version must come from a fresh server read; a race after this read still fails closed.
    const current = await request<TenantDetail>(path);
    try {
      await request(`${path}${action === 'delete' ? '' : `/${action}`}`, action === 'delete' ? 'DELETE' : 'POST', { expectedVersion: current.version }, crypto.randomUUID());
      setDialog(undefined); setConfirmation(''); setPayment(undefined); await load(key);
      work.setMessage(action === 'delete' ? 'Tenant deletion requested. Access is revoked; full erasure is a separate offline step.' : `Tenant ${action === 'suspend' ? 'suspended' : 'resumed'}.`);
    } catch (e) {
      if (e instanceof OperatorError && e.status === 409) {
        setDialog(undefined); setConfirmation(''); await load(key);
        work.setMessage(e.code === 'RESTORE_REVIEW_REQUIRED' ? 'RESTORE_REVIEW_REQUIRED' : 'This tenant changed since you loaded it.');
      } else throw e;
    }
  });
  const tenant = view?.tenant, readOnly = tenant?.state === 'deleted' || tenant?.state === 'deleting';
  const confirmValue = tenant?.slug ?? tenantId;
  return <OperatorFrame connected={key !== undefined} title="Operator · Tenant details" work={work} connect={async credential => { await load(credential); setKey(credential); }} disconnect={() => {
    setKey(undefined); setView(undefined); setPayment(undefined); setDialog(undefined); setConfirmation(''); setEmail(''); setName(''); setRole('reader'); setTier('regular'); setInviteKey(crypto.randomUUID()); work.setError(''); work.setMessage('Disconnected.');
  }}>
    {key !== undefined && view && tenant && <><p><a href="#operator-tenants">← All tenants</a></p>
      <div className="operator-title"><h1>{tenant.displayName ?? tenant.tenantId}</h1><StateChip state={tenant.state} />{view.billing && <span className="operator-chip plan">{tiers[view.billing.tier ?? 'free']}</span>}</div>
      <p>Slug <strong>{tenant.slug ?? 'None'}</strong> · Tenant ID <code>{tenant.tenantId}</code></p>
      {tenant.state === 'suspended' && <p className="operator-banner">Tenant suspended. Access is stopped. Resume in the Danger zone when ready.</p>}
      {readOnly && <p className="operator-banner">{tenant.state === 'deleted' ? 'Deleted tenant. This tombstone is read-only.' : 'Deletion requested. Access is revoked; this tenant is read-only.'}</p>}
      <section className="operator-card"><h2>Overview</h2><dl className="operator-facts">
        <div><dt>State</dt><dd>{titleCase(tenant.state)}</dd></div><div><dt>Version</dt><dd>{tenant.version}</dd></div>
        <div><dt>Namespace ID</dt><dd><code>{tenant.namespaceId}</code></dd></div><div><dt>Created via operation ID</dt><dd><code>{tenant.createdOperationId ?? 'Unknown'}</code></dd></div>
      </dl>
        {view.usage && <UsageStrip usage={view.usage} />}{!readOnly && !view.usage && <p>Usage unavailable{view.usageError ? `: ${view.usageError}` : ''}.</p>}
        {view.usage && <p className="operator-note">API calls and queries use daily UTC quotas; NLQ uses the current UTC month. Storage is the current logical-byte gauge.</p>}
        {tenant.tombstone && <p>Deleted at {tenant.tombstone}</p>}
      </section>
      {!readOnly && <><section className="operator-card"><h2>Plan & billing</h2>
        {view.billingMissing ? <p>Billing is not configured on this deployment</p> : view.billingError ? <p role="alert">Billing unavailable: {view.billingError}</p> : view.billing && <>
          <dl className="operator-facts"><div><dt>Current tier</dt><dd>{tiers[view.billing.tier ?? 'free']}</dd></div><div><dt>Subscription status</dt><dd>{view.billing.subscriptionStatus ?? 'None'}</dd></div><div><dt>Access state</dt><dd>{view.billing.accessState ?? 'active'}</dd></div></dl>
          {view.billing.accessState === 'paused' && <div className="operator-banner"><p>Access paused — past due. Paying in Stripe restores the paid tier automatically. Or resolve now by dropping the tenant to Free.</p><button disabled={work.busy} onClick={() => setDialog('resolve')}>Drop to Free…</button></div>}
          <form aria-label="Generate payment link" onSubmit={event => { event.preventDefault(); void work.run(async () => {
            const result = await operatorRequest(props, key)<{ url: string }>(`${path}/billing/payment-link`, 'POST', { tier }); setPayment({ url: result.url, tier });
          }); }}><label>Payment link for tier<select value={tier} disabled={work.busy} onChange={event => setTier(event.target.value as Tier)}>{(['light', 'regular', 'heavy'] as const).map(value => <option value={value} key={value}>{tiers[value]}</option>)}</select></label><button className="operator-primary" disabled={work.busy}>Generate payment link</button></form>
          <p>A payment link does not change the current tier. The plan changes when the customer pays.</p>
          {payment && <PaymentLink {...payment} work={work} />}
        </>}
      </section>
      <section className="operator-card"><h2>People</h2>
        {view.peopleError ? <p role="alert">People unavailable: {view.peopleError}</p> : <>
          {view.users?.filter(user => user.role === 'administrator').map(user => <p key={user.id}>{user.name} · Administrator · {user.status}</p>)}
          <p>{view.users?.length ?? 0} members · Manage membership and removals in <a href="#operator-users">Tenant users</a>.</p>
        </>}
        {tenant.state === 'active' && <form aria-label="Invite member" onSubmit={event => { event.preventDefault(); void work.run(async () => {
          await operatorRequest(props, key)(`${path}/invitations`, 'POST', { email, name, role }, inviteKey);
          setEmail(''); setName(''); setInviteKey(crypto.randomUUID()); await load(key); work.setMessage('Invitation emailed.');
        }); }}><label>Invite member — email<input type="email" required disabled={work.busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Name<input required maxLength={512} disabled={work.busy} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Role<select value={role} disabled={work.busy} onChange={event => setRole(event.target.value)}>{[['reader', 'Reader'], ['author', 'Author'], ['author_ai', 'Author AI'], ['reader_ai', 'Reader AI'], ['administrator', 'Administrator']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={work.busy}>Send invitation</button>
        </form>}
        <p>The invitation is emailed by the server. Its token is never shown here.</p>
      </section></>}
      <section className="operator-card operator-danger"><h2>{readOnly ? 'Erasure' : 'Danger zone'}</h2>
        {!readOnly && <>
          {(tenant.state === 'active' || tenant.state === 'suspended') && <div className="operator-danger-row"><div><strong>{tenant.state === 'suspended' ? 'Resume' : 'Suspend'} tenant</strong><p>Suspension stops access and keeps data. Pending restore review prevents resuming here.</p></div><button disabled={work.busy} onClick={() => transition(tenant.state === 'suspended' ? 'resume' : 'suspend')}>{tenant.state === 'suspended' ? 'Resume' : 'Suspend'}</button></div>}
          <div className="operator-danger-row"><div><strong>Delete tenant</strong><p>Revoke access and request a tombstone.</p></div><button disabled={work.busy} onClick={() => { setConfirmation(''); setDialog('delete'); }}>Delete…</button></div>
        </>}
        <p>{erasureNote}</p>
      </section>
      {!readOnly && dialog === 'delete' && <section className="operator-card operator-danger" role="dialog" aria-labelledby="delete-tenant-title"><h2 id="delete-tenant-title">Delete tenant</h2><p>{erasureNote}</p>
        <label>Type the {tenant.slug ? 'slug' : 'tenant ID'} to confirm: {confirmValue}<input autoFocus value={confirmation} disabled={work.busy} onChange={event => setConfirmation(event.target.value)} /></label>
        <button disabled={work.busy || confirmation !== confirmValue} onClick={() => transition('delete')}>Delete tenant</button><button disabled={work.busy} onClick={() => setDialog(undefined)}>Cancel</button>
      </section>}
      {!readOnly && dialog === 'resolve' && <section className="operator-card" role="dialog" aria-labelledby="resolve-billing-title"><h2 id="resolve-billing-title">Drop tenant to Free?</h2><p>This restores access with Free quotas. The paid tier ends.</p>
        <button disabled={work.busy} onClick={() => void work.run(async () => { await operatorRequest(props, key)(`${path}/billing/resolve`, 'POST', { action: 'drop_to_free' }); setDialog(undefined); await load(key); work.setMessage('Tenant dropped to Free.'); })}>Confirm drop to Free</button><button disabled={work.busy} onClick={() => setDialog(undefined)}>Cancel</button>
      </section>}
    </>}
  </OperatorFrame>;
}
