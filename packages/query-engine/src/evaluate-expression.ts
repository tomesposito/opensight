import type { ResultRow, ResultValue, RowExpression } from './types.js';
import { scalarValue } from './scalar.js';
export function evaluateExpression(e: RowExpression, row: ResultRow = {}, special?: (e: RowExpression) => ResultValue | undefined): ResultValue {
  const resolved = special?.(e); if (resolved !== undefined) return resolved;
  const run = (node: RowExpression): ResultValue => evaluateExpression(node, row, special);
  switch (e.kind) {
    case 'literal': case 'parameter': case 'symbol': return e.value;
    case 'column': return row[e.columnName] ?? null;
    case 'list': case 'sort': throw new Error('Expected scalar expression');
    case 'call':
      if (e.name === 'ifelse') { for (let i = 0; i < e.args.length - 1; i += 2) if (run(e.args[i]!)) return run(e.args[i + 1]!); return run(e.args.at(-1)!); }
      if (e.name === 'coalesce') { for (const arg of e.args) { const value = run(arg); if (value !== null) return value; } return null; }
      return scalarValue(e.name, e.args.map(run));
    case 'unary': { const a = run(e.operand); return a === null ? null : e.operator === 'NOT' ? Number(!a) : e.operator === '-' ? -Number(a) : Number(a); }
    case 'binary': {
      const a = run(e.left), b = run(e.right);
      if (e.operator === 'AND') return a === 0 || b === 0 ? 0 : a === null || b === null ? null : 1;
      if (e.operator === 'OR') return a || b ? 1 : a === null || b === null ? null : 0;
      if (a === null || b === null) return null;
      let value: number;
      switch (e.operator) {
        case '+': value = Number(a) + Number(b); break;
        case '-': value = Number(a) - Number(b); break;
        case '*': value = Number(a) * Number(b); break;
        case '/': return b === 0 ? null : Number(a) / Number(b);
        case '=': return Number(a === b);
        case '<>': return Number(a !== b);
        case '<': return Number(a < b);
        case '>': return Number(a > b);
        case '<=': return Number(a <= b);
        case '>=': return Number(a >= b);
      }
      if (!Number.isFinite(value)) throw new Error('Nonfinite calculated value');
      return value;
    }
  }
}
