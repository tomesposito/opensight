import { validateConnectorConfig, type ConnectorConfig, type S3SourceOptions } from '@opensight/query-engine';
import { sourceError } from './source-schema.js';

/** The verified tenant scope an S3 grant is checked against. Structurally a
 * TenantContext; kept local so this module stays free of metadata imports. */
export interface S3GrantScope { readonly tenantId: string; readonly namespaceId: string; readonly userId: string }
/** One operator grant: an exact S3 config bound to the tenants allowed to use
 * the operator's credentials for it, optionally narrowed to namespaces and/or
 * principals within those tenants. An unscoped grant does not exist: a config
 * no grant covers is denied for every tenant (fail closed, issue #300). */
export interface HostedS3Grant {
  readonly config: ConnectorConfig;
  readonly tenantIds: readonly string[];
  readonly namespaceIds?: readonly string[];
  readonly userIds?: readonly string[];
}
export interface HostedS3Settings extends S3SourceOptions { grants: readonly HostedS3Grant[] }
const grantKeys = ['config', 'tenantIds', 'namespaceIds', 'userIds'];
function scopeIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 256) sourceError();
  const ids = raw.map(value => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) sourceError();
    return value;
  });
  if (new Set(ids).size !== ids.length) sourceError();
  return Object.freeze(ids);
}
function parseGrant(raw: unknown): HostedS3Grant {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) sourceError();
  const entry = raw as Record<string, unknown>;
  // Legacy plain-config entries carry no scope and are rejected: silently
  // keeping them valid would preserve the cross-tenant grant this fixes.
  if (!Object.hasOwn(entry, 'config') || !Object.hasOwn(entry, 'tenantIds')) sourceError();
  for (const key of Object.keys(entry)) if (!grantKeys.includes(key)) sourceError();
  return Object.freeze({
    config: validateConnectorConfig('s3', entry.config),
    tenantIds: scopeIds(entry.tenantIds),
    ...(entry.namespaceIds === undefined ? {} : { namespaceIds: scopeIds(entry.namespaceIds) }),
    ...(entry.userIds === undefined ? {} : { userIds: scopeIds(entry.userIds) }),
  });
}
/** Operator grants, analogous to database endpoints. Never taken from an HTTP body. */
export function hostedS3Settings(environment: NodeJS.ProcessEnv = process.env): HostedS3Settings {
  try {
    const raw: unknown = JSON.parse(environment.OPENSIGHT_S3_SOURCES ?? '[]');
    if (!Array.isArray(raw) || raw.length > 256) sourceError();
    return { environment, grants: Object.freeze(raw.map(parseGrant)) };
  } catch { return sourceError('SOURCE_ENDPOINT_CONFIG_INVALID', 503); }
}
const sameConfig = (allowed: ConnectorConfig, config: ConnectorConfig): boolean =>
  Object.keys(allowed).length === Object.keys(config).length && Object.entries(config).every(([key, value]) => allowed[key] === value);
const inScope = (grant: HostedS3Grant, scope: S3GrantScope): boolean =>
  grant.tenantIds.includes(scope.tenantId)
  && (grant.namespaceIds === undefined || grant.namespaceIds.includes(scope.namespaceId))
  && (grant.userIds === undefined || grant.userIds.includes(scope.userId));
export function permittedS3Config(raw: unknown, settings: HostedS3Settings, scope: S3GrantScope): ConnectorConfig {
  const config = validateConnectorConfig('s3', raw);
  if (!settings.grants.some(grant => sameConfig(grant.config, config) && inScope(grant, scope))) sourceError('SOURCE_ENDPOINT_DENIED', 403);
  return config;
}
