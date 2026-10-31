import { parseExpression, compilePrep, hasCapability, METRIC_PREFIX, type MetricDefinition, type MetricDataset, type PublishedMetric } from '@opensight/query-engine';
import { AssetCatalog, assetFail, assetKey } from './asset-model.js';
import { object, identifier, resourceKey, type MetadataResource } from './metadata-resources.js';

export interface MetricVersion { version: number; state: 'draft' | 'published'; definition: MetricDefinition; actor: string; at: string }
export interface MetricRecord {
  dataset: MetricDataset; createdBy: string; publishedVersion: number | null;
  versions: MetricVersion[]; audit: { action: 'create' | 'edit' | 'publish'; actor: string; at: string; version: number }[];
}
export interface MetricSchema { columns: readonly { name: string; type: string }[]; unsafeJoin?: boolean }
export function metricDataset(raw: unknown): MetricDataset {
  const d = resourceKey(object(raw, ['kind', 'id', 'ownerId']) as unknown as MetricDataset);
  if (d.kind !== 'dataset' && d.kind !== 'prepared-dataset') assetFail('METRIC_INVALID_DATASET');
  return d as MetricDataset;
}
export function metricDefinition(raw: unknown, schema?: MetricSchema): MetricDefinition {
  const d = object(raw, ['name', 'expression', 'defaultAggregation', 'format', 'description', 'synonyms']);
  if (typeof d.name !== 'string' || !d.name.trim() || d.name !== d.name.trim() || d.name.length > 128 || /[{}\x00-\x1f]/.test(d.name) || d.name.startsWith(METRIC_PREFIX)) assetFail('METRIC_INVALID_NAME');
  if (typeof d.expression !== 'string' || !d.expression.trim() || d.expression.length > 10000) assetFail('METRIC_INVALID_EXPRESSION');
  if (!['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT_COUNT'].includes(String(d.defaultAggregation))) assetFail('METRIC_INVALID_AGGREGATION');
  const f = object(d.format, ['style', 'decimalPlaces', 'currency']);
  if (!['number', 'percent', 'currency'].includes(String(f.style)) || !Number.isInteger(f.decimalPlaces) || Number(f.decimalPlaces) < 0 || Number(f.decimalPlaces) > 10 || (f.style === 'currency' ? typeof f.currency !== 'string' || !/^[A-Z]{3}$/.test(f.currency) : f.currency !== undefined)) assetFail('METRIC_INVALID_FORMAT');
  if (typeof d.description !== 'string' || d.description.length > 4000 || !Array.isArray(d.synonyms) || d.synonyms.length > 50 || d.synonyms.some(s => typeof s !== 'string' || !s.trim() || s !== s.trim() || s.length > 128 || /[{}\x00-\x1f]/.test(s)) || new Set(d.synonyms.map(s => String(s).toLowerCase())).size !== d.synonyms.length) assetFail('METRIC_INVALID_INPUT');
  if (schema) {
    if (schema.columns.some(c => c.name.toLowerCase() === String(d.name).toLowerCase())) assetFail('METRIC_NAME_CONFLICT', 409);
    try {
      const expression = parseExpression(d.expression, '$.expression', { bind: name => {
        const c = schema.columns.find(c => c.name === name);
        if (!c) assetFail('METRIC_UNKNOWN_FIELD', 422);
        return { scalarType: c.type === 'STRING' ? 'string' : c.type === 'DATETIME' ? 'datetime' : c.type === 'BOOLEAN' ? 'boolean' : 'number', nullable: true };
      } });
      if (expression.scalarType !== 'number' && !['COUNT', 'DISTINCT_COUNT'].includes(String(d.defaultAggregation))) assetFail('METRIC_TYPE_MISMATCH', 422);
    } catch (e) { if (e && typeof e === 'object' && 'code' in e && String(e.code).startsWith('METRIC_')) throw e; assetFail('METRIC_INVALID_EXPRESSION', 422); }
  }
  return structuredClone(d) as unknown as MetricDefinition;
}
export function metricRecord(resource: MetadataResource): MetricRecord { return resource.body as unknown as MetricRecord; }
/** Storage validation is separate from live-schema validation, so historical definitions survive schema changes. */
export function validateMetricRecord(raw: unknown): MetricRecord {
  const b = object(raw, ['dataset', 'createdBy', 'publishedVersion', 'versions', 'audit']); metricDataset(b.dataset); identifier(b.createdBy);
  if (!Array.isArray(b.versions) || !b.versions.length || !Array.isArray(b.audit) || b.audit.length !== b.versions.length) assetFail('METRIC_INVALID_HISTORY');
  let published: number | null = null;
  b.versions.forEach((raw, i) => {
    const v = object(raw, ['version', 'state', 'definition', 'actor', 'at']);
    if (v.version !== i + 1 || !['draft', 'published'].includes(String(v.state)) || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) assetFail('METRIC_INVALID_HISTORY');
    identifier(v.actor); metricDefinition(v.definition);
    const a = object((b.audit as unknown[])[i], ['action', 'actor', 'at', 'version']);
    if (a.version !== v.version || a.actor !== v.actor || a.at !== v.at || a.action !== (v.state === 'published' ? 'publish' : i === 0 ? 'create' : 'edit')) assetFail('METRIC_INVALID_HISTORY');
    if (v.state === 'published') published = i + 1;
  });
  if (b.publishedVersion !== published || (b.versions[0] as MetricVersion).actor !== b.createdBy) assetFail('METRIC_INVALID_HISTORY');
  return b as unknown as MetricRecord;
}
export class MetricCatalog {
  constructor(readonly assets: AssetCatalog) {}
  dataset(ref: MetricDataset) { return this.assets.find(ref.kind, ref.id, ref.ownerId) ?? assetFail('METRIC_DATASET_NOT_FOUND', 404); }
  schema(ref: MetricDataset): MetricSchema {
    const dataset = this.dataset(ref);
    if (ref.kind === 'dataset') {
      const wire = object(dataset.body.definition), d = object(wire.DataSet ?? wire);
      if (!Array.isArray(d.OutputColumns)) assetFail('METRIC_SCHEMA_UNAVAILABLE', 422);
      return { columns: d.OutputColumns.map(raw => { const c = object(raw); return { name: String(c.Name), type: String(c.Type) }; }) };
    }
    const datasets = this.assets.resources.filter(r => r.kind === 'prepared-dataset' && r.ownerId === ref.ownerId).map(r => ({ id: r.id, pipeline: object(r.body.resource).opensightPrep as import('@opensight/bundle-parser/prep').PrepPipeline }));
    const sources = this.assets.resources.filter(r => r.kind === 'source' && r.ownerId === ref.ownerId).map((r, i) => ({ id: r.id, table: `metric_schema_${i}`, connectorId: 'file', security: 'unrestricted' as const, columns: object(r.body.binding).columns as import('@opensight/bundle-parser/prep').PrepColumn[] }));
    return { columns: compilePrep(datasets.find(d => d.id === ref.id)!.pipeline, sources, { datasets, datasetId: ref.id }).columns };
  }
  canPublish(ref: MetricDataset) {
    const d = this.dataset(ref), user = this.assets.user();
    if (user.body.role === 'administrator') return true;
    if (!hasCapability(user.body.role, 'build')) return false;
    if (d.ownerId) return d.ownerId === this.assets.scope.userId;
    const sources = d.body.sources as { ownerId?: string }[] | undefined;
    return !!sources?.length && sources.every(s => s.ownerId === this.assets.scope.userId);
  }
  canEdit(r: MetadataResource) { const b = metricRecord(r); return hasCapability(this.assets.user().body.role, 'build') && (this.canPublish(b.dataset) || b.publishedVersion === null && b.createdBy === this.assets.scope.userId); }
  get(id: string) {
    this.assets.user();
    const r = this.assets.find('metric', id) ?? assetFail('METRIC_NOT_FOUND', 404), b = metricRecord(r);
    this.dataset(b.dataset);
    if (b.publishedVersion === null && !this.canEdit(r)) assetFail('METRIC_NOT_FOUND', 404);
    return r;
  }
  list(ref?: MetricDataset) {
    this.assets.user(); if (ref) this.dataset(ref);
    return this.assets.resources.filter(r => r.kind === 'metric' && (!ref || assetKey(metricRecord(r).dataset) === assetKey(ref))).flatMap(r => {
      try { return [this.get(r.id)]; } catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'METRIC_NOT_FOUND') return []; throw e; }
    });
  }
  private checkName(id: string, dataset: MetricDataset, definition: MetricDefinition) {
    if (this.assets.resources.some(r => r.kind === 'metric' && r.id !== id && assetKey(metricRecord(r).dataset) === assetKey(dataset) && metricRecord(r).versions.filter(v => v.version === r.version || v.version === metricRecord(r).publishedVersion).some(v => v.definition.name.toLowerCase() === definition.name.toLowerCase()))) assetFail('METRIC_NAME_CONFLICT', 409);
  }
  create(id: string, dataset: MetricDataset, raw: unknown, schema: MetricSchema) {
    this.assets.build(); this.dataset(dataset); identifier(id);
    if (this.assets.find('metric', id)) assetFail('METRIC_ID_CONFLICT', 409);
    const definition = metricDefinition(raw, schema); this.checkName(id, dataset, definition);
    const b: MetricRecord = { dataset, createdBy: this.assets.scope.userId, publishedVersion: null, versions: [], audit: [] };
    const r: MetadataResource = { kind: 'metric', id, version: 0, body: b as unknown as Record<string, unknown> };
    this.append(r, 'create', definition); this.assets.resources.push(r); return r;
  }
  edit(id: string, expected: number, raw: unknown, schema: MetricSchema) {
    this.assets.build(); const r = this.get(id), b = metricRecord(r);
    if (!this.canEdit(r)) assetFail('METRIC_EDIT_FORBIDDEN', 403);
    this.assets.match(r, expected);
    const definition = metricDefinition(raw, schema); this.checkName(id, b.dataset, definition);
    this.append(r, 'edit', definition); return r;
  }
  publish(id: string, expected: number, schema: MetricSchema) {
    const r = this.get(id), b = metricRecord(r);
    if (!this.canPublish(b.dataset)) assetFail('METRIC_PUBLISH_FORBIDDEN', 403);
    this.assets.match(r, expected);
    const latest = b.versions.at(-1)!;
    if (latest.state !== 'draft') assetFail('METRIC_NO_DRAFT', 409);
    const definition = metricDefinition(latest.definition, schema); this.checkName(id, b.dataset, definition);
    this.append(r, 'publish', definition); return r;
  }
  private append(r: MetadataResource, action: 'create' | 'edit' | 'publish', definition: MetricDefinition) {
    const b = metricRecord(r), version = ++r.version, actor = this.assets.scope.userId, at = new Date().toISOString();
    b.versions.push({ version, state: action === 'publish' ? 'published' : 'draft', definition: structuredClone(definition), actor, at });
    b.audit.push({ action, version, actor, at }); if (action === 'publish') b.publishedVersion = version;
  }
  execution(ref: MetricDataset) {
    const seen = new Set<string>();
    const unsafe = (ref: MetricDataset): boolean => {
      const key = assetKey(ref); if (seen.has(key)) assetFail('METRIC_DATASET_CYCLE', 422); seen.add(key);
      const r = this.dataset(ref);
      if (ref.kind === 'dataset') { const wire = object(r.body.definition), d = object(wire.DataSet ?? wire); return Object.values(object(d.LogicalTableMap ?? {})).some(t => !!object(object(t).Source ?? {}).JoinInstruction); }
      const p = object(object(r.body.resource).opensightPrep), steps = p.steps as { kind: string; config: { source?: unknown } }[];
      if (steps.some(s => s.kind === 'join')) return true;
      const refs = [p.input, ...steps.filter(s => s.kind === 'append').map(s => s.config.source)];
      const result = refs.some(r => r && typeof r === 'object' && 'dataset' in r && unsafe({ ...ref, id: String(r.dataset) }));
      seen.delete(key); return result;
    };
    return { metrics: this.published(ref), unsafeJoin: unsafe(ref) };
  }
  published(ref: MetricDataset): PublishedMetric[] {
    return this.list(ref).flatMap(r => { const b = metricRecord(r), v = b.versions.find(v => v.version === b.publishedVersion); return v ? [{ id: r.id, version: v.version, ...structuredClone(v.definition) }] : []; });
  }
}
