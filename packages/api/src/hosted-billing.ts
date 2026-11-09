import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { appendOperatorAudit } from './operator-audit.js';
import { entitlementConfig, type Entitlement } from './hosted-usage.js';
import type { MailTransport } from './mail.js';

/** Hosted billing and 14-day trials (#194, #197). Paused workspaces retain
 * data for 30 days; resolution is payment, export, or closure via D-84. */

export const BILLING_TIERS = ['free', 'light', 'regular', 'heavy'] as const;
export type BillingTier = typeof BILLING_TIERS[number];
/** Decided flat monthly prices (D-78 amounts, 2026-10-28). Flat only: quotas
 * hard-stop overage, so there are no metered Stripe prices. */
export const TIER_PRICE_CENTS: Readonly<Record<BillingTier, number>> = Object.freeze({ free: 0, light: 2900, regular: 9900, heavy: 39900 });
export const PAID_TIERS: readonly BillingTier[] = ['light', 'regular', 'heavy'];

export const DAY_MS = 86_400_000;
export const PAUSED_RESOLUTIONS = ['pay', 'export', 'close'] as const;

export type BillingAccessState = 'active' | 'paused';
export interface BillingRecord {
  tenantId: string; tier: BillingTier | null; subscriptionStatus: string | null;
  accessState: BillingAccessState; pauseEffectiveAt: string | null;
  trialEndsAt: string | null; retentionDueAt: string | null;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null; updatedAt: string;
  lastStripeEventCreated: number | null;
}
export interface BillingConfig {
  apiKey: string; webhookSecret: string;
  trialEntitlement?: Entitlement;
  priceIds: Readonly<Record<'light' | 'regular' | 'heavy', string>>;
  tierEntitlements: Readonly<Partial<Record<BillingTier, Entitlement>>>;
}
export interface StripeClient {
  createCheckoutSession?(input: { priceId: string; tenantId: string; tier: BillingTier; origin: string; idempotencyKey: string }): Promise<{ id: string; url: string }>;
  createPaymentLink(input: { priceId: string; tenantId: string; tier: BillingTier; idempotencyKey: string }): Promise<{ id: string; url: string }>;
}
export type StripeFetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function configInvalid(): never { throw new MetadataError('BILLING_CONFIG_INVALID', 503); }
function secretField(value: string | undefined): string {
  if (!value || value.length > 512 || /[\s\x00-\x1f]/.test(value)) configInvalid();
  return value!;
}
function trialEntitlement(raw: string | undefined): Entitlement | undefined {
  if (raw === undefined) return undefined;
  try { return tierEntitlements(JSON.stringify({ light: JSON.parse(raw) })).light; }
  catch { configInvalid(); }
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
    if (env.OPENSIGHT_BILLING_TIER_ENTITLEMENTS !== undefined || env.OPENSIGHT_TRIAL_ENTITLEMENT !== undefined) configInvalid();
    return undefined;
  }
  if (present.length !== names.length) configInvalid();
  return Object.freeze({
    apiKey: secretField(env.OPENSIGHT_STRIPE_SECRET_KEY), webhookSecret: secretField(env.OPENSIGHT_STRIPE_WEBHOOK_SECRET),
    priceIds: Object.freeze({ light: secretField(env.OPENSIGHT_STRIPE_PRICE_LIGHT), regular: secretField(env.OPENSIGHT_STRIPE_PRICE_REGULAR), heavy: secretField(env.OPENSIGHT_STRIPE_PRICE_HEAVY) }),
    tierEntitlements: Object.freeze(tierEntitlements(env.OPENSIGHT_BILLING_TIER_ENTITLEMENTS)),
    trialEntitlement: trialEntitlement(env.OPENSIGHT_TRIAL_ENTITLEMENT),
  });
}

/** Thin Stripe REST client over an injectable fetcher: tests never make real
 * Stripe calls, and no card data ever touches OpenSight (Stripe hosts the
 * payment page). The official SDK is deliberately not a dependency. */
