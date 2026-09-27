import type { ResultValue, RowExpression, SqlDialect } from './types.js';
import { fail } from './validation.js';
export type CallExpression = Extract<RowExpression, { kind: 'call' }>;
export function scalarValue(name: string, args: readonly ResultValue[]): ResultValue {
  if (args.some(a => a === null)) return null;
  const [a, b, c] = args, chars = [...String(a)];
  switch (name) {
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
  switch (e.name) {
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
