/** Shared, browser-safe parameter contract. Values are data, never expression/SQL text. */
export type ParameterValue = string | number;
export interface ParameterDeclaration {
  name: string;
  type: 'string' | 'number' | 'datetime';
  multiple: boolean;
  integer?: boolean;
}
export type ParameterBindings = Record<string, ParameterValue[]>;
export function parameterValueError(parameter: ParameterDeclaration, values: unknown): string | undefined {
  if (!Array.isArray(values) || values.length > 1000) return 'expected an array of at most 1000 values';
  // An empty selection is explicit (no matches); missing bindings are separate errors.
  if (!parameter.multiple && values.length > 1) return 'expected at most one value for a single-value parameter';
  for (const value of values) {
    if (parameter.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || parameter.integer && !Number.isSafeInteger(value)) return parameter.integer ? 'expected a safe integer' : 'expected a finite number';
    } else if (typeof value !== 'string' || value.includes('\0') || value.length > 10000) return 'expected a string without NUL (at most 10000 characters)';
    else if (parameter.type === 'datetime' && !validDateTime(value)) return 'expected an ISO date or UTC datetime';
  }
  if (new Set(values).size !== values.length) return 'duplicate values are not allowed';
}
export function validDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10) && (!value.includes('T') || date.toISOString().slice(11, 19) === value.slice(11, 19));
}
export function validateParameters(raw: unknown = [], bindings: unknown = {}): { declarations: ParameterDeclaration[]; bindings: ParameterBindings } {
  const error = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
  if (!Array.isArray(raw) || raw.length > 200) return error('parameterDeclarations', 'expected at most 200 declarations');
  const names = new Set<string>();
  const declarations = raw.map((value: unknown, index): ParameterDeclaration => {
    const path = `parameterDeclarations[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return error(path, 'expected a declaration');
    const p = value as Record<string, unknown>;
    if (Object.keys(p).some(k => !['name', 'type', 'multiple', 'integer'].includes(k))) return error(path, 'unknown property');
    if (typeof p.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(p.name) || names.has(p.name)) return error(`${path}.name`, 'expected a unique parameter name (letters, digits, underscore)');
    if (!['string', 'number', 'datetime'].includes(String(p.type)) || typeof p.multiple !== 'boolean' || p.type === 'datetime' && p.multiple || p.integer !== undefined && (typeof p.integer !== 'boolean' || p.type !== 'number')) return error(path, 'invalid parameter type or multiplicity (datetime must be single-value)');
    names.add(p.name);
    return p as unknown as ParameterDeclaration;
  });
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return error('parameterBindings', 'expected an object');
  const b = bindings as Record<string, unknown>;
  for (const name of Object.keys(b)) if (!names.has(name)) error(`parameterBindings.${name}`, 'undeclared parameter');
  for (const p of declarations) {
    if (!Object.hasOwn(b, p.name)) error(`parameterBindings.${p.name}`, 'missing binding');
    const problem = parameterValueError(p, b[p.name]);
    if (problem) error(`parameterBindings.${p.name}`, problem);
  }
  return { declarations, bindings: b as ParameterBindings };
}
