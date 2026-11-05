import { useState } from 'react';
import { deriveTenantSlug, erasureNote, OperatorError, OperatorFrame, operatorRequest, PaymentLink, StateChip, tiers, useOperatorWork,
  type OperatorProps, type OperatorRequest, type OperatorWork, type TenantSummary, type Tier } from './operator-provisioning.js';

function CreateTenant({ request, work, cancel, refresh }: { request: OperatorRequest; work: OperatorWork; cancel: () => void; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(''), [name, setName] = useState(''), [slug, setSlug] = useState('');
  const [nameEdited, setNameEdited] = useState(false), [slugEdited, setSlugEdited] = useState(false);
  const [adminName, setAdminName] = useState(''), [email, setEmail] = useState(''), [tier, setTier] = useState<Tier>('free');
  const [idempotency] = useState(() => crypto.randomUUID()), [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ tenantId: string; url?: string; notice?: string }>();
  const fieldError = (field: string) => fields[field] && <span className="operator-field-error" role="alert">{fields[field]}</span>;
  if (created) return <section className="operator-card" aria-label="Tenant created"><h2>Tenant created on the Free plan</h2>
    {created.url && <PaymentLink url={created.url} tier={tier} work={work} />}{created.notice && <p role="status">{created.notice}</p>}
    <a href={`#operator-tenant/${created.tenantId}`}>Open tenant details</a> <button disabled={work.busy} onClick={cancel}>All tenants</button>
  </section>;
  return <><button disabled={work.busy} onClick={cancel}>← All tenants</button><h1>Create tenant</h1>
    <p>Provision a workspace and email its first administrator an invitation.</p>
    <section className="operator-card operator-create"><h2>Workspace & first administrator</h2><p>The workspace name appears in invitations, the workspace picker and the app header.</p>
      <form aria-label="Create tenant" onSubmit={event => { event.preventDefault(); void work.run(async () => {
        setFields({});
        try {
          const result = await request<{ tenantId: string }>('tenants', 'POST', { displayName, name, ...(slug ? { slug } : {}), administrator: { name: adminName, email } }, idempotency);
          setCreated(result);
          if (tier !== 'free') {
            try { const link = await request<{ url: string }>(`tenants/${result.tenantId}/billing/payment-link`, 'POST', { tier }); setCreated({ ...result, url: link.url }); }
            catch (e) { setCreated({ ...result, notice: e instanceof OperatorError && e.status === 404
              ? 'Created on Free. Billing is not configured on this deployment; no link generated.'
              : `Created on Free. No payment link generated: ${e instanceof Error ? e.message : 'Request failed'}. Generate a link from tenant details.` }); }
          }
          await refresh();
        } catch (e) {
          if (e instanceof OperatorError && e.code === 'TENANT_SLUG_CONFLICT') setFields({ slug: `${slug || deriveTenantSlug(displayName)} is already in use` });
          else if (e instanceof OperatorError && e.code === 'METADATA_INVALID' && e.field) setFields({ [e.field]: 'Enter a valid value.' });
          else if (e instanceof OperatorError && e.code === 'EMAIL_INVALID') setFields({ 'administrator.email': 'Enter a valid email address.' });
          else if (e instanceof OperatorError && e.code === 'SMTP_NOT_CONFIGURED') work.setError('Mail is not configured on this deployment, so the invitation cannot be sent. No tenant was created.');
          else throw e;
        }
      }); }}>
        <fieldset disabled={work.busy} className="operator-fields"><div className="operator-field-grid">
          <label>Workspace display name<input required maxLength={512} value={displayName} aria-invalid={!!fields.displayName} onChange={event => { const value = event.target.value; setDisplayName(value); if (!nameEdited) setName(value); if (!slugEdited) setSlug(deriveTenantSlug(value)); }} />{fieldError('displayName')}<small>Required. Up to 512 characters; no control characters.</small></label>
          <label>Tenant name<input required maxLength={512} value={name} aria-invalid={!!fields.name} onChange={event => { setNameEdited(true); setName(event.target.value); }} />{fieldError('name')}<small>The namespace name. Pre-filled from the display name.</small></label>
          <label>Slug<input maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} aria-invalid={!!fields.slug} onChange={event => { setSlugEdited(true); setSlug(event.target.value); }} />{fieldError('slug')}<small>Auto-derived; editable. Lowercase letters, numbers and hyphens. Must be unique.</small></label><div />
          <label>Administrator name<input required maxLength={512} value={adminName} aria-invalid={!!fields['administrator.name']} onChange={event => setAdminName(event.target.value)} />{fieldError('administrator.name')}</label>
          <label>Administrator email<input type="email" required value={email} aria-invalid={!!fields['administrator.email']} onChange={event => setEmail(event.target.value)} />{fieldError('administrator.email')}<small>The invitation is emailed to this address.</small></label>
        </div><fieldset className="operator-plans"><legend>Starting plan</legend><div>{(Object.keys(tiers) as Tier[]).map(value => <label key={value}><input type="radio" name="starting-plan" value={value} checked={tier === value} onChange={() => setTier(value)} />{tiers[value]}</label>)}</div>
          <p>The tenant is created on Free quotas. With a paid plan selected, the next step generates a payment link. The paid plan starts when the customer pays.</p>
        </fieldset></fieldset>
        <button className="operator-primary" disabled={work.busy} type="submit">Create tenant</button><button disabled={work.busy} type="button" onClick={cancel}>Cancel</button>
      </form>
    </section></>;
}
export function OperatorTenants(props: OperatorProps) {
  const [key, setKey] = useState<string>(), [tenants, setTenants] = useState<TenantSummary[]>([]), [filter, setFilter] = useState(''), [creating, setCreating] = useState(false);
  const work = useOperatorWork();
  const load = async (credential: string) => { const result = await operatorRequest(props, credential)<{ tenants: TenantSummary[] }>('tenants'); setTenants(result.tenants); return result.tenants.length; };
  return <OperatorFrame connected={key !== undefined} title="Operator · Tenants" work={work} connect={async credential => { const count = await load(credential); setCreating(count === 0); setKey(credential); }} disconnect={() => { setKey(undefined); setTenants([]); setCreating(false); setFilter(''); work.setError(''); work.setMessage('Disconnected.'); }}>
    {key !== undefined && (creating || !tenants.length ? <>
      {!tenants.length && <p>No tenants yet. Create the first tenant.</p>}
      <CreateTenant request={operatorRequest(props, key)} work={work} cancel={() => setCreating(false)} refresh={async () => { await load(key); }} />
    </> : <><h1>Operator · Tenants</h1><p>Every hosted workspace. Provisioning is manual: an operator approves each tenant.</p>
      <p className="operator-connected">Connected. {tenants.length} tenants on this deployment.</p>
      <div className="operator-toolbar"><label>Filter tenants<input type="search" placeholder="Name or slug" value={filter} onChange={event => setFilter(event.target.value)} /></label><button className="operator-primary" disabled={work.busy} onClick={() => setCreating(true)}>New tenant</button></div>
      <div className="operator-table-wrap"><table><thead><tr>{['Workspace', 'Slug', 'State', 'Plan', 'Members', 'Created'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{tenants.filter(tenant => `${tenant.displayName ?? tenant.tenantId} ${tenant.slug ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map(tenant => <tr key={tenant.tenantId} className={tenant.state === 'deleted' ? 'deleted' : ''} onClick={() => { window.location.hash = `operator-tenant/${tenant.tenantId}`; }}>
          <td className="operator-name"><a href={`#operator-tenant/${tenant.tenantId}`}>{tenant.displayName ?? tenant.tenantId}</a></td><td>{tenant.slug ?? '—'}</td><td><StateChip state={tenant.state} /></td><td><span className="operator-chip plan">{tiers[tenant.tier]}</span></td><td>{tenant.memberCount}</td><td>{tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Unknown'}</td>
        </tr>)}</tbody></table></div>
      {filter && !tenants.some(tenant => `${tenant.displayName ?? tenant.tenantId} ${tenant.slug ?? ''}`.toLowerCase().includes(filter.toLowerCase())) && <p>No tenants match this filter.</p>}
      <p>{erasureNote}</p></>)}
  </OperatorFrame>;
}
