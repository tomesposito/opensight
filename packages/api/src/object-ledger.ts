import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { TenantMetadata, type TenantContext, type Revisions } from './metadata.js';
import { currentAuthority } from './serverless-authority.js';
import { coordinationDeployment } from './coordination-schema.js';
import { objectChecksum } from './object-schema.js';
import { entitlementConfig, resourceBytes } from './hosted-usage.js';
import { describeStorage, storageQuotaError } from './storage-breakdown.js';
import type { PlannedArtifactWrite } from './artifact-transfer.js';
import { artifactIdentity, type ArtifactIdentity } from './artifact-schema.js';

export type ObjectPurpose = 'raw-upload' | 'source' | 'cache' | 'result';
export interface ObjectPlan { readonly id: string; readonly key: string; readonly capacityBytes: number; readonly purpose: ObjectPurpose; readonly mediaType: string }
export interface VerifiedObject { version: string; bytes: number; checksum: string; descriptor?: string }
export interface LedgerObject extends ObjectPlan {
  state: 'reserved' | 'live' | 'retiring' | 'deleted'; createdAt: number; retentionUntil: number; signatureUntil: number;
  version?: string; bytes?: number; checksum?: string; descriptor?: string;
}
interface PlanState { context: TenantContext; checksum?: string }
const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const count = (raw: SqlValue | undefined): number => {
  const n = Number(raw); if (raw === undefined || !Number.isSafeInteger(n) || n < 0) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return n;
};
const checksum = (value: string): string => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').toString('base64') !== value) throw new MetadataError('OBJECT_INVALID', 400); return value;
};
const version = (value: string): string => {
  if (!value || value === 'null' || value.length > 1024 || /[\x00-\x20\x7f]/.test(value)) throw new MetadataError('OBJECT_INVALID', 400); return value;
};

