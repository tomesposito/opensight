import { hasCapability } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import { resourceKinds } from './metadata-resources.js';
import type { TenantMetadata, TenantContext } from './metadata.js';
import type { HostedData } from './hosted-data.js';
/** Portability uses the same source read authorization, RLS/CLS and result
 * bounds as interactive output. Never export credentials or sealed secrets.
 * Private assets remain scoped to their owner; the archive states this scope. */
export async function exportWorkspace(metadata: TenantMetadata, data: HostedData, context: TenantContext) {
  const user = await metadata.get(context, { kind: 'user', id: context.userId });
  if (!hasCapability(user.body.role as Parameters<typeof hasCapability>[0], 'admin')) throw new MetadataError('SECURITY_ADMIN_REQUIRED', 403);
  const revisions = await metadata.revisions(context);
  const kinds = resourceKinds.filter(kind => !['secret', 'ai-config', 'invitation', 'job'].includes(kind));
  const resources = (await Promise.all(kinds.map(kind => metadata.list(context, kind)))).flat();
  data.begin(context);
  const sources: { id: string; data: unknown }[] = [];
  for (const source of resources.filter(resource => resource.kind === 'source')) {
    const result = await data.execute(context, source.id, 'output', {});
    if ('truncated' in result && result.truncated) throw new MetadataError('WORKSPACE_EXPORT_TOO_LARGE', 413);
    sources.push({ id: source.id, data: result });
  }
  await metadata.assertRevisions(context, revisions);
  return { version: 1, tenantId: context.tenantId, namespaceId: context.namespaceId,
    scope: 'Shared workspace metadata and your private assets; source data follows your row and column permissions. Credentials are excluded.', resources, sources };
}
