import type { QueryPlan, ResultRow, ResultValue, RowExpression } from './types.js';
import { aggregateValue } from './aggregate.js';
import { functionReference } from './catalog.js';
import { evaluateExpression as evaluate } from './evaluate-expression.js';
/** Executes an already validated plan over caller-owned pinned fixture rows. */
export function evaluatePlan(plan: QueryPlan, input: readonly ResultRow[]): ResultRow[] {
  const rows = input.map(source => {
    const row = { ...source };
    for (const c of plan.calculations.filter(c => c.expression.level === 'row')) row[c.name] = evaluate(c.expression, row);
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
    const dimensions = plan.dimensions.map(d => row[d.columnName] == null ? null : d.granularity === 'YEAR' ? String(row[d.columnName]).slice(0, 4) : d.granularity === 'QUARTER' ? `${String(row[d.columnName]).slice(0, 4)}-Q${Math.ceil(Number(String(row[d.columnName]).slice(5, 7)) / 3)}` : d.granularity === 'MONTH' ? String(row[d.columnName]).slice(0, 7) : d.granularity === 'DAY' ? String(row[d.columnName]).slice(0, 10) : row[d.columnName]!);
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
      const run = (e: RowExpression): ResultValue => evaluate(e, group.rows[0] ?? {}, node => {
        if (node.kind === 'column') { const c = plan.calculations.find(c => c.name === node.columnName && c.expression.level === 'aggregate'); if (c) return run(c.expression); }
        if (node.kind === 'call' && functionReference(node.name)?.stage === 'aggregate') return aggregateValue(node.name, group.rows.map(row => evaluate(node.args[0]!, row)), node.args[1]?.kind === 'literal' ? Number(node.args[1].value) : 50);
        return undefined;
      });
      const c = plan.calculations.find(c => c.name === m.columnName && c.expression.level === 'aggregate');
      const value = c ? run(c.expression) : aggregateValue(m.aggregation.toLowerCase(), group.rows.map(row => row[m.columnName] ?? null));
      return [m.outputName, value];
    }),
  ]));
}
