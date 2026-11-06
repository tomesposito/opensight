import { useState } from 'react';
import { useAccess, type Session } from './access.js';
import type { createApiClient } from './api-client.js';

export type PaidTier = 'light' | 'regular' | 'heavy';
export interface TrialInfo { endsAt: string; daysRemaining: number }
export interface BillingState { tier?: string | null; accessState?: string; trialEndsAt?: string | null; pauseEffectiveAt?: string | null; retentionDueAt?: string | null; subscriptionStatus?: string | null }
export type BillingClient = Partial<Pick<ReturnType<typeof createApiClient>, 'checkout' | 'exportWorkspace' | 'closeWorkspace'>>;
const plans = [{ tier: 'light', name: 'Light', price: 29 }, { tier: 'regular', name: 'Regular', price: 99 }, { tier: 'heavy', name: 'Heavy', price: 399 }] as const;
export const tierLabel = (tier: string | null | undefined) => tier === 'free' ? 'Self-hosted' : tier ? tier[0]!.toUpperCase() + tier.slice(1) : 'Operator configured';
const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

export function TrialBanner({ session }: { session: Session }) {
  const [dismissed, setDismissed] = useState(false), trial = session.trial;
  if (!trial || trial.daysRemaining <= 0 || dismissed) return null;
  return <aside className="trial-banner" aria-label="Trial status"><span className="trial-pill">14-day trial</span>
    <span><strong>Day {Math.max(1, 15 - trial.daysRemaining)} of 14.</strong> Your trial ends <strong>{date(trial.endsAt)}</strong>. Upgrade to keep this workspace — everything you've built carries over.</span>
    {session.role === 'administrator' && <a href="#/admin/billing">Upgrade</a>}
    <button aria-label="Dismiss trial banner for this session" onClick={() => setDismissed(true)}>×</button>
  </aside>;
}
export function BillingPanel({ session, client, paused = false }: { session: Session; client: BillingClient; paused?: boolean }) {
  const [tier, setTier] = useState<PaidTier>('light'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [closing, setClosing] = useState(false), [closed, setClosed] = useState(false);
  const admin = session.role === 'administrator', trial = session.trial, billing = session.billing;
  const expired = paused && !!billing?.trialEndsAt;
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); } };
  const checkout = () => run(async () => { if (!client.checkout) throw new Error('Checkout needs hosted API.'); const result = await client.checkout(tier); window.location.assign(result.url); });
  const exportData = () => run(async () => {
    if (!client.exportWorkspace) throw new Error('Export needs hosted API.');
    const result = await client.exportWorkspace();
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'opensight-workspace.json'; link.click(); URL.revokeObjectURL(url);
  });
  if (closed) return <section className="trial-card"><h1>Workspace closed</h1><p>Erasure follows the operator D-84 maintenance flow. Audit entries are retained.</p></section>;
  return <section className="trial-card" aria-label={paused ? 'Workspace paused' : 'Billing'}>
    {paused && <span className="trial-pill ended">{expired ? 'Trial ended' : 'Access paused'}</span>}
    <h1>{expired ? `Your trial of hosted OpenSight ended on ${date(billing!.trialEndsAt!)}` : paused ? 'Your hosted workspace is paused' : trial ? `Trial — ${trial.daysRemaining} days left` : `Billing · ${tierLabel(billing?.tier)}`}</h1>
    {paused ? <><p>Nothing was deleted. Your dashboards, datasets, and settings are exactly as you left them — the workspace is paused until you pick a plan.</p>
      {billing?.retentionDueAt && <p className="trial-retention">We'll keep everything until <strong>{date(billing.retentionDueAt)}</strong>. After that date, the operator can erase the workspace and its data. You can export your data at any point before then, free.</p>}</>
      : <p>{trial ? `Your trial ends ${date(trial.endsAt)}. ` : ''}Every feature included. Hosted tiers differ in quotas, never in features.</p>}
    {admin ? <>
      <fieldset className="trial-plans" disabled={busy}><legend>Choose a hosted plan</legend>{plans.map(plan => <label key={plan.tier} className={tier === plan.tier ? 'selected' : ''}>
        <input type="radio" name="tier" value={plan.tier} checked={tier === plan.tier} onChange={() => setTier(plan.tier)} /><span>{plan.name}</span><strong>${plan.price}<small>/mo</small></strong>
      </label>)}</fieldset>
      <div className="trial-actions"><button className="trial-primary" disabled={busy} onClick={() => void checkout()}>Continue with {tierLabel(tier)} — ${plans.find(p => p.tier === tier)!.price}/mo</button>
        {paused && <button disabled={busy} onClick={() => void exportData()}>Export my data</button>}</div>
      {paused && <div className="trial-close"><span>Rather run OpenSight yourself? It's the same product, free and open source.</span><button disabled={busy} onClick={() => setClosing(true)}>Close workspace</button></div>}
      {closing && <div role="dialog" aria-label="Confirm workspace closure"><p>Export your data first. Closing removes access and enters the existing erasure flow.</p><button disabled={busy} onClick={() => void run(async () => { if (!client.closeWorkspace || !session.tenantId) throw new Error('Closure needs hosted API.'); await client.closeWorkspace(session.tenantId); setClosed(true); })}>Confirm closure</button><button onClick={() => setClosing(false)}>Cancel</button></div>}
    </> : <p>Ask your workspace administrator to choose a plan, export data or close the workspace.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
export function BillingPage({ client }: { client: BillingClient }) {
  const { session } = useAccess();
  return session ? <BillingPanel session={session} client={client} /> : <p>Billing needs hosted API.</p>;
}
