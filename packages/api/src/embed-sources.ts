import { digest } from './auth-crypto.js';
import { HostedSources, type HostedSource } from './hosted-sources.js';
import { type TenantContext } from './metadata.js';
import { decryptMetadataSecret } from './metadata-secrets.js';
import { identifier, object } from './metadata-resources.js';
import { sourceBody } from './source-schema.js';
import { embedFailure } from './embed-sessions.js';

/** Used exclusively after an embed's asset/dataset scope check. General source and
 * prepared-data routes continue using the owner-only HostedSources adapter. */
export class EmbedSources extends HostedSources {
  private readonly bindings = new WeakMap<TenantContext, Map<string, string>>();
  async bindDataset(context: TenantContext, datasetId: string): Promise<string> {
    const { source } = await this.metadata.embedDatasetSource(context, datasetId);
    const id = `embed_${digest(JSON.stringify([datasetId, source.ownerId, identifier(source.id)]))}`, bound = this.bindings.get(context) ?? new Map<string, string>();
    bound.set(id, datasetId); this.bindings.set(context, bound); return id;
  }
  private dataset(context: TenantContext, id: string): string {
    return this.bindings.get(context)?.get(id) ?? embedFailure('EMBED_SOURCE_UNRESOLVED', 403);
  }
  override async stored(context: TenantContext, id: string): Promise<HostedSource> {
    const { source } = await this.metadata.embedDatasetSource(context, this.dataset(context, id));
    return { ...sourceBody(source.body), id, version: source.version };
  }
  override async payload(context: TenantContext, source: HostedSource): Promise<unknown> {
    this.active(source);
    const current = await this.metadata.embedDatasetSource(context, this.dataset(context, source.id));
    if (current.source.version !== source.version || !current.secret) embedFailure('SOURCE_SECRET_UNAVAILABLE', 503);
    const secret = current.secret;
    try { return object(JSON.parse(decryptMetadataSecret(String(secret.body.ciphertext), this.encryptionKey, context, { kind: 'secret', id: secret.id, ownerId: secret.ownerId }))); }
    catch { return embedFailure('SOURCE_SECRET_UNAVAILABLE', 503); }
  }
}
