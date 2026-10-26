import type { BundleDefinition } from '@opensight/bundle-parser';
import { analysisFail, analysisId, analysisObject, checkAnalysisInput, type AnalysisSchema } from '@opensight/web/analysis';
import type { JsonObject } from './mapping.js';
export interface DatasetBinding { kind: 'dataset' | 'prepared-dataset'; id: string }
export type DatasetBindings = Record<string, DatasetBinding>;
export interface AnalysisRecord { id: string; name: string; definition: BundleDefinition; datasetBindings: DatasetBindings; version: number; updatedAt?: string; hasHadVisual?: boolean; bindingOwnerId?: string }
export interface AnalysisBackend {
  /** Only the local backend has the configured synthetic sales binding. */
  sampleDatasetId?: 'sales';
  /** Scope is trusted and comes only from verified identity or explicit local mode. */
  scope: { tenantId: string; namespaceId: string; userId: string };
  list(): Promise<{ kind: 'analysis'; id: string; name: string }[]>;
  authorize(id?: string, write?: boolean): Promise<void>;
  exists(id: string): Promise<boolean>;
  accessSnapshot(id: string): Promise<unknown>;
  authorizeRemoved(snapshot: unknown): Promise<void>;
  get(id: string): Promise<AnalysisRecord>;
  resolve(bindings: DatasetBindings): Promise<Map<string, AnalysisSchema>>;
  /** Capture admission revisions, then compare them inside the storage transaction. */
  stamp(): Promise<unknown>;
  check(stamp: unknown): Promise<void>;
  save(record: AnalysisRecord, expectedVersion: number, stamp: unknown): Promise<void>;
  remove(id: string, expectedVersion: number, stamp: unknown): Promise<void>;
}
export function datasetBindings(raw: unknown, definition: BundleDefinition): DatasetBindings {
  const bindings = analysisObject(raw, '$.datasetBindings'), declarations = definition.dataSetIdentifierDeclarations;
  if (!Array.isArray(declarations)) analysisFail('INVALID_INPUT', '$.definition.dataSetIdentifierDeclarations', 'Expected declarations');
  const names = declarations.map((d, i) => {
    const v = analysisObject(d, `$.definition.dataSetIdentifierDeclarations[${i}]`);
    if (typeof v.identifier !== 'string' || !v.identifier.trim()) analysisFail('INVALID_INPUT', `$.definition.dataSetIdentifierDeclarations[${i}].identifier`, 'Expected identifier');
    return v.identifier;
  });
  if (new Set(names).size !== names.length || Object.keys(bindings).length !== names.length || names.some(n => !Object.hasOwn(bindings, n))) analysisFail('UNRESOLVED_BINDING', '$.datasetBindings', 'Bindings must exactly match unique declarations');
  return Object.fromEntries(names.map(name => {
    const path = `$.datasetBindings[${JSON.stringify(name)}]`, b = analysisObject(bindings[name], path);
    checkAnalysisInput(b, path);
    if (Object.keys(b).length !== 2 || !['kind', 'id'].every(k => Object.hasOwn(b, k)) || b.kind !== 'dataset' && b.kind !== 'prepared-dataset') analysisFail('INVALID_INPUT', path, 'Expected { kind: dataset | prepared-dataset, id }');
    const id = analysisId(b.id, `${path}.id`);
    if (b.kind === 'prepared-dataset' && id.length > 128) analysisFail('INVALID_INPUT', `${path}.id`, 'Prepared dataset id exceeds 128 characters');
    return [name, { kind: b.kind, id } as DatasetBinding];
  }));
}
export function analysisName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || /[\x00-\x1f]/.test(raw)) analysisFail('INVALID_INPUT', '$.name', 'Expected a name of 1–512 characters');
  return raw;
}
export function describeAnalysis(record: AnalysisRecord, Definition: JsonObject, Errors: unknown[]) {
  return { AnalysisId: record.id, Name: record.name, Definition, Errors };
}

/** Internal milestone checks support the persisted QuickSight wire definition. */
export function wireHasVisuals(wire: unknown): boolean {
  if (!wire || typeof wire !== 'object' || !('Definition' in wire)) return false;
  const definition = wire.Definition;
  if (!definition || typeof definition !== 'object' || !('Sheets' in definition) || !Array.isArray(definition.Sheets)) return false;
  return definition.Sheets.some((sheet: unknown) => !!sheet && typeof sheet === 'object' && 'Visuals' in sheet && Array.isArray(sheet.Visuals) && sheet.Visuals.length > 0);
}