export function httpStripeClient(apiKey: string, fetcher: StripeFetcher = fetch as unknown as StripeFetcher): StripeClient {
  return {
    async createCheckoutSession({ priceId, tenantId, tier, origin, idempotencyKey }) {
      const form = new URLSearchParams({ mode: 'subscription', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
        'metadata[tenant_id]': tenantId, 'metadata[tier]': tier,
        'subscription_data[metadata][tenant_id]': tenantId, 'subscription_data[metadata][tier]': tier,
        success_url: `${origin}/#/admin/billing`, cancel_url: `${origin}/#/admin/billing` });
      try {
        const response = await fetcher('https://api.stripe.com/v1/checkout/sessions', { method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey }, body: form.toString() });
        const result = nested(await response.json());
        if (!response.ok || typeof result.id !== 'string' || typeof result.url !== 'string' || !result.url.startsWith('https://checkout.stripe.com/')) throw new Error();
        return { id: result.id, url: result.url };
      } catch { throw new MetadataError('STRIPE_REQUEST_FAILED', 502); }
    },
    async createPaymentLink({ priceId, tenantId, tier, idempotencyKey }) {
      const form = new URLSearchParams({
        'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
        'metadata[tenant_id]': tenantId, 'metadata[tier]': tier,
      });
      let response: Awaited<ReturnType<StripeFetcher>>;
      try {
        response = await fetcher('https://api.stripe.com/v1/payment_links', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey },
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
  const headerText = header as string;
  let timestamp: string | undefined; const signatures: string[] = [];
  for (const part of headerText.split(',')) {
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

export interface StripeEvent { id: string; type: string; created: number; object: Record<string, unknown> }
const SUBSCRIPTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
]);
const BILLING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed', ...SUBSCRIPTION_EVENT_TYPES,
  'invoice.payment_failed', 'invoice.paid', 'invoice.payment_succeeded',
]);
export function parseStripeEvent(rawBody: Buffer): StripeEvent {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)); } catch { throw new MetadataError('STRIPE_EVENT_INVALID', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MetadataError('STRIPE_EVENT_INVALID', 400);
  const event = parsed as Record<string, unknown>;
  const data = event.data !== null && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
  const object = data.object !== null && typeof data.object === 'object' && !Array.isArray(data.object) ? data.object as Record<string, unknown> : undefined;
  if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(event.id) || typeof event.type !== 'string' || !event.type || event.type.length > 128 || !object
    || typeof event.created !== 'number' || !Number.isSafeInteger(event.created) || event.created < 0)
    throw new MetadataError('STRIPE_EVENT_INVALID', 400);
  return { id: event.id, type: event.type, created: event.created, object };
}

