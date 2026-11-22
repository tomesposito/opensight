import type { ParameterValue } from './parameters.js';
import type { PrepType } from '@opensight/bundle-parser/prep';
import type { Dimension, ResultValue, RowExpression } from './types.js';
import { constant, dateUnits, formatParts } from './datetime.js';
import { fail, quoteLiteral } from './validation.js';

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

/**
 * Encode one plan parameter as the typed SQL literal Athena expects in an
 * execution parameter. Athena substitutes execution parameters as SQL text,
 * so a string must arrive already quoted (Athena documents that string
 * parameters include the single quotes); an unquoted string would be read
 * as an identifier/expression. Numbers stay bare. String-typed values keep
 * their type even when they look numeric, and date/datetime values are
 * string-typed ISO text, so they are quoted the same way. Apostrophes are
 * escaped by quoteLiteral's doubling, so expression-shaped input stays a
 * single inert literal.
 */
export function athenaExecutionParameter(value: ParameterValue): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_INPUT', '$.parameters', 'Athena numeric execution parameters must be finite');
    return String(value);
  }
  return quoteLiteral(value);
}

/** Athena timestamp-without-zone columns follow the shared UTC fixture contract. */
export const athenaDateCast = (value: string): string => `CAST(REPLACE(REPLACE(${value}, 'T', ' '), 'Z', '') AS TIMESTAMP)`;
export const athenaTimestamp = (value: string): string => `(to_iso8601(CAST(${value} AS TIMESTAMP)) || 'Z')`;
export function athenaGranularity(value: string, grain: NonNullable<Dimension['granularity']>): string {
  const truncated = `date_trunc('${grain.toLowerCase()}', ${value})`;
  if (grain === 'QUARTER') return `(date_format(${truncated}, '%Y') || '-Q' || CAST(quarter(${truncated}) AS VARCHAR))`;
  return `date_format(${truncated}, '${{ YEAR: '%Y', MONTH: '%Y-%m', DAY: '%Y-%m-%d' }[grain]}')`;
}
const unsupported = (e: RowExpression): never => fail('UNSUPPORTED_FEATURE', e.location.path, 'Athena SQL function or arguments are not implemented');
function unit(e: RowExpression, key: string): string {
  return Object.hasOwn(dateUnits, key) ? dateUnits[key]! : unsupported(e);
}
function trunc(e: RowExpression, value: string, key: string): string {
  if (key === 'MS') return unsupported(e); // Presto date_trunc has no millisecond unit.
  return key === 'WK' ? `date_add('day', -1, date_trunc('week', date_add('day', 1, ${value})))` : `date_trunc('${unit(e, key)}', ${value})`;
}
/** Dedicated Presto forms; there is no PostgreSQL/DuckDB fallback. */
export function athenaDatetimeSql(e: Extract<RowExpression, { kind: 'call' }>, compile: (e: RowExpression) => string): string | undefined {
  const node = (i: number) => compile(e.args[i]!);
  switch (e.name) {
    case 'addDateTime': return `date_add('${unit(e, constant(e.args[1]).toUpperCase())}', CAST(truncate(${node(0)}) AS BIGINT), ${node(2)})`;
    case 'truncDate': return trunc(e, node(1), constant(e.args[0]).toUpperCase());
    case 'dateDiff': {
      const key = constant(e.args[2], 'DD').toUpperCase(), a = node(0), b = node(1);
      return `date_diff('${unit(e, key)}', ${key === 'MS' ? a : trunc(e, a, key)}, ${key === 'MS' ? b : trunc(e, b, key)})`;
    }
    case 'extract': {
      const key = constant(e.args[0]).toUpperCase(), value = node(1);
      return key === 'WD' ? `(mod(day_of_week(${value}), 7) + 1)` : `${unit(e, key)}(${value})`;
    }
    case 'formatDate': {
      const value = node(0), formats: Record<string, string> = { yyyy: '%Y', YYYY: '%Y', yy: '%y', MM: '%m', dd: '%d', HH: '%H', hh: '%h', mm: '%i', ss: '%s', a: '%p' };
      const parts = formatParts(constant(e.args[1], "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")).map(p => {
        if (p.literal !== undefined) return quoteLiteral(p.literal);
        const token = p.token!;
        if (token === 'Z' || token === 'ZZ') return quoteLiteral(token === 'Z' ? '+0000' : '+00:00');
        if (['S', 'SS', 'SSS'].includes(token)) return `substr(date_format(${value}, '%f'), 1, ${token.length})`;
        if (!Object.hasOwn(formats, token)) return unsupported(e);
        return `date_format(${value}, '${formats[token]}')`;
      });
      return `(CASE WHEN ${value} IS NULL THEN NULL ELSE (${parts.length ? parts.join(' || ') : "''"}) END)`;
    }
    case 'parseDate': return unsupported(e);
    default: return undefined;
  }
}
export function athenaScalarSql(e: Extract<RowExpression, { kind: 'call' }>, compile: (e: RowExpression) => string): string {
  const date = athenaDatetimeSql(e, compile); if (date !== undefined) return date;
  const args = e.args.map(compile), [a] = args;
  switch (e.name) {
    case 'sum': case 'avg': case 'count': case 'min': case 'max': return `${e.name.toUpperCase()}(${a})`;
    case 'distinct_count': return `COUNT(DISTINCT ${a})`;
    case 'stdev': case 'stdevp': case 'var': case 'varp': return `${({ stdev: 'stddev_samp', stdevp: 'stddev_pop', var: 'var_samp', varp: 'var_pop' })[e.name]}(${a})`;
    case 'ifelse': return `(CASE ${args.slice(0, -1).flatMap((v, i) => i % 2 === 0 ? [`WHEN ${v} THEN ${args[i + 1]}`] : []).join(' ')} ELSE ${args.at(-1)} END)`;
    case 'coalesce': case 'nullIf': return `${e.name}(${args.join(', ')})`;
    case 'isNull': return `(${a} IS NULL)`;
    case 'isNotNull': return `(${a} IS NOT NULL)`;
    case 'abs': case 'ceil': case 'floor': return `${e.name}(${a})`;
    case 'decimalToInt': return `truncate(${a})`;
    case 'toDecimal': return `CAST(${a} AS DOUBLE)`;
    case 'concat': return `(${args.join(' || ')})`;
    case 'upper': case 'lower': return `${e.name}(${a})`;
    case 'strlen': return `length(${a})`;
    case 'toString': return e.args[0]!.scalarType === 'datetime' ? athenaTimestamp(a!) : unsupported(e);
    default: return unsupported(e);
  }
}

