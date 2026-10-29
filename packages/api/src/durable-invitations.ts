import { hasCapability, type Role } from '@opensight/query-engine';
import { MetadataError, type SqlConnection } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import type { HostedConfig } from './hosted-config.js';
import { invitationMessage, type InvitationDispatch } from './hosted-provisioning.js';
import { unseal } from './auth-crypto.js';
import { DurableDispatch, type DispatchEnvelope } from './dispatch.js';
import { DurableExecution, type ExecutionEvent } from './durable-execution.js';
import { MailError, type MailTransport } from './mail.js';

/** Reuses prearmed dispatch, encrypted H2 tokens and bounded execution. No request SMTP. */
export class DurableInvitations implements InvitationDispatch {
  readonly configured: boolean;
  readonly execution: DurableExecution;
  constructor(readonly dispatch: DurableDispatch, private readonly metadata: TenantMetadata,
    private readonly config: HostedConfig, private readonly mail: MailTransport) {
    this.configured = mail.deliveryConfigured ?? mail.configured;
    this.execution = new DurableExecution(dispatch);
  }
  async create<T>(context: TenantContext, invitationId: string, requestHash: string, work: (c: SqlConnection) => Promise<T>): Promise<T | undefined> {
    if (!this.configured) throw new MetadataError('SMTP_NOT_CONFIGURED', 503);
    const revisions = await this.metadata.revisions(context);
    const handle = await this.dispatch.prepare(context, { kind: 'invitation-write', idempotencyKey: invitationId, requestDigest: requestHash, revisions });
    let result: T | undefined;
    await this.dispatch.commit(handle, async (c, now) => {
      result = await work(c);
      return { receipt: { id: invitationId, revision: 1 }, events: [{ aggregateId: invitationId, aggregateRevision: 1, kind: 'invitation-deliver', dueAt: now, expiresAt: now + 86400000 }] };
    });
    // A failed immediate hint cannot undo acceptance: acknowledged recovery owns it.
    try { await this.dispatch.dispatch(handle); } catch { /* Recovery retries the durable outbox. */ }
    return result;
  }
  private async current(c: SqlConnection, event: ExecutionEvent, now: number) {
    if (event.kind !== 'invitation-deliver' || event.aggregateRevision !== 1) throw new MetadataError('INVITATION_EVENT_INVALID', 409);
    const { tenantId, namespaceId, userId } = event.scope;
    if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING version", [tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    const sender = (await c.query(`SELECT u.body FROM h1_resources u JOIN h2_memberships m ON m.tenant_id = u.tenant_id AND m.namespace_id = u.namespace_id AND m.user_id = u.resource_id
      JOIN h2_identities i ON i.subject = m.subject WHERE u.tenant_id = ? AND u.namespace_id = ? AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = ? AND m.status = 'active' AND i.status = 'active'`, [tenantId, namespaceId, userId]))[0];
    if (!sender || !hasCapability((JSON.parse(String(sender.body)) as { role: Role }).role, 'admin')) throw new MetadataError('SECURITY_ADMIN_REQUIRED', 403);
    const row = (await c.query(`SELECT v.*, i.email, t.display_name, m.status AS membership_status FROM h2_invitations v
      JOIN h2_identities i ON i.subject = v.subject JOIN h1_tenants t ON t.tenant_id = v.tenant_id
      JOIN h2_memberships m ON m.subject = v.subject AND m.tenant_id = v.tenant_id
      WHERE v.invitation_id = ? AND v.tenant_id = ? AND m.namespace_id = ?`, [event.aggregateId, tenantId, namespaceId]))[0];
    if (!row) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    if (Number(row.delivered) || Number(row.accepted)) return undefined;
    if (row.membership_status !== 'invited' || Number(row.expires_at) <= now || !row.token_secret) throw new MetadataError('INVITATION_EXPIRED', 409);
    return row;
  }
  async run(envelope: DispatchEnvelope, remainingMs = 110000): Promise<void> {
    const handle = await this.execution.claim(envelope, remainingMs);
    if (!handle) { await this.dispatch.flushEvent(envelope); return; }
    let sending = false, accepted = false;
    try {
      const row = await this.execution.checked(handle, (c, now) => this.current(c, handle.event, now));
      if (!row) { await this.execution.complete(handle); return; }
      if (!this.mail.configured) throw new MailError('SMTP_NOT_CONFIGURED');
      const token = unseal(String(row.token_secret), this.config.encryptionKey, `invitation:${handle.event.aggregateId}`);
      const message = invitationMessage(this.config.origin, handle.event.scope.tenantId, row.display_name, String(row.email), token);
      await this.execution.sending(handle); sending = true;
      await this.mail.send({ ...message, dedupeKey: handle.event.aggregateId }, () => this.execution.checked(handle, async (c, now) => {
        const current = await this.current(c, handle.event, now);
        if (!current || current.token_hash !== row.token_hash || current.email !== row.email) throw new MetadataError('INVITATION_REVISED', 403);
      }));
      accepted = true;
      await this.execution.complete(handle, async c => {
        await c.query('UPDATE h2_invitations SET delivered = 1 WHERE invitation_id = ? AND tenant_id = ? AND token_hash = ?', [handle.event.aggregateId, handle.event.scope.tenantId, row.token_hash!]);
      });
    } catch (error) {
      // A successful SMTP response followed by SQL failure leaves `sending` held.
      // Unknown network outcomes likewise never trigger an automatic second email.
      if (!accepted && await this.execution.failed(handle, error, sending && (!(error instanceof MetadataError) || error.status >= 500))) {
        await this.dispatch.flushEvent(envelope); return;
      }
      throw error;
    }
    await this.dispatch.flushEvent(envelope);
  }
  async replay(envelope: DispatchEnvelope, acceptAmbiguous = false): Promise<void> {
    await this.execution.replay(envelope, async (c, event) => {
      if (!await this.current(c, event, await this.dispatch.time(c))) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
    }, acceptAmbiguous);
  }
}
