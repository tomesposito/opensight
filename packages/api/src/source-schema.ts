import { prepColumns, validatePolicy, type BoundColumn, type DatasetPolicy, type UploadColumn } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import { object, identifier, type ResourceKey } from './metadata-resources.js';

export type SourcePolicy = Omit<DatasetPolicy, 'namespaceId' | 'dataSetArn'>;
export interface SourceBinding {
  version: 3; connectorId: 'file' | 'postgresql'; state: 'active' | 'retired' | 'expired';
  columns: UploadColumn[]; endpointId?: string; schema?: string; table?: string;
  expiresAt?: string; rowCount?: number;
}
export interface SourceBody { binding: SourceBinding; secretId?: string; policy: SourcePolicy }
export function sourceError(code = 'SOURCE_INVALID', status = 400): never { throw new MetadataError(code, status); }
export function boundColumns(columns: readonly UploadColumn[]): BoundColumn[] {
  return columns.map(c => ({ name: c.name, type: c.type === 'BOOLEAN' ? 'STRING' : c.type,
    scalarType: c.type === 'BOOLEAN' ? 'boolean' : c.type === 'STRING' ? 'string' : c.type === 'DATETIME' ? 'datetime' : 'number', nullable: true }));
}
export function sourcePolicy(value: unknown, columns: readonly UploadColumn[]): SourcePolicy {
  if (value === undefined) sourceError('SOURCE_POLICY_REQUIRED', 403);
  const raw = object(value, ['rowLevel', 'rowRules', 'columnGrants', 'protectedColumns']);
  const { namespaceId: _namespace, dataSetArn: _arn, ...policy } = validatePolicy({ ...raw, namespaceId: 'validation', dataSetArn: 'source' }, boundColumns(columns));
  // The shared security grammar has no Boolean equality scalar; refuse rather than coerce.
  const check = (p: import('@opensight/query-engine').RowPredicate): void => {
    if ('all' in p) p.all.forEach(check);
    else if ('any' in p) p.any.forEach(check);
    else if (columns.find(c => c.name === p.column)?.type === 'BOOLEAN' && !['is-null', 'is-not-null'].includes(p.operator)) sourceError('INVALID_SECURITY_POLICY');
  };
  policy.rowRules.forEach(r => check(r.predicate));
  return policy;
}
export function sourceBody(raw: unknown): SourceBody {
  const body = object(raw, ['binding', 'secretId', 'policy']);
  if (object(body.binding).version !== 3) sourceError('SOURCE_MIGRATION_REQUIRED', 503);
  const b = object(body.binding, ['version', 'connectorId', 'state', 'columns', 'endpointId', 'schema', 'table', 'expiresAt', 'rowCount']);
  if (!['file', 'postgresql'].includes(String(b.connectorId)) || !['active', 'retired', 'expired'].includes(String(b.state))) sourceError();
  if (!Array.isArray(b.columns)) sourceError();
  for (const column of b.columns) object(column, ['name', 'type']);
  const columns = prepColumns(b.columns as UploadColumn[], '$.columns');
  if (b.connectorId !== 'file' && b.state === 'expired') sourceError();
  if (b.connectorId === 'file') {
    if (typeof b.expiresAt !== 'string' || !Number.isFinite(Date.parse(b.expiresAt)) || new Date(b.expiresAt).toISOString() !== b.expiresAt
      || !Number.isSafeInteger(b.rowCount) || Number(b.rowCount) < 0 || b.endpointId !== undefined || b.schema !== undefined || b.table !== undefined) sourceError();
  } else {
    identifier(b.endpointId); identifier(b.schema); identifier(b.table);
    if (b.expiresAt !== undefined || b.rowCount !== undefined) sourceError();
  }
  if (body.secretId !== undefined) identifier(body.secretId);
  if (b.state === 'active' && body.secretId === undefined) sourceError('SOURCE_SECRET_REQUIRED', 403);
  return { binding: { ...b, columns } as unknown as SourceBinding, ...(body.secretId === undefined ? {} : { secretId: body.secretId as string }), policy: sourcePolicy(body.policy, columns) };
}
export function sourcePolicyLinks(body: SourceBody): ResourceKey[] {
  return [...body.policy.rowRules, ...(body.policy.columnGrants ?? [])].flatMap(r => r.principals.map(p => ({ kind: p.type, id: p.id })));
}
export interface SourceEndpoint { id: string; host: string; port: number; database: string; tls: boolean; tenantColumn?: string }
/** Exact operator-owned endpoints. No URI options, redirects, sockets or tenant-provided hostnames. */
export function sourceEndpoints(env: NodeJS.ProcessEnv = process.env): SourceEndpoint[] {
  try {
    const raw: unknown = JSON.parse(env.OPENSIGHT_SOURCE_ENDPOINTS ?? '[]');
    if (!Array.isArray(raw) || raw.length > 256) sourceError();
    const endpoints = raw.map(v => {
      const e = object(v, ['id', 'host', 'port', 'database', 'tls', 'tenantColumn']);
      identifier(e.id);
      if (typeof e.host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(e.host) || !Number.isInteger(e.port) || Number(e.port) < 1 || Number(e.port) > 65535
        || typeof e.database !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(e.database) || typeof e.tls !== 'boolean') sourceError();
      if (e.tenantColumn !== undefined) identifier(e.tenantColumn);
      return e as unknown as SourceEndpoint;
    });
    if (new Set(endpoints.map(e => e.id)).size !== endpoints.length) sourceError();
    return endpoints;
  } catch { return sourceError('SOURCE_ENDPOINT_CONFIG_INVALID', 503); }
}
export function sourceCredentials(value: unknown): { username: string; password: string } {
  const c = object(value, ['username', 'password']);
  if (typeof c.username !== 'string' || !c.username.length || c.username.length > 256 || /[\x00-\x1f]/.test(c.username)
    || typeof c.password !== 'string' || !c.password.length || c.password.length > 8192 || c.password.includes('\0')) sourceError('SOURCE_CREDENTIALS_INVALID');
  return { username: c.username, password: c.password };
}
