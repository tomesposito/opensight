import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { appendOperatorAudit } from './operator-audit.js';
import { entitlementConfig, type Entitlement } from './hosted-usage.js';
import type { MailTransport } from './mail.js';

/**
 * Stripe Billing for hosted tiers (issue #194, D-81). Operator payment links
 * plus webhook-driven entitlements; access stays request-only and
 * operator-provisioned (D-79) — there is no self-serve signup or checkout.
 *
 * Past-due rule (Tom, 2026-11-03, recorded on #194): when a subscription's
 * payment has failed past Stripe's own retries (subscription unpaid, or
 * cancelled at period end), the tenant's hosted access PAUSES — data is
 * retained, there is no automatic downgrade and no extra grace window.
 * Resolution is an admin action: pay in Stripe (the subscription returns to
 * active and the webhook restores the paid tier) or explicitly drop the
 * tenant to Free through the operator route. The operator is notified when
 * a tenant enters the paused state.
 */

export const BILLING_TIERS = ['free', 'light', 'regular', 'heavy'] as const;
export type BillingTier = typeof BILLING_TIERS[number];
/** Decided flat monthly prices (D-78 amounts, 2026-10-28). Flat only: quotas
 * hard-stop overage, so there are no metered Stripe prices. */
export const TIER_PRICE_CENTS: Readonly<Record<BillingTier, number>> = Object.freeze({ free: 0, light: 2900, regular: 9900, heavy: 39900 });
const PAID_TIERS: readonly BillingTier[] = ['light', 'regular', 'heavy'];

export type BillingAccessState = 'active' | 'paused';
export interface BillingRecord {
  tenantId: string; tier: BillingTier | null; subscriptionStatus: string | null;
  accessState: BillingAccessState; pauseEffectiveAt: string | null;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null; updatedAt: string;
}
export interface BillingConfig {
  apiKey: string; webhookSecret: string;
  priceIds: Readonly<Record<'light' | 'regular' | 'heavy', string>>;
  tierEntitlements: Readonly<Partial<Record<BillingTier, Entitlement>>>;
}
export interface StripeClient {
  createPaymentLink(input: { priceId: string; tenantId: string; tier: BillingTier }): Promise<{ id: string; url: string }>;
}
export type StripeFetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function configInvalid(): never { throw new MetadataError('BILLING_CONFIG_INVALID', 503); }
function secretField(value: string | undefined): string {
  if (!value || value.length > 512 || /[\s\x00-\x1f]/.test(value)) configInvalid();
  return value!;
}
function tierEntitlements(raw: string | undefined): Partial<Record<BillingTier, Entitlement>> {
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) configInvalid();
    for (const key of Object.keys(parsed as object)) if (!(BILLING_TIERS as readonly string[]).includes(key)) configInvalid();
    const shaped = entitlementConfig(JSON.stringify({ defaults: null, tenants: parsed }));
    return shaped.tenants as Partial<Record<BillingTier, Entitlement>>;
  } catch (error) { if (error instanceof MetadataError && error.code === 'BILLING_CONFIG_INVALID') throw error; configInvalid(); }
}
/**
 * Billing is enabled only by a complete Stripe configuration. No Stripe
 * variables at all = billing disabled and the rest of the product works
 * unchanged (fail closed, local mode unaffected); a partial configuration
 * is an operator error and refuses to start.
 */
export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig | undefined {
  const names = ['OPENSIGHT_STRIPE_SECRET_KEY', 'OPENSIGHT_STRIPE_WEBHOOK_SECRET', 'OPENSIGHT_STRIPE_PRICE_LIGHT', 'OPENSIGHT_STRIPE_PRICE_REGULAR', 'OPENSIGHT_STRIPE_PRICE_HEAVY'] as const;
  const present = names.filter(name => env[name] !== undefined && env[name] !== '');
  if (!present.length) {
    if (env.OPENSIGHT_BILLING_TIER_ENTITLEMENTS !== undefined) configInvalid();
    return undefined;
  }
  if (present.length !== names.length) configInvalid();
  return Object.freeze({
    apiKey: secretField(env.OPENSIGHT_STRIPE_SECRET_KEY), webhookSecret: secretField(env.OPENSIGHT_STRIPE_WEBHOOK_SECRET),
    priceIds: Object.freeze({ light: secretField(env.OPENSIGHT_STRIPE_PRICE_LIGHT), regular: secretField(env.OPENSIGHT_STRIPE_PRICE_REGULAR), heavy: secretField(env.OPENSIGHT_STRIPE_PRICE_HEAVY) }),
    tierEntitlements: Object.freeze(tierEntitlements(env.OPENSIGHT_BILLING_TIER_ENTITLEMENTS)),
  });
}

