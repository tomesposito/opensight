export type ObjectValue = Record<string, unknown>;
export type ErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_FEATURE' | 'UNRESOLVED_BINDING' |
  'INVALID_SECURITY_POLICY' | 'PRINCIPAL_REQUIRED' | 'UNKNOWN_PRINCIPAL' | 'ROW_ACCESS_DENIED' | 'COLUMN_ACCESS_DENIED' | 'NAMESPACE_ACCESS_DENIED' |
  'TYPE_MISMATCH' | 'CALCULATION_CYCLE' | 'SECURITY_REJECTED' | 'LOCAL_DATA_ERROR' | 'EXECUTION_ERROR';

/** A located execution diagnostic; inventory acceptance is deliberately insufficient. */
export class QueryEngineError extends Error {
  constructor(public readonly code: ErrorCode, public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'QueryEngineError';
  }
}

export function fail(code: ErrorCode, path: string, message: string): never {
  throw new QueryEngineError(code, path, message);
}
export function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_INPUT', path, 'expected an object');
  }
  return value as ObjectValue;
}
export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('INVALID_INPUT', path, 'expected an array');
  return value;
}
export function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.length || value.includes('\0')) {
    fail('INVALID_INPUT', path, 'expected a nonempty string without NUL');
  }
  return value;
}
export function equals(value: unknown, expected: string, path: string): void {
  if (value !== expected) fail('UNSUPPORTED_FEATURE', path, `expected ${expected}`);
}
export function keys(value: ObjectValue, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('UNSUPPORTED_FEATURE', `${path}.${key}`, 'unrecognized execution property');
  }
}
export function variant(value: unknown, path: string): [string, ObjectValue] {
  const entries = Object.entries(object(value, path));
  const entry = entries[0];
  if (entries.length !== 1 || !entry) fail('INVALID_INPUT', path, 'expected exactly one variant');
  return [entry[0], object(entry[1], `${path}.${entry[0]}`)];
}
export function emptyArray(value: unknown, path: string): void {
  if (value !== undefined && array(value, path).length) {
    fail('UNSUPPORTED_FEATURE', path, 'feature is not executable in the local slice');
  }
}
export function unique(names: Set<string>, name: string, path: string): void {
  // DuckDB identifiers are case-insensitive even when quoted.
  const folded = name.toLowerCase();
  if (names.has(folded)) fail('INVALID_INPUT', path, `duplicate or case-ambiguous name: ${name}`);
  names.add(folded);
}
export function quoteIdentifier(value: string, dialect?: import('./types.js').SqlDialect): string {
  if (dialect === 'mysql') return '`' + value.replaceAll('`', '``') + '`';
  return `"${value.replaceAll('"', '""')}"`;
}
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
