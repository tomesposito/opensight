import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { digest, seal, unseal } from './auth-crypto.js';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { HostedProvisioning, operatorOperationId } from './hosted-provisioning.js';
import { HostedBilling, DAY_MS } from './hosted-billing.js';
import { normalizedEmail } from './hosted-auth.js';
import { deriveWorkspaceSlug, parseWorkspaceSlug } from './workspace-naming.js';
import type { MailTransport } from './mail.js';
import { appendOperatorAudit } from './operator-audit.js';
import { escapeHtml } from './reports.js';

export const SIGNUP_ACCEPTED = Object.freeze({ received: true, message: 'Check your email for the next step.' });
export const SIGNUP_QUEUED = Object.freeze({ queued: true, message: "Signups are opening in batches; we'll email you when your workspace is ready." });
export interface SignupConfig { enabled: boolean; origin: string; encryptionKey: Buffer; blocklistFile?: string; challengeSecret?: string; volumeCap: number }
export type ChallengeVerifier = (token: string, ip: string) => Promise<boolean>;
export function signupConfig(env: NodeJS.ProcessEnv, origin: string, encryptionKey: Buffer): SignupConfig {
  if (env.OPENSIGHT_SIGNUP_ENABLED !== undefined && !['true', 'false'].includes(env.OPENSIGHT_SIGNUP_ENABLED)) throw new MetadataError('SIGNUP_CONFIG_INVALID', 503);
  const volumeCap = Number(env.OPENSIGHT_SIGNUP_VOLUME_CAP ?? '25');
  if (!Number.isSafeInteger(volumeCap) || volumeCap < 1) throw new MetadataError('SIGNUP_CONFIG_INVALID', 503);
  return { enabled: env.OPENSIGHT_SIGNUP_ENABLED === 'true', origin, encryptionKey, volumeCap,
    blocklistFile: env.OPENSIGHT_SIGNUP_BLOCKLIST_FILE, challengeSecret: env.OPENSIGHT_SIGNUP_CHALLENGE_SECRET };
}
/** Managed challenge is verified on the server. No challenge/secret means deny,
 * never a client-asserted success. Tests inject a verifier and make no network calls. */