export async function initializeBilling(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h9_billing (
      tenant_id TEXT PRIMARY KEY REFERENCES h1_tenants(tenant_id), tier TEXT, subscription_status TEXT,
      access_state TEXT NOT NULL DEFAULT 'active', pause_effective_at TEXT,
      stripe_customer_id TEXT, stripe_subscription_id TEXT, updated_at TEXT NOT NULL)`);
    const columns = await c.query(db.dialect === 'postgres'
      ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'h9_billing'"
      : 'PRAGMA table_info(h9_billing)');
    for (const column of ['trial_ends_at', 'retention_due_at']) {
      if (!columns.some(row => row.name === column)) await c.query(`ALTER TABLE h9_billing ADD COLUMN ${column} TEXT`);
    }
    if (!columns.some(row => row.name === 'last_stripe_event_created'))
      await c.query('ALTER TABLE h9_billing ADD COLUMN last_stripe_event_created BIGINT');
    for (const row of await c.query("SELECT tenant_id, pause_effective_at FROM h9_billing WHERE access_state = 'paused' AND pause_effective_at IS NOT NULL AND retention_due_at IS NULL")) {
      await c.query('UPDATE h9_billing SET retention_due_at = ? WHERE tenant_id = ?', [new Date(Date.parse(String(row.pause_effective_at)) + 30 * DAY_MS).toISOString(), row.tenant_id!]);
    }
    await c.query(`CREATE TABLE IF NOT EXISTS h9_billing_links (
      link_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES h1_tenants(tenant_id), tier TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await c.query(`CREATE TABLE IF NOT EXISTS h9_billing_operations (
      operation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL REFERENCES h1_tenants(tenant_id),
      kind TEXT NOT NULL CHECK (kind IN ('payment_link', 'checkout_session')),
      tier TEXT NOT NULL CHECK (tier IN ('light', 'regular', 'heavy')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
      price_id TEXT NOT NULL, checkout_origin TEXT,
      stripe_object_id TEXT, stripe_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await c.query('CREATE INDEX IF NOT EXISTS h9_billing_operations_tenant ON h9_billing_operations (tenant_id, kind, tier)');
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
    trialEndsAt: stringOrNull(row.trial_ends_at), retentionDueAt: stringOrNull(row.retention_due_at),
    lastStripeEventCreated: row.last_stripe_event_created == null ? null : Number(row.last_stripe_event_created),
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
  stripe?: StripeClient; clock?: () => number; origin?: string;
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
    await this.expireTrials();
  }
  /** null explicitly denies fallback to deployment defaults; undefined preserves
   * operator-created tenants without billing and legacy Free records. */
  tierEntitlement(tenantId: string): Entitlement | null | undefined {
    const record = this.records.get(tenantId);
    if (!record) return undefined;
    if (record.tier && PAID_TIERS.includes(record.tier)) return this.config.tierEntitlements[record.tier] ?? null;
    if (record.trialEndsAt) return Date.parse(record.trialEndsAt) > this.clock() ? this.config.trialEntitlement ?? null : null;
    if (record.tier === 'free') return this.config.tierEntitlements.free;
    return null;
  }
  trial(tenantId: string): { endsAt: string; daysRemaining: number } | null {
    const record = this.records.get(tenantId);
    if (!record?.trialEndsAt || record.tier && PAID_TIERS.includes(record.tier)) return null;
    return { endsAt: record.trialEndsAt, daysRemaining: Math.max(0, Math.ceil((Date.parse(record.trialEndsAt) - this.clock()) / DAY_MS)) };
  }
  /** Also usable inside provisioning's transaction so tenant and trial commit together. */
  async startTrialIn(c: SqlConnection, tenantId: string, provisionedAt = this.clock()): Promise<void> {
    if (!this.config.trialEntitlement) throw new MetadataError('TRIAL_ENTITLEMENT_UNRESOLVED', 503);
    const endsAt = new Date(provisionedAt + 14 * DAY_MS).toISOString();
    const rows = await c.query(`INSERT INTO h9_billing (tenant_id, access_state, trial_ends_at, updated_at)
      VALUES (?, 'active', ?, ?) ON CONFLICT (tenant_id) DO NOTHING RETURNING tenant_id`, [tenantId, endsAt, new Date(provisionedAt).toISOString()]);
    if (rows.length) await appendOperatorAudit(c, { action: 'billing.trial.started', tenantId, detail: { trialEndsAt: endsAt } }, provisionedAt);
  }
  async startTrial(tenantId: string): Promise<void> {
    await this.db.transaction(c => this.startTrialIn(c, identifier(tenantId)));
    await this.load();
  }
  /** Lazy durable expiry uses the actual deadline, never the polling time. */
  async expireTrials(): Promise<void> {
    const expired = await this.db.transaction(async c => {
      const rows = await c.query(`UPDATE h9_billing SET access_state = 'paused', pause_effective_at = trial_ends_at,
        updated_at = ? WHERE trial_ends_at <= ? AND (tier IS NULL OR tier = 'free') AND access_state <> 'paused' RETURNING *`, [this.nowIso(), this.nowIso()]);
      for (const row of rows) {
        const retentionDueAt = new Date(Date.parse(String(row.trial_ends_at)) + 30 * DAY_MS).toISOString();
        await c.query('UPDATE h9_billing SET retention_due_at = ? WHERE tenant_id = ?', [retentionDueAt, String(row.tenant_id)]);
        row.retention_due_at = retentionDueAt;
        await appendOperatorAudit(c, { action: 'billing.access.paused', tenantId: String(row.tenant_id),
          detail: { reason: 'trial_expired', pauseEffectiveAt: row.trial_ends_at, retentionDueAt } }, Date.parse(String(row.trial_ends_at)));
      }
      return rows;
    });
    for (const row of expired) {
      const record = asRecord(row)!; this.records.set(record.tenantId, record);
      await this.notifyPause(record.tenantId, record.pauseEffectiveAt!, 'trial_expired');
    }
  }
  private async notifyPause(tenantId: string, effectiveAt: string, reason: string): Promise<void> {
    if (!this.options.mail?.configured || !this.options.notifyTo) return;
    await this.options.mail.send({ to: [this.options.notifyTo], subject: `OpenSight billing: tenant ${tenantId} access paused`,
      html: `<p>Tenant ${tenantId} entered the billing paused state (${reason}). Access pauses at ${effectiveAt}; data is retained for 30 days. Resolve by paying in Stripe, exporting data, or closing the workspace.</p>`,
      dedupeKey: createHmac('sha256', 'billing-pause').update(`${tenantId}:${effectiveAt}`).digest('hex'),
    }).catch(() => undefined);
  }
  /** The past-due gate: a paused tenant whose pause is in effect gets no
   * hosted access. Data is retained; only an admin resolution reopens it. */
  assertAccess(tenantId: string): void {
    const record = this.records.get(tenantId);
    if (record?.trialEndsAt && (!record.tier || !PAID_TIERS.includes(record.tier)) && Date.parse(record.trialEndsAt) <= this.clock())
      throw new MetadataError('TRIAL_EXPIRED', 403);
    if (record?.accessState === 'paused' && record.pauseEffectiveAt && Date.parse(record.pauseEffectiveAt) <= this.clock())
      throw new MetadataError('BILLING_ACCESS_PAUSED', 403);
  }
  accessPaused(tenantId: string): boolean {
    try { this.assertAccess(tenantId); return false; } catch (error) { if (error instanceof MetadataError && ['TRIAL_EXPIRED', 'BILLING_ACCESS_PAUSED'].includes(error.code)) return true; throw error; }
  }
  async state(tenantId: string): Promise<BillingRecord | { tenantId: string; status: 'none' }> {
    identifier(tenantId);
    await this.expireTrials();
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
    const link = await this.stripe.createPaymentLink({ priceId: this.config.priceIds[paidTier], tenantId, tier: paidTier, idempotencyKey: randomUUID() });
    await this.db.transaction(async c => {
      await c.query('INSERT INTO h9_billing_links (link_id, tenant_id, tier, created_at) VALUES (?,?,?,?)', [link.id, tenantId, paidTier, this.nowIso()]);
      await appendOperatorAudit(c, { action: 'billing.payment_link.created', tenantId, subject: link.id, detail: { tier: paidTier, priceCents: TIER_PRICE_CENTS[paidTier] } }, this.clock());
    });
    return { ...link, tier: paidTier };
  }
  async createCheckoutSession(tenantId: string, tier: unknown): Promise<{ id: string; url: string }> {
    identifier(tenantId);
    if (typeof tier !== 'string' || !PAID_TIERS.includes(tier as BillingTier)) throw new MetadataError('BILLING_TIER_INVALID', 400);
    if (!this.options.origin || !this.stripe.createCheckoutSession) throw new MetadataError('BILLING_CHECKOUT_UNAVAILABLE', 503);
    if (!(await this.db.transaction(c => c.query("SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? AND state = 'active'", [tenantId]))).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    const record = await this.state(tenantId);
    if (!('status' in record) && record.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(record.subscriptionStatus ?? '')) throw new MetadataError('BILLING_SUBSCRIPTION_EXISTS', 409);
    const paidTier = tier as 'light' | 'regular' | 'heavy';
    const session = await this.stripe.createCheckoutSession({ tenantId, tier: paidTier, priceId: this.config.priceIds[paidTier], origin: this.options.origin, idempotencyKey: randomUUID() });
    await this.db.transaction(c => appendOperatorAudit(c, { action: 'billing.checkout.created', tenantId, subject: session.id, detail: { tier: paidTier } }, this.clock()));
    return session;
  }
  private tierForPrice(priceId: string | null): BillingTier | undefined {
    if (!priceId) return undefined;
    for (const tier of PAID_TIERS) if (this.config.priceIds[tier as 'light' | 'regular' | 'heavy'] === priceId) return tier as BillingTier;
    return undefined;
  }
  private async resolveTenant(c: SqlConnection, event: StripeEvent): Promise<{ tenantId: string; linkTier?: BillingTier; checkoutBinding?: boolean } | undefined> {
    const object = event.object;
    const metadata = nested(object.metadata);
    const metaTenant = stringOrNull(metadata.tenant_id);
    if (metaTenant) { try { return { tenantId: identifier(metaTenant), checkoutBinding: event.type === 'checkout.session.completed', ...(event.type === 'checkout.session.completed' && PAID_TIERS.includes(metadata.tier as BillingTier) ? { linkTier: metadata.tier as BillingTier } : {}) }; } catch { /* fall through to durable bindings */ } }
    const paymentLink = event.type === 'checkout.session.completed' ? stringOrNull(object.payment_link) : null;
    if (paymentLink) {
      const link = (await c.query('SELECT tenant_id, tier FROM h9_billing_links WHERE link_id = ?', [paymentLink]))[0];
      if (link) return { tenantId: String(link.tenant_id), linkTier: String(link.tier) as BillingTier, checkoutBinding: true };
    }
    const subscriptionId = SUBSCRIPTION_EVENT_TYPES.has(event.type) ? stringOrNull(object.id) : stringOrNull(object.subscription);
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
        if (!BILLING_EVENT_TYPES.has(event.type)) {
          await c.query('UPDATE h9_billing_events SET outcome = ? WHERE event_id = ?', ['ignored', event.id]);
          return { duplicate: false, handled: false, tenantId: null, action: 'ignored' } satisfies BillingEventResult;
        }
        const resolved = await this.resolveTenant(c, event);
        if (!resolved) {
          await c.query('UPDATE h9_billing_events SET outcome = ? WHERE event_id = ?', ['unmatched', event.id]);
          await appendOperatorAudit(c, { action: 'billing.event.unmatched', subject: event.id, detail: { type: event.type, stripeEventId: event.id } }, this.clock());
          return { duplicate: false, handled: false, tenantId: null, action: 'unmatched' } satisfies BillingEventResult;
        }
        const { tenantId } = resolved;
        // Lock the parent even before the first billing row exists. PostgreSQL
        // transactions otherwise race at READ COMMITTED; SQLite uses BEGIN IMMEDIATE.
        if (this.db.dialect === 'postgres') await c.query('SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? FOR UPDATE', [tenantId]);
        const existing = asRecord((await c.query('SELECT * FROM h9_billing WHERE tenant_id = ?', [tenantId]))[0]);
        const object = event.object;
        const subscriptionId = SUBSCRIPTION_EVENT_TYPES.has(event.type) ? stringOrNull(object.id) : stringOrNull(object.subscription);
        // Only tenant-bound checkout (metadata or a stored operator payment
        // link), or subscription.created for the bound customer, may replace a
        // binding. Customer/metadata resolution alone never authorizes updates
        // or invoices for another subscription, including an unbound tenant.
        const mayBind = resolved.checkoutBinding || event.type === 'customer.subscription.created'
          && existing?.stripeCustomerId != null && existing.stripeCustomerId === stringOrNull(object.customer);
        if (!subscriptionId || subscriptionId !== existing?.stripeSubscriptionId && !mayBind) {
          await c.query('UPDATE h9_billing_events SET tenant_id = ?, outcome = ? WHERE event_id = ?', [tenantId, 'foreign_subscription', event.id]);
          return { duplicate: false, handled: false, tenantId, action: 'foreign_subscription' } satisfies BillingEventResult;
        }
        // Stripe timestamps have one-second precision, and event IDs do not
        // establish chronology. Equal-created events are first-applied-wins:
        // keep the committed state and record subsequent ties as stale.
        if (existing?.lastStripeEventCreated != null && event.created <= existing.lastStripeEventCreated) {
          await c.query('UPDATE h9_billing_events SET tenant_id = ?, outcome = ? WHERE event_id = ?', [tenantId, 'stale', event.id]);
          return { duplicate: false, handled: false, tenantId, action: 'stale' } satisfies BillingEventResult;
        }
        await c.query('UPDATE h9_billing_events SET tenant_id = ?, outcome = ? WHERE event_id = ?', [tenantId, 'applied', event.id]);
        const next: BillingRecord = existing ? { ...existing } : { tenantId, trialEndsAt: null, retentionDueAt: null, tier: null, subscriptionStatus: null, accessState: 'active', pauseEffectiveAt: null, stripeCustomerId: null, stripeSubscriptionId: null, lastStripeEventCreated: null, updatedAt: this.nowIso() };
        let action = 'recorded';
        // A trial converts to paid entitlements only on a verified successful
        // billing transition in THIS event (#212): an unpaid checkout or an
        // incomplete subscription binds and is recorded, but must not assign
        // the paid tier or clear the trial expiry.
        let conversionAuthorized = false;
        if (event.type === 'checkout.session.completed') {
          next.stripeCustomerId = stringOrNull(object.customer) ?? next.stripeCustomerId;
          next.stripeSubscriptionId = stringOrNull(object.subscription) ?? next.stripeSubscriptionId;
          const paymentVerified = ['paid', 'no_payment_required'].includes(String(object.payment_status));
          if (resolved.linkTier && paymentVerified) {
            next.tier = resolved.linkTier;
            conversionAuthorized = true;
            if (stringOrNull(nested(object.metadata).tier)) { next.accessState = 'active'; next.pauseEffectiveAt = null; }
          }
          action = 'checkout_completed';
        } else if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
          const status = event.type === 'customer.subscription.deleted' ? 'canceled' : stringOrNull(object.status) ?? next.subscriptionStatus;
          next.stripeCustomerId = stringOrNull(object.customer) ?? next.stripeCustomerId;
          next.stripeSubscriptionId = stringOrNull(object.id) ?? next.stripeSubscriptionId;
          const items = nested(object.items), first = Array.isArray(items.data) ? nested(items.data[0]) : {};
          const priceTier = this.tierForPrice(stringOrNull(nested(first.price).id));
          // The price tier becomes the entitlement only once the subscription
          // itself authorizes it; other statuses (incomplete, past_due, ...)
          // are recorded in subscriptionStatus without touching the tier, so
          // an incomplete payment stays represented separately (#212).
          if (priceTier && (status === 'active' || status === 'trialing')) { next.tier = priceTier; conversionAuthorized = true; }
          next.subscriptionStatus = status;
          if (status === 'active' || status === 'trialing') {
            if (next.accessState === 'paused') action = 'access_restored';
            next.accessState = 'active'; next.pauseEffectiveAt = null;
          } else if (status === 'unpaid' || status === 'incomplete_expired') {
            if (next.accessState !== 'paused') { action = 'access_paused'; pauseNotice = { tenantId, effectiveAt: this.nowIso(), reason: `subscription_${status}` }; }
            next.accessState = 'paused'; next.pauseEffectiveAt = next.pauseEffectiveAt && Date.parse(next.pauseEffectiveAt) <= this.clock() ? next.pauseEffectiveAt : this.nowIso();
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
        if (conversionAuthorized && next.tier && PAID_TIERS.includes(next.tier)) next.trialEndsAt = null;
        next.retentionDueAt = next.pauseEffectiveAt ? new Date(Date.parse(next.pauseEffectiveAt) + 30 * DAY_MS).toISOString() : null;
        next.updatedAt = this.nowIso();
        next.lastStripeEventCreated = event.created;
        await c.query(`INSERT INTO h9_billing (tenant_id, tier, subscription_status, access_state, pause_effective_at, stripe_customer_id, stripe_subscription_id, updated_at, trial_ends_at, retention_due_at, last_stripe_event_created)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (tenant_id) DO UPDATE SET tier = excluded.tier, subscription_status = excluded.subscription_status,
          access_state = excluded.access_state, pause_effective_at = excluded.pause_effective_at, stripe_customer_id = excluded.stripe_customer_id,
          stripe_subscription_id = excluded.stripe_subscription_id, updated_at = excluded.updated_at, trial_ends_at = excluded.trial_ends_at, retention_due_at = excluded.retention_due_at,
          last_stripe_event_created = excluded.last_stripe_event_created`,
        [next.tenantId, next.tier, next.subscriptionStatus, next.accessState, next.pauseEffectiveAt, next.stripeCustomerId, next.stripeSubscriptionId, next.updatedAt, next.trialEndsAt, next.retentionDueAt, next.lastStripeEventCreated]);
        if (existing?.trialEndsAt && !next.trialEndsAt && next.tier && PAID_TIERS.includes(next.tier)) await appendOperatorAudit(c, { action: 'billing.trial.converted', tenantId, detail: { tier: next.tier, stripeEventId: event.id } }, this.clock());
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
    if (pauseNotice) {
      const notice = pauseNotice as { tenantId: string; effectiveAt: string; reason: string };
      await this.notifyPause(notice.tenantId, notice.effectiveAt, notice.reason);
    }
    return result;
  }
}