/** Thin Stripe REST client over an injectable fetcher: tests never make real
 * Stripe calls, and no card data ever touches OpenSight (Stripe hosts the
 * payment page). The official SDK is deliberately not a dependency. */
export function httpStripeClient(apiKey: string, fetcher: StripeFetcher = fetch as unknown as StripeFetcher): StripeClient {
  return {
    async createPaymentLink({ priceId, tenantId, tier }) {
      const form = new URLSearchParams({
        'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
        'metadata[tenant_id]': tenantId, 'metadata[tier]': tier,
      });
      let response: Awaited<ReturnType<StripeFetcher>>;
      try {
        response = await fetcher('https://api.stripe.com/v1/payment_links', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
      } catch { throw new MetadataError('STRIPE_REQUEST_FAILED', 502); }
      const payload: unknown = await response.json().catch(() => undefined);
      const record = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      if (!response.ok || typeof record.id !== 'string' || typeof record.url !== 'string' || !record.url.startsWith('https://'))
        throw new MetadataError('STRIPE_REQUEST_FAILED', 502);
      return { id: record.id, url: record.url };
    },
  };
}

const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Verify a Stripe webhook signature (v1 HMAC-SHA256 over "<t>.<raw body>")
 * against the raw request body. Anything off — missing, malformed, stale or
 * mismatched — is STRIPE_SIGNATURE_INVALID; the body is never trusted first. */
export function verifyStripeSignature(rawBody: Buffer, header: string | string[] | undefined, secret: string, nowSeconds: number): void {
  const invalid = (): never => { throw new MetadataError('STRIPE_SIGNATURE_INVALID', 400); };
  if (typeof header !== 'string' || !header || header.length > 2048) invalid();
  let timestamp: string | undefined; const signatures: string[] = [];
  for (const part of header!.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) invalid();
    const key = part.slice(0, eq).trim(), value = part.slice(eq + 1).trim();
    if (key === 't') { if (timestamp !== undefined) invalid(); timestamp = value; }
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp!) || !signatures.length) invalid();
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) invalid();
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const matched = signatures.some(candidate => {
    if (!/^[0-9a-f]{64}$/.test(candidate)) return false;
    return timingSafeEqual(Buffer.from(candidate, 'hex'), expected);
  });
  if (!matched) invalid();
}

/** Read a webhook request body raw (signature verification needs the exact
 * bytes), bounded like every other body in the hosted server. */
export async function readRawBody(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const bytes = chunk as Buffer; size += bytes.length;
      if (size > maxBytes) throw new MetadataError('STRIPE_EVENT_TOO_LARGE', 413);
      chunks.push(bytes);
    }
  } catch (error) { request.resume(); if (error instanceof MetadataError) throw error; throw new MetadataError('STRIPE_EVENT_INVALID', 400); }
  return Buffer.concat(chunks, size);
}

export interface StripeEvent { id: string; type: string; object: Record<string, unknown> }
export function parseStripeEvent(rawBody: Buffer): StripeEvent {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)); } catch { throw new MetadataError('STRIPE_EVENT_INVALID', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MetadataError('STRIPE_EVENT_INVALID', 400);
  const event = parsed as Record<string, unknown>;
  const data = event.data !== null && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
  const object = data.object !== null && typeof data.object === 'object' && !Array.isArray(data.object) ? data.object as Record<string, unknown> : undefined;
  if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(event.id) || typeof event.type !== 'string' || !event.type || event.type.length > 128 || !object)
    throw new MetadataError('STRIPE_EVENT_INVALID', 400);
  return { id: event.id, type: event.type, object };
}

