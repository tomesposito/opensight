import { useRef, useState, type ReactNode } from 'react';
import { BrandMark } from './BrandMark.js';

export type Tier = 'free' | 'light' | 'regular' | 'heavy';
export const tiers: Record<Tier, string> = { free: 'Self-hosted', light: 'Light · $29/mo', regular: 'Regular · $99/mo', heavy: 'Heavy · $399/mo' };
export const titleCase = (value: string) => value === 'free' ? 'Self-hosted' : value.charAt(0).toUpperCase() + value.slice(1);
export interface OperatorProps { baseUrl?: string; fetcher?: typeof fetch }
export interface TenantSummary { tenantId: string; displayName: string | null; slug: string | null; state: string; tier: Tier; memberCount: number; createdAt: string | null }
export interface TenantDetail { tenantId: string; displayName: string | null; slug: string | null; state: string; namespaceId: string; version: number; createdOperationId: string | null; tombstone: string | null }
export interface Billing { billingMode?: 'checkout' | 'waitlist'; entitlementSource?: 'stripe' | 'manual' | 'trial'; paidRequest?: (import('./TrialBilling.js').PaidRequestState & { id: string }) | null; trialEndsAt?: string | null; retentionDueAt?: string | null; tier?: Tier | null; subscriptionStatus?: string | null; accessState?: string; status?: 'none' }
export interface OperatorMember { id: string; name: string; role: string; status: string }
export interface UsageOverview { day: string; period: string; apiCalls: number; queries: number; storageBytes: number; nlq: number; quotas: { apiCalls: number; queries: number; storageBytes: number; nlq: number | null } }
export class OperatorError extends Error {
  constructor(readonly code: string, readonly status: number, readonly field?: string) { super(code); }
}
export function operatorRequest({ baseUrl = '/api', fetcher = fetch }: OperatorProps, key: string) {
  return async <T,>(path: string, method = 'GET', body?: unknown, idempotencyKey?: string): Promise<T> => {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/api/host/${path}`, { method, credentials: 'omit',
      headers: { Authorization: `Operator ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as T & { errorCode?: string; field?: string };
    if (!response.ok) throw new OperatorError(value.errorCode ?? 'Request failed', response.status, value.field);
    return value;
  };
}
export type OperatorRequest = ReturnType<typeof operatorRequest>;
/** Mirrors the server's D-83 derivation, including a null slug for non-Latin-only names. */
export function deriveTenantSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');
}
export function useOperatorWork() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const running = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { running.current = false; setBusy(false); }
  };
  return { busy, error, message, run, setError, setMessage };
}
export type OperatorWork = ReturnType<typeof useOperatorWork>;
export function OperatorNav({ current }: { current: 'tenants' | 'users' | 'ideas' | 'signups' }) {
  return <nav aria-label="Operator"><a href="#operator-tenants" aria-current={current === 'tenants' ? 'page' : undefined}>Tenants</a> · <a href="#operator-users" aria-current={current === 'users' ? 'page' : undefined}>Tenant users</a> · <a href="#operator-ideas" aria-current={current === 'ideas' ? 'page' : undefined}>Ideas</a> · <a href="#operator-signups" aria-current={current === 'signups' ? 'page' : undefined}>Signups</a></nav>;
}
export function OperatorFrame({ connected, connect, disconnect, work, children, title, current = 'tenants' }: {
  current?: 'tenants' | 'users' | 'ideas' | 'signups'; connected: boolean; connect: (key: string) => Promise<void>; disconnect: () => void; work: OperatorWork; children: ReactNode; title: string;
}) {
  const [credential, setCredential] = useState('');
  return <div className="operator-provisioning">
    <header className="operator-brand"><BrandMark size={26} /><strong>opensight</strong><span className="operator-plane">Operator</span>
      {connected && <span className="operator-connection">Credential held in memory only <button disabled={work.busy} onClick={() => { setCredential(''); disconnect(); }}>Disconnect</button></span>}
    </header>
    <main className="admin-settings operator-tenants"><OperatorNav current={current} />
      {!connected && <><h1>{title}</h1><form aria-label="Operator connection" onSubmit={event => { event.preventDefault(); void work.run(async () => { await connect(credential); setCredential(''); }); }}>
        <label>Operator credential<input type="password" autoComplete="off" required value={credential} disabled={work.busy} onChange={event => setCredential(event.target.value)} /></label>
        <button type="submit" disabled={work.busy}>Load tenants</button>
      </form></>}
      {work.busy && <p role="status">Working…</p>}{work.error && <p role="alert">{work.error}</p>}{work.message && <p role="status">{work.message}</p>}
      {connected && children}
    </main>
  </div>;
}
export function StateChip({ state }: { state: string }) { return <span className={`operator-chip ${state}`}>{titleCase(state)}</span>; }
export function PaymentLink({ url, tier, work }: { url: string; tier: Tier; work: OperatorWork }) {
  return <><div className="operator-payment"><a href={url} target="_blank" rel="noreferrer">{url}</a><button disabled={work.busy} type="button" onClick={() => void work.run(async () => { await navigator.clipboard.writeText(url); work.setMessage('Payment link copied.'); })}>Copy link</button></div>
    <p>{`Send this link to the customer. The ${titleCase(tier)} plan starts when they pay.`}</p></>;
}
export const erasureNote = 'Full erasure is a separate offline maintenance step. Audit entries are retained (D-84). Serverless object-store erasure is unsupported and fails closed.';