/** SQL-only ledger. Caller owns the control/tenant-locked, authorized business transaction. */
export class ObjectLedger {
  readonly deployment: string;
  private readonly plans = new WeakMap<ObjectPlan, PlanState>();
  constructor(private readonly metadata: TenantMetadata, deployment: string) { this.deployment = coordinationDeployment(deployment); }
  private scope(context: TenantContext): SqlValue[] { this.metadata.assertContext(context); return [this.deployment, context.tenantId, context.namespaceId, context.userId]; }
  plan(context: TenantContext, input: { purpose: ObjectPurpose; capacityBytes: number; mediaType: string; checksum?: string; artifact?: PlannedArtifactWrite; identity?: ArtifactIdentity }): ObjectPlan {
    this.metadata.assertContext(context);
    if (!['raw-upload', 'source', 'cache', 'result'].includes(input.purpose) || !Number.isSafeInteger(input.capacityBytes) || input.capacityBytes < 1 || input.capacityBytes > 512 * 1024 * 1024
      || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(input.mediaType) || input.mediaType.length > 128) throw new MetadataError('OBJECT_INVALID', 400);
    const id = randomUUID(), hash = createHash('sha256').update(JSON.stringify([context.tenantId, context.namespaceId, context.userId, input.purpose])).digest('hex');
    let key = `objects/v1/${hash}/${id}`;
    if (input.identity) {
      const identity = artifactIdentity(input.identity);
      if (input.artifact || !['source', 'cache'].includes(input.purpose) || identity.tenant !== context.tenantId || identity.namespace !== context.namespaceId || identity.owner !== context.userId
        || input.mediaType !== 'application/vnd.apache.parquet') throw new MetadataError('OBJECT_INVALID', 400);
      key = `artifacts/v1/${createHash('sha256').update(JSON.stringify([identity.tenant, identity.namespace, identity.owner, identity.kind, identity.resource])).digest('hex')}/${id}.parquet`;
    }
    if (input.artifact) {
      const a = input.artifact, identity = a.identity;
      if (!['source', 'cache'].includes(input.purpose) || identity.tenant !== context.tenantId || identity.namespace !== context.namespaceId || identity.owner !== context.userId
        || a.descriptor.encodedBytes !== input.capacityBytes || input.mediaType !== 'application/vnd.apache.parquet'
        || !/^[A-Za-z0-9_/-]{1,256}\/[a-f0-9-]{36}\.parquet$/.test(a.key)) throw new MetadataError('OBJECT_INVALID', 400);
      key = a.key;
    }
    const plan = Object.freeze({ id, key, capacityBytes: input.capacityBytes, purpose: input.purpose, mediaType: input.mediaType });
    this.plans.set(plan, { context, ...(input.checksum ? { checksum: checksum(input.checksum) } : {}) }); return plan;
  }
  private async schema(c: SqlConnection): Promise<void> {
    const marker = (await c.query('SELECT version, checksum FROM sr_object_schema WHERE deployment = ?', [this.deployment]))[0];
    if (Number(marker?.version) !== 1 || marker?.checksum !== objectChecksum) throw new MetadataError('OBJECT_SCHEMA_REQUIRED', 503);
  }
  private async gauge(c: SqlConnection, context: TenantContext): Promise<{ reserved: number; live: number }> {
    const values = [this.deployment, context.tenantId, context.namespaceId];
    await c.query('INSERT INTO sr_storage_usage VALUES (?,?,?,0,0) ON CONFLICT (deployment, tenant_id, namespace_id) DO NOTHING', values);
    const row = (await c.query('SELECT reserved_bytes, live_bytes FROM sr_storage_usage WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?', values))[0];
    return { reserved: count(row?.reserved_bytes), live: count(row?.live_bytes) };
  }
  async reserve(c: SqlConnection, context: TenantContext, revisions: Revisions, intentId: string, plans: readonly ObjectPlan[],
    now: number, retentionUntil: number, signatureUntil = now): Promise<void> {
    await this.schema(c); await currentAuthority(c, this.metadata, context, revisions, !plans.length || plans.some(p => p.purpose !== 'result')); identifier(intentId);
    if (!plans.length || plans.length > 8 || ![now, retentionUntil, signatureUntil].every(Number.isSafeInteger)
      || now <= 0 || retentionUntil <= now || signatureUntil < now || signatureUntil > now + 60000) throw new MetadataError('OBJECT_INVALID', 400);
    let bytes = 0;
    for (const plan of plans) {
      const state = this.plans.get(plan);
      if (!state || state.context !== context) throw new MetadataError('OBJECT_PLAN_REQUIRED', 403);
      bytes += plan.capacityBytes;
    }
    const intent = (await c.query(`SELECT state, commit_until FROM sr_dispatch_intent WHERE ${scoped} AND intent_id = ?`, [...this.scope(context), intentId]))[0];
    if (intent?.state !== 'prepared' || count(intent.commit_until) <= now) throw new MetadataError('DISPATCH_PREPARATION_REQUIRED', 403);
    const row = (await c.query('SELECT entitlements FROM sr_limits WHERE deployment = ?', [this.deployment]))[0];
    const limits = entitlementConfig(row ? String(row.entitlements) : undefined), limit = Object.hasOwn(limits.tenants, context.tenantId) ? limits.tenants[context.tenantId] : limits.defaults;
    if (!limit) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    const gauge = await this.gauge(c, context);
    const logical = await resourceBytes(c, context);
    if (logical + gauge.reserved + gauge.live + bytes > limit.storageBytes) {
      // Explain the condition instead of a generic quota error: a tester needs to see
      // how much of the limit is retained reservations awaiting collector cleanup.
      const breakdown = await describeStorage(c, { deployment: this.deployment, tenantId: context.tenantId, namespaceId: context.namespaceId, now });
      throw storageQuotaError(breakdown, bytes);
    }
    for (const plan of plans) {
      const state = this.plans.get(plan)!;
      await c.query("INSERT INTO sr_object VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,NULL,'reserved',?,?,?)", [...this.scope(context), plan.id, intentId, plan.key,
        plan.purpose, plan.capacityBytes, state.checksum ?? null, plan.mediaType, now, retentionUntil, plan.purpose === 'raw-upload' ? signatureUntil : now]);
    }
    await c.query('UPDATE sr_storage_usage SET reserved_bytes = reserved_bytes + ? WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?', [bytes, this.deployment, context.tenantId, context.namespaceId]);
  }
  async read(c: SqlConnection, context: TenantContext, id: string): Promise<LedgerObject> {
    const row = (await c.query(`SELECT * FROM sr_object WHERE ${scoped} AND object_id = ?`, [...this.scope(context), identifier(id)]))[0];
    if (!row) throw new MetadataError('RESOURCE_NOT_FOUND', 404); return this.decode(row);
  }
  private decode(row: SqlRow): LedgerObject {
    return { id: String(row.object_id), key: String(row.object_key), capacityBytes: count(row.capacity_bytes), purpose: row.purpose as ObjectPurpose,
      mediaType: String(row.media_type), state: row.state as LedgerObject['state'], createdAt: count(row.created_at), retentionUntil: count(row.retention_until), signatureUntil: count(row.signature_until),
      ...(row.object_version === null ? {} : { version: version(String(row.object_version)) }), ...(row.actual_bytes === null ? {} : { bytes: count(row.actual_bytes) }),
      ...(row.checksum === null ? {} : { checksum: checksum(String(row.checksum)) }), ...(row.descriptor === null ? {} : { descriptor: String(row.descriptor) }) };
  }
  /** Verified exact-version HEAD/GET must precede this call; source/manifest binding commits with it. */
  async bind(c: SqlConnection, context: TenantContext, id: string, verified: VerifiedObject): Promise<void> {
    const entry = await this.read(c, context, id);
    version(verified.version); checksum(verified.checksum);
    if (!Number.isSafeInteger(verified.bytes) || verified.bytes < 1 || verified.bytes > entry.capacityBytes || entry.checksum && entry.checksum !== verified.checksum
      || verified.descriptor !== undefined && Buffer.byteLength(verified.descriptor) > 1024 * 1024) throw new MetadataError('OBJECT_INVALID', 400);
    if (entry.state === 'live' && entry.version === verified.version && entry.bytes === verified.bytes && entry.checksum === verified.checksum && entry.descriptor === verified.descriptor) return;
    if (entry.state !== 'reserved') throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
    const gauge = await this.gauge(c, context); if (gauge.reserved < entry.capacityBytes) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503);
    await c.query(`UPDATE sr_object SET state = 'live', actual_bytes = ?, checksum = ?, object_version = ?, descriptor = ? WHERE ${scoped} AND object_id = ?`, [verified.bytes, verified.checksum, verified.version, verified.descriptor ?? null, ...this.scope(context), id]);
    await c.query('UPDATE sr_storage_usage SET reserved_bytes = reserved_bytes - ?, live_bytes = live_bytes + ? WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?',
      [entry.capacityBytes, verified.bytes, this.deployment, context.tenantId, context.namespaceId]);
  }
  /** Immutable pre-PUT description survives an uncertain write and is not a live binding. */
  async stage(c: SqlConnection, context: TenantContext, id: string, input: { checksum: string; descriptor: string }): Promise<void> {
    const entry = await this.read(c, context, id); checksum(input.checksum);
    if (entry.state !== 'reserved' || entry.purpose === 'raw-upload' || Buffer.byteLength(input.descriptor) > 1024 * 1024) throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
    if (entry.checksum !== undefined && entry.checksum !== input.checksum || entry.descriptor !== undefined && entry.descriptor !== input.descriptor) throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
    await c.query(`UPDATE sr_object SET checksum = ?, descriptor = ? WHERE ${scoped} AND object_id = ?`, [input.checksum, input.descriptor, ...this.scope(context), id]);
  }
  /** Signature renewal is a SQL obligation and must commit before the new capability is returned. */
  async signature(c: SqlConnection, context: TenantContext, id: string, now: number, until: number): Promise<void> {
    const entry = await this.read(c, context, id);
    if (entry.state !== 'reserved' || entry.purpose !== 'raw-upload' || !Number.isSafeInteger(until) || until <= now || until > Math.min(now + 60000, entry.retentionUntil)) throw new MetadataError('UPLOAD_EXPIRED', 409);
    await c.query(`UPDATE sr_object SET signature_until = ? WHERE ${scoped} AND object_id = ?`, [Math.max(until, entry.signatureUntil), ...this.scope(context), id]);
  }
  /** Collector calls only after checking current source/manifest references under the same locks. */
  async retire(c: SqlConnection, context: TenantContext, id: string, now: number): Promise<LedgerObject> {
    const entry = await this.read(c, context, id);
    const pins = await c.query(`SELECT pin_id FROM sr_object_pin WHERE ${scoped} AND object_id = ? AND expires_at > ? LIMIT 1`, [...this.scope(context), id, now]);
    if (pins.length || now < Math.max(entry.retentionUntil, entry.createdAt + 86400000, entry.signatureUntil + 600000)) throw new MetadataError('OBJECT_RETENTION_REQUIRED', 409);
    if (entry.state === 'live' || entry.state === 'reserved') await c.query(`UPDATE sr_object SET state = 'retiring' WHERE ${scoped} AND object_id = ?`, [...this.scope(context), id]);
    return { ...entry, state: entry.state === 'deleted' ? 'deleted' : 'retiring' };
  }
  /** Record an ambiguous PUT's discovered exact version after publication is fenced out. */
  async retiringVersion(c: SqlConnection, context: TenantContext, id: string, foundVersion: string): Promise<void> {
    const entry = await this.read(c, context, id); version(foundVersion);
    if (entry.state !== 'retiring' || entry.version !== undefined && entry.version !== foundVersion) throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
    await c.query(`UPDATE sr_object SET object_version = ? WHERE ${scoped} AND object_id = ?`, [foundVersion, ...this.scope(context), id]);
  }
  /** Requires a confirmed exact-key/version absence. Timeouts/dead workers never release storage. */
  async deleted(c: SqlConnection, context: TenantContext, id: string, expectedVersion: string | undefined): Promise<void> {
    const entry = await this.read(c, context, id);
    if (entry.state === 'deleted') return;
    if (entry.state !== 'retiring' || entry.version !== expectedVersion) throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
    const reserved = entry.bytes === undefined;
    const gauge = await this.gauge(c, context), amount = reserved ? entry.capacityBytes : entry.bytes!, field = reserved ? 'reserved_bytes' : 'live_bytes';
    if ((reserved ? gauge.reserved : gauge.live) < amount) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503);
    await c.query(`UPDATE sr_storage_usage SET ${field} = ${field} - ? WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?`, [amount, this.deployment, context.tenantId, context.namespaceId]);
    await c.query(`UPDATE sr_object SET state = 'deleted' WHERE ${scoped} AND object_id = ?`, [...this.scope(context), id]);
  }
}
