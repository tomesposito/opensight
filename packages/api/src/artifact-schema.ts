import { artifactColumns } from '@opensight/query-engine';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import type { WorkScope } from './budgets.js';
import type { CachedInput } from './blaze.js';
import { MetadataError } from './metadata-db.js';

export interface ArtifactLimits { encodedBytes: number; decodedBytes: number; rows: number; columns: number; cellChars: number }
export interface ArtifactDescriptor {
  format: 'opensight-parquet-v1'; columns: PrepColumn[]; rowCount: number; decodedBytes: number;
  encodedBytes: number; sha256: string; cachedInputs: CachedInput[];
}
export interface ArtifactIdentity { tenant: string; namespace: string; owner: string; kind: 'source' | 'prepared-dataset'; resource: string }
export interface ArtifactReference { identity: ArtifactIdentity; key: string; version: string; descriptor: ArtifactDescriptor }
export function artifactError(code = 'ARTIFACT_INVALID'): never { throw new MetadataError(code, code === 'ARTIFACT_UNAVAILABLE' ? 503 : 422); }
export function exactObject(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== [...fields].sort().join()) artifactError();
  return raw as Record<string, unknown>;
}
const positive = (value: unknown, zero = false): number => {
  if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1)) artifactError(); return Number(value);
};
export function artifactLimits(scope: WorkScope, raw: ArtifactLimits): ArtifactLimits {
  scope.check(); const value = exactObject(structuredClone(raw), ['encodedBytes', 'decodedBytes', 'rows', 'columns', 'cellChars']);
  for (const v of Object.values(value)) positive(v);
  const limits = value as unknown as ArtifactLimits;
  if (limits.encodedBytes > scope.limits.workingBytes || limits.decodedBytes > scope.limits.workingBytes || limits.rows > scope.limits.sourceRows
    || limits.rows >= Number.MAX_SAFE_INTEGER || limits.columns > 256 || limits.cellChars > scope.limits.cellChars) artifactError('ARTIFACT_LIMIT_INVALID');
  return limits;
}
export function artifactProvenance(raw: unknown): CachedInput[] {
  if (!Array.isArray(raw) || raw.length > 256) artifactError();
  return raw.map(item => {
    const value = exactObject(item, ['datasetId', 'refreshedAt']);
    if (typeof value.datasetId !== 'string' || !value.datasetId.length || value.datasetId.length > 512 || /[\x00-\x1f]/.test(value.datasetId)
      || typeof value.refreshedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.refreshedAt)
      || !Number.isFinite(Date.parse(value.refreshedAt)) || new Date(value.refreshedAt).toISOString() !== value.refreshedAt) artifactError();
    return { datasetId: value.datasetId, refreshedAt: value.refreshedAt };
  });
}
export function artifactDescriptor(raw: unknown, limits: ArtifactLimits): ArtifactDescriptor {
  const value = exactObject(structuredClone(raw), ['format', 'columns', 'rowCount', 'decodedBytes', 'encodedBytes', 'sha256', 'cachedInputs']);
  const columns = artifactColumns(value.columns), rowCount = positive(value.rowCount, true), decodedBytes = positive(value.decodedBytes), encodedBytes = positive(value.encodedBytes);
  if (value.format !== 'opensight-parquet-v1' || columns.length > limits.columns || rowCount > limits.rows || decodedBytes > limits.decodedBytes
    || encodedBytes > limits.encodedBytes || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) artifactError();
  return { format: 'opensight-parquet-v1', columns, rowCount, decodedBytes, encodedBytes, sha256: value.sha256, cachedInputs: artifactProvenance(value.cachedInputs) };
}
export function artifactIdentity(raw: unknown): ArtifactIdentity {
  const value = exactObject(structuredClone(raw), ['tenant', 'namespace', 'owner', 'kind', 'resource']);
  if (value.kind !== 'source' && value.kind !== 'prepared-dataset') artifactError();
  for (const key of ['tenant', 'namespace', 'owner', 'resource']) if (typeof value[key] !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value[key] as string)) artifactError();
  return value as unknown as ArtifactIdentity;
}
export function artifactFailure(error: unknown): never {
  if (error instanceof MetadataError && (error.code.startsWith('ARTIFACT_') || ['EXECUTION_CANCELLED', 'TENANT_BUDGET_EXCEEDED', 'NODE_ADMISSION_REFUSED',
    'INVOCATION_DEADLINE_EXCEEDED', 'INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED'].includes(error.code))) throw error;
  if (error && typeof error === 'object' && 'code' in error && ['ARTIFACT_INVALID', 'BLAZE_DATASET_TOO_LARGE'].includes(String(error.code))) artifactError(String(error.code));
  return artifactError('ARTIFACT_UNAVAILABLE');
}
