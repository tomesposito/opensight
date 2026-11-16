import type { ParameterValue } from './parameters.js';
import { fail } from './validation.js';

/** Expand numbered binds in SQL order, preserving quoted identifiers and literals. */
export function athenaBindings(sql: string, parameters: readonly ParameterValue[]): { sql: string; parameters: ParameterValue[] } {
  const values: ParameterValue[] = [];
  const text = sql.replace(/"(?:""|[^"])*"|'(?:''|[^'])*'|\$(\d+)/g, (token, index: string | undefined) => {
    if (!index) return token;
    const value = parameters[Number(index) - 1];
    if (value === undefined) fail('INVALID_INPUT', '$.parameters', 'Unresolved Athena parameter');
    if (value === null) fail('UNSUPPORTED_FEATURE', '$.parameters', 'Athena null execution parameters are not supported');
    values.push(value!); return '?';
  });
  return { sql: text, parameters: values };
}
