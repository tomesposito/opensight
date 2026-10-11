import { MetadataError, type SqlConnection, type SqlValue } from './metadata-db.js';
import { type TenantContext } from './metadata.js';
import { identifier } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import { DurableCoordinator, type AdmissionInput, type AttemptDetails, type AttemptHandle } from './coordination.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { manifestChecksum } from './manifest-schema.js';
import { sourceBody } from './source-schema.js';
import { artifactIdentity, artifactReference, exactObject, type ArtifactIdentity, type ArtifactReference, type ArtifactLimits } from './artifact-schema.js';

export interface ManifestDefinition { kind: 'source' | 'prepared-dataset'; id: string; version: number }
interface Dependency extends ManifestDefinition { fence: string; generation: string; refreshedAt: string }
interface Document {
  identity: ArtifactIdentity; epoch: string; attemptId: string; fence: string; generation: string;
  version: number; revisions: AdmissionInput['revisions']; state: 'running' | 'ready' | 'error';
  definitions: ManifestDefinition[]; dependencies: Dependency[]; reference: ArtifactReference | null;
  refreshedAt: string | null; error: string | null;
}
export interface ManifestRead {
  readonly reference: Readonly<ArtifactReference>; readonly refreshedAt: string; readonly metadataBytes: number;
}
const predicate = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ?';
const fields = ['identity', 'epoch', 'attemptId', 'fence', 'generation', 'version', 'revisions', 'state', 'definitions', 'dependencies', 'reference', 'refreshedAt', 'error'];
function invalid(): never { throw new MetadataError('MANIFEST_INVALID', 503); }
function stale(): never { throw new MetadataError('BLAZE_INVALIDATED', 409); }
const count = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) < 1) invalid(); return Number(v); };
const counter = (v: unknown): string => { if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) invalid(); return v; };
const timestamp = (v: unknown): string => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) invalid(); return v as string; };
const key = (v: ManifestDefinition): string => JSON.stringify([v.kind, v.id]);
const metadataLimit = (d: AttemptDetails): number => Math.min(1048576, Math.floor(d.limits.workingBytes / 8));
const errorCode = (v: unknown): string => { if (typeof v !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(v)) invalid(); return v; };
export const manifestArtifactLimits = (d: AttemptDetails): ArtifactLimits => ({ encodedBytes: d.limits.workingBytes, decodedBytes: Math.min(d.limits.workingBytes, d.limits.cacheBytes), rows: d.limits.sourceRows, columns: 256, cellChars: d.limits.cellChars });
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value;
}
function definition(raw: unknown): ManifestDefinition {
  const v = exactObject(raw, ['kind', 'id', 'version']);
  if (v.kind !== 'source' && v.kind !== 'prepared-dataset') invalid();
  return { kind: v.kind, id: identifier(v.id), version: count(v.version) };
}
function dependency(raw: unknown): Dependency {
  const v = exactObject(raw, ['kind', 'id', 'version', 'fence', 'generation', 'refreshedAt']);
  return { ...definition({ kind: v.kind, id: v.id, version: v.version }), fence: counter(v.fence), generation: counter(v.generation), refreshedAt: timestamp(v.refreshedAt) };
}
function merge<T extends ManifestDefinition>(values: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const value of values) { const prior = result.get(key(value)); if (prior && JSON.stringify(prior) !== JSON.stringify(value)) stale(); result.set(key(value), value); }
  return [...result.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, v]) => v);
}
function bounded(value: unknown, d: AttemptDetails): string {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > metadataLimit(d)) throw new MetadataError('MANIFEST_LIMIT_EXCEEDED', 429);
  return body;
}

