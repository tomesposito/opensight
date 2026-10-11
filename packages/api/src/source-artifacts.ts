import { MetadataError } from './metadata-db.js';
import { type TenantContext } from './metadata.js';
import { type MetadataResource } from './metadata-resources.js';
import { type SourceArtifactReader } from './hosted-sources.js';
import { sourceBody } from './source-schema.js';
import { DurableCoordinator, type AttemptHandle } from './coordination.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { ArtifactTransfer, type LocalArtifact } from './artifact-transfer.js';
import { artifactReference } from './artifact-schema.js';
import { manifestArtifactLimits } from './manifests.js';
import { TenantBudgets } from './budgets.js';

/** The source adapter passes only its current owner binding or authorized embed dataset link. */
export class SourceArtifacts {
  constructor(private readonly coordinator: DurableCoordinator, private readonly attempt: (context: TenantContext) => AttemptHandle,
    private readonly transfer: ArtifactTransfer, private readonly budgets: TenantBudgets, private readonly dialect: CoordinationDialect = 'postgres') {}
  readonly read: SourceArtifactReader = async (context: TenantContext, source: MetadataResource, verify: () => Promise<void>) => {
    const handle = this.attempt(context), details = this.coordinator.describe(handle), limits = manifestArtifactLimits(details), scope = this.budgets.current(context);
    if (details.context !== context || source.kind !== 'source' || !source.ownerId) throw new MetadataError('SOURCE_ACCESS_DENIED', 403);
    const original = sourceBody(source.body);
    if (original.binding.version !== 4) throw new MetadataError('SOURCE_ARTIFACT_REQUIRED', 503);
    const identity = { tenant: context.tenantId, namespace: context.namespaceId, owner: source.ownerId, kind: 'source' as const, resource: source.id };
    const current = async () => {
      await verify();
      return this.coordinator.publish(handle, async c => {
        const actual = (await c.query("SELECT body, version FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = 'source' AND resource_id = ?",
          [context.tenantId, context.namespaceId, source.ownerId!, source.id]))[0];
        if (!actual || Number(actual.version) !== source.version) throw new MetadataError('METADATA_REVISED', 403);
        const body = sourceBody(JSON.parse(String(actual.body))), now = await coordinationNow(c, this.dialect);
        if (body.binding.version !== 4 || body.binding.objectId !== original.binding.objectId || body.binding.state !== 'active' || Date.parse(body.binding.expiresAt!) <= now) throw new MetadataError('UPLOAD_EXPIRED', 403);
        const entry = (await c.query(`SELECT * FROM sr_object WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND object_id = ?`,
          [this.coordinator.deployment, context.tenantId, context.namespaceId, source.ownerId!, body.binding.objectId!]))[0];
        if (!entry || entry.state !== 'live' || entry.purpose !== 'source' || entry.media_type !== 'application/vnd.apache.parquet' || Number(entry.retention_until) <= now) throw new MetadataError('SOURCE_ARTIFACT_UNAVAILABLE', 503);
        const reference = artifactReference({ identity, key: entry.object_key, version: entry.object_version, descriptor: JSON.parse(String(entry.descriptor)) }, limits);
        if (Number(entry.actual_bytes) !== reference.descriptor.encodedBytes || entry.checksum !== Buffer.from(reference.descriptor.sha256, 'hex').toString('base64')
          || body.binding.rowCount !== reference.descriptor.rowCount || JSON.stringify(body.binding.columns) !== JSON.stringify(reference.descriptor.columns)) throw new MetadataError('SOURCE_ARTIFACT_INVALID', 503);
        return reference;
      });
    };
    const reference = await current(); let local: LocalArtifact | undefined;
    try {
      local = await this.transfer.download(scope, identity, reference, limits);
      const table = await this.transfer.decode(scope, local, limits);
      if (JSON.stringify(await current()) !== JSON.stringify(reference)) throw new MetadataError('METADATA_REVISED', 403);
      scope.memory(table.bytes); const rows = [];
      for (let r = 0; r < table.rowCount; r++) { scope.check(); rows.push(table.columns.map((_, c) => table.value(r, c))); }
      await verify(); scope.check(); return { rows };
    } finally { await local?.close(); }
  };
}
