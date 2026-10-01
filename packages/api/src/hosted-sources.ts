import { randomUUID } from 'node:crypto';
import { hasCapability, isRole, parseUpload, type UploadColumn } from '@opensight/query-engine';
import { TenantMetadata, type TenantContext } from './metadata.js';
import { object, identifier, type MetadataResource } from './metadata-resources.js';
import { encryptMetadataSecret, decryptMetadataSecret } from './metadata-secrets.js';
import { sourceBody, sourceCredentials, sourcePolicy, sourceError, type SourceBody, type SourceEndpoint } from './source-schema.js';
import type { JsonObject } from './mapping.js';

export interface HostedSource extends SourceBody { id: string; version: number }
const json = (value: unknown): JsonObject => object(value);
/** Tenant/owner-scoped records and encrypted payloads share H1's atomic durable store. */
export class HostedSources {
  readonly endpoints: readonly SourceEndpoint[];
  constructor(readonly metadata: TenantMetadata, private readonly encryptionKey: string, endpoints: readonly SourceEndpoint[], readonly clock = Date.now) {
    this.endpoints = structuredClone(endpoints);
  }
  async capability(context: TenantContext, capability: 'build' | 'view' | 'ai'): Promise<void> {
    const user = await this.metadata.get(context, { kind: 'user', id: context.userId });
    if (capability === 'view' ? !isRole(user.body.role) : !hasCapability(user.body.role, capability)) sourceError('SOURCE_ACCESS_DENIED', 403);
  }
  key(context: TenantContext, kind: 'source' | 'secret', id: string) { return { kind, id: identifier(id), ownerId: context.userId }; }
  endpoint(id: string): SourceEndpoint {
    return this.endpoints.find(e => e.id === id) ?? sourceError('SOURCE_ENDPOINT_DENIED', 403);
  }
  async stored(context: TenantContext, id: string): Promise<HostedSource> {
    const r = await this.metadata.get(context, this.key(context, 'source', id));
    return { ...sourceBody(r.body), id: r.id, version: r.version };
  }
  active(source: HostedSource): void {
    if (source.binding.state === 'expired') sourceError('UPLOAD_EXPIRED', 403);
    if (source.binding.state !== 'active') sourceError('SOURCE_RETIRED', 403);
    if (source.binding.expiresAt && Date.parse(source.binding.expiresAt) <= this.clock()) sourceError('UPLOAD_EXPIRED', 403);
    if (source.binding.endpointId) this.endpoint(source.binding.endpointId);
  }
  async get(context: TenantContext, id: string): Promise<HostedSource> {
    const source = await this.stored(context, id); this.active(source); return source;
  }
  summary(source: HostedSource) {
    const { columns, connectorId, state, expiresAt, rowCount } = source.binding;
    return { id: source.id, version: source.version, connectorId, state, columns, ...(expiresAt ? { expiresAt, rowCount } : {}) };
  }
  private seal(context: TenantContext, secretId: string, payload: unknown) {
    return encryptMetadataSecret(JSON.stringify(payload), this.encryptionKey, context, this.key(context, 'secret', secretId));
  }
  async payload(context: TenantContext, source: HostedSource): Promise<unknown> {
    this.active(source);
    if (!source.secretId) sourceError('SOURCE_SECRET_REQUIRED', 403);
    const key = this.key(context, 'secret', source.secretId), r = await this.metadata.get(context, key);
    try { return JSON.parse(decryptMetadataSecret(String(r.body.ciphertext), this.encryptionKey, context, key)) as unknown; }
    catch { return sourceError('SOURCE_SECRET_UNAVAILABLE', 503); }
  }
  async create(context: TenantContext, id: string, raw: unknown): Promise<ReturnType<HostedSources['summary']>> {
    await this.capability(context, 'build'); identifier(id);
    const r = object(structuredClone(raw), ['connectorId', 'endpointId', 'schema', 'table', 'columns', 'credentials', 'policy']);
    if (r.connectorId !== 'postgresql') sourceError('SOURCE_CONNECTOR_UNSUPPORTED');
    this.endpoint(identifier(r.endpointId));
    const secretId = randomUUID();
    const body = sourceBody({ binding: { version: 3, connectorId: 'postgresql', state: 'active', endpointId: r.endpointId, schema: r.schema, table: r.table, columns: r.columns }, secretId, policy: r.policy });
    const secret = this.seal(context, secretId, sourceCredentials(r.credentials));
    await this.metadata.batch(context, [
      { key: this.key(context, 'secret', secretId), body: secret, expectedVersion: 0 },
      { key: this.key(context, 'source', id), body: json(body), expectedVersion: 0 },
    ]);
    return this.summary({ ...body, id, version: 1 });
  }
  async upload(context: TenantContext, raw: unknown): Promise<ReturnType<HostedSources['summary']>> {
    await this.capability(context, 'build');
    const r = object(structuredClone(raw), ['config', 'base64', 'columns', 'expiresAt', 'policy']);
    if (typeof r.expiresAt !== 'string' || !Number.isFinite(Date.parse(r.expiresAt)) || Date.parse(r.expiresAt) <= this.clock()) sourceError('UPLOAD_EXPIRY_REQUIRED');
    if (typeof r.base64 !== 'string' || !r.base64 || r.base64.length > 12 * 1024 * 1024 || Buffer.from(r.base64, 'base64').toString('base64') !== r.base64) sourceError('INVALID_UPLOAD');
    const parsed = parseUpload({ config: r.config, data: Buffer.from(r.base64, 'base64'), ...(r.columns === undefined ? {} : { columns: r.columns as UploadColumn[] }) });
    const id = `upload_${randomUUID().replaceAll('-', '')}`, secretId = randomUUID();
    const body = sourceBody({ binding: { version: 3, connectorId: 'file', state: 'active', columns: parsed.columns, rowCount: parsed.rows.length, expiresAt: r.expiresAt }, secretId, policy: r.policy });
    await this.metadata.batch(context, [
      { key: this.key(context, 'secret', secretId), body: this.seal(context, secretId, { rows: parsed.rows }), expectedVersion: 0 },
      { key: this.key(context, 'source', id), body: json(body), expectedVersion: 0 },
    ]);
    return this.summary({ ...body, id, version: 1 });
  }
  async bind(context: TenantContext, id: string, raw: unknown): Promise<void> {
    await this.capability(context, 'build');
    const r = object(structuredClone(raw), ['expectedVersion', 'endpointId', 'schema', 'table', 'columns', 'policy']), source = await this.get(context, id);
    const binding = { ...source.binding };
    for (const k of ['endpointId', 'schema', 'table', 'columns'] as const) if (r[k] !== undefined) {
      if (binding.connectorId !== 'postgresql') sourceError('SOURCE_BINDING_IMMUTABLE');
      Object.assign(binding, { [k]: r[k] });
    }
    if (binding.endpointId) this.endpoint(binding.endpointId);
    const body = sourceBody({ binding, secretId: source.secretId, policy: r.policy === undefined ? source.policy : sourcePolicy(r.policy, binding.columns) });
    await this.metadata.put(context, this.key(context, 'source', id), json(body), r.expectedVersion as number);
  }
  async rotate(context: TenantContext, id: string, raw: unknown): Promise<void> {
    await this.capability(context, 'build');
    const r = object(structuredClone(raw), ['expectedVersion', 'credentials']), source = await this.get(context, id);
    if (source.binding.connectorId !== 'postgresql' || !source.secretId) sourceError('SOURCE_ROTATION_UNSUPPORTED');
    const key = this.key(context, 'secret', source.secretId), secret = await this.metadata.get(context, key);
    await this.metadata.batch(context, [
      { key, body: this.seal(context, source.secretId, sourceCredentials(r.credentials)), expectedVersion: secret.version },
      { key: this.key(context, 'source', id), body: json({ binding: source.binding, policy: source.policy, secretId: source.secretId }), expectedVersion: r.expectedVersion as number },
    ]);
  }
  async retire(context: TenantContext, id: string, expectedVersion: number): Promise<void> {
    await this.capability(context, 'build');
    const source = await this.stored(context, id), edits = [{ key: this.key(context, 'source', id), expectedVersion,
      body: json({ binding: { ...source.binding, state: 'retired' }, policy: source.policy }) }];
    const secret: MetadataResource | undefined = source.secretId ? await this.metadata.get(context, this.key(context, 'secret', source.secretId)) : undefined;
    await this.metadata.batch(context, [...edits, ...(secret ? [{ key: this.key(context, 'secret', secret.id), expectedVersion: secret.version, body: null }] : [])]);
  }
}
