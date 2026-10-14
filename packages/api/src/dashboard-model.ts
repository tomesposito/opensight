import type { AnalysisBackend, AnalysisRecord, DatasetBindings } from './analysis-model.js';
import type { JsonObject } from './mapping.js';
import type { AssetGrant } from './organization.js';
import { MetadataError } from './metadata-db.js';
import { projectDefinition } from '@opensight/web/analysis';

/** Only definitions and server-owned binding identities are durable. */
export interface DashboardVersion {
  version: number; publishedAt: string; publishedBy: string;
  name: string; definition: AnalysisRecord['definition']; wireDefinition: JsonObject; datasetBindings: DatasetBindings;
  bindingOwnerId: string; sourceAnalysisId: string;
}
export interface DashboardRecord {
  id: string; sourceAnalysisId: string; sourceActive: boolean;
  latest: number; versions: DashboardVersion[];
}
export type DashboardChange =
  | { kind: 'publish'; source: AnalysisRecord; dashboardId: string; create: boolean; publishedAt: string; cap?: number }
  | { kind: 'delete'; expected: number }
  | { kind: 'prune'; version: number; expected: number }
  | { kind: 'share'; principal: AssetGrant['principal']; role?: AssetGrant['role'] };
export interface DashboardBackend {
  readonly analyses: AnalysisBackend;
  authorize(id?: string, mode?: 'read' | 'write' | 'admin'): Promise<void>;
  list(): Promise<DashboardRecord[]>;
  get(id: string): Promise<DashboardRecord>;
  accessSnapshot(id: string): Promise<unknown>;
  authorizeRemoved(snapshot: unknown): Promise<void>;
  grants(id: string): Promise<AssetGrant[] | undefined>;
  change(id: string, change: DashboardChange, stamp: unknown): Promise<DashboardRecord | null>;
  query(version: DashboardVersion, definition: JsonObject, visualId: string): Promise<DashboardQuery>;
}
export interface DashboardQuery {
  columns: { name: string; type: 'string' | 'number' }[];
  rows: Record<string, string | number | null>[];
  bindings: Record<string, string>;
}
export function dashboardVersion(record: DashboardRecord, version = record.latest): DashboardVersion {
  const found = record.versions.find(v => v.version === version);
  if (!found) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  return found;
}
export function describeDashboard(record: DashboardRecord, version = record.latest): JsonObject {
  const v = dashboardVersion(record, version);
  return { DashboardId: record.id, Name: v.name, Definition: structuredClone(v.wireDefinition), Errors: [], Version: v.version, PublishedAt: v.publishedAt, SourceAnalysisId: v.sourceAnalysisId };
}
export function changeDashboard(prior: DashboardRecord | undefined, change: DashboardChange, userId: string): DashboardRecord | null {
  if (change.kind === 'publish') {
    if (!prior && !change.create) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    if (prior && change.create) throw new MetadataError('DASHBOARD_SOURCE_MISMATCH', 409);
    if (prior && (!prior.sourceActive || prior.sourceAnalysisId !== change.source.id)) throw new MetadataError('DASHBOARD_SOURCE_MISMATCH', 409);
    const result: DashboardRecord = structuredClone(prior ?? { id: change.dashboardId, sourceAnalysisId: change.source.id, sourceActive: true, latest: 0, versions: [] });
    if (!Number.isSafeInteger(result.latest + 1)) throw new MetadataError('DASHBOARD_VERSION_EXHAUSTED', 409);
    result.latest++;
    result.versions.push({ version: result.latest, name: change.source.name, definition: structuredClone(change.source.definition), wireDefinition: projectDefinition(change.source.definition), datasetBindings: structuredClone(change.source.datasetBindings), bindingOwnerId: userId, sourceAnalysisId: change.source.id, publishedAt: change.publishedAt, publishedBy: userId });
    if (change.cap) result.versions = result.versions.slice(-change.cap);
    return result;
  }
  if (!prior) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  if (change.kind === 'share') return structuredClone(prior);
  if (prior.latest !== change.expected) throw new MetadataError('DASHBOARD_PRECONDITION_FAILED', 412);
  if (change.kind === 'delete') return null;
  if (prior.latest === change.version) throw new MetadataError('DASHBOARD_LATEST_VERSION', 409);
  dashboardVersion(prior, change.version);
  return { ...structuredClone(prior), versions: prior.versions.filter(v => v.version !== change.version) };
}
export function changeDashboardGrants(grants: AssetGrant[] | undefined, change: Extract<DashboardChange, { kind: 'share' }>): AssetGrant[] {
  const matches = (g: AssetGrant) => g.principal.type === change.principal.type && g.principal.id === change.principal.id;
  if (!change.role && !grants?.some(matches)) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  return [...(grants ?? []).filter(g => !matches(g)), ...(change.role ? [{ principal: change.principal, role: change.role }] : [])];
}

/** Validate durable state at restart; never infer or repair broken history. */
export function validateDashboardRecord(raw: unknown, id: string): asserts raw is DashboardRecord {
  const r = raw as DashboardRecord | undefined;
  const validId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(v);
  if (!r || r.id !== id || !validId(id) || !validId(r.sourceAnalysisId) || typeof r.sourceActive !== 'boolean' || !Number.isSafeInteger(r.latest) || r.latest < 1 || !Array.isArray(r.versions) || !r.versions.length) throw new Error('Invalid dashboard history');
  let last = 0;
  for (const v of r.versions) {
    if (!Number.isSafeInteger(v.version) || v.version <= last || v.version > r.latest || v.sourceAnalysisId !== r.sourceAnalysisId || !validId(v.bindingOwnerId) || !validId(v.publishedBy) || typeof v.name !== 'string' || typeof v.publishedAt !== 'string' || !Number.isFinite(Date.parse(v.publishedAt)) || !v.wireDefinition || !Array.isArray(v.wireDefinition.DataSetIdentifierDeclarations) || !v.definition || !Array.isArray(v.definition.dataSetIdentifierDeclarations) || !v.datasetBindings || typeof v.datasetBindings !== 'object') throw new Error('Invalid dashboard version');
    const names = v.definition.dataSetIdentifierDeclarations.map(d => d.identifier);
    if (new Set(names).size !== names.length || Object.keys(v.datasetBindings).length !== names.length) throw new Error('Invalid dashboard bindings');
    for (const name of names) {
      const binding = Object.hasOwn(v.datasetBindings, name) ? v.datasetBindings[name] : undefined;
      if (!binding || !['dataset', 'prepared-dataset'].includes(binding.kind) || !validId(binding.id)) throw new Error('Invalid dashboard binding');
    }
    last = v.version;
  }
  if (last !== r.latest) throw new Error('Missing latest dashboard version');
}