export function challengeVerifier(secret: string | undefined): ChallengeVerifier {
  return async (token, ip) => {
    if (!secret || !token) return false;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
        body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(10000) });
      const result = await response.json() as { success?: unknown; hostname?: unknown; action?: unknown };
      return response.ok && result.success === true && result.hostname === 'getopensight.org' && result.action === 'signup';
    } catch { return false; }
  };
}
export function normalizeSignupEmail(raw: unknown): string {
  const email = normalizedEmail(raw), [local, domain] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local!.split('+')[0]!.replaceAll('.', '')}@gmail.com`;
  return email;
}
function label(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(raw)) throw new MetadataError('SIGNUP_INVALID', 400);
  return raw.trim();
}
export async function initializeSignups(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h10_signups (
      id TEXT PRIMARY KEY, normalized_email TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
      display_name TEXT NOT NULL, slug TEXT NOT NULL, admin_name TEXT NOT NULL,
      token_digest TEXT NOT NULL UNIQUE, token_secret TEXT NOT NULL, expires_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', created_ip TEXT NOT NULL, created_at TEXT NOT NULL,
      verified_at TEXT, tenant_id TEXT, trial_started_at TEXT, queued_at TEXT)`);
    await c.query(`CREATE TABLE IF NOT EXISTS h10_signup_settings (id INTEGER PRIMARY KEY, paused INTEGER NOT NULL)`);
    await c.query('INSERT INTO h10_signup_settings VALUES (1,0) ON CONFLICT (id) DO NOTHING');
  });
}
export class HostedSignup {
  constructor(private readonly db: Database, private readonly provisioning: HostedProvisioning,
    private readonly billing: HostedBilling, private readonly mail: MailTransport, readonly config: SignupConfig,
    private readonly verifyChallenge = challengeVerifier(config.challengeSecret), private readonly clock = Date.now) {}
  private enabled(): void { if (!this.config.enabled) throw new MetadataError('RESOURCE_NOT_FOUND', 404); }
  async limit(kind: 'form' | 'slug' | 'resend-ip' | 'resend-email', value: string): Promise<void> {
    const limits = { form: 5, slug: 30, 'resend-ip': 5, 'resend-email': 3 }, now = this.clock();
    const bucket = `signup:${kind}:${digest(value)}`;
    const allowed = await this.db.transaction(async c => {
      await c.query("DELETE FROM h2_attempts WHERE bucket LIKE 'signup:%' AND window_start <= ?", [now - 3600000]);
      const row = (await c.query(`INSERT INTO h2_attempts VALUES (?,?,1) ON CONFLICT (bucket)
        DO UPDATE SET attempts = h2_attempts.attempts + 1 RETURNING attempts`, [bucket, now]))[0]!;
      return Number(row.attempts) <= limits[kind];
    });
    if (!allowed) throw new MetadataError('SIGNUP_RATE_LIMITED', 429);
  }
  async slug(raw: unknown, ip: string): Promise<{ available: boolean }> {
    this.enabled(); await this.limit('slug', ip);
    const slug = parseWorkspaceSlug(raw); if (!slug) throw new MetadataError('SIGNUP_INVALID', 400);
    return { available: !(await this.db.transaction(c => c.query('SELECT tenant_id FROM h1_tenants WHERE slug = ?', [slug]))).length };
  }
  private async blocked(email: string): Promise<boolean> {
    if (!this.config.blocklistFile) throw new MetadataError('SIGNUP_BLOCKLIST_UNAVAILABLE', 503);
    let text: string;
    try { text = await readFile(this.config.blocklistFile, 'utf8'); } catch { throw new MetadataError('SIGNUP_BLOCKLIST_UNAVAILABLE', 503); }
    const domains = new Set(text.split(/\r?\n/).map(line => line.split('#')[0]!.trim().toLowerCase()).filter(Boolean));
    const domain = email.split('@')[1]!;
    return [...domains].some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));
  }
  private async sendVerification(row: SqlRow): Promise<void> {
    const token = unseal(String(row.token_secret), this.config.encryptionKey, `signup:${row.id}`);
    await this.mail.send({ to: [String(row.email)], subject: 'Confirm your OpenSight workspace',
      html: `<p><a href="${escapeHtml(this.config.origin)}/#signup=${token}">Confirm your email and create your workspace</a></p><p>This single-use link expires in 24 hours.</p>` });
  }
  async request(input: Record<string, unknown>, ip: string): Promise<typeof SIGNUP_ACCEPTED> {
    this.enabled(); await this.limit('form', ip);
    const displayName = label(input.displayName), adminName = label(input.adminName), email = normalizedEmail(input.adminEmail), normalized = normalizeSignupEmail(email);
    const slug = parseWorkspaceSlug(input.slug) ?? deriveWorkspaceSlug(displayName);
    if (!slug) throw new MetadataError('SIGNUP_INVALID', 400);
    if (await this.blocked(email)) throw new MetadataError('SIGNUP_PERMANENT_EMAIL_REQUIRED', 400);
    if (typeof input.challengeToken !== 'string' || input.challengeToken.length > 4096 || !await this.verifyChallenge(input.challengeToken, ip)) throw new MetadataError('SIGNUP_CHALLENGE_REQUIRED', 403);
    const result = await this.db.transaction(async c => {
      await c.query('UPDATE h10_signup_settings SET id = id WHERE id = 1');
      const prior = (await c.query('SELECT * FROM h10_signups WHERE normalized_email = ?', [digest(normalized)]))[0];
      // Check legacy administrator emails too, including well-known aliases.
      const admins = await c.query(`SELECT i.email, u.body FROM h2_identities i JOIN h2_memberships m ON m.subject = i.subject
        JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id
        WHERE u.kind = 'user' AND m.status <> 'removed'`);
      const known = admins.some(row => (JSON.parse(String(row.body)) as { role?: string }).role === 'administrator' && normalizeSignupEmail(row.email) === normalized);
      if (known || prior?.trial_started_at) return { known: true };
      if (prior) return { known: false }; // Resend is the bounded retry path.
      const id = randomUUID(), token = randomBytes(32).toString('base64url'), now = new Date(this.clock()).toISOString();
      await c.query(`INSERT INTO h10_signups (id, normalized_email, email, display_name, slug, admin_name, token_digest, token_secret, expires_at, created_ip, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id, digest(normalized), email, displayName, slug, adminName, digest(token), seal(token, this.config.encryptionKey, `signup:${id}`), new Date(this.clock() + DAY_MS).toISOString(), digest(ip), now]);
      await appendOperatorAudit(c, { action: 'signup.requested', subject: id, detail: { slug } }, this.clock());
      return { known: false, row: (await c.query('SELECT * FROM h10_signups WHERE id = ?', [id]))[0] };
    });
    // Identical HTTP body/status regardless of account existence or delivery failure.
    if (result.known) await this.mail.send({ to: [email], subject: 'Your OpenSight workspace', html: `<p>You already have a workspace or have used your trial. <a href="${escapeHtml(this.config.origin)}">Sign in to OpenSight</a>.</p>` }).catch(() => undefined);
    else if (result.row) await this.sendVerification(result.row).catch(() => undefined);
    return SIGNUP_ACCEPTED;
  }
  async resend(raw: unknown, ip: string): Promise<typeof SIGNUP_ACCEPTED> {
    this.enabled(); await this.limit('resend-ip', ip); const email = normalizeSignupEmail(raw); await this.limit('resend-email', email);
    if (await this.blocked(email)) throw new MetadataError('SIGNUP_PERMANENT_EMAIL_REQUIRED', 400);
    const row = await this.db.transaction(async c => {
      await c.query('UPDATE h10_signup_settings SET id = id WHERE id = 1');
      const prior = (await c.query("SELECT * FROM h10_signups WHERE normalized_email = ? AND trial_started_at IS NULL AND verified_at IS NULL", [digest(email)]))[0];
      if (!prior) return;
      const token = randomBytes(32).toString('base64url');
      await c.query("UPDATE h10_signups SET token_digest = ?, token_secret = ?, expires_at = ?, state = 'pending' WHERE id = ?", [digest(token), seal(token, this.config.encryptionKey, `signup:${prior.id}`), new Date(this.clock() + DAY_MS).toISOString(), prior.id!]);
      return (await c.query('SELECT * FROM h10_signups WHERE id = ?', [prior.id!]))[0];
    });
    if (row) await this.sendVerification(row).catch(() => undefined);
    return SIGNUP_ACCEPTED;
  }
  /** Slice 5 supplies runtime pause/cap admission under the provisioning lock. */
  admission?: (c: SqlConnection, signup: SqlRow) => Promise<boolean>;
  async verify(raw: unknown): Promise<{ invitationToken: string; tenantId: string } | typeof SIGNUP_QUEUED> {
    this.enabled();
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new MetadataError('SIGNUP_TOKEN_INVALID', 400);
    const row = await this.db.transaction(async c => {
      const row = (await c.query('SELECT * FROM h10_signups WHERE token_digest = ?', [digest(raw)]))[0];
      if (!row) throw new MetadataError('SIGNUP_TOKEN_INVALID', 400);
      if (row.state === 'verified') throw new MetadataError('SIGNUP_ALREADY_VERIFIED', 409);
      if (Date.parse(String(row.expires_at)) <= this.clock() && !row.verified_at) {
        await c.query("UPDATE h10_signups SET state = 'expired' WHERE id = ?", [row.id!]); return undefined;
      }
      return row;
    });
    if (!row) throw new MetadataError('SIGNUP_TOKEN_EXPIRED', 410);
    return this.provision(row);
  }
  async provision(row: SqlRow): Promise<{ invitationToken: string; tenantId: string } | typeof SIGNUP_QUEUED> {
    try {
      const op = await this.provisioning.provision(`signup-${row.id}`, { name: String(row.display_name), displayName: String(row.display_name), slug: String(row.slug), administrator: { name: String(row.admin_name), email: String(row.email) } }, {
        via: 'self_serve_signup', beforeCreate: async c => {
          const current = (await c.query('SELECT * FROM h10_signups WHERE id = ?', [row.id!]))[0]!;
          if (current.token_digest !== row.token_digest) throw new MetadataError('SIGNUP_TOKEN_INVALID', 400);
          if (current.state !== 'pending') throw new MetadataError('SIGNUP_ALREADY_VERIFIED', 409);
          if (!current.verified_at && Date.parse(String(current.expires_at)) <= this.clock()) throw new MetadataError('SIGNUP_TOKEN_EXPIRED', 410);
          if (this.admission && !await this.admission(c, current)) throw new MetadataError('SIGNUP_QUEUED', 202);
        }, onCreated: async (c, tenantId) => {
          const verified = (await c.query('SELECT verified_at FROM h10_signups WHERE id = ?', [row.id!]))[0]?.verified_at;
          await this.billing.startTrialIn(c, tenantId, this.clock());
          await c.query("UPDATE h10_signups SET state = 'verified', verified_at = ?, tenant_id = ?, trial_started_at = ?, token_secret = '' WHERE id = ?", [new Date(this.clock()).toISOString(), tenantId, new Date(this.clock()).toISOString(), row.id!]);
          if (!verified) await appendOperatorAudit(c, { action: 'signup.verified', tenantId, subject: String(row.id), detail: { via: 'self_serve_signup' } }, this.clock());
        },
      });
      await this.billing.load();
      const invitation = (await this.db.transaction(c => c.query('SELECT token_secret FROM h2_invitations WHERE invitation_id = ?', [operatorOperationId(`signup-${row.id}`)])))[0]!;
      return { tenantId: op.tenantId, invitationToken: unseal(String(invitation.token_secret), this.config.encryptionKey, `invitation:${operatorOperationId(`signup-${row.id}`)}`) };
    } catch (error) {
      if (!(error instanceof MetadataError) || error.code !== 'SIGNUP_QUEUED') throw error;
      await this.db.transaction(async c => {
        const first = await c.query("UPDATE h10_signups SET verified_at = ?, queued_at = ? WHERE id = ? AND state = 'pending' AND verified_at IS NULL RETURNING id", [new Date(this.clock()).toISOString(), new Date(this.clock()).toISOString(), row.id!]);
        if (first.length) await appendOperatorAudit(c, { action: 'signup.verified', subject: String(row.id), detail: { via: 'self_serve_signup', queued: true } }, this.clock());
      });
      return SIGNUP_QUEUED;
    }
  }
}