/** Current SQL authority plus immutable history; no object I/O or background poll. */
export class ManifestStore {
  private readonly reads = new WeakMap<ManifestRead, { attempt: AttemptHandle; document: Document }>();
  constructor(readonly coordinator: DurableCoordinator, private readonly dialect: CoordinationDialect = 'postgres') {
    if (!['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('MANIFEST_CONFIG_INVALID', 503);
  }
  identity(details: AttemptDetails, target: Pick<ManifestDefinition, 'kind' | 'id'>): ArtifactIdentity {
    return artifactIdentity({ tenant: details.context.tenantId, namespace: details.context.namespaceId, owner: details.context.userId, kind: target.kind, resource: target.id });
  }
  private values(identity: ArtifactIdentity): SqlValue[] { return [this.coordinator.deployment, identity.tenant, identity.namespace, identity.owner, identity.kind, identity.resource]; }
  private async schema(c: SqlConnection): Promise<void> {
    const row = (await c.query('SELECT version, checksum FROM sr_manifest_schema WHERE deployment = ?', [this.coordinator.deployment]))[0];
    if (Number(row?.version) !== 1 || row?.checksum !== manifestChecksum) throw new MetadataError('MANIFEST_SCHEMA_REQUIRED', 503);
  }
  private async definitions(c: SqlConnection, details: AttemptDetails, values: readonly ManifestDefinition[]): Promise<void> {
    const now = await coordinationNow(c, this.dialect);
    for (const value of values) {
      const row = (await c.query(`SELECT version, body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ?`,
        [details.context.tenantId, details.context.namespaceId, details.context.userId, value.kind, value.id]))[0];
      if (!row || Number(row.version) !== value.version) stale();
      if (value.kind === 'source') {
        const source = sourceBody(JSON.parse(String(row.body)));
        if (source.binding.state === 'expired' || source.binding.expiresAt && Date.parse(source.binding.expiresAt) <= now) throw new MetadataError('UPLOAD_EXPIRED', 403);
        if (source.binding.state !== 'active') throw new MetadataError('SOURCE_RETIRED', 403);
      }
    }
  }
  async admit(context: TenantContext, input: AdmissionInput, rawDefinitions: readonly ManifestDefinition[] = [],
    admittedWork?: (c: SqlConnection, details: AttemptDetails) => Promise<void>): Promise<AttemptHandle> {
    const request = structuredClone(input), definitions = structuredClone(rawDefinitions).map(definition);
    if (request.class === 'query' && definitions.length) invalid();
    return this.coordinator.admit(context, request, async (c, details) => {
      await this.schema(c);
      if (!details.input.claim) { await admittedWork?.(c, details); return; }
      const claim = details.input.claim, all = merge([...definitions, { kind: claim.kind, id: claim.id, version: claim.expectedVersion }]);
      const document: Document = { identity: this.identity(details, claim), epoch: details.epoch, attemptId: details.input.attemptId,
        fence: details.fence!, generation: details.generation!, version: claim.expectedVersion, revisions: { ...details.input.revisions },
        state: 'running', definitions: all, dependencies: [], reference: null, refreshedAt: null, error: null };
      const body = bounded(document, details); await this.definitions(c, details, all);
      await c.query(`INSERT INTO sr_manifest VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (deployment, tenant_id, namespace_id, owner_id, kind, resource_id)
        DO UPDATE SET attempt_id = excluded.attempt_id, generation = excluded.generation, state = excluded.state, body = excluded.body`,
      [...this.values(document.identity), document.attemptId, document.generation, document.state, body]);
      await appendMetadataEvent(c, context, 'artifact:running');
      await admittedWork?.(c, details);
    });
  }
  private parse(raw: string, details: AttemptDetails): Document {
    if (Buffer.byteLength(raw) > metadataLimit(details)) throw new MetadataError('MANIFEST_LIMIT_EXCEEDED', 429);
    const v = exactObject(JSON.parse(raw), fields), identity = artifactIdentity(v.identity);
    if (!Array.isArray(v.definitions) || !Array.isArray(v.dependencies) || !['running', 'ready', 'error'].includes(String(v.state))) invalid();
    const revisions = exactObject(v.revisions, ['authorization', 'policy', 'configuration']);
    const document: Document = { identity, epoch: counter(v.epoch), attemptId: identifier(v.attemptId), fence: counter(v.fence), generation: counter(v.generation), version: count(v.version),
      revisions: { authorization: count(revisions.authorization), policy: count(revisions.policy), configuration: count(revisions.configuration) },
      state: v.state as Document['state'], definitions: merge(v.definitions.map(definition)), dependencies: merge(v.dependencies.map(dependency)),
      reference: v.reference === null ? null : artifactReference(v.reference, manifestArtifactLimits(details)), refreshedAt: v.refreshedAt === null ? null : timestamp(v.refreshedAt), error: v.error === null ? null : errorCode(v.error) };
    if (document.state === 'ready' ? !document.reference || !document.refreshedAt || document.error !== null : document.reference !== null || document.refreshedAt !== null
      || (document.state === 'error' ? !document.error : document.error !== null)) invalid();
    if (!document.definitions.some(d => d.kind === identity.kind && d.id === identity.resource && d.version === document.version)
      || document.dependencies.some(d => d.kind === identity.kind && d.id === identity.resource)
      || document.reference && JSON.stringify(document.reference.identity) !== JSON.stringify(identity)) invalid();
    return document;
  }
  private async current(c: SqlConnection, details: AttemptDetails, target: ManifestDefinition): Promise<Document> {
    const identity = this.identity(details, target);
    // Bound before returning a stored body to JS. UTF-8 octet length differs by engine.
    const length = this.dialect === 'postgres' ? 'octet_length(body)' : 'length(CAST(body AS BLOB))';
    const row = (await c.query(`SELECT body, state, attempt_id, CAST(generation AS TEXT) AS generation FROM sr_manifest WHERE ${predicate} AND ${length} <= ?`, [...this.values(identity), metadataLimit(details)]))[0];
    if (!row) throw new MetadataError('BLAZE_NOT_READY', 409);
    const doc = this.parse(String(row.body), details);
    if (JSON.stringify(doc.identity) !== JSON.stringify(identity) || doc.state !== row.state || doc.attemptId !== row.attempt_id || doc.generation !== String(row.generation)) invalid();
    if (doc.version !== target.version || doc.epoch !== details.epoch || (['authorization', 'policy', 'configuration'] as const).some(k => doc.revisions[k] !== details.input.revisions[k])) stale();
    const claim = (await c.query(`SELECT CAST(fence AS TEXT) AS fence, CAST(generation AS TEXT) AS generation, resource_version FROM sr_claim WHERE ${predicate}`, this.values(identity)))[0];
    if (claim?.fence !== doc.fence || claim?.generation !== doc.generation || Number(claim?.resource_version) !== doc.version) stale();
    return doc;
  }
  private ready(doc: Document): void {
    if (doc.state !== 'ready') throw new MetadataError(doc.state === 'running' ? 'BLAZE_REFRESH_IN_PROGRESS' : doc.error ?? 'BLAZE_NOT_READY', 409);
  }
  private token(doc: Document): Dependency {
    this.ready(doc); return { kind: doc.identity.kind, id: doc.identity.resource, version: doc.version, fence: doc.fence, generation: doc.generation, refreshedAt: doc.refreshedAt! };
  }
  private async dependencies(c: SqlConnection, details: AttemptDetails, dependencies: readonly Dependency[]): Promise<void> {
    for (const token of dependencies) {
      const current = await this.current(c, details, token); this.ready(current);
      if (JSON.stringify(this.token(current)) !== JSON.stringify(token)) stale();
    }
  }
  private snapshot(handle: AttemptHandle, read: ManifestRead): Document {
    const saved = this.reads.get(read);
    if (!saved || saved.attempt !== handle) throw new MetadataError('MANIFEST_HANDLE_REQUIRED', 403);
    return saved.document;
  }
  async read(handle: AttemptHandle, rawTarget: ManifestDefinition): Promise<ManifestRead> {
    const target = definition(structuredClone(rawTarget)), details = this.coordinator.describe(handle);
    const doc = await this.coordinator.publish(handle, async c => {
      await this.schema(c); const doc = await this.current(c, details, target); this.ready(doc);
      await this.definitions(c, details, doc.definitions); await this.dependencies(c, details, doc.dependencies); return doc;
    });
    const result = frozen({ reference: structuredClone(doc.reference!), refreshedAt: doc.refreshedAt!, metadataBytes: Buffer.byteLength(JSON.stringify(doc)) * 4 });
    this.reads.set(result, { attempt: handle, document: frozen(doc) }); return result;
  }
  async verify(handle: AttemptHandle, reads: readonly ManifestRead[]): Promise<void> {
    const saved = [...reads].map(read => this.snapshot(handle, read)), details = this.coordinator.describe(handle);
    const definitions = merge(saved.flatMap(d => d.definitions)), dependencies = merge(saved.flatMap(d => [this.token(d), ...d.dependencies]));
    bounded({ definitions, dependencies }, details);
    await this.coordinator.publish(handle, async c => { await this.schema(c); await this.definitions(c, details, definitions); await this.dependencies(c, details, dependencies); });
  }
  async publish(handle: AttemptHandle, rawReference: ArtifactReference, reads: readonly ManifestRead[] = [],
    publishedWork?: (c: SqlConnection, reference: ArtifactReference) => Promise<void>): Promise<void> {
    const details = this.coordinator.describe(handle), reference = artifactReference(rawReference, manifestArtifactLimits(details));
    const consumed = [...reads].map(read => this.snapshot(handle, read));
    await this.complete(handle, details, async (c, running) => {
      if (JSON.stringify(reference.identity) !== JSON.stringify(running.identity)) invalid();
      const definitions = merge([...running.definitions, ...consumed.flatMap(d => d.definitions)]);
      const dependencies = merge(consumed.flatMap(d => [this.token(d), ...d.dependencies]));
      if (dependencies.some(d => d.kind === running.identity.kind && d.id === running.identity.resource)) stale();
      bounded({ definitions, dependencies, reference }, details);
      await this.definitions(c, details, definitions); await this.dependencies(c, details, dependencies);
      await publishedWork?.(c, reference);
      return { ...running, state: 'ready', reference, definitions, dependencies, refreshedAt: new Date(await coordinationNow(c, this.dialect)).toISOString() };
    });
  }
  async fail(handle: AttemptHandle, code: string): Promise<void> {
    const details = this.coordinator.describe(handle), error = errorCode(code);
    await this.complete(handle, details, async (c, running) => { await this.definitions(c, details, running.definitions); return { ...running, state: 'error', error }; });
  }
  private async complete(handle: AttemptHandle, details: AttemptDetails, transform: (c: SqlConnection, running: Document) => Promise<Document>): Promise<void> {
    if (!details.input.claim) throw new MetadataError('MANIFEST_REFRESH_REQUIRED', 403);
    const target = { kind: details.input.claim.kind, id: details.input.claim.id, version: details.input.claim.expectedVersion };
    await this.coordinator.publish(handle, async c => {
      await this.schema(c); const current = await this.current(c, details, target);
      if (current.state !== 'running' || current.attemptId !== handle.attemptId || current.fence !== details.fence || current.generation !== details.generation) throw new MetadataError('MANIFEST_PUBLICATION_LOST', 409);
      const next = await transform(c, current), body = bounded(next, details), values = this.values(current.identity);
      const changed = await c.query(`UPDATE sr_manifest SET state = ?, body = ? WHERE ${predicate} AND attempt_id = ? AND generation = ? AND state = 'running' RETURNING resource_id`, [next.state, body, ...values, handle.attemptId, details.generation!]);
      if (changed.length !== 1) throw new MetadataError('MANIFEST_PUBLICATION_LOST', 409);
      if (next.state === 'ready') await c.query('INSERT INTO sr_manifest_versions VALUES (?,?,?,?,?,?,?,?)', [...values, next.generation, body]);
      await appendMetadataEvent(c, details.context, `artifact:${next.state}`);
    });
  }
}
