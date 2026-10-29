import { disabledAnalytics, type Analytics } from './analytics.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { hasCapability, isRole, type Role } from '@opensight/query-engine';
import { MetadataError, missing, type Database, type SqlConnection } from './metadata-db.js';
import { identifier, insertResource } from './metadata-resources.js';
import { checksum, MetadataOperator, type TenantOperation } from './metadata-operator.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import type { HostedConfig } from './hosted-config.js';
import type { MailTransport, MailMessage } from './mail.js';
import { digest, seal, unseal } from './auth-crypto.js';
import { escapeHtml } from './reports.js';
import { normalizedEmail } from './hosted-auth.js';
import { appendOperatorAudit } from './operator-audit.js';
import { applyDisposition, disposition, type JobDisposition, type JobOwnership } from './job-ownership.js';
import { deriveWorkspaceSlug, parseWorkspaceSlug, workspaceLabel } from './workspace-naming.js';
import type { TenantContext } from './metadata.js';

export interface OnboardingInput { name: string; slug?: string; administrator: { email: string; name: string } }
export interface InvitationInput { email: string; name: string; role: Role }
export interface PendingInvitation { id: string; namespaceId: string; email: string; name: string; role: Role; expiresAt: string }
export interface InvitationDispatch {
  readonly configured: boolean;
  create<T>(context: TenantContext, invitationId: string, requestHash: string, work: (c: SqlConnection) => Promise<T>): Promise<T | undefined>;
}
export function invitationMessage(origin: string, tenantId: string, workspaceName: unknown, email: string, token: string): MailMessage {
  const tenantLine = workspaceName ? `<p>Workspace: ${escapeHtml(workspaceLabel(workspaceName, tenantId))}</p>` : `<p>Tenant: ${escapeHtml(tenantId)}</p>`;
  return { to: [email], subject: 'OpenSight invitation', html: `<p>You have been invited to OpenSight.</p>${tenantLine}<p><a href="${escapeHtml(origin)}/#invite=${token}">Set up your OpenSight account</a> in your browser: choose a password and register your authenticator app. If you already have an account, sign in to accept the invitation.</p><p>This invitation is single-use. Operators and automation can also use the enrollment API with this token:</p><code>${token}</code>` };
}
function label(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new MetadataError('METADATA_INVALID', 400);
  return value;
}
/** The deployment has one operator identity, separate from all tenant identities. */
export const operatorOperationId = (key: string): string => checksum(['deployment-operator', identifier(key)]);

