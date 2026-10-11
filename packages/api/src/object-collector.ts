import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { MetadataError, type Database, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { DurableDispatch, type DispatchEnvelope, type DurableEvent } from './dispatch.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import type { InvocationAws } from './runtime-aws.js';
import { objectChecksum } from './object-schema.js';

type Event = DurableEvent & { scope: { tenantId: string; namespaceId: string; userId: string } };
const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const number = (value: SqlValue | undefined): number => {
  const n = Number(value); if (value === undefined || !Number.isSafeInteger(n) || n < 0) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return n;
};
const version = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw || raw === 'null' || raw.length > 1024 || /[\x00-\x20\x7f]/.test(raw)) throw new MetadataError('OBJECT_VERSION_REQUIRED', 503); return raw;
};
const absent = (error: unknown): boolean => error instanceof Error && ['NotFound', 'NoSuchKey', 'NoSuchVersion'].includes(error.name)
  && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404;
export interface ObjectDeletion {
  latest(key: string): Promise<string | undefined>;
  remove(key: string, version: string): Promise<void>;
}
/** A successful DELETE alone is not proof; only exact-version absence releases quota. */
export class AwsObjectDeletion implements ObjectDeletion {
  constructor(private readonly aws: InvocationAws, private readonly bucket: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new MetadataError('ARTIFACT_CONFIG_INVALID', 503);
  }
  private key(key: string): void {
    if (!/^(?:objects\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}|artifacts\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\.parquet)$/.test(key)) throw new MetadataError('OBJECT_INVALID', 503);
  }
  async latest(key: string): Promise<string | undefined> {
    this.key(key);
    try { return version((await this.aws.call(signal => this.aws.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal }))).VersionId); }
    catch (error) { if (absent(error)) return undefined; throw error; }
  }
  async remove(key: string, id: string): Promise<void> {
    this.key(key); version(id);
    await this.aws.call(signal => this.aws.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key, VersionId: id }), { abortSignal: signal }));
    try { await this.aws.call(signal => this.aws.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, VersionId: id }), { abortSignal: signal })); }
    catch (error) { if (absent(error)) return; throw error; }
    throw new MetadataError('OBJECT_DELETE_UNCONFIRMED', 503);
  }
}

