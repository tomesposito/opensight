import { validatePrepPipeline, type PrepStep, type PrepColumn, type PrepPipeline } from '@opensight/bundle-parser/prep';
import type { BundleDataSet, QsBundle } from '@opensight/bundle-parser/browser';
import { compilePrep, type PrepSource } from '@opensight/query-engine/browser';
export interface PrepSourceSummary { id: string; connectorId: string; columns: PrepColumn[]; available: boolean }
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
  return sources.map(s => ({ ...s, table: s.id, security: s.available ? 'unrestricted' : 'protected' }));
}
export function prepSchema(pipeline: PrepPipeline, sources: readonly PrepSourceSummary[], through?: string | null): PrepColumn[] {
  const input = sources.find(s => s.id === pipeline.input);
  const dialect = input?.connectorId === 'postgresql' ? 'postgres' : 'duckdb';
  return compilePrep(pipeline, prepBindings(sources), { dialect, through }).columns;
}
export function newPrepStep(kind: PrepStep['kind'], columns: readonly PrepColumn[], sources: readonly PrepSourceSummary[], input: string): PrepStep {
  const col = columns[0]?.name ?? '', numeric = columns.find(c => c.type === 'DECIMAL' || c.type === 'INTEGER')?.name ?? col;
  const source = sources.find(s => s.id !== input)?.id ?? input;
  const id = `step-${globalThis.crypto.randomUUID()}`;
  switch (kind) {
    case 'changeType': return { id, kind, config: { column: col, type: 'STRING' } };
    case 'rename': return { id, kind, config: { column: col, name: `${col}_renamed` } };
    case 'select': return { id, kind, config: { columns: columns.map(c => c.name) } };
    case 'filter': return { id, kind, config: { filters: [{ columnName: col, values: [] }] } };
    case 'calculate': return { id, kind, config: { name: 'calculated_column', expression: `{${numeric}}` } };
    case 'aggregate': return { id, kind, config: { groupBy: [], measures: [{ column: numeric, name: 'total', aggregation: 'SUM' }] } };
    case 'join': return { id, kind, config: { source, joinType: 'left', keys: [{ left: col, right: sources.find(s => s.id === source)?.columns[0]?.name ?? '' }], columns: [{ column: col, name: `joined_${col}` }] } };
    case 'append': return { id, kind, config: { source } };
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
