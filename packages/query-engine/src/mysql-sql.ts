import type { RowExpression } from './types.js';
import type { ParameterValue } from './parameters.js';
import { constant, dateUnits, formatParts } from './datetime.js';
import { fail, quoteLiteral } from './validation.js';

export const mysqlDateCast = (value: string): string => `CAST(REPLACE(REPLACE(${value}, 'T', ' '), 'Z', '') AS DATETIME(3))`;
export const mysqlTimestamp = (value: string): string => `CONCAT(DATE_FORMAT(${value}, '%Y-%m-%dT%H:%i:%s.'), LEFT(DATE_FORMAT(${value}, '%f'), 3), 'Z')`;
function trunc(value: string, unit: string): string {
  if (unit === 'MS') return `TIMESTAMPADD(MICROSECOND, -MOD(MICROSECOND(${value}), 1000), ${value})`;
  if (unit === 'WK') return `DATE_SUB(DATE(${value}), INTERVAL (DAYOFWEEK(${value}) - 1) DAY)`;
  if (unit === 'Q') return `DATE_ADD(MAKEDATE(YEAR(${value}), 1), INTERVAL ((QUARTER(${value}) - 1) * 3) MONTH)`;
  const formats: Record<string, string> = { YYYY: '%Y-01-01', YY: '%Y-01-01', MM: '%Y-%m-01', DD: '%Y-%m-%d', D: '%Y-%m-%d', HH: '%Y-%m-%d %H:00:00', MI: '%Y-%m-%d %H:%i:00', SS: '%Y-%m-%d %H:%i:%s' };
  return `CAST(DATE_FORMAT(${value}, '${formats[unit]}') AS DATETIME(3))`;
}
export function mysqlScalarSql(e: Extract<RowExpression, { kind: 'call' }>, compile: (e: RowExpression) => string): string {
  const unsupported = (): never => fail('UNSUPPORTED_FEATURE', e.location.path, `MySQL SQL function ${e.name} is not yet implemented`);
  // These functions need dedicated MySQL semantics; never emit DuckDB/Postgres syntax.
  if (['parseDate', 'parseDecimal', 'parseInt', 'median', 'percentile'].includes(e.name)) return unsupported();
  const node = (i: number) => compile(e.args[i]!);
  if (e.name === 'now') return 'UTC_TIMESTAMP(3)';
  if (e.name === 'truncDate') return trunc(node(1), constant(e.args[0]).toUpperCase());
  if (e.name === 'addDateTime') {
    const unit = constant(e.args[1]).toUpperCase();
    return `TIMESTAMPADD(${unit === 'MS' ? 'MICROSECOND' : dateUnits[unit]!.toUpperCase()}, TRUNCATE(${node(0)}, 0)${unit === 'MS' ? ' * 1000' : ''}, ${node(2)})`;
  }
  if (e.name === 'extract') {
    const unit = constant(e.args[0]).toUpperCase(), value = node(1);
    return unit === 'WD' ? `DAYOFWEEK(${value})` : unit === 'MS' ? `FLOOR(MICROSECOND(${value}) / 1000)` : `EXTRACT(${dateUnits[unit]!.toUpperCase()} FROM ${value})`;
  }
  if (e.name === 'dateDiff') {
    const unit = constant(e.args[2], 'DD').toUpperCase(), a = node(0), b = node(1);
    const diff = (part: string) => `(${part}(${b}) - ${part}(${a}))`;
    if (['YYYY', 'YY'].includes(unit)) return diff('YEAR');
    if (unit === 'Q') return `(${diff('YEAR')} * 4 + ${diff('QUARTER')})`;
    if (unit === 'MM') return `(${diff('YEAR')} * 12 + ${diff('MONTH')})`;
    return `(TIMESTAMPDIFF(MICROSECOND, ${trunc(a, unit)}, ${trunc(b, unit)}) / ${{ WK: 604800000000, DD: 86400000000, D: 86400000000, HH: 3600000000, MI: 60000000, SS: 1000000, MS: 1000 }[unit]})`;
  }
  if (e.name === 'formatDate') {
    const value = node(0), parts = formatParts(constant(e.args[1], "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
    const formats: Record<string, string> = { yyyy: '%Y', YYYY: '%Y', yy: '%y', MMMM: '%M', MMM: '%b', MM: '%m', M: '%c', dd: '%d', d: '%e', HH: '%H', H: '%k', hh: '%h', h: '%l', mm: '%i', ss: '%s', EEEE: '%W', EEE: '%a', EE: '%a', E: '%a', a: '%p' };
    const expressions = parts.map(p => {
      if (p.literal !== undefined) return quoteLiteral(p.literal);
      const t = p.token!;
      if (t === 'Z' || t === 'ZZ') return quoteLiteral(t === 'Z' ? '+0000' : '+00:00');
      if (t.startsWith('S')) return `LEFT(DATE_FORMAT(${value}, '%f'), ${t.length})`;
      if (t === 'm' || t === 's') return `CAST(${t === 'm' ? 'MINUTE' : 'SECOND'}(${value}) AS CHAR)`;
      return `DATE_FORMAT(${value}, '${formats[t]}')`;
    });
    return `(CASE WHEN ${value} IS NULL THEN NULL ELSE CONCAT(${expressions.length ? expressions.join(', ') : "''"}) END)`;
  }
  const args = e.args.map(compile), [a, b, c] = args;
  const integer = (v: string) => `CAST(TRUNCATE(${v}, 0) AS SIGNED)`;
  switch (e.name) {
    case 'sum': case 'avg': case 'count': case 'min': case 'max': return `${e.name.toUpperCase()}(${a})`;
    case 'distinct_count': return `COUNT(DISTINCT ${a})`;
    case 'stdev': case 'stdevp': case 'var': case 'varp': return `${({ stdev: 'STDDEV_SAMP', stdevp: 'STDDEV_POP', var: 'VAR_SAMP', varp: 'VAR_POP' })[e.name]}(${a})`;
    case 'ifelse': return `(CASE ${args.slice(0, -1).flatMap((v, i) => i % 2 === 0 ? [`WHEN ${v} THEN ${args[i + 1]}`] : []).join(' ')} ELSE ${args.at(-1)} END)`;
    case 'coalesce': case 'nullIf': return `${e.name}(${args.join(', ')})`;
    case 'isNull': return `(${a} IS NULL)`;
    case 'isNotNull': return `(${a} IS NOT NULL)`;
    case 'abs': case 'ceil': case 'floor': return `${e.name}(${a})`;
    case 'decimalToInt': return `TRUNCATE(${a}, 0)`;
    case 'round': { const f = `POWER(10, ${integer(b ?? '0')})`; return `(SIGN(${a}) * FLOOR(ABS(${a}) * ${f} + 0.5) / ${f})`; }
    case 'sqrt': return `SQRT(${a})`;
    case 'ln': return `LN(${a})`;
    case 'log': return `(LN(${a}) / NULLIF(LN(${b ?? '10'}), 0))`;
    case 'exp': return `(CASE WHEN ${a} < -745 THEN 0 WHEN ${a} <= 709.782712893384 THEN EXP(${a}) ELSE NULL END)`;
    case 'power': return `(CASE WHEN ${a} IS NULL OR ${b} IS NULL THEN NULL WHEN ${a} = 0 THEN CASE WHEN ${b} > 0 THEN 0 WHEN ${b} = 0 THEN 1 ELSE NULL END WHEN ${a} < 0 AND ${b} <> TRUNCATE(${b}, 0) THEN NULL WHEN ${b} * LN(ABS(${a})) > 709.782712893384 THEN NULL WHEN ${b} * LN(ABS(${a})) < -745 THEN 0 ELSE POWER(${a}, ${b}) END)`;
    case 'mod': return `MOD(${a}, NULLIF(${b}, 0))`;
    case 'pi': return 'PI()';
    case 'toDecimal': return `CAST(${a} AS DOUBLE)`;
    case 'concat': return `CONCAT(${args.join(', ')})`;
    case 'substring': return `(CASE WHEN ${b} < 1 OR ${c} < 0 THEN NULL ELSE SUBSTRING(${a}, ${integer(b!)}, ${integer(c!)}) END)`;
    case 'left': case 'right': return `(CASE WHEN ${b} < 0 THEN NULL ELSE ${e.name}(${a}, ${integer(b!)}) END)`;
    case 'trim': case 'upper': case 'lower': return `${e.name}(${a})`;
    case 'replace': return `REPLACE(${args.join(', ')})`;
    case 'locate': return `LOCATE(${b}, ${a}, ${integer(c ?? '1')})`;
    case 'strlen': return `CHAR_LENGTH(${a})`;
    case 'toString': return e.args[0]!.scalarType === 'datetime' ? mysqlTimestamp(a!) : `CAST(${a} AS CHAR)`;
    default: return unsupported();
  }
}
/** Expand repeated numbered bindings into positional parameters, skipping quoted SQL tokens. */
export function mysqlBindings(sql: string, parameters: readonly ParameterValue[]): { sql: string; parameters: ParameterValue[] } {
  const values: ParameterValue[] = [];
  const text = sql.replace(/`(?:``|[^`])*`|'(?:''|[^'])*'|\$(\d+)/g, (token, index: string | undefined) => {
    if (!index) return token;
    const value = parameters[Number(index) - 1];
    if (value === undefined) fail('INVALID_INPUT', '$.parameters', 'Unresolved MySQL parameter');
    values.push(value!); return '?';
  });
  return { sql: text, parameters: values };
}