/** Private denial-only worker: no principal session is required or created for GC. */
export class ObjectCollector {
  constructor(private readonly database: Database, private readonly dispatch: DurableDispatch, private readonly objects: ObjectDeletion,
    private readonly dialect: CoordinationDialect = 'postgres') {}
  private scope(event: Event): SqlValue[] { return [this.dispatch.deployment, event.scope.tenantId, event.scope.namespaceId, event.scope.userId]; }
  private async transaction<T>(event: Event, work: (c: SqlConnection, row: SqlRow, now: number) => Promise<T>): Promise<T | undefined> {
    return this.database.transaction(async c => {
      const control = (await c.query(`SELECT epoch, state FROM sr_control WHERE deployment = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [this.dispatch.deployment]))[0];
      if (number(control?.epoch) !== event.epoch) return undefined;
      if (control?.state !== 'open') throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
      const marker = (await c.query('SELECT checksum FROM sr_object_schema WHERE deployment = ?', [this.dispatch.deployment]))[0];
      if (marker?.checksum !== objectChecksum) throw new MetadataError('OBJECT_SCHEMA_REQUIRED', 503);
      // Same tenant lock as publication and usage, including suspended/deleted owners.
      await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [event.scope.tenantId]);
      const row = (await c.query(`SELECT * FROM sr_outbox WHERE ${scoped} AND event_id = ?`, [...this.scope(event), event.eventId]))[0];
      if (!row || number(row.control_epoch) !== event.epoch || row.aggregate_id !== event.aggregateId || row.kind !== event.kind
        || number(row.aggregate_revision) !== event.aggregateRevision) throw new MetadataError('OPERATION_EVENT_INVALID', 409);
      if (row.state === 'terminal') return undefined;
      return work(c, row, await coordinationNow(c, this.dialect));
    });
  }
  private async target(c: SqlConnection, event: Event): Promise<string> {
    if (event.kind === 'object-cleanup') return event.aggregateId;
    const row = (await c.query(`SELECT object_id FROM sr_cleanup_target WHERE ${scoped} AND cleanup_id = ?`, [...this.scope(event), event.aggregateId]))[0];
    if (!row) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return String(row.object_id);
  }
  private async entry(c: SqlConnection, event: Event, id: string): Promise<SqlRow> {
    const row = (await c.query(`SELECT * FROM sr_object WHERE ${scoped} AND object_id = ?`, [...this.scope(event), id]))[0];
    if (!row) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return row;
  }
  /** Undefined means an active indefinite manifest: replacement prearms a new cleanup. */
  private async protectedUntil(c: SqlConnection, event: Event, entry: SqlRow, now: number): Promise<number | undefined> {
    let until = Math.max(number(entry.retention_until), number(entry.created_at) + 86400000, number(entry.signature_until) + 600000);
    for (const pin of await c.query(`SELECT expires_at FROM sr_object_pin WHERE ${scoped} AND object_id = ? AND expires_at > ?`, [...this.scope(event), entry.object_id!, now])) until = Math.max(until, number(pin.expires_at));
    if (entry.purpose === 'raw-upload' || entry.purpose === 'source') {
      const uploads = await c.query(`SELECT operation_id FROM sr_upload WHERE ${scoped} AND (raw_object_id = ? OR output_object_id = ?) AND state = 'accepted'`, [...this.scope(event), entry.object_id!, entry.object_id!]);
      for (const upload of uploads) {
        const op = (await c.query(`SELECT expires_at FROM sr_operation WHERE ${scoped} AND operation_id = ? AND state IN ('queued','running')`, [...this.scope(event), upload.operation_id!]))[0];
        if (op) until = Math.max(until, number(op.expires_at));
      }
    }
    if (entry.purpose === 'source') for (const source of await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = 'source'", this.scope(event).slice(1))) {
      const body = JSON.parse(String(source.body)) as { binding?: { version?: number; objectId?: string; state?: string; expiresAt?: string } }, b = body.binding;
      if (b?.version === 4 && b.objectId === entry.object_id && b.state === 'active') {
        const expires = Date.parse(b.expiresAt ?? ''); if (!Number.isSafeInteger(expires)) throw new MetadataError('OBJECT_REFERENCE_INVALID', 503);
        until = Math.max(until, expires);
      }
    }
    if (entry.purpose === 'cache') for (const manifest of await c.query(`SELECT body FROM sr_manifest WHERE ${scoped} AND state = 'ready'`, this.scope(event))) {
      const doc = JSON.parse(String(manifest.body)) as { reference?: { key?: string; version?: string }; definitions?: { kind: string; id: string }[] };
      if (doc.reference?.key !== entry.object_key || doc.reference?.version !== entry.object_version) continue;
      let expires = Infinity;
      if (!Array.isArray(doc.definitions)) throw new MetadataError('OBJECT_REFERENCE_INVALID', 503);
      for (const d of doc.definitions.filter(d => d.kind === 'source')) {
        const source = (await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = 'source' AND resource_id = ?", [...this.scope(event).slice(1), d.id]))[0];
        if (!source) { expires = now; break; }
        const binding = (JSON.parse(String(source.body)) as { binding?: { state?: string; expiresAt?: string } }).binding;
        if (!binding || binding.state !== 'active') { expires = now; break; }
        if (binding.expiresAt) { const value = Date.parse(binding.expiresAt); if (!Number.isSafeInteger(value)) throw new MetadataError('OBJECT_REFERENCE_INVALID', 503); expires = Math.min(expires, value); }
      }
      if (expires === Infinity) return undefined;
      until = Math.max(until, expires);
    }
    if (entry.purpose === 'result') for (const op of await c.query(`SELECT o.expires_at FROM sr_result_chunk r JOIN sr_operation o ON o.deployment = r.deployment AND o.tenant_id = r.tenant_id AND o.namespace_id = r.namespace_id AND o.owner_id = r.owner_id AND o.operation_id = r.operation_id
      WHERE r.deployment = ? AND r.tenant_id = ? AND r.namespace_id = ? AND r.owner_id = ? AND r.object_id = ? AND o.state = 'completed'`, [...this.scope(event), entry.object_id!])) until = Math.max(until, number(op.expires_at));
    return until;
  }
  async run(envelope: DispatchEnvelope): Promise<void> {
    const event = await this.dispatch.inspect(envelope); if (!event) return;
    if (!['object-cleanup', 'artifact-cleanup'].includes(event.kind)) throw new MetadataError('OPERATION_EVENT_INVALID', 409);
    const next = await this.transaction(event, async (c, outbox, now) => {
      const id = await this.target(c, event), entry = await this.entry(c, event, id);
      if (entry.state === 'deleted') { await this.dispatch.terminal(c, event.eventId, event.epoch); return undefined; }
      const until = await this.protectedUntil(c, event, entry, now);
      if (until === undefined) { await this.dispatch.terminal(c, event.eventId, event.epoch); return undefined; }
      if (until > now) {
        // The original queue receipt is the prearmed recovery owner. Ack it only
        // after this continuation has a confirmed external dispatch receipt.
        const revision = event.aggregateRevision + 1;
        if (!Number.isSafeInteger(revision)) throw new MetadataError('DISPATCH_UNAVAILABLE', 503);
        await c.query("INSERT INTO sr_outbox VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,'pending') ON CONFLICT (deployment, tenant_id, namespace_id, owner_id, aggregate_id, aggregate_revision, kind) DO NOTHING", [...this.scope(event), randomUUID(), outbox.intent_id!, event.aggregateId, revision, event.kind, event.epoch, until, until + 86400000]);
        return { continueIntent: String(outbox.intent_id) };
      }
      if (!['reserved', 'live', 'retiring'].includes(String(entry.state))) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503);
      await c.query(`UPDATE sr_object SET state = 'retiring' WHERE ${scoped} AND object_id = ?`, [...this.scope(event), id]);
      return { id, key: String(entry.object_key), version: entry.object_version === null ? undefined : version(entry.object_version) };
    });
    if (!next) return;
    if ('continueIntent' in next) {
      await this.dispatch.flush(next.continueIntent!, event.epoch);
      await this.transaction(event, async c => { await this.dispatch.terminal(c, event.eventId, event.epoch); }); return;
    }
    let exactVersion = next.version;
    if (!exactVersion) {
      exactVersion = await this.objects.latest(next.key!);
      if (exactVersion) {
        const found = exactVersion;
        await this.transaction(event, async c => {
          const row = await this.entry(c, event, next.id!);
          if (row.state !== 'retiring' || row.object_version !== null && row.object_version !== found) throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
          await c.query(`UPDATE sr_object SET object_version = ? WHERE ${scoped} AND object_id = ?`, [found, ...this.scope(event), next.id!]);
        });
      }
    }
    if (exactVersion) await this.objects.remove(next.key!, exactVersion);
    await this.transaction(event, async c => {
      const row = await this.entry(c, event, next.id!);
      if (row.state !== 'deleted') {
        if (row.state !== 'retiring' || (row.object_version ?? undefined) !== exactVersion) throw new MetadataError('OBJECT_BINDING_CONFLICT', 409);
        const reserved = row.actual_bytes === null, field = reserved ? 'reserved_bytes' : 'live_bytes', amount = number(reserved ? row.capacity_bytes : row.actual_bytes);
        const gauge = (await c.query(`SELECT ${field} FROM sr_storage_usage WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?`, this.scope(event).slice(0, 3)))[0];
        if (number(gauge?.[field]) < amount) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503);
        await c.query(`UPDATE sr_storage_usage SET ${field} = ${field} - ? WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?`, [amount, ...this.scope(event).slice(0, 3)]);
        await c.query(`UPDATE sr_object SET state = 'deleted' WHERE ${scoped} AND object_id = ?`, [...this.scope(event), next.id!]);
      }
      await this.dispatch.terminal(c, event.eventId, event.epoch);
    });
  }
}
