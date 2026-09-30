import { randomBytes, randomUUID } from 'node:crypto';
import { isRole, type Role } from '@opensight/query-engine';
import { MetadataError, missing, type Database, type SqlConnection } from './metadata-db.js';
import { identifier, insertResource } from './metadata-resources.js';
import { checksum, MetadataOperator, type TenantOperation } from './metadata-operator.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import type { HostedConfig } from './hosted-config.js';
import type { MailTransport } from './mail.js';
import { digest, seal, unseal } from './auth-crypto.js';
import { normalizedEmail } from './hosted-auth.js';

export interface OnboardingInput { name: string; administrator: { email: string; name: string } }
export interface InvitationInput { email: string; name: string; role: Role }
function label(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new MetadataError('METADATA_INVALID', 400);
  return value;
}
/** The deployment has one operator identity, separate from all tenant identities. */
export const operatorOperationId = (key: string): string => checksum(['deployment-operator', identifier(key)]);

export class HostedProvisioning {
  readonly operator: MetadataOperator;
  constructor(private readonly database: Database, private readonly config: HostedConfig, private readonly mail: MailTransport, private readonly clock = Date.now) {
    this.operator = new MetadataOperator(database);
  }
  private async invite(c: SqlConnection, operationId: string, tenantId: string, namespaceId: string, userId: string, email: string): Promise<string> {
    await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'invited') ON CONFLICT (email) DO NOTHING", [randomUUID(), email]);
    const subject = String((await c.query('SELECT subject FROM h2_identities WHERE email = ?', [email]))[0]!.subject);
    await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,?,'invited')", [subject, tenantId, namespaceId, userId]);
    const token = randomBytes(32).toString('base64url');
    await c.query('INSERT INTO h2_invitations VALUES (?,?,?,?,?,?,0,0)', [operationId, subject, tenantId, digest(token), seal(token, this.config.encryptionKey, `invitation:${operationId}`), this.clock() + this.config.invitationSeconds * 1000]);
    return operationId;
  }
  async provision(key: string, raw: OnboardingInput): Promise<TenantOperation> {
    const input = { name: label(raw.name), administrator: { email: normalizedEmail(raw.administrator.email), name: label(raw.administrator.name) } };
    const operationId = operatorOperationId(key), hash = checksum({ action: 'onboard', input });
    if (!this.mail.configured) throw new MetadataError('SMTP_NOT_CONFIGURED', 503);
    await this.database.transaction(async c => {
      await c.query('UPDATE h2_control SET id = id WHERE id = 1');
      const prior = (await c.query('SELECT * FROM h2_onboarding WHERE operation_id = ?', [operationId]))[0];
      if (prior) { if (prior.request_hash !== hash) throw new MetadataError('OPERATION_ID_REUSED'); return; }
      const tenantId = randomUUID(), namespaceId = randomUUID(), userId = randomUUID();
      await c.query("INSERT INTO h1_tenants VALUES (?,'provisioning',1,NULL,NULL,NULL)", [tenantId]);
      await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [namespaceId, tenantId, input.name]);
      await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [tenantId, namespaceId]);
      await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id: userId }, { name: input.administrator.name, role: 'administrator' });
      await c.query("INSERT INTO h1_operations VALUES (?,?,?,'provision',?,'pending','created')", [operationId, tenantId, namespaceId, hash]);
      const invitation = await this.invite(c, operationId, tenantId, namespaceId, userId, input.administrator.email);
      await c.query('INSERT INTO h2_onboarding VALUES (?,?,?,?)', [operationId, hash, tenantId, invitation]);
      await appendMetadataEvent(c, { tenantId, namespaceId }, 'tenant.provisioning');
    });
    return this.completeProvision(operationId);
  }
  private async deliver(invitationId: string): Promise<void> {
    const row = (await this.database.transaction(c => c.query(`SELECT v.*, i.email, t.state FROM h2_invitations v
      JOIN h2_identities i ON i.subject = v.subject JOIN h1_tenants t ON t.tenant_id = v.tenant_id WHERE invitation_id = ?`, [invitationId])))[0];
    if (!row) missing();
    if (!['provisioning', 'active'].includes(String(row.state))) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    if (Number(row.delivered) || Number(row.accepted)) return;
    if (Number(row.expires_at) <= this.clock()) throw new MetadataError('INVITATION_EXPIRED', 409);
    const token = unseal(String(row.token_secret), this.config.encryptionKey, `invitation:${invitationId}`);
    // Delivery belongs to the identity flow, never to operator metadata responses.
    await this.mail.send({ to: [String(row.email)], subject: 'OpenSight invitation',
      html: `<p>You have been invited to OpenSight.</p><p>Public origin: ${this.config.origin}</p><p>Tenant: ${row.tenant_id}</p><p>Use this single-use invitation token with the OpenSight enrollment API:</p><code>${token}</code>` });
    await this.database.transaction(c => c.query('UPDATE h2_invitations SET delivered = 1 WHERE invitation_id = ?', [invitationId]));
  }
  private async completeProvision(operationId: string): Promise<TenantOperation> {
    const op = await this.operator.inspect(operationId);
    if (op.status === 'complete') return op;
    await this.deliver(operationId);
    await this.database.transaction(async c => {
      const tenants = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state IN ('provisioning','active') RETURNING state", [op.tenantId]);
      if (!tenants.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      if ((await c.query('SELECT status FROM h1_operations WHERE operation_id = ?', [operationId]))[0]!.status === 'complete') return;
      const rows = await c.query(`SELECT m.subject FROM h2_memberships m JOIN h2_invitations i ON i.subject = m.subject AND i.tenant_id = m.tenant_id
        JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id AND u.kind = 'user'
        WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.status = 'invited' AND i.delivered = 1 AND i.expires_at > ?`, [op.tenantId, op.namespaceId, this.clock()]);
      if (!rows.length) throw new MetadataError('AUTH_MAPPING_REQUIRED', 503);
      await c.query("UPDATE h1_tenants SET state = 'active', version = version + 1 WHERE tenant_id = ? AND state = 'provisioning'", [op.tenantId]);
      await c.query("UPDATE h1_operations SET status = 'complete', step = 'active' WHERE operation_id = ?", [operationId]);
      await appendMetadataEvent(c, op, 'tenant.active');
    });
    return this.operator.inspect(operationId);
  }
  async inviteMember(key: string, tenantId: string, raw: InvitationInput): Promise<{ operationId: string; tenantId: string }> {
    identifier(tenantId);
    if (!isRole(raw.role)) throw new MetadataError('METADATA_INVALID', 400);
    const input = { email: normalizedEmail(raw.email), name: label(raw.name), role: raw.role }, operationId = operatorOperationId(key);
    const hash = checksum({ action: 'invite', tenantId, input });
    if (!this.mail.configured) throw new MetadataError('SMTP_NOT_CONFIGURED', 503);
    await this.database.transaction(async c => {
      const rows = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [tenantId]);
      if (!rows.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      const prior = (await c.query('SELECT * FROM h2_onboarding WHERE operation_id = ?', [operationId]))[0];
      if (prior) { if (prior.request_hash !== hash) throw new MetadataError('OPERATION_ID_REUSED'); return; }
      const namespaceId = String((await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ?', [tenantId]))[0]!.namespace_id), userId = randomUUID();
      await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id: userId }, { name: input.name, role: input.role });
      await this.invite(c, operationId, tenantId, namespaceId, userId, input.email);
      await c.query('INSERT INTO h2_onboarding VALUES (?,?,?,?)', [operationId, hash, tenantId, operationId]);
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ?', [tenantId]);
      await appendMetadataEvent(c, { tenantId, namespaceId }, 'membership.invited');
    });
    await this.deliver(operationId);
    return { operationId, tenantId };
  }
  /** Removal is an admission tombstone, preserving referenced owners/assets until their lifecycle handles them. */
  async removeMember(tenantId: string, userId: string): Promise<void> {
    identifier(tenantId); identifier(userId);
    await this.database.transaction(async c => {
      const tenant = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [tenantId]);
      if (!tenant.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      const rows = await c.query("UPDATE h2_memberships SET status = 'removed', version = version + 1 WHERE tenant_id = ? AND user_id = ? AND status <> 'removed' RETURNING namespace_id", [tenantId, userId]);
      if (!rows.length) {
        if (!(await c.query("SELECT user_id FROM h2_memberships WHERE tenant_id = ? AND user_id = ? AND status = 'removed'", [tenantId, userId])).length) missing();
        return;
      }
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ?', [tenantId]);
      await appendMetadataEvent(c, { tenantId, namespaceId: String(rows[0]!.namespace_id) }, 'membership.removed');
    });
  }
}