export async function initializeBilling(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h9_billing (
      tenant_id TEXT PRIMARY KEY REFERENCES h1_tenants(tenant_id), tier TEXT, subscription_status TEXT,
      access_state TEXT NOT NULL DEFAULT 'active', pause_effective_at TEXT,
      stripe_customer_id TEXT, stripe_subscription_id TEXT, updated_at TEXT NOT NULL)`);
    await c.query(`CREATE TABLE IF NOT EXISTS h9_billing_links (
      link_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES h1_tenants(tenant_id), tier TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await c.query(`CREATE TABLE IF NOT EXISTS h9_billing_events (
      event_id TEXT PRIMARY KEY, tenant_id TEXT, type TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL)`);
  });
}

function asRecord(row: Record<string, unknown> | undefined): BillingRecord | undefined {
  if (!row) return undefined;
  return {
    tenantId: String(row.tenant_id), tier: row.tier === null ? null : String(row.tier) as BillingTier,
    subscriptionStatus: row.subscription_status === null ? null : String(row.subscription_status),
    accessState: String(row.access_state) === 'paused' ? 'paused' : 'active',
    pauseEffectiveAt: row.pause_effective_at === null ? null : String(row.pause_effective_at),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId: row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id),
    updatedAt: String(row.updated_at),
  };
}
function nested(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringOrNull(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function uniqueViolation(error: unknown): boolean {
  const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['23505', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /unique constraint|duplicate key/i.test(message);
}

export interface BillingEventResult { duplicate: boolean; handled: boolean; tenantId: string | null; action: string }
export interface HostedBillingOptions {
  mail?: MailTransport; notifyTo?: string | null;
  stripe?: StripeClient; clock?: () => number;
}

/**
 * Durable billing state per tenant plus an in-memory mirror used by the
 * request gate and the entitlement override. The mirror is refreshed on
 * every mutation this process applies and once at startup via load(); the
 * single-node hosted server is the composition this slice targets.
 */
export class HostedBilling {
  private readonly clock: () => number;
  private readonly stripe: StripeClient;
  private readonly records = new Map<string, BillingRecord>();
  constructor(private readonly db: Database, private readonly config: BillingConfig, private readonly options: HostedBillingOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.stripe = options.stripe ?? httpStripeClient(config.apiKey);
  }
  private nowIso(): string { return new Date(this.clock()).toISOString(); }
  async load(): Promise<void> {
    const rows = await this.db.transaction(c => c.query('SELECT * FROM h9_billing'));
    this.records.clear();
    for (const row of rows) { const record = asRecord(row)!; this.records.set(record.tenantId, record); }
  }
  /** Effective entitlement override for a billed tenant, when the operator
   * configured an entitlement for the tenant's current tier. */
  tierEntitlement(tenantId: string): Entitlement | undefined {
    const record = this.records.get(tenantId);
    if (!record?.tier) return undefined;
    return this.config.tierEntitlements[record.tier];
  }
  /** The past-due gate: a paused tenant whose pause is in effect gets no
   * hosted access. Data is retained; only an admin resolution reopens it. */
  assertAccess(tenantId: string): void {
    const record = this.records.get(tenantId);
    if (record?.accessState === 'paused' && record.pauseEffectiveAt && Date.parse(record.pauseEffectiveAt) <= this.clock())
      throw new MetadataError('BILLING_ACCESS_PAUSED', 403);
  }
  async state(tenantId: string): Promise<BillingRecord | { tenantId: string; status: 'none' }> {
    identifier(tenantId);
    const record = await this.db.transaction(async c => asRecord((await c.query('SELECT * FROM h9_billing WHERE tenant_id = ?', [tenantId]))[0]));
    return record ?? { tenantId, status: 'none' };
  }
  async createPaymentLink(tenantId: string, tier: unknown): Promise<{ id: string; url: string; tier: BillingTier }> {
    identifier(tenantId);
    if (typeof tier !== 'string' || !(PAID_TIERS as readonly string[]).includes(tier)) throw new MetadataError('BILLING_TIER_INVALID', 400);
    const paidTier = tier as 'light' | 'regular' | 'heavy';
    await this.db.transaction(async c => {
      if (!(await c.query("SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? AND state <> 'deleted'", [tenantId])).length)
        throw new MetadataError('TENANT_UNAVAILABLE', 403);
    });
    const link = await this.stripe.createPaymentLink({ priceId: this.config.priceIds[paidTier], tenantId, tier: paidTier });
    await this.db.transaction(async c => {
      await c.query('INSERT INTO h9_billing_links (link_id, tenant_id, tier, created_at) VALUES (?,?,?,?)', [link.id, tenantId, paidTier, this.nowIso()]);
      await appendOperatorAudit(c, { action: 'billing.payment_link.created', tenantId, subject: link.id, detail: { tier: paidTier, priceCents: TIER_PRICE_CENTS[paidTier] } }, this.clock());
    });
    return { ...link, tier: paidTier };
  }
  /** Admin resolution #2 from Tom's ruling: explicitly drop a paused tenant
   * to Free. (Resolution #1 — paying in Stripe — arrives as a webhook when
   * the subscription returns to active and restores the paid tier.) */
  async resolveDropToFree(tenantId: string): Promise<BillingRecord> {
    identifier(tenantId);
    const updated = await this.db.transaction(async c => {
      await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state <> 'deleted' RETURNING tenant_id", [tenantId]);
      const record = asRecord((await c.query('SELECT * FROM h9_billing WHERE tenant_id = ?', [tenantId]))[0]);
      if (!record) throw new MetadataError('BILLING_NOT_PAUSED', 409);
      if (record.accessState !== 'paused') throw new MetadataError('BILLING_NOT_PAUSED', 409);
      const next: BillingRecord = { ...record, tier: 'free', accessState: 'active', pauseEffectiveAt: null, updatedAt: this.nowIso() };
      await c.query('UPDATE h9_billing SET tier = ?, access_state = ?, pause_effective_at = ?, updated_at = ? WHERE tenant_id = ?',
        [next.tier, next.accessState, next.pauseEffectiveAt, next.updatedAt, tenantId]);
      await appendOperatorAudit(c, { action: 'billing.access.restored', tenantId, detail: { via: 'drop_to_free', fromTier: record.tier, toTier: 'free', stripeEventId: null } }, this.clock());
      return next;
    });
    this.records.set(tenantId, updated);
    return updated;
  }
  private tierForPrice(priceId: string | null): BillingTier | undefined {
    if (!priceId) return undefined;
    for (const tier of PAID_TIERS) if (this.config.priceIds[tier as 'light' | 'regular' | 'heavy'] === priceId) return tier as BillingTier;
    return undefined;
  }
  private async resolveTenant(c: SqlConnection, event: StripeEvent): Promise<{ tenantId: string; linkTier?: BillingTier } | undefined> {
    const object = event.object;
    const metadata = nested(object.metadata);
    const metaTenant = stringOrNull(metadata.tenant_id);
    if (metaTenant) { try { return { tenantId: identifier(metaTenant) }; } catch { /* fall through to durable bindings */ } }
    const paymentLink = stringOrNull(object.payment_link);
    if (paymentLink) {
      const link = (await c.query('SELECT tenant_id, tier FROM h9_billing_links WHERE link_id = ?', [paymentLink]))[0];
      if (link) return { tenantId: String(link.tenant_id), linkTier: String(link.tier) as BillingTier };
    }
    const subscriptionId = event.type.startsWith('customer.subscription') ? stringOrNull(object.id) : stringOrNull(object.subscription);
    if (subscriptionId) {
      const row = (await c.query('SELECT tenant_id FROM h9_billing WHERE stripe_subscription_id = ?', [subscriptionId]))[0];
      if (row) return { tenantId: String(row.tenant_id) };
    }
    const customerId = stringOrNull(object.customer);
    if (customerId) {
      const row = (await c.query('SELECT tenant_id FROM h9_billing WHERE stripe_customer_id = ?', [customerId]))[0];
      if (row) return { tenantId: String(row.tenant_id) };
    }
    return undefined;
  }
  /**
   * Apply one verified webhook event exactly once. The event ID is recorded
   * in the same transaction as the state change and the audit entries, so a
   * replay is a durable no-op. Every entitlement change is audited with the
   * Stripe event ID as the reference.
   */
  async handleEvent(event: StripeEvent): Promise<BillingEventResult> {
    let pauseNotice: { tenantId: string; effectiveAt: string; reason: string } | undefined;
    let result: BillingEventResult;
    try {
      result = await this.db.transaction(async c => {
        await c.query('SAVEPOINT opensight_billing_event');
        try { await c.query('INSERT INTO h9_billing_events (event_id, tenant_id, type, outcome, created_at) VALUES (?,?,?,?,?)', [event.id, null, event.type, 'received', this.nowIso()]); }
        catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT opensight_billing_event');
          await c.query('RELEASE SAVEPOINT opensight_billing_event');
          if (uniqueViolation(error)) return { duplicate: true, handled: false, tenantId: null, action: 'duplicate' } satisfies BillingEventResult;
          throw error;
        }
        await c.query('RELEASE SAVEPOINT opensight_billing_event');
        const resolved = await this.resolveTenant(c, event);
        if (!resolved) {
          await c.query('UPDATE h9_billing_events SET outcome = ? WHERE event_id = ?', ['unmatched', event.id]);
          await appendOperatorAudit(c, { action: 'billing.event.unmatched', subject: event.id, detail: { type: event.type, stripeEventId: event.id } }, this.clock());
          return { duplicate: false, handled: false, tenantId: null, action: 'unmatched' } satisfies BillingEventResult;
        }
        const { tenantId } = resolved;
        await c.query('UPDATE h9_billing_events SET tenant_id = ?, outcome = ? WHERE event_id = ?', [tenantId, 'applied', event.id]);
        const existing = asRecord((await c.query('SELECT * FROM h9_billing WHERE tenant_id = ?', [tenantId]))[0]);
        const next: BillingRecord = existing ?? { tenantId, tier: null, subscriptionStatus: null, accessState: 'active', pauseEffectiveAt: null, stripeCustomerId: null, stripeSubscriptionId: null, updatedAt: this.nowIso() };
        const object = event.object;
        let action = 'recorded';
        if (event.type === 'checkout.session.completed') {
          next.stripeCustomerId = stringOrNull(object.customer) ?? next.stripeCustomerId;
          next.stripeSubscriptionId = stringOrNull(object.subscription) ?? next.stripeSubscriptionId;
          if (resolved.linkTier) next.tier = resolved.linkTier;
          action = 'checkout_completed';
        } else if (event.type.startsWith('customer.subscription')) {
          const status = event.type === 'customer.subscription.deleted' ? 'canceled' : stringOrNull(object.status) ?? next.subscriptionStatus;
          next.stripeCustomerId = stringOrNull(object.customer) ?? next.stripeCustomerId;
          next.stripeSubscriptionId = stringOrNull(object.id) ?? next.stripeSubscriptionId;
          const items = nested(object.items), first = Array.isArray(items.data) ? nested(items.data[0]) : {};
          const priceTier = this.tierForPrice(stringOrNull(nested(first.price).id));
          if (priceTier) next.tier = priceTier;
          next.subscriptionStatus = status;
          if (status === 'active' || status === 'trialing') {
            if (next.accessState === 'paused') action = 'access_restored';
            next.accessState = 'active'; next.pauseEffectiveAt = null;
          } else if (status === 'unpaid' || status === 'incomplete_expired') {
            if (next.accessState !== 'paused') { action = 'access_paused'; pauseNotice = { tenantId, effectiveAt: this.nowIso(), reason: `subscription_${status}` }; }
            next.accessState = 'paused'; next.pauseEffectiveAt = this.nowIso();
          } else if (status === 'canceled') {
            const periodEnd = typeof object.current_period_end === 'number' && Number.isFinite(object.current_period_end) ? object.current_period_end * 1000 : null;
            const effective = periodEnd !== null && periodEnd > this.clock() ? new Date(periodEnd).toISOString() : this.nowIso();
            if (next.accessState !== 'paused') { action = 'access_paused'; pauseNotice = { tenantId, effectiveAt: effective, reason: 'subscription_canceled' }; }
            next.accessState = 'paused'; next.pauseEffectiveAt = effective;
          } else if (status === 'past_due') {
            action = 'past_due';
          }
        } else if (event.type === 'invoice.payment_failed') {
          next.stripeSubscriptionId = stringOrNull(object.subscription) ?? next.stripeSubscriptionId;
          next.stripeCustomerId = stringOrNull(object.customer) ?? next.stripeCustomerId;
          if (next.subscriptionStatus === 'active') next.subscriptionStatus = 'past_due';
          action = 'payment_failed';
        } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
          next.stripeSubscriptionId = stringOrNull(object.subscription) ?? next.stripeSubscriptionId;
          action = 'invoice_paid';
        } else {
          await c.query('UPDATE h9_billing_events SET outcome = ? WHERE event_id = ?', ['ignored', event.id]);
          return { duplicate: false, handled: false, tenantId, action: 'ignored' } satisfies BillingEventResult;
        }
        next.updatedAt = this.nowIso();
        await c.query(`INSERT INTO h9_billing (tenant_id, tier, subscription_status, access_state, pause_effective_at, stripe_customer_id, stripe_subscription_id, updated_at)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (tenant_id) DO UPDATE SET tier = excluded.tier, subscription_status = excluded.subscription_status,
          access_state = excluded.access_state, pause_effective_at = excluded.pause_effective_at, stripe_customer_id = excluded.stripe_customer_id,
          stripe_subscription_id = excluded.stripe_subscription_id, updated_at = excluded.updated_at`,
        [next.tenantId, next.tier, next.subscriptionStatus, next.accessState, next.pauseEffectiveAt, next.stripeCustomerId, next.stripeSubscriptionId, next.updatedAt]);
        const changed = !existing || existing.tier !== next.tier || existing.accessState !== next.accessState || existing.subscriptionStatus !== next.subscriptionStatus;
        if (changed) await appendOperatorAudit(c, { action: 'billing.entitlement.changed', tenantId, subject: next.stripeSubscriptionId ?? undefined,
          detail: { stripeEventId: event.id, type: event.type, action, fromTier: existing?.tier ?? null, toTier: next.tier, subscriptionStatus: next.subscriptionStatus, accessState: next.accessState, pauseEffectiveAt: next.pauseEffectiveAt } }, this.clock());
        if (action === 'access_paused') await appendOperatorAudit(c, { action: 'billing.access.paused', tenantId,
          detail: { stripeEventId: event.id, reason: pauseNotice!.reason, pauseEffectiveAt: next.pauseEffectiveAt } }, this.clock());
        if (action === 'access_restored') await appendOperatorAudit(c, { action: 'billing.access.restored', tenantId,
          detail: { stripeEventId: event.id, via: 'subscription_active', tier: next.tier } }, this.clock());
        this.records.set(tenantId, next);
        return { duplicate: false, handled: true, tenantId, action } satisfies BillingEventResult;
      });
    } catch (error) {
      if (uniqueViolation(error)) return { duplicate: true, handled: false, tenantId: null, action: 'duplicate' };
      throw error;
    }
    if (pauseNotice && this.options.mail?.configured && this.options.notifyTo) {
      // Best-effort, after the pause is durable: a mail failure never rolls
      // the pause back (same rule as access-request notification, #177).
      const notice = pauseNotice as { tenantId: string; effectiveAt: string; reason: string };
      await this.options.mail.send({
        to: [this.options.notifyTo], subject: `OpenSight billing: tenant ${notice.tenantId} access paused`,
        html: `<p>Tenant ${notice.tenantId} entered the billing paused state (${notice.reason}). Access pauses at ${notice.effectiveAt}; data is retained. Resolve by paying in Stripe or dropping the tenant to Free via the operator billing route.</p>`,
        dedupeKey: `billing-paused:${notice.tenantId}:${notice.effectiveAt}`,
      }).catch(() => undefined);
    }
    return result;
  }
}
