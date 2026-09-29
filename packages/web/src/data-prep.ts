import { validatePrepPipeline, type PrepStep, type PrepColumn, type PrepPipeline, type PrepInput, type PrepJoinInput } from '@opensight/bundle-parser/prep';
import type { BundleDataSet, QsBundle } from '@opensight/bundle-parser/browser';
import { compilePrep, type PrepSource } from '@opensight/query-engine/browser';
export interface PrepSourceSummary { execution?: import('./api-client.js').ExecutionStatus; id: string; ref?: PrepJoinInput; name?: string; connectorId: string; columns: PrepColumn[]; available: boolean; errorCode?: string }
export const prepRefKey = (ref: PrepJoinInput): string => JSON.stringify(ref);
export const prepSourceRef = (source: PrepSourceSummary): PrepJoinInput => source.ref ?? source.id;
export const prepRefLabel = (ref: PrepJoinInput): string => typeof ref === 'string' ? ref : 'dataset' in ref ? `Dataset · ${ref.dataset}` : `Step · ${ref.step}`;
export const prepSourceLabel = (source: PrepSourceSummary): string => `${source.ref && typeof source.ref !== 'string' ? 'dataset' in source.ref ? 'Prepared dataset' : 'Earlier step' : source.connectorId === 'file' ? 'Uploaded file' : source.connectorId} · ${source.name ?? source.id}${source.execution ? ` · ${source.execution.mode === 'BLAZE' ? 'BLAZE' : 'DIRECT QUERY'}` : ''}`;
export function prepMessage(e: unknown): string {
  return e instanceof Error ? `${'code' in e && typeof e.code === 'string' ? `${e.code}: ` : ''}${e.message}` : 'Invalid pipeline';
}
export interface PrepSchemaContext { datasets?: readonly BundleDataSet[]; datasetId?: string }
/** One graph node per source occurrence: repeated references to the same source render as
 *  distinct nodes (self-join instances: Product, Product (2), Product (3)), ordered by first use. */
export function prepInputNodes(pipeline: PrepPipeline): { ref: PrepInput; instance: number; consumers: string[] }[] {
  const nodes: { ref: PrepInput; instance: number; consumers: string[] }[] = [];
  const seen = new Map<string, number>();
  const add = (ref: PrepJoinInput, consumer: string) => {
    if (typeof ref !== 'string' && 'step' in ref) return;
    const key = prepRefKey(ref), instance = (seen.get(key) ?? 0) + 1;
    seen.set(key, instance);
    nodes.push({ ref, instance, consumers: [consumer] });
  };
  add(pipeline.input, 'Input');
  for (const [i, step] of pipeline.steps.entries()) if (step.kind === 'join' || step.kind === 'append') add(step.config.source, `${i + 1}. ${prepLabel(step.kind)}`);
  return nodes;
}
/** QuickSight-style instance label: first occurrence plain, later ones get " (2)", " (3)". */
export const prepInstanceLabel = (base: string, instance: number): string => instance > 1 ? `${base} (${instance})` : base;
/** 1-based occurrence of a join/append step's source among same-ref uses in the pipeline.
 *  Bundle refs distinguish instances by position; a step not yet in the pipeline counts as the next occurrence. */
