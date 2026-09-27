import type { AuthorParameter, ParameterValue } from './parameters.js';
import { parameterValueError } from './parameters.js';
export type ControlKind = 'dropdown' | 'slider' | 'date' | 'text';
export interface AuthorControl {
  id: string; label: string; kind: ControlKind; parameterId: string;
  options?: ParameterValue[];
  source?: { columnName: string; dataSetIdentifier: string; local: boolean };
  cascade?: { controlId: string; columnName: string }[];
  min?: number; max?: number; step?: number;
  importedId?: string;
}
export function controlError(control: AuthorControl, parameters: readonly AuthorParameter[]): string | undefined {
  const p = parameters.find(p => p.id === control.parameterId);
  if (!p) return 'Choose a declared parameter.';
  if (!['dropdown', 'slider', 'date', 'text'].includes(control.kind)) return 'Unsupported control type.';
  if (control.kind === 'slider' && (p.type !== 'number' || p.multiple) || control.kind === 'date' && p.type !== 'datetime' || control.kind === 'text' && (p.type !== 'string' || p.multiple)) return 'The control type does not match the parameter.';
  if (control.kind === 'slider' && (![control.min, control.max, control.step].every(v => typeof v === 'number' && Number.isFinite(v)) || control.min! >= control.max! || control.step! <= 0 || p.integer && ![control.min, control.max, control.step].every(Number.isSafeInteger))) return 'Slider requires a minimum below maximum and a positive step matching the number type.';
  if (control.options !== undefined && parameterValueError({ ...p, multiple: true }, control.options)) return 'Control options must match the parameter type.';
}
export function validateControls(raw: unknown, parameters: readonly AuthorParameter[]): asserts raw is AuthorControl[] {
  if (!Array.isArray(raw)) throw new Error('Invalid controls');
  const ids = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c !== 'object' || Object.keys(c).some(k => !['id','label','kind','parameterId','options','source','cascade','min','max','step','importedId'].includes(k)) || typeof c.id !== 'string' || !c.id || ids.has(c.id) || typeof c.label !== 'string' || c.importedId !== undefined && typeof c.importedId !== 'string' || controlError(c, parameters)) throw new Error('Invalid control');
    if (c.source !== undefined && (!c.source || Object.keys(c.source).some(k => !['columnName','dataSetIdentifier','local'].includes(k)) || typeof c.source.columnName !== 'string' || !c.source.columnName || typeof c.source.dataSetIdentifier !== 'string' || typeof c.source.local !== 'boolean')) throw new Error('Invalid control source');
    if (c.cascade !== undefined && (!Array.isArray(c.cascade) || !c.source || c.cascade.some((v: Record<string, unknown>) => !v || Object.keys(v).some(k => !['controlId','columnName'].includes(k)) || typeof v.columnName !== 'string' || !v.columnName || !raw.some(parent => parent.id === v.controlId && parent.id !== c.id)))) throw new Error('Invalid cascade');
    ids.add(c.id);
  }
  const visit = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id)) throw new Error('Cascading controls cannot form a cycle');
    const next = new Set(seen).add(id);
    raw.find(c => c.id === id)?.cascade?.forEach((p: { controlId: string }) => visit(p.controlId, next));
  };
  ids.forEach(id => visit(id));
}
