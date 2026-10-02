import { eventContext } from './hosted-events.js';
import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SecurityOptions, Identity } from './security.js';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import type { HostedConfig } from './hosted-config.js';
import { base32, digest, equal, hashPassword, passwordInput, seal, unseal, verifyPassword, verifyTotp } from './auth-crypto.js';
import { identifier } from './metadata-resources.js';
import { emailAddress } from './mail.js';

function denied(): never { throw new MetadataError('AUTHENTICATION_FAILED', 401); }
export function normalizedEmail(value: unknown): string {
  if (!emailAddress(value)) throw new MetadataError('EMAIL_INVALID', 400);
  return value.toLowerCase();
}
export function tokenInput(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) denied();
  return value;
}
const membershipSelect = `SELECT m.*, t.state, r."authorization", r.policy, r.configuration, u.body FROM h2_memberships m
  JOIN h1_tenants t ON t.tenant_id = m.tenant_id
  JOIN h1_revisions r ON r.tenant_id = m.tenant_id AND r.namespace_id = m.namespace_id
  JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = m.user_id`;

/** Trusted operator action. A retired key ID can never be reactivated by an old process. */
export async function activateAuthKey(database: Database, config: HostedConfig): Promise<void> {
  await database.transaction(async c => {
    await c.query('UPDATE h2_control SET id = id WHERE id = 1');
    const prior = (await c.query('SELECT * FROM h2_keys WHERE key_id = ?', [config.keyId]))[0];
    const fingerprint = digest(config.signingKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint || Number(prior.active) !== 1) throw new MetadataError('AUTH_KEY_REUSED', 503);
      return;
    }
    await c.query('UPDATE h2_keys SET active = 0 WHERE active = 1');
    await c.query('INSERT INTO h2_keys VALUES (?,?,1)', [config.keyId, fingerprint]);
  });
}

