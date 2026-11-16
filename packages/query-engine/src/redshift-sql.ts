import type { PrepType } from '@opensight/bundle-parser/prep';
import type { Dimension, ResultValue, RowExpression } from './types.js';
import { constant, dateUnits, formatParts } from './datetime.js';
import { fail, quoteLiteral } from './validation.js';

/** Avoid dependence on server backslash-literal settings in generated format literals. */
export const redshiftLiteral = (value: string): string => value.includes('\\')
  ? `(${value.split('\\').map(quoteLiteral).join(' || CHR(92) || ')})` : quoteLiteral(value);
export const redshiftTimestamp = (value: string): string => `TO_CHAR(${value}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export function redshiftGranularity(value: string, grain: NonNullable<Dimension['granularity']>): string {
  const format = { YEAR: 'YYYY', QUARTER: 'YYYY-"Q"Q', MONTH: 'YYYY-MM', DAY: 'YYYY-MM-DD' }[grain];
  return `TO_CHAR(DATE_TRUNC('${grain.toLowerCase()}', ${value}), '${format}')`;
}
const trunc = (value: string, unit: string): string => unit === 'WK'
  ? `DATEADD(day, -1, DATE_TRUNC('week', DATEADD(day, 1, ${value})))`
  : `DATE_TRUNC('${dateUnits[unit]}', ${value})`;

/** Deliberate allowlist: only these SQL forms reuse the PostgreSQL compiler.
 * Adding a Postgres function never implicitly enables it on Redshift. */
const shared = new Set(['sum', 'avg', 'count', 'min', 'max', 'distinct_count', 'stdev', 'stdevp', 'var', 'varp',
  'ifelse', 'coalesce', 'nullIf', 'isNull', 'isNotNull', 'abs', 'ceil', 'floor', 'decimalToInt',
  'sqrt', 'ln', 'log', 'exp', 'power', 'pi', 'toDecimal',
  'concat', 'substring', 'left', 'right', 'trim', 'upper', 'lower', 'replace', 'locate', 'strlen']);
export function redshiftScalarSql(e: Extract<RowExpression, { kind: 'call' }>, compile: (e: RowExpression) => string, postgresForm: () => string): string {
  const unsupported = (): never => fail('UNSUPPORTED_FEATURE', e.location.path, `Redshift SQL function ${e.name} is not implemented for these arguments`);
  const node = (i: number) => compile(e.args[i]!);
  if (shared.has(e.name)) return postgresForm();
  switch (e.name) {
    case 'truncDate': return trunc(node(1), constant(e.args[0]).toUpperCase());
    case 'addDateTime': return `DATEADD(${dateUnits[constant(e.args[1]).toUpperCase()]}, CAST(TRUNC(${node(0)}) AS INTEGER), ${node(2)})`;
    case 'dateDiff': {
      const unit = constant(e.args[2], 'DD').toUpperCase(), a = node(0), b = node(1);
      return unit === 'WK' ? `(DATEDIFF(day, ${trunc(a, unit)}, ${trunc(b, unit)}) / 7)` : `DATEDIFF(${dateUnits[unit]}, ${a}, ${b})`;
    }
    case 'extract': {
      const unit = constant(e.args[0]).toUpperCase(), value = node(1);
      return unit === 'WD' ? `(DATE_PART(dow, ${value}) + 1)` : unit === 'MS' ? `MOD(CAST(FLOOR(DATE_PART(millisecond, ${value})) AS INTEGER), 1000)` : `FLOOR(DATE_PART(${dateUnits[unit]}, ${value}))`;
    }
    case 'formatDate': {
      const value = node(0);
      // Fixed-width numeric tokens and UTC offsets only; no unverified format modifiers.
      const formats: Record<string, string> = { yyyy: 'YYYY', YYYY: 'YYYY', yy: 'YY', MM: 'MM', dd: 'DD', HH: 'HH24', hh: 'HH12', mm: 'MI', ss: 'SS', S: 'MS', SS: 'MS', SSS: 'MS', a: 'AM' };
      const parts = formatParts(constant(e.args[1], "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")).map(p => {
        if (p.literal !== undefined) return redshiftLiteral(p.literal);
        const token = p.token!;
        if (token === 'Z' || token === 'ZZ') return quoteLiteral(token === 'Z' ? '+0000' : '+00:00');
        if (!Object.hasOwn(formats, token)) return unsupported();
        const formatted = `TO_CHAR(${value}, '${formats[token]}')`;
        return token === 'S' || token === 'SS' ? `LEFT(${formatted}, ${token.length})` : formatted;
      });
      return `(CASE WHEN ${value} IS NULL THEN NULL ELSE (${parts.length ? parts.join(' || ') : "''"}) END)`;
    }
    case 'round': {
      const value = node(0), factor = `POWER(10, CAST(TRUNC(${e.args[1] ? node(1) : '0'}) AS INTEGER))`;
      return `(SIGN(${value}) * FLOOR(ABS(${value}) * ${factor} + 0.5) / ${factor})`;
    }
    case 'toString': return e.args[0]!.scalarType === 'datetime' ? redshiftTimestamp(node(0)) : unsupported();
    // parseDate requires validation semantics beyond TO_TIMESTAMP; never emit MAKE_TIMESTAMP
    // or Postgres REGEXP_MATCH arrays. Decimal parsing/statistical ordered sets also fail closed.
    default: return unsupported();
  }
}

/** Native names for schema adapters and wire OIDs for results. Unknown types always fail
 * closed, including SUPER, GEOMETRY, GEOGRAPHY, HLLSKETCH and VARBYTE. TIME is text because
 * it has no calendar date; TIMETZ is likewise preserved as wire text. */
export function redshiftType(type: string | number): PrepType {
  const oids: Readonly<Record<number, PrepType>> = { 16: 'BOOLEAN', 20: 'INTEGER', 21: 'INTEGER', 23: 'INTEGER', 700: 'DECIMAL', 701: 'DECIMAL', 1700: 'DECIMAL',
    18: 'STRING', 19: 'STRING', 25: 'STRING', 1042: 'STRING', 1043: 'STRING', 1082: 'DATETIME', 1083: 'STRING', 1114: 'DATETIME', 1184: 'DATETIME', 1266: 'STRING' };
  const names: Readonly<Record<string, PrepType>> = { SMALLINT: 'INTEGER', INT2: 'INTEGER', INTEGER: 'INTEGER', INT: 'INTEGER', INT4: 'INTEGER', BIGINT: 'INTEGER', INT8: 'INTEGER',
    DECIMAL: 'DECIMAL', NUMERIC: 'DECIMAL', REAL: 'DECIMAL', FLOAT4: 'DECIMAL', FLOAT: 'DECIMAL', FLOAT8: 'DECIMAL', 'DOUBLE PRECISION': 'DECIMAL',
    BOOLEAN: 'BOOLEAN', BOOL: 'BOOLEAN', CHAR: 'STRING', CHARACTER: 'STRING', BPCHAR: 'STRING', VARCHAR: 'STRING', 'CHARACTER VARYING': 'STRING', TEXT: 'STRING',
    DATE: 'DATETIME', TIMESTAMP: 'DATETIME', TIMESTAMPTZ: 'DATETIME', 'TIMESTAMP WITHOUT TIME ZONE': 'DATETIME', 'TIMESTAMP WITH TIME ZONE': 'DATETIME',
    TIME: 'STRING', TIMETZ: 'STRING', 'TIME WITHOUT TIME ZONE': 'STRING', 'TIME WITH TIME ZONE': 'STRING' };
  const key = typeof type === 'string' ? type.trim().toUpperCase().replace(/\(\d+(?:\s*,\s*\d+)?\)/, '').trim() : type;
  const mapped = typeof key === 'number' ? oids[key] : Object.hasOwn(names, key) ? names[key] : undefined;
  return mapped ?? fail('UNSUPPORTED_FEATURE', '$.redshift.type', 'Unsupported Redshift column type');
}
export function redshiftResultValue(value: unknown, oid: number): ResultValue {
  const type = redshiftType(oid); // Validate even NULL values, not just their payloads.
  if (value === null) return null;
  if (typeof value !== 'string') return fail('EXECUTION_ERROR', '$.redshift.result', 'Unsupported Redshift result scalar');
  if (type === 'BOOLEAN') {
    if (value === 't' || value === 'f') return Number(value === 't');
  } else if (type === 'STRING' || type === 'DATETIME') return value;
  else {
    if (/^[+-]?\d+$/.test(value)) {
      const integer = BigInt(value);
      if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) return value;
    }
    if (value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return fail('EXECUTION_ERROR', '$.redshift.result', 'Unsupported or nonfinite Redshift result scalar');
}