/** Exact wire-type allowlist. Complex/unknown types fail even for NULL or empty results. */
export function athenaType(type: string): PrepType {
  const name = type.trim().toLowerCase();
  if (/^(tinyint|smallint|int|integer|bigint)$/.test(name)) return 'INTEGER';
  if (/^(double|float|real|decimal(?:\(\d+(?:\s*,\s*\d+)?\))?)$/.test(name)) return 'DECIMAL';
  if (name === 'boolean') return 'BOOLEAN';
  if (/^(varchar|char)(?:\(\d+\))?$/.test(name)) return 'STRING';
  if (name === 'date' || name === 'timestamp') return 'DATETIME';
  return fail('UNSUPPORTED_FEATURE', '$.athena.type', 'Unsupported Athena column type');
}
export function athenaResultValue(value: unknown, nativeType: string): ResultValue {
  const type = athenaType(nativeType);
  if (value === null) return null;
  if (typeof value === 'string') {
    if (type === 'STRING' || type === 'DATETIME') return value;
    if (type === 'BOOLEAN' && (value === 'true' || value === 'false')) return Number(value === 'true');
    if (type === 'INTEGER' && /^[+-]?\d+$/.test(value)) {
      const integer = BigInt(value);
      return integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER) ? value : Number(integer);
    }
    if (type === 'DECIMAL' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value);
  }
  return fail('EXECUTION_ERROR', '$.athena.result', 'Unsupported or nonfinite Athena result scalar');
}
