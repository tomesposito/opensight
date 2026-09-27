import { dataFields, tabular, type AuthorVisual, type CalculatedField } from './authoring.js';
import { fieldType, selectionFilters, type Selection } from './interactions.js';
export type DateGrain = 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY';
export interface HierarchyLevel { columnName: string; granularity?: DateGrain }
export interface DimensionHierarchy { id: string; name: string; levels: HierarchyLevel[] }
export type DrillPath = Selection[];
export const levelLabel = (level: HierarchyLevel): string => level.granularity ? `${level.columnName} · ${level.granularity.toLowerCase()}` : level.columnName;
export function hierarchyError(hierarchy: DimensionHierarchy, calculations: readonly CalculatedField[] = [], imported = false): string | undefined {
  if (!hierarchy || typeof hierarchy !== 'object' || Object.keys(hierarchy).some(k => !['id','name','levels'].includes(k)) || typeof hierarchy.id !== 'string' || !hierarchy.id || typeof hierarchy.name !== 'string' || !hierarchy.name.trim() || !Array.isArray(hierarchy.levels) || hierarchy.levels.length < 2 || hierarchy.levels.length > 10) return 'Define a name and two to ten hierarchy levels.';
  const seen = new Set<string>();
  for (const [i, level] of hierarchy.levels.entries()) {
    if (!level || Object.keys(level).some(k => !['columnName','granularity'].includes(k)) || typeof level.columnName !== 'string' || !level.columnName || !imported && !dataFields(calculations).some(f => f.name === level.columnName && f.role === 'dimension')) return 'Each level must reference a dimension.';
    const key = JSON.stringify(level);
    if (seen.has(key)) return 'Hierarchy levels must be unique.';
    seen.add(key);
    if (level.granularity !== undefined && (!['YEAR','QUARTER','MONTH','DAY'].includes(level.granularity) || !imported && fieldType(level.columnName, calculations) !== 'datetime')) return 'Date levels require a datetime dimension and a supported granularity.';
    if (i && level.columnName === hierarchy.levels[i - 1]!.columnName) {
      const order = ['YEAR','QUARTER','MONTH','DAY'];
      if (!level.granularity || order.indexOf(level.granularity) <= order.indexOf(hierarchy.levels[i - 1]!.granularity ?? 'DAY')) return 'Date levels must progress from coarser to finer grains.';
    }
  }
}
export function drillDown(visual: AuthorVisual, path: DrillPath, selection: Selection): DrillPath {
  const levels = visual.hierarchy?.levels, level = levels?.[path.length];
  return !levels || !level || path.length >= levels.length - 1 || selection.values[level.columnName] === undefined ? path : [...path, { values: { [level.columnName]: selection.values[level.columnName]! } }];
}
export function drillUp(path: DrillPath, depth = path.length - 1): DrillPath { return path.slice(0, Math.max(0, depth)); }
export function drillBreadcrumbs(visual: AuthorVisual, path: DrillPath): { label: string; depth: number }[] {
  if (!visual.hierarchy) return [];
  return [{ label: visual.hierarchy.name, depth: 0 }, ...path.map((selection, i) => ({ label: `${levelLabel(visual.hierarchy!.levels[i]!)}: ${selection.values[visual.hierarchy!.levels[i]!.columnName]}`, depth: i + 1 }))];
}
export function withDrill(visual: AuthorVisual, path: DrillPath, calculations: readonly CalculatedField[] = []): AuthorVisual {
  const level = visual.hierarchy?.levels[path.length];
  if (!level || visual.kind === 'kpi') return visual;
  const filters = path.flatMap((selection, i) => {
    const ancestor = visual.hierarchy!.levels[i]!, value = selection.values[ancestor.columnName], type = fieldType(ancestor.columnName, calculations);
    return type && value !== undefined ? selectionFilters(ancestor.columnName, type, value) : [];
  });
  return { ...visual, dimension: level.columnName, ...(tabular(visual.kind) ? { rows: [level.columnName, ...visual.rows.slice(1).filter(f => f !== level.columnName)], columns: visual.columns.filter(f => f !== level.columnName) } : {}),
    dateGrain: level.granularity ?? (level.columnName === 'order_date' ? 'MONTH' : undefined), interactionFilters: [...(visual.interactionFilters ?? []), ...filters] };
}
