import { colorValid } from './themes.js';
import type { Cell } from './model.js';
export interface ConditionalRule { fieldId: string; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; threshold: number; color: string; background: string }
export interface VisualFormatting {
  headersVisible?: boolean; rowNamesVisible?: boolean; columnNamesVisible?: boolean; valueNamesVisible?: boolean;
  headerColor?: string; headerBackground?: string; cellColor?: string; cellBackground?: string;
  fontSize?: number; decimalPlaces?: number; names?: Record<string, string>; rules?: ConditionalRule[];
}
export function formattingValid(raw: unknown): raw is VisualFormatting {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const f = raw as Record<string, unknown>;
  const booleans = ['headersVisible', 'rowNamesVisible', 'columnNamesVisible', 'valueNamesVisible'];
  const colors = ['headerColor', 'headerBackground', 'cellColor', 'cellBackground'];
  if (Object.keys(f).some(k => ![...booleans, ...colors, 'fontSize', 'decimalPlaces', 'names', 'rules'].includes(k))) return false;
  if (booleans.some(k => f[k] !== undefined && typeof f[k] !== 'boolean') || colors.some(k => f[k] !== undefined && !colorValid(f[k]))) return false;
  if (f.fontSize !== undefined && (!Number.isInteger(f.fontSize) || Number(f.fontSize) < 8 || Number(f.fontSize) > 32) || f.decimalPlaces !== undefined && (!Number.isInteger(f.decimalPlaces) || Number(f.decimalPlaces) < 0 || Number(f.decimalPlaces) > 12)) return false;
  if (f.names !== undefined && (!f.names || typeof f.names !== 'object' || Array.isArray(f.names) || Object.entries(f.names).some(([k, v]) => !k || typeof v !== 'string' || !v.trim() || v.length > 128))) return false;
  if (f.rules !== undefined && (!Array.isArray(f.rules) || f.rules.length > 20 || !f.rules.every(r => r && typeof r === 'object' && Object.keys(r).every(k => ['fieldId', 'operator', 'threshold', 'color', 'background'].includes(k)) && typeof r.fieldId === 'string' && !!r.fieldId && ['gt', 'gte', 'lt', 'lte', 'eq'].includes(r.operator) && typeof r.threshold === 'number' && Number.isFinite(r.threshold) && colorValid(r.color) && colorValid(r.background)))) return false;
  return true;
}
export function matchingRule(rules: readonly ConditionalRule[] | undefined, fieldId: string, value: Cell): ConditionalRule | undefined {
  if (typeof value !== 'number') return;
  return rules?.find(r => r.fieldId === fieldId && ({ gt: value > r.threshold, gte: value >= r.threshold, lt: value < r.threshold, lte: value <= r.threshold, eq: value === r.threshold })[r.operator]);
}