export class HostedProvisioning {
  readonly operator: MetadataOperator;
  constructor(private readonly database: Database, private readonly config: HostedConfig, private readonly mail: MailTransport, private readonly clock = Date.now, private readonly jobs?: JobOwnership, private readonly analytics = disabledAnalytics, private readonly invitationDispatch?: InvitationDispatch) {
    this.operator = new MetadataOperator(database);
  }
  private async reserve(operationId: string, hash: string): Promise<void> {
    await this.database.transaction(async c => {
      await c.query('INSERT INTO h2_requests VALUES (?,?) ON CONFLICT (operation_id) DO NOTHING', [operationId, hash]);
      const prior = (await c.query('SELECT request_hash FROM h2_requests WHERE operation_id = ?', [operationId]))[0]!;
      if (prior.request_hash !== hash) throw new MetadataError('OPERATION_ID_REUSED');
    });
  }
  async transition(key: string, tenantId: string, action: 'suspend' | 'resume' | 'delete', expectedVersion: number): Promise<TenantOperation> {
    identifier(tenantId);
    if (!['suspend', 'resume', 'delete'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MetadataError('METADATA_INVALID', 400);
    const operationId = operatorOperationId(key);
    await this.reserve(operationId, checksum({ action, tenantId, expectedVersion }));
    return this.operator.transition(operationId, tenantId, action, expectedVersion);
  }
  private async invite(c: SqlConnection, operationId: string, tenantId: string, namespaceId: string, userId: string, email: string): Promise<{ id: string; token: string; expiresAt: string }> {
    await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'invited') ON CONFLICT (email) DO NOTHING", [randomUUID(), email]);
    const subject = String((await c.query('SELECT subject FROM h2_identities WHERE email = ?', [email]))[0]!.subject);
    await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,?,'invited')", [subject, tenantId, namespaceId, userId]);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.clock() + this.config.invitationSeconds * 1000;
    await c.query('INSERT INTO h2_invitations VALUES (?,?,?,?,?,?,0,0)', [operationId, subject, tenantId, digest(token), seal(token, this.config.encryptionKey, `invitation:${operationId}`), expiresAt]);
    return { id: operationId, token, expiresAt: new Date(expiresAt).toISOString() };
  }
  async provision(key: string, raw: OnboardingInput): Promise<TenantOperation> {
    const name = label(raw.name), slug = parseWorkspaceSlug(raw.slug) ?? deriveWorkspaceSlug(name);
    const input = { name, slug, administrator: { email: normalizedEmail(raw.administrator.email), name: label(raw.administrator.name) } };
    const operationId = operatorOperationId(key), hash = checksum({ action: 'onboard', input });
    if (!this.mail.configured) throw new MetadataError('SMTP_NOT_CONFIGURED', 503);
    await this.reserve(operationId, hash);
    await this.database.transaction(async c => {
      await c.query('UPDATE h2_control SET id = id WHERE id = 1');
      const prior = (await c.query('SELECT * FROM h2_onboarding WHERE operation_id = ?', [operationId]))[0];
      if (prior) { if (prior.request_hash !== hash) throw new MetadataError('OPERATION_ID_REUSED'); return; }
      const tenantId = randomUUID(), namespaceId = randomUUID(), userId = randomUUID();
      const inserted = await c.query(`INSERT INTO h1_tenants (tenant_id,state,version,display_name,slug)
        VALUES (?,'provisioning',1,?,?) ON CONFLICT (slug) DO NOTHING RETURNING tenant_id`, [tenantId, input.name, input.slug]);
      if (!inserted.length) throw new MetadataError('TENANT_SLUG_CONFLICT', 409);
      await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [namespaceId, tenantId, input.name]);
      await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [tenantId, namespaceId]);
      await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id: userId }, { name: input.administrator.name, role: 'administrator' });
      await c.query("INSERT INTO h1_operations VALUES (?,?,?,'provision',?,'pending','created')", [operationId, tenantId, namespaceId, hash]);
      const invitation = await this.invite(c, operationId, tenantId, namespaceId, userId, input.administrator.email);
      await c.query('INSERT INTO h2_onboarding VALUES (?,?,?,?)', [operationId, hash, tenantId, invitation.id]);
      await appendMetadataEvent(c, { tenantId, namespaceId }, 'tenant.provisioning');
      // The committed provisioning mutations are audited in the transaction that creates
      // them, so a later SMTP failure cannot leave them unaudited. Invitation tokens are
      // sealed in h2_invitations and mailed; only the recipient identity lands here.
      await appendOperatorAudit(c, { action: 'tenant.provisioned', tenantId, subject: input.administrator.email, detail: { operationId, name: input.name, slug: input.slug } });
      await appendOperatorAudit(c, { action: 'membership.invited', tenantId, subject: input.administrator.email, detail: { operationId, userId, role: 'administrator' } });
    });
    return this.completeProvision(operationId, input);
  }
  private async deliver(invitationId: string): Promise<void> {
    const row = (await this.database.transaction(c => c.query(`SELECT v.*, i.email, t.state, t.display_name FROM h2_invitations v
      JOIN h2_identities i ON i.subject = v.subject JOIN h1_tenants t ON t.tenant_id = v.tenant_id WHERE invitation_id = ?`, [invitationId])))[0];
    if (!row) missing();
    if (!['provisioning', 'active'].includes(String(row.state))) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    if (Number(row.delivered) || Number(row.accepted)) return;
    if (Number(row.expires_at) <= this.clock()) throw new MetadataError('INVITATION_EXPIRED', 409);
    const token = unseal(String(row.token_secret), this.config.encryptionKey, `invitation:${invitationId}`);
    // Delivery belongs to the identity flow, never to operator metadata responses.
    await this.mail.send(invitationMessage(this.config.origin, String(row.tenant_id), row.display_name, String(row.email), token));
    await this.database.transaction(c => c.query('UPDATE h2_invitations SET delivered = 1 WHERE invitation_id = ?', [invitationId]));
  }
  private async completeProvision(operationId: string, input: Pick<OnboardingInput, 'administrator'>): Promise<TenantOperation> {
    const op = await this.operator.inspect(operationId);
    if (op.status === 'complete') return op;
    await this.deliver(operationId);
    const activated = await this.database.transaction(async c => {
      const tenants = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state IN ('provisioning','active') RETURNING state", [op.tenantId]);
      if (!tenants.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      if ((await c.query('SELECT status FROM h1_operations WHERE operation_id = ?', [operationId]))[0]!.status === 'complete') return;
      const rows = await c.query(`SELECT m.subject, u.body FROM h2_memberships m JOIN h2_invitations i ON i.subject = m.subject AND i.tenant_id = m.tenant_id
        JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id AND u.kind = 'user'
        WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.status = 'invited' AND i.delivered = 1 AND i.expires_at > ?`, [op.tenantId, op.namespaceId, this.clock()]);
      if (!rows.some(row => (JSON.parse(String(row.body)) as { role?: string }).role === 'administrator')) throw new MetadataError('AUTH_MAPPING_REQUIRED', 503);
      await c.query("UPDATE h1_tenants SET state = 'active', version = version + 1 WHERE tenant_id = ? AND state = 'provisioning'", [op.tenantId]);
      await c.query("UPDATE h1_operations SET status = 'complete', step = 'active' WHERE operation_id = ?", [operationId]);
      await appendMetadataEvent(c, op, 'tenant.active');
      // Activation is recorded separately from provisioning; the complete-status checks
      // above make it operation-deduplicated, so a retried provision activates (and audits)
      // exactly once. The invitation token is sealed in h2_invitations and mailed; only the
      // recipient identity lands here.
      await appendOperatorAudit(c, { action: 'tenant.activated', tenantId: op.tenantId, subject: input.administrator.email, detail: { operationId } });
      return true;
    });
    if (activated) { this.analytics.track(op, { name: 'tenant_provisioned' }); this.analytics.track(op, { name: 'user_invited' }); }
    return this.operator.inspect(operationId);
  }
  async inviteMember(key: string, tenantId: string, raw: InvitationInput): Promise<{ operationId: string; tenantId: string }> {
    await this.createMemberInvitation(key, tenantId, raw);
    return { operationId: operatorOperationId(key), tenantId };
  }
  /** Tenant creation discloses the fresh token once; lists and operator responses never do. */
  async inviteTenantMember(context: TenantContext, raw: InvitationInput): Promise<{ invitation: PendingInvitation; token: string }> {
    const created = await this.createMemberInvitation(randomUUID(), context.tenantId, raw, context);
    if (!created) throw new MetadataError('OPERATION_ID_REUSED');
    return { invitation: created.invitation, token: created.token };
  }
  private async createMemberInvitation(key: string, tenantId: string, raw: InvitationInput, context?: TenantContext) {
    identifier(tenantId);
    if (!isRole(raw.role)) throw new MetadataError('METADATA_INVALID', 400);
    const input = { email: normalizedEmail(raw.email), name: label(raw.name), role: raw.role }, operationId = operatorOperationId(key);
    const hash = checksum({ action: 'invite', tenantId, input });
    const delivery = context ? this.invitationDispatch : undefined;
    if (!(delivery?.configured ?? this.mail.configured)) throw new MetadataError('SMTP_NOT_CONFIGURED', 503);
    await this.reserve(operationId, hash);
    const work = async (c: SqlConnection) => {
      const rows = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [tenantId]);
      if (!rows.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      if (context) await this.tenantAdmin(c, context);
      const prior = (await c.query('SELECT * FROM h2_onboarding WHERE operation_id = ?', [operationId]))[0];
      if (prior) { if (prior.request_hash !== hash) throw new MetadataError('OPERATION_ID_REUSED'); return; }
      const namespaceId = String((await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ?', [tenantId]))[0]!.namespace_id), userId = randomUUID();
      if (context && (await c.query(`SELECT m.user_id FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject
        WHERE m.tenant_id = ? AND i.email = ?`, [tenantId, input.email])).length) throw new MetadataError('MEMBERSHIP_EXISTS', 409);
      await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id: userId }, { name: input.name, role: input.role });
      const invitation = await this.invite(c, operationId, tenantId, namespaceId, userId, input.email);
      await c.query('INSERT INTO h2_onboarding VALUES (?,?,?,?)', [operationId, hash, tenantId, operationId]);
      // Pending membership grants no admission and changes no active user's permissions.
      // Preserve tenant sessions for this workflow; operator invalidation stays unchanged.
      if (!context) await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ?', [tenantId]);
      await appendMetadataEvent(c, { tenantId, namespaceId }, 'membership.invited');
      // The invitation token is sealed in h2_invitations and mailed; only the recipient identity lands here.
      await appendOperatorAudit(c, { ...(context ? { actor: context.userId } : {}), action: 'membership.invited', tenantId, subject: input.email, detail: { operationId, userId, role: input.role } });
      return { tenantId, namespaceId, invitation: { id: invitation.id, namespaceId, ...input, expiresAt: invitation.expiresAt }, token: invitation.token };
    };
    const invited = delivery && context ? await delivery.create(context, operationId, hash, work) : await this.database.transaction(work);
    if (invited) this.analytics.track(invited, { name: 'user_invited' });
    if (!delivery) await this.deliver(operationId);
    return invited;
  }
  /** Recheck admission under the same tenant lock used by acceptance/removal. */
  private async tenantAdmin(c: SqlConnection, context: TenantContext): Promise<void> {
    const tenant = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [context.tenantId]);
    if (!tenant.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    const row = (await c.query(`SELECT u.body, r."authorization" FROM h2_memberships m
      JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id AND u.kind = 'user' AND u.owner_id = ''
      JOIN h1_revisions r ON r.tenant_id = m.tenant_id AND r.namespace_id = m.namespace_id
      WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.user_id = ? AND m.status = 'active'`, [context.tenantId, context.namespaceId, context.userId]))[0];
    if (!row || !hasCapability((JSON.parse(String(row.body)) as { role: Role }).role, 'admin')) throw new MetadataError('SECURITY_ADMIN_REQUIRED', 403);
    if (Number(row.authorization) !== context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
  }
  async listTenantInvitations(context: TenantContext): Promise<PendingInvitation[]> {
    return this.database.transaction(async c => {
      await this.tenantAdmin(c, context);
      const rows = await c.query(`SELECT v.invitation_id, v.expires_at, i.email, u.body FROM h2_invitations v
        JOIN h2_identities i ON i.subject = v.subject
        JOIN h2_memberships m ON m.subject = v.subject AND m.tenant_id = v.tenant_id
        JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id AND u.kind = 'user' AND u.owner_id = ''
        WHERE v.tenant_id = ? AND m.namespace_id = ? AND m.status = 'invited' AND v.accepted = 0 AND v.expires_at > ?
        ORDER BY v.expires_at, v.invitation_id`, [context.tenantId, context.namespaceId, this.clock()]);
      return rows.map(row => {
        const user = JSON.parse(String(row.body)) as { name: string; role: Role };
        return { id: String(row.invitation_id), namespaceId: context.namespaceId, email: String(row.email), name: user.name, role: user.role, expiresAt: new Date(Number(row.expires_at)).toISOString() };
      });
    });
  }
  async revokeTenantInvitation(context: TenantContext, invitationId: string): Promise<void> {
    identifier(invitationId);
    await this.database.transaction(async c => {
      await this.tenantAdmin(c, context);
      // Keep the operation's FK history, but expire the token and erase its sealed copy.
      const rows = await c.query(`UPDATE h2_invitations SET expires_at = 0, token_secret = ''
        WHERE tenant_id = ? AND invitation_id = ? AND accepted = 0 AND expires_at > ? RETURNING subject`, [context.tenantId, invitationId, this.clock()]);
      if (!rows.length) missing();
      await appendMetadataEvent(c, context, 'membership.invitation-revoked');
      await appendOperatorAudit(c, { actor: context.userId, action: 'membership.invitation-revoked', tenantId: context.tenantId, subject: String(rows[0]!.subject), detail: { invitationId } });
    });
  }
  /** Removal is an admission tombstone, preserving referenced owners/assets until their lifecycle handles them. */
  async removeMember(tenantId: string, userId: string, raw?: JobDisposition): Promise<void> {
    identifier(tenantId); identifier(userId);
    const choice = disposition(raw);
    if (choice?.action === 'transfer') {
      // Completed removal is idempotent even with the original transfer request.
      const removed = await this.database.transaction(c => c.query("SELECT user_id FROM h2_memberships WHERE tenant_id = ? AND user_id = ? AND status = 'removed'", [tenantId, userId]));
      if (removed.length) return;
      if (!this.jobs) throw new MetadataError('JOB_TRANSFER_UNAVAILABLE', 503);
      await this.jobs.validateTransfer(tenantId, userId, choice);
    }
    await this.database.transaction(async c => {
      const tenant = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [tenantId]);
      if (!tenant.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      const namespace = (await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ?', [tenantId]))[0]!;
      await applyDisposition(c, { tenantId, namespaceId: String(namespace.namespace_id) }, userId, choice, new Date(this.clock()).toISOString());
      const rows = await c.query("UPDATE h2_memberships SET status = 'removed', version = version + 1 WHERE tenant_id = ? AND user_id = ? AND status <> 'removed' RETURNING namespace_id", [tenantId, userId]);
      if (!rows.length) {
        if (!(await c.query("SELECT user_id FROM h2_memberships WHERE tenant_id = ? AND user_id = ? AND status = 'removed'", [tenantId, userId])).length) missing();
        return;
      }
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ?', [tenantId]);
      await appendMetadataEvent(c, { tenantId, namespaceId: String(rows[0]!.namespace_id) }, 'membership.removed');
      await appendOperatorAudit(c, { action: 'membership.removed', tenantId, subject: userId, detail: { jobs: choice?.action ?? 'none' } });
    });
  }
}
