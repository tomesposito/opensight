import type { ResultValue, RowExpression, SqlDialect } from './types.js';
import { fail } from './validation.js';
export type CallExpression = Extract<RowExpression, { kind: 'call' }>;
export function scalarValue(name: string, args: readonly ResultValue[]): ResultValue {
  if (args.some(a => a === null)) return null;
  const [a, b, c] = args, chars = [...String(a)];
  const finite = (n: number): ResultValue => Number.isFinite(n) ? n : null;
  switch (name) {
    case 'abs': return Math.abs(Number(a));
    case 'ceil': return Math.ceil(Number(a));
    case 'floor': return Math.floor(Number(a));
    case 'decimalToInt': return Math.trunc(Number(a));
    case 'round': { const factor = 10 ** Math.trunc(Number(b ?? 0)); return finite(Math.sign(Number(a)) * Math.round(Math.abs(Number(a)) * factor) / factor); }
    case 'sqrt': return finite(Math.sqrt(Number(a)));
    case 'power': return finite(Math.pow(Number(a), Number(b)));
    case 'exp': return finite(Math.exp(Number(a)));
    case 'ln': return finite(Math.log(Number(a)));
    case 'log': return Number(b ?? 10) <= 0 || Number(b ?? 10) === 1 ? null : finite(Math.log(Number(a)) / Math.log(Number(b ?? 10)));
    case 'mod': return Number(b) === 0 ? null : Number(a) % Number(b);
    case 'pi': return Math.PI;
    case 'toDecimal': return Number(a);
    case 'parseDecimal': case 'parseInt': {
      const text = String(a).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
      const value = Number(text); return finite(name === 'parseInt' ? Math.trunc(value) : value);
    }
    case 'concat': return args.join('');
    case 'substring': return Number(b) < 1 || Number(c) < 0 ? null : chars.slice(Math.trunc(Number(b)) - 1, Math.trunc(Number(b)) - 1 + Math.trunc(Number(c))).join('');
    case 'left': return Number(b) < 0 ? null : chars.slice(0, Math.trunc(Number(b))).join('');
    case 'right': return Number(b) < 0 ? null : Number(b) === 0 ? '' : chars.slice(-Math.trunc(Number(b))).join('');
    case 'trim': return String(a).replace(/^ +| +$/g, '');
    case 'upper': return String(a).toUpperCase();
    case 'lower': return String(a).toLowerCase();
    case 'replace': return b === '' ? String(a) : String(a).split(String(b)).join(String(c));
    case 'locate': {
      const start = c === undefined ? 1 : Math.trunc(Number(c)); if (start < 1) return 0;
      const index = chars.slice(start - 1).join('').indexOf(String(b));
      return index < 0 ? 0 : [...chars.slice(start - 1).join('').slice(0, index)].length + start;
    }
    case 'strlen': return chars.length;
    case 'toString': return String(a);
    default: throw new Error(`Unsupported scalar function ${name}`);
  }
}
export function scalarSql(e: CallExpression, dialect: SqlDialect, compile: (e: RowExpression) => string): string {
  const args = e.args.map(compile), [a, b, c] = args;
  const integer = (s: string | undefined) => `CAST(TRUNC(${s}) AS INTEGER)`;
  const numeric = dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE';
  switch (e.name) {
    case 'abs': case 'ceil': case 'floor': return `${e.name}(${a})`;
    case 'decimalToInt': return `TRUNC(${a})`;
    case 'round': return dialect === 'postgres' ? `CAST(ROUND(CAST(${a} AS NUMERIC), ${integer(b ?? '0')}) AS DOUBLE PRECISION)` : `ROUND(${a}, ${integer(b ?? '0')})`;
    case 'sqrt': return `(CASE WHEN ${a} >= 0 THEN SQRT(${a}) ELSE NULL END)`;
    case 'ln': return `(CASE WHEN ${a} > 0 THEN LN(${a}) ELSE NULL END)`;
    case 'log': return `(CASE WHEN ${a} > 0 AND ${b ?? '10'} > 0 AND ${b ?? '10'} <> 1 THEN LN(${a}) / LN(${b ?? '10'}) ELSE NULL END)`;
    case 'exp': return `(CASE WHEN ${a} <= 709.782712893384 THEN EXP(${a}) ELSE NULL END)`;
    case 'power': return `(CASE WHEN (${a} >= 0 OR ${b} = TRUNC(${b})) AND NOT (${a} = 0 AND ${b} < 0) THEN POWER(${a}, ${b}) ELSE NULL END)`;
    case 'mod': return `CAST(MOD(CAST(${a} AS ${dialect === 'postgres' ? 'NUMERIC' : 'DOUBLE'}), NULLIF(CAST(${b} AS ${dialect === 'postgres' ? 'NUMERIC' : 'DOUBLE'}), 0)) AS ${numeric})`;
    case 'pi': return 'PI()';
    case 'toDecimal': return `CAST(${a} AS ${numeric})`;
    case 'parseDecimal': case 'parseInt': {
      const pattern = "'^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$'";
      const valid = dialect === 'postgres' ? `TRIM(${a}) ~ ${pattern}` : `REGEXP_FULL_MATCH(TRIM(${a}), ${pattern})`;
      const value = `CAST(TRIM(${a}) AS ${numeric})`;
      return `(CASE WHEN ${valid} THEN ${e.name === 'parseInt' ? `TRUNC(${value})` : value} ELSE NULL END)`;
    }
    case 'concat': return `(${args.join(' || ')})`;
    case 'substring': return `(CASE WHEN ${b} < 1 OR ${c} < 0 THEN NULL ELSE SUBSTRING(${a}, ${integer(b)}, ${integer(c)}) END)`;
    case 'left': case 'right': return `(CASE WHEN ${b} < 0 THEN NULL ELSE ${e.name}(${a}, ${integer(b)}) END)`;
    case 'trim': case 'upper': case 'lower': case 'replace': return `${e.name}(${args.join(', ')})`;
    case 'locate': {
      const start = c ?? '1', position = `STRPOS(SUBSTRING(${a}, ${integer(start)}), ${b})`;
      return `(CASE WHEN ${a} IS NULL OR ${b} IS NULL OR ${start} IS NULL THEN NULL WHEN ${start} < 1 OR ${position} = 0 THEN 0 ELSE ${position} + ${integer(start)} - 1 END)`;
    }
    case 'strlen': return `LENGTH(${a})`;
    case 'toString': return e.args[0]!.scalarType === 'number' ? `REGEXP_REPLACE(CAST(${a} AS VARCHAR), '\\.0$', '')` : `CAST(${a} AS VARCHAR)`;
    default: return fail('UNSUPPORTED_FEATURE', e.location.path, `Unsupported SQL function ${e.name}`);
  }
}
