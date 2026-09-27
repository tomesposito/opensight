import type { QueryPlan, ResultRow, ResultValue, RowExpression } from './types.js';
function evaluate(expression: RowExpression, row: ResultRow): ResultValue {
  if (expression.kind === 'literal' || expression.kind === 'parameter') return expression.value;
  if (expression.kind === 'column') return row[expression.columnName] ?? null;
  const a = evaluate(expression.left, row), b = evaluate(expression.right, row);
  if (a === null || b === null) return null;
  if (typeof a !== 'number' || typeof b !== 'number') throw new Error('Arithmetic requires numbers');
  const value = expression.operator === '+' ? a + b : expression.operator === '-' ? a - b : a * b;
  if (!Number.isFinite(value)) throw new Error('Nonfinite calculated value');
  return value;
}
/** Executes an already validated plan over caller-owned pinned fixture rows. */
export function evaluatePlan(plan: QueryPlan, input: readonly ResultRow[]): ResultRow[] {
  const rows = input.map(source => {
    const row = { ...source };
    for (const c of plan.calculations) row[c.name] = evaluate(c.expression, row);
    return row;
  }).filter(row => plan.filters.every(f => {
    const raw = row[f.columnName];
    if (raw === null || raw === undefined) return false;
    const comparable = (v: string | number) => f.scalarType === 'datetime' ? new Date(v).getTime() : v;
    const value = comparable(raw);
    if ('values' in f) return f.values.some(v => comparable(v) === value);
    const bound = comparable(f.value);
    return f.operator === 'GREATER_THAN_OR_EQUAL_TO' ? value >= bound : f.operator === 'LESS_THAN_OR_EQUAL_TO' ? value <= bound : value === bound;
  }));
  const groups = new Map<string, { dimensions: ResultValue[]; rows: ResultRow[] }>();
  if (!plan.dimensions.length) groups.set('[]', { dimensions: [], rows: [] });
  for (const row of rows) {
    const dimensions = plan.dimensions.map(d => row[d.columnName] == null ? null : d.granularity === 'MONTH' ? String(row[d.columnName]).slice(0, 7) : row[d.columnName]!);
    const key = JSON.stringify(dimensions);
    if (!groups.has(key)) groups.set(key, { dimensions, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => {
    for (let i = 0; i < a.dimensions.length; i++) {
      const x = a.dimensions[i]!, y = b.dimensions[i]!;
      if (x !== y) return x === null ? -1 : y === null ? 1 : x < y ? -1 : 1;
    }
    return 0;
  }).map(group => Object.fromEntries([
    ...plan.dimensions.map((d, i) => [d.outputName, group.dimensions[i]!]),
    ...plan.measures.map(m => {
      const values = group.rows.flatMap(row => typeof row[m.columnName] === 'number' ? [row[m.columnName] as number] : []);
      const sum = values.reduce((a, b) => a + b, 0);
      const value = m.aggregation === 'COUNT' ? values.length : !values.length ? null : m.aggregation === 'MIN' ? Math.min(...values) : m.aggregation === 'MAX' ? Math.max(...values) : m.aggregation === 'AVG' ? sum / values.length : sum;
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite aggregate');
      return [m.outputName, value];
    }),
  ]));
}
