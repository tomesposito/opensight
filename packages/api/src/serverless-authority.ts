import { hasCapability, isRole } from '@opensight/query-engine';
import { MetadataError, type SqlConnection } from './metadata-db.js';
import { type TenantContext, type Revisions, TenantMetadata } from './metadata.js';
import { object } from './metadata-resources.js';

/** Caller locks sr_control first. The tenant lock serializes revocation and quota writes. */
export async function currentAuthority(c: SqlConnection, metadata: TenantMetadata, context: TenantContext,
  revisions: Revisions, build = false): Promise<void> {
  metadata.assertContext(context);
  if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [context.tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
  const revision = (await c.query('SELECT "authorization", policy, configuration FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]))[0];
  if (!revision || Number(revision.authorization) !== context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
  if ((['authorization', 'policy', 'configuration'] as const).some(k => !Number.isSafeInteger(revisions[k]) || revisions[k] < 1 || Number(revision[k]) !== revisions[k])) throw new MetadataError('METADATA_REVISED', 403);
  const members = await c.query(`SELECT m.user_id FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject
    WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.user_id = ? AND m.status = 'active' AND i.status = 'active'`, [context.tenantId, context.namespaceId, context.userId]);
  if (members.length !== 1) throw new MetadataError('UNKNOWN_PRINCIPAL', 403);
  const user = (await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = '' AND kind = 'user' AND resource_id = ?", [context.tenantId, context.namespaceId, context.userId]))[0];
  const role: unknown = user ? object(JSON.parse(String(user.body))).role : undefined;
  if (!isRole(role) || build && !hasCapability(role, 'build')) throw new MetadataError('SOURCE_ACCESS_DENIED', 403);
}
