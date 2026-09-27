import { parameterValueError, validateParameters } from '@opensight/query-engine/parameters';
import type { ParameterDeclaration, ParameterValue } from '@opensight/query-engine/parameters';
export { parameterValueError };
export type { ParameterDeclaration, ParameterValue };
export interface AuthorParameter extends ParameterDeclaration {
  id: string; defaultValues: ParameterValue[]; values: ParameterValue[];
  memberPath?: string;
}
export const declaration = ({ name, type, multiple, integer }: AuthorParameter): ParameterDeclaration => ({ name, type, multiple, ...(integer === undefined ? {} : { integer }) });
export function parameterError(p: AuthorParameter): string | undefined {
  try { validateParameters([declaration(p)], { [p.name]: p.values }); }
  catch (e) { return e instanceof Error ? e.message : String(e); }
  return parameterValueError(p, p.defaultValues);
}
export function validateAuthorParameters(raw: unknown): asserts raw is AuthorParameter[] {
  if (!Array.isArray(raw)) throw new Error('Invalid parameters');
  const ids = new Set<string>(), names = new Set<string>();
  for (const p of raw) {
    if (!p || typeof p !== 'object' || Object.keys(p).some(k => !['id', 'name', 'type', 'multiple', 'integer', 'values', 'defaultValues', 'memberPath'].includes(k)) || typeof p.id !== 'string' || !/^parameter-[1-9][0-9]*$/.test(p.id) || ids.has(p.id) || p.memberPath !== undefined && typeof p.memberPath !== 'string' || names.has(`${p.memberPath ?? ''}:${p.name}`) || parameterError(p)) throw new Error('Invalid parameters');
    ids.add(p.id); names.add(`${p.memberPath ?? ''}:${p.name}`);
  }
}
export function importParameter(raw: unknown, id: string, memberPath: string): AuthorParameter | undefined {
  if (!raw || typeof raw !== 'object') return;
  const [kind, body] = Object.entries(raw)[0] ?? [];
  if (!body || typeof body !== 'object' || !['stringParameterDeclaration', 'integerParameterDeclaration', 'decimalParameterDeclaration', 'dateTimeParameterDeclaration'].includes(kind ?? '')) return;
  const type = kind === 'stringParameterDeclaration' ? 'string' : kind === 'dateTimeParameterDeclaration' ? 'datetime' : 'number';
  const values: unknown = body.defaultValues?.staticValues ?? [];
  const p: AuthorParameter = { id, name: body.name, type, multiple: body.parameterValueType === 'MULTI_VALUED', ...(type === 'number' ? { integer: kind === 'integerParameterDeclaration' } : {}), defaultValues: values as ParameterValue[], values: structuredClone(values) as ParameterValue[], memberPath };
  return parameterError(p) ? undefined : p;
}
export function serializeParameter(p: AuthorParameter): Record<string, unknown> {
  const kind = p.type === 'datetime' ? 'dateTime' : p.type === 'number' ? p.integer ? 'integer' : 'decimal' : 'string';
  return { [`${kind}ParameterDeclaration`]: { name: p.name, ...(p.type === 'datetime' ? { timeGranularity: 'DAY' } : { parameterValueType: p.multiple ? 'MULTI_VALUED' : 'SINGLE_VALUED' }), defaultValues: { staticValues: p.defaultValues } } };
}
