import { createHash } from 'node:crypto';
import { prepColumns, validateConnectorConfig, type UploadColumn } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import { object } from './metadata-resources.js';
import type { JsonObject } from './mapping.js';

export interface DirectUploadRequest {
  byteLength: number; sha256: string; mediaType: string; config: ReturnType<typeof validateConnectorConfig>;
  columns?: UploadColumn[]; expiresAt: string; policy: JsonObject;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function requestDigest(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function directUploadRequest(raw: unknown): DirectUploadRequest {
  const r = object(structuredClone(raw), ['byteLength', 'sha256', 'mediaType', 'config', 'columns', 'expiresAt', 'policy']);
  if (!Number.isSafeInteger(r.byteLength) || Number(r.byteLength) < 1 || Number(r.byteLength) > 8 * 1024 * 1024) throw new MetadataError('UPLOAD_LIMIT_EXCEEDED', 400);
  if (typeof r.sha256 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(r.sha256) || Buffer.from(r.sha256, 'base64').toString('base64') !== r.sha256) throw new MetadataError('UPLOAD_CHECKSUM_REQUIRED', 400);
  const config = validateConnectorConfig('file', r.config), mediaTypes: Record<string, string> = { csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  if (r.mediaType !== mediaTypes[config.format!]) throw new MetadataError('UPLOAD_MEDIA_TYPE_INVALID', 400);
  if (typeof r.expiresAt !== 'string' || !Number.isFinite(Date.parse(r.expiresAt)) || new Date(r.expiresAt).toISOString() !== r.expiresAt) throw new MetadataError('UPLOAD_EXPIRY_REQUIRED', 400);
  const policy = object(r.policy, ['rowLevel', 'rowRules', 'columnGrants', 'protectedColumns']);
  if (typeof policy.rowLevel !== 'boolean' || !Array.isArray(policy.rowRules)) throw new MetadataError('SOURCE_POLICY_REQUIRED', 403);
  if (r.columns !== undefined && !Array.isArray(r.columns)) throw new MetadataError('UPLOAD_SCHEMA_MISMATCH', 400);
  const columns = r.columns === undefined ? undefined : prepColumns(r.columns as UploadColumn[], '$.columns');
  // Full policy/column compatibility is evaluated against the contained parser's actual schema.
  return { byteLength: Number(r.byteLength), sha256: r.sha256, mediaType: String(r.mediaType), config,
    ...(columns ? { columns } : {}), expiresAt: r.expiresAt, policy };
}