export class HostedAuth {
  private constructor(private readonly database: Database, private readonly config: HostedConfig, private readonly clock: () => number) {}
  static async create(database: Database, config: HostedConfig, clock = Date.now): Promise<HostedAuth> {
    if (database.durable !== true) throw new MetadataError('DURABLE_MEMBERSHIP_STORE_REQUIRED', 503);
    const auth = new HostedAuth(database, config, clock);
    await database.transaction(async c => {
      await c.query('UPDATE h2_control SET id = id WHERE id = 1');
      if (!(await c.query('SELECT * FROM h2_keys')).length) await c.query('INSERT INTO h2_keys VALUES (?,?,1)', [config.keyId, digest(config.signingKey)]);
      await auth.key(c);
    });
    return auth;
  }
  private async key(c: SqlConnection): Promise<void> {
    const key = (await c.query('UPDATE h2_keys SET active = active WHERE key_id = ? AND active = 1 RETURNING *', [this.config.keyId]))[0];
    if (!key || Number(key.active) !== 1 || !equal(String(key.fingerprint), digest(this.config.signingKey))) throw new MetadataError('AUTH_KEY_REVOKED', 401);
  }
  /** Reserve attempts before expensive crypto; durable buckets survive restarts and serialize nodes. */
  async limit(principal: string, peer: string): Promise<void> {
    const now = this.clock(), window = 900000;
    const allowed = await this.database.transaction(async c => {
      await c.query('DELETE FROM h2_attempts WHERE window_start <= ?', [now - window]);
      let allowed = true;
      for (const [name, maximum] of [['global', 200], [`peer:${peer}`, 50], [`principal:${principal}`, 10]] as const) {
        const bucket = digest(name);
        const row = (await c.query(`INSERT INTO h2_attempts VALUES (?,?,1)
          ON CONFLICT (bucket) DO UPDATE SET attempts = h2_attempts.attempts + 1 RETURNING attempts`, [bucket, now]))[0]!;
        if (Number(row.attempts) > maximum) { allowed = false; break; }
      }
      return allowed;
    });
    if (!allowed) throw new MetadataError('AUTH_RATE_LIMITED', 429);
  }
  private async membership(c: SqlConnection, subject: string, tenantId: string, invited = false): Promise<SqlRow> {
    // Same lock order as H1 admission: tenant first. A committed suspension wins subsequent admission.
    const lock = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' AND NOT EXISTS (SELECT 1 FROM h8_restore_holds h WHERE h.tenant_id = h1_tenants.tenant_id) RETURNING version", [tenantId]);
    if (!lock.length) denied();
    const row = (await c.query(`${membershipSelect} WHERE m.subject = ? AND m.tenant_id = ?`, [subject, tenantId]))[0];
    if (!row || row.state !== 'active' || row.status !== 'active' && !(invited && row.status === 'invited')) denied();
    const event = eventContext.getStore();
    if (event) { event.tenantId = tenantId; event.namespaceId = String(row.namespace_id); event.resourceRevision = Number(row.authorization); }
    return row;
  }
  private async invitation(c: SqlConnection, token: string): Promise<SqlRow> {
    const row = (await c.query('SELECT * FROM h2_invitations WHERE token_hash = ?', [digest(token)]))[0];
    if (!row || Number(row.expires_at) <= this.clock() || !equal(String(row.token_hash), digest(token))) denied();
    await this.membership(c, String(row.subject), String(row.tenant_id), true);
    return row;
  }
  async enroll(tokenValue: unknown, passwordValue: unknown, peer: string): Promise<{ enrollmentRequired: boolean; secret?: string; uri?: string }> {
    const token = tokenInput(tokenValue), password = passwordInput(passwordValue);
    await this.limit(`invite:${digest(token)}`, peer);
    const invite = await this.database.transaction(c => this.invitation(c, token));
    const subject = String(invite.subject);
    // Do memory-hard work outside the database transaction; compare state again before storing.
    const existing = (await this.database.transaction(c => c.query('SELECT * FROM h2_identities WHERE subject = ?', [subject])))[0]!;
    if (existing.status === 'active') return { enrollmentRequired: false };
    const passwordHash = existing.password_hash ? String(existing.password_hash) : await hashPassword(password);
    if (existing.password_hash && !await verifyPassword(password, passwordHash)) denied();
    const secret = existing.totp_secret ? unseal(String(existing.totp_secret), this.config.encryptionKey, `totp:${subject}`) : randomBytes(20).toString('base64');
    return this.database.transaction(async c => {
      await this.invitation(c, token);
      const changed = await c.query(`UPDATE h2_identities SET password_hash = ?, totp_secret = ?, status = 'enrolling'
        WHERE subject = ? AND status = ? AND COALESCE(password_hash, '') = ? RETURNING subject`,
        [passwordHash, seal(secret, this.config.encryptionKey, `totp:${subject}`), subject, String(existing.status), String(existing.password_hash ?? '')]);
      if (!changed.length) throw new MetadataError('AUTH_ENROLLMENT_CONFLICT', 409);
      const encoded = base32(Buffer.from(secret, 'base64'));
      return { enrollmentRequired: true, secret: encoded, uri: `otpauth://totp/${encodeURIComponent(`OpenSight:${existing.email}`)}?secret=${encoded}&issuer=OpenSight&algorithm=SHA1&digits=6&period=30` };
    });
  }
  private async credentials(subject: string, password: string): Promise<SqlRow> {
    const row = (await this.database.transaction(c => c.query('SELECT * FROM h2_identities WHERE subject = ?', [subject])))[0];
    if (!row?.password_hash || !await verifyPassword(password, String(row.password_hash))) denied();
    return row;
  }
  private async consumeTotp(c: SqlConnection, credentials: SqlRow, code: string, replay = false): Promise<void> {
    const subject = String(credentials.subject), encrypted = String(credentials.totp_secret);
    const secret = Buffer.from(unseal(encrypted, this.config.encryptionKey, `totp:${subject}`), 'base64');
    const step = verifyTotp(secret, code, this.clock(), replay ? -1 : Number(credentials.last_step));
    if (step === undefined) denied();
    if (replay) return;
    const rows = await c.query(`UPDATE h2_identities SET last_step = ? WHERE subject = ? AND last_step < ? AND password_hash = ? AND totp_secret = ? RETURNING subject`,
      [step, subject, step, String(credentials.password_hash), encrypted]);
    if (!rows.length) denied();
  }
  async accept(tokenValue: unknown, passwordValue: unknown, code: string, peer: string): Promise<{ accepted: true }> {
    const token = tokenInput(tokenValue), password = passwordInput(passwordValue);
    await this.limit(`invite:${digest(token)}`, peer);
    const invite = await this.database.transaction(c => this.invitation(c, token));
    const credentials = await this.credentials(String(invite.subject), password);
    return this.database.transaction(async c => {
      const current = await this.invitation(c, token);
      // Accepted replays only acknowledge completion. They never issue credentials or reset MFA.
      await this.consumeTotp(c, credentials, code, Number(current.accepted) === 1);
      if (Number(current.accepted) !== 1) {
        await c.query("UPDATE h2_identities SET status = 'active' WHERE subject = ?", [String(current.subject)]);
        await c.query("UPDATE h2_memberships SET status = 'active', version = version + 1 WHERE subject = ? AND tenant_id = ? AND status = 'invited'", [String(current.subject), String(current.tenant_id)]);
        await c.query('UPDATE h2_invitations SET accepted = 1 WHERE invitation_id = ?', [String(current.invitation_id)]);
      }
      return { accepted: true };
    });
  }
  async login(emailValue: unknown, passwordValue: unknown, code: string, tenantValue: unknown, peer: string): Promise<{ token: string; expiresAt: number; tenantId: string }> {
    const email = normalizedEmail(emailValue), password = passwordInput(passwordValue), tenantId = identifier(tenantValue);
    await this.limit(email, peer);
    const identity = (await this.database.transaction(c => c.query('SELECT * FROM h2_identities WHERE email = ?', [email])))[0];
    // Unknown/uninitialized accounts still pay the same scrypt cost and return the same error.
    if (!identity?.password_hash) { await hashPassword(password); denied(); }
    const credentials = await this.credentials(String(identity.subject), password);
    if (credentials.status !== 'active') denied();
    return this.database.transaction(async c => {
      await this.key(c);
      const membership = await this.membership(c, String(identity.subject), tenantId);
      await this.consumeTotp(c, credentials, code);
      return this.issue(c, membership);
    });
  }
  private signature(prefix: string): string {
    return createHmac('sha256', this.config.signingKey).update(JSON.stringify([prefix, this.config.issuer, this.config.audience, this.config.origin])).digest('base64url');
  }
  private async issue(c: SqlConnection, membership: SqlRow, expiresAtLimit = Infinity): Promise<{ token: string; expiresAt: number; tenantId: string }> {
    const opaque = randomBytes(32).toString('base64url'), prefix = `h2.${this.config.keyId}.${opaque}`;
    const expiresAt = Math.min(expiresAtLimit, this.clock() + this.config.sessionSeconds * 1000), tenantId = String(membership.tenant_id);
    await c.query(`INSERT INTO h2_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [digest(opaque), String(membership.subject), tenantId, String(membership.namespace_id), String(membership.user_id), this.config.issuer, this.config.audience, this.config.origin,
        expiresAt, this.config.keyId, Number(membership.version), Number(membership.authorization), Number(membership.policy), Number(membership.configuration)]);
    return { token: `${prefix}.${this.signature(prefix)}`, expiresAt, tenantId };
  }
  private async session(c: SqlConnection, token: string): Promise<{ session: SqlRow; membership: SqlRow }> {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'h2' || parts[1] !== this.config.keyId || !/^[A-Za-z0-9_-]{43}$/.test(parts[2]!) || !equal(parts[3]!, this.signature(parts.slice(0, 3).join('.')))) denied();
    await this.key(c);
    const session = (await c.query('SELECT * FROM h2_sessions WHERE session_id = ?', [digest(parts[2]!)]))[0];
    if (!session || Number(session.revoked) || Number(session.expires_at) <= this.clock() || session.issuer !== this.config.issuer || session.audience !== this.config.audience || session.origin !== this.config.origin || session.key_id !== this.config.keyId) denied();
    const membership = await this.membership(c, String(session.subject), String(session.tenant_id));
    const admitted = await c.query('UPDATE h2_sessions SET revoked = revoked WHERE session_id = ? AND revoked = 0 RETURNING session_id', [String(session.session_id)]);
    if (!admitted.length) denied();
    if (membership.namespace_id !== session.namespace_id || membership.user_id !== session.user_id || Number(membership.version) !== Number(session.membership_version)
      || Number(membership.authorization) !== Number(session.authorization_revision) || Number(membership.policy) !== Number(session.policy_revision) || Number(membership.configuration) !== Number(session.configuration_revision)) denied();
    const identity = (await c.query("SELECT subject FROM h2_identities WHERE subject = ? AND status = 'active'", [String(session.subject)]))[0];
    if (!identity) denied();
    return { session, membership };
  }
  bearer(request: IncomingMessage): string {
    const value = request.headers.authorization;
    if (!value || value.length > 1024 || !/^Bearer [A-Za-z0-9_.-]+$/.test(value)) denied();
    return value.slice(7);
  }
  /** The existing SecurityOptions.authenticate seam remains transport/verifier independent. */
  readonly authenticate: SecurityOptions['authenticate'] = async request => this.verify(this.bearer(request));
  async verify(token: string): Promise<Identity> {
    return this.database.transaction(async c => {
      const { session } = await this.session(c, token);
      return { namespaceId: String(session.namespace_id), userId: String(session.user_id) };
    });
  }
  async switchTenant(token: string, tenantValue: unknown): Promise<{ token: string; expiresAt: number; tenantId: string }> {
    const tenantId = identifier(tenantValue);
    return this.database.transaction(async c => {
      const { session } = await this.session(c, token);
      const membership = await this.membership(c, String(session.subject), tenantId);
      const result = await this.issue(c, membership, Number(session.expires_at));
      await c.query('UPDATE h2_sessions SET revoked = 1 WHERE session_id = ?', [String(session.session_id)]);
      return result;
    });
  }
  async logout(token: string): Promise<void> {
    await this.database.transaction(async c => {
      const { session } = await this.session(c, token);
      await c.query('UPDATE h2_sessions SET revoked = 1 WHERE session_id = ?', [String(session.session_id)]);
    });
  }
}