export function prepStepSourceInstance(pipeline: PrepPipeline, step: PrepStep): number {
  if (step.kind !== 'join' && step.kind !== 'append') return 1;
  const source = step.config.source;
  if (typeof source !== 'string' && 'step' in source) return 1;
  const key = prepRefKey(source), keys = [prepRefKey(pipeline.input)];
  for (const s of pipeline.steps) {
    if (s.kind !== 'join' && s.kind !== 'append') continue;
    if (typeof s.config.source !== 'string' && 'step' in s.config.source) continue;
    keys.push(prepRefKey(s.config.source));
    if (s.id === step.id) break;
  }
  const count = keys.filter(k => k === key).length;
  return pipeline.steps.some(s => s.id === step.id) ? count : count + 1;
}
export const prepCatalog: { kind: PrepStep['kind']; label: string; group: string }[] = [
  { kind: 'calculate', label: 'Add calculated column', group: 'Column transformations' },
  { kind: 'changeType', label: 'Change data type', group: 'Column transformations' },
  { kind: 'rename', label: 'Rename column', group: 'Column transformations' },
  { kind: 'select', label: 'Select columns', group: 'Column transformations' },
  { kind: 'append', label: 'Append', group: 'Combine' }, { kind: 'join', label: 'Join', group: 'Combine' },
  { kind: 'aggregate', label: 'Aggregate', group: 'Other' }, { kind: 'filter', label: 'Filter', group: 'Other' },
  { kind: 'pivot', label: 'Pivot', group: 'Other' }, { kind: 'unpivot', label: 'Unpivot', group: 'Other' },
];
export const prepLabel = (kind: PrepStep['kind']) => prepCatalog.find(c => c.kind === kind)!.label;
export function prepBindings(sources: readonly PrepSourceSummary[]): PrepSource[] {
  return sources.filter(s => !s.ref || typeof s.ref === 'string').map(s => ({ ...s, table: s.id, security: s.available ? 'unrestricted' : 'protected' }));
}
export function prepPlan(pipeline: PrepPipeline, sources: readonly PrepSourceSummary[], through?: string | null, context: PrepSchemaContext = {}) {
  const input = sources.find(s => prepRefKey(prepSourceRef(s)) === prepRefKey(pipeline.input));
  const dialect = input?.connectorId === 'postgresql' ? 'postgres' : 'duckdb';
  const datasets = context.datasets?.filter(d => d.opensightPrep).map(d => {
    const cached = sources.find(s => typeof s.ref === 'object' && 'dataset' in s.ref && s.ref.dataset === d.dataSetId && s.execution?.mode === 'BLAZE');
    const materialized: PrepSource | undefined = cached ? { id: `cached-${cached.id}`, table: `cached-${cached.id}`, connectorId: 'file', columns: cached.columns, security: cached.available ? 'unrestricted' : 'protected' } : undefined;
    return { id: d.dataSetId, pipeline: d.opensightPrep!, ...(materialized ? { materialized } : {}) };
  });
  return compilePrep(pipeline, prepBindings(sources), { dialect, through, datasetId: context.datasetId, datasets });
}
export function prepSchema(pipeline: PrepPipeline, sources: readonly PrepSourceSummary[], through?: string | null, context: PrepSchemaContext = {}): PrepColumn[] {
  return prepPlan(pipeline, sources, through, context).columns;
}
export function newPrepStep(kind: PrepStep['kind'], columns: readonly PrepColumn[], sources: readonly PrepSourceSummary[], input: PrepInput): PrepStep {
  const col = columns[0]?.name ?? '', numeric = columns.find(c => c.type === 'DECIMAL' || c.type === 'INTEGER')?.name ?? col;
  const available = sources.filter(s => s.available);
  const right = available.find(s => prepRefKey(prepSourceRef(s)) !== prepRefKey(input)) ?? available[0];
  const source = right ? prepSourceRef(right) : input;
  const id = `step-${globalThis.crypto.randomUUID()}`;
  switch (kind) {
    case 'changeType': return { id, kind, config: { column: col, type: 'STRING' } };
    case 'rename': return { id, kind, config: { column: col, name: `${col}_renamed` } };
    case 'select': return { id, kind, config: { columns: columns.map(c => c.name) } };
    case 'filter': return { id, kind, config: { filters: [{ columnName: col, values: [] }] } };
    case 'calculate': return { id, kind, config: { name: 'calculated_column', expression: `{${numeric}}` } };
    case 'aggregate': return { id, kind, config: { groupBy: [], measures: [{ column: numeric, name: 'total', aggregation: 'SUM' }] } };
    case 'join': return { id, kind, config: { source, joinType: 'left', keys: [{ left: col, right: right?.columns.find(c => c.name === col && c.type === columns[0]?.type)?.name ?? right?.columns.find(c => c.type === columns[0]?.type)?.name ?? right?.columns[0]?.name ?? '' }], prefix: 'joined_' } };
    case 'append': return { id, kind, config: { source: available.find(s => !s.ref && s.id !== input)?.id ?? (typeof input === 'string' ? input : '') } };
    case 'pivot': return { id, kind, config: { groupBy: [], column: col, value: numeric, aggregation: 'SUM', values: [{ value: 'value', name: 'pivot_value' }] } };
    case 'unpivot': return { id, kind, config: { columns: [numeric], nameColumn: 'column_name', valueColumn: 'column_value' } };
  }
}
/** Preserve every other member/property of a supplied bundle during prep editing. */
export function prepBundle(resource: BundleDataSet, pipeline: PrepPipeline, original?: QsBundle): QsBundle {
  const bundle = original ? structuredClone(original) : { members: [{ path: `dataset/${resource.dataSetId}.json`, resource: structuredClone(resource) }] };
  const member = bundle.members.find(m => m.resource.resourceType === 'dataset' && m.resource.dataSetId === resource.dataSetId);
  if (!member || member.resource.resourceType !== 'dataset') throw new Error('Prepared dataset is missing from the bundle');
  member.resource.name = resource.name;
  member.resource.opensightPrep = validatePrepPipeline(pipeline);
  return bundle;
}
