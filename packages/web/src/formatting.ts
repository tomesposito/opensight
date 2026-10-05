import { colorValid } from './themes.js';
import type { Cell, Field } from './model.js';
import type { VisualKind } from './visual-catalog.js';
export const hasLegend = (kind: VisualKind): boolean => ['bar', 'line', 'pie', 'combo', 'area', 'bar100', 'radar'].includes(kind);
export const hasDataLabels = (kind: VisualKind): boolean => !['table', 'pivot', 'kpi', 'gauge', 'box', 'wordCloud', 'pointMap'].includes(kind);
export const LEGEND_POSITIONS = ['AUTO', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT'] as const;
export type LegendPosition = typeof LEGEND_POSITIONS[number];
export const legendPositionValid = (raw: unknown): raw is LegendPosition => LEGEND_POSITIONS.some(p => p === raw);
export const binsValid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
export function gaugeValid(v: unknown): v is { min: number; max: number } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const g = v as Record<string, unknown>;
  return Object.keys(g).every(k => k === 'min' || k === 'max') && typeof g.min === 'number' && typeof g.max === 'number' && Number.isFinite(g.min) && Number.isFinite(g.max) && g.min < g.max;
}
export interface ConditionalRule { fieldId: string; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; threshold: number; color: string; background: string }
export interface PivotOptions {
  metricPlacement?: 'columns' | 'rows';
  hideEmptyRows?: boolean; hideEmptyColumns?: boolean;
  wordWrap?: boolean; columnWidth?: number;
  /** Typed row-dimension prefixes; omitted groups are expanded. */
  collapsedRowGroups?: Cell[][];
}
export function rowGroupPathValid(raw: unknown): raw is Cell[] {
  return Array.isArray(raw) && raw.length > 0 && raw.every(value => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value));
}
export function pivotOptionsValid(raw: unknown): raw is PivotOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  return Object.keys(p).every(k => ['metricPlacement', 'hideEmptyRows', 'hideEmptyColumns', 'wordWrap', 'columnWidth', 'collapsedRowGroups'].includes(k))
    && (p.collapsedRowGroups === undefined || Array.isArray(p.collapsedRowGroups) && p.collapsedRowGroups.every(rowGroupPathValid) && new Set(p.collapsedRowGroups.map(path => JSON.stringify(path))).size === p.collapsedRowGroups.length)
    && (p.metricPlacement === undefined || p.metricPlacement === 'columns' || p.metricPlacement === 'rows')
    && ['hideEmptyRows', 'hideEmptyColumns', 'wordWrap'].every(k => p[k] === undefined || typeof p[k] === 'boolean')
    && (p.columnWidth === undefined || Number.isInteger(p.columnWidth) && Number(p.columnWidth) >= 60 && Number(p.columnWidth) <= 400);
}
export interface VisualFormatting {
  pivot?: PivotOptions;
  titleFontSize?: number; barCategoryGap?: number; legendPosition?: LegendPosition;
  headersVisible?: boolean; rowNamesVisible?: boolean; columnNamesVisible?: boolean; valueNamesVisible?: boolean;
  headerColor?: string; headerBackground?: string; cellColor?: string; cellBackground?: string;
  fontSize?: number; decimalPlaces?: number; names?: Record<string, string>; rules?: ConditionalRule[];
}
export function formattingValid(raw: unknown): raw is VisualFormatting {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const f = raw as Record<string, unknown>;
  const booleans = ['headersVisible', 'rowNamesVisible', 'columnNamesVisible', 'valueNamesVisible'];
  const colors = ['headerColor', 'headerBackground', 'cellColor', 'cellBackground'];
  if (Object.keys(f).some(k => ![...booleans, ...colors, 'fontSize', 'decimalPlaces', 'names', 'rules', 'pivot', 'titleFontSize', 'barCategoryGap', 'legendPosition'].includes(k))) return false;
  if (f.legendPosition !== undefined && !legendPositionValid(f.legendPosition)) return false;
  if (f.pivot !== undefined && !pivotOptionsValid(f.pivot)) return false;
  if (f.titleFontSize !== undefined && (!Number.isInteger(f.titleFontSize) || Number(f.titleFontSize) < 8 || Number(f.titleFontSize) > 48)) return false;
  if (f.barCategoryGap !== undefined && (!Number.isInteger(f.barCategoryGap) || Number(f.barCategoryGap) < 0 || Number(f.barCategoryGap) > 80)) return false;
  if (booleans.some(k => f[k] !== undefined && typeof f[k] !== 'boolean') || colors.some(k => f[k] !== undefined && !colorValid(f[k]))) return false;
  if (f.fontSize !== undefined && (!Number.isInteger(f.fontSize) || Number(f.fontSize) < 8 || Number(f.fontSize) > 32) || f.decimalPlaces !== undefined && (!Number.isInteger(f.decimalPlaces) || Number(f.decimalPlaces) < 0 || Number(f.decimalPlaces) > 12)) return false;
  if (f.names !== undefined && (!f.names || typeof f.names !== 'object' || Array.isArray(f.names) || Object.entries(f.names).some(([k, v]) => !k || typeof v !== 'string' || !v.trim() || v.length > 128))) return false;
  if (f.rules !== undefined && (!Array.isArray(f.rules) || f.rules.length > 20 || !f.rules.every(r => r && typeof r === 'object' && Object.keys(r).every(k => ['fieldId', 'operator', 'threshold', 'color', 'background'].includes(k)) && typeof r.fieldId === 'string' && !!r.fieldId && ['gt', 'gte', 'lt', 'lte', 'eq'].includes(r.operator) && typeof r.threshold === 'number' && Number.isFinite(r.threshold) && colorValid(r.color) && colorValid(r.background)))) return false;
  return true;
}
export function matchingRule(rules: readonly ConditionalRule[] | undefined, fieldId: string, value: Cell): ConditionalRule | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  return rules?.find(r => r.fieldId === fieldId && ({ gt: value > r.threshold, gte: value >= r.threshold, lt: value < r.threshold, lte: value <= r.threshold, eq: value === r.threshold })[r.operator]);
}
export function fieldName(field: Field, formatting?: VisualFormatting): string {
  const names = formatting?.names;
  return names && Object.hasOwn(names, field.column) ? names[field.column]! : names && Object.hasOwn(names, field.id) ? names[field.id]! : field.column;
}
export function fieldRule(formatting: VisualFormatting | undefined, field: Field, value: Cell): ConditionalRule | undefined {
  return formatting?.rules?.find(rule => (rule.fieldId === field.column || rule.fieldId === field.id) && matchingRule([rule], rule.fieldId, value));
}
