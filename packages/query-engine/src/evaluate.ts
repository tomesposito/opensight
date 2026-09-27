import type { QueryPlan, ResultRow, ResultValue, RowExpression, RowFilter, ExpressionLevel } from './types.js';
import { aggregateValue } from './aggregate.js';
import { constant, dateUnits, addDate, asDate, truncateDate } from './datetime.js';
import { functionReference, periodUnits } from './catalog.js';
import { evaluateExpression as evaluate } from './evaluate-expression.js';

export function matchesFilter(f: RowFilter, row: ResultRow): boolean {
  const raw = row[f.columnName]; if (raw === null || raw === undefined) return false;
  const comparable = (v: string | number) => f.scalarType === 'datetime' ? asDate(v).getTime() : v;
  const value = comparable(raw);
  if ('values' in f) return f.values.some(v => comparable(v) === value);
  const bound = comparable(f.value);
  return f.operator === 'GREATER_THAN_OR_EQUAL_TO' ? value >= bound : f.operator === 'LESS_THAN_OR_EQUAL_TO' ? value <= bound : value === bound;
}
export const compareValues = (a: ResultValue, b: ResultValue): number => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;
const list = (e: RowExpression | undefined): readonly RowExpression[] => e?.kind === 'list' ? e.items : [];
export function expressionChildren(e: RowExpression): readonly RowExpression[] {
  return e.kind === 'call' ? e.args : e.kind === 'binary' ? [e.left, e.right] : e.kind === 'unary' ? [e.operand] : e.kind === 'list' ? e.items : e.kind === 'sort' ? [e.expression] : [];
}
interface Group { dimensions: ResultValue[]; context: ResultRow; rows: ResultRow[] }
/** Shared stage evaluator used by fixtures and by both SQL engines for multirow calculations. */
export function evaluatePlan(plan: QueryPlan, input: readonly ResultRow[]): ResultRow[] {
  const calculations = new Map(plan.calculations.map(c => [c.name, c.expression]));
  let rows = input.map(source => {
    const row = { ...source };
    for (const column of plan.sourceColumns) if (column.scalarType === 'datetime' && row[column.name] != null) row[column.name] = asDate(row[column.name]!).toISOString();
    for (const c of plan.calculations) if (c.expression.level === 'row' && !Object.hasOwn(row, c.name)) row[c.name] = evaluate(c.expression, row);
    return row;
  });
  rows = rows.filter(row => plan.filters.filter(f => !['aggregate', 'table'].includes(calculations.get(f.columnName)?.level ?? 'row')).every(f => matchesFilter(f, row)));
  const groups = new Map<string, Group>();
  if (!plan.dimensions.length) groups.set('[]', { dimensions: [], context: {}, rows: [] });
  for (const row of rows) {
    const context = { ...row };
    const dimensions = plan.dimensions.map(d => {
      const value = row[d.columnName]; if (value == null) return null;
      if (d.granularity) context[d.columnName] = truncateDate(value, { YEAR: 'YYYY', QUARTER: 'Q', MONTH: 'MM', DAY: 'DD' }[d.granularity]);
      return d.granularity === 'YEAR' ? String(value).slice(0, 4) : d.granularity === 'QUARTER' ? `${String(value).slice(0, 4)}-Q${Math.ceil(Number(String(value).slice(5, 7)) / 3)}` : d.granularity === 'MONTH' ? String(value).slice(0, 7) : d.granularity === 'DAY' ? String(value).slice(0, 10) : value;
    });
    const key = JSON.stringify(dimensions);
    if (!groups.has(key)) groups.set(key, { dimensions, context, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  let visible = [...groups.values()].sort((a, b) => { for (let i = 0; i < a.dimensions.length; i++) { const order = compareValues(a.dimensions[i]!, b.dimensions[i]!); if (order) return order; } return 0; });
  const cache = new Map<RowExpression, Map<Group, ResultValue>>();
  const run = (e: RowExpression, group: Group): ResultValue => {
    let results = cache.get(e); if (!results) { results = new Map(); cache.set(e, results); }
    if (results.has(group)) return results.get(group)!;
    const value = evaluate(e, group.context, node => {
      if (node.kind === 'column') { const c = calculations.get(node.columnName); if (c && ['aggregate', 'table'].includes(c.level)) return run(c, group); }
      if (node.kind !== 'call') return undefined;
      const stage = functionReference(node.name)?.stage;
      if (stage === 'aggregate') return aggregateValue(node.name, group.rows.map(row => evaluate(node.args[0]!, row)), Number(constant(node.args[1], '50')));
      if (stage !== 'table') return undefined;
      const rank = ['rank', 'denseRank'].includes(node.name), period = node.name.startsWith('periodOverPeriod');
      const partition = list(node.args[rank || node.name === 'percentOfTotal' ? 1 : node.name === 'runningSum' ? 2 : 3]);
      const key = (g: Group) => JSON.stringify(partition.map(p => run(p, g)));
      let peers = visible.filter(g => key(g) === key(group));
      if (period) {
        const dateArg = node.args[1]!, dimension = plan.dimensions.find(d => d.columnName === (dateArg.kind === 'column' ? dateArg.columnName : ''));
        const unitName = periodUnits[constant(node.args[2], dimension?.granularity ?? 'MONTH').toUpperCase()]!;
        const unit = Object.entries(dateUnits).find(([, name]) => name === unitName)![0];
        const current = run(dateArg, group); if (current === null) return null;
        const target = addDate(truncateDate(current, unit), -Number(node.args[3] ? evaluate(node.args[3]) : 1), unit);
        const otherDimensions = plan.dimensions.filter(d => d.columnName !== (dateArg.kind === 'column' ? dateArg.columnName : ''));
        peers = visible.filter(g => otherDimensions.every(d => g.context[d.columnName] === group.context[d.columnName]));
        const previous = peers.find(g => truncateDate(run(dateArg, g), unit) === target);
        if (!previous) return null;
        const a = run(node.args[0]!, group), b = run(node.args[0]!, previous);
        return a === null || b === null || node.name.endsWith('PercentDifference') && b === 0 ? null : node.name.endsWith('PercentDifference') ? (Number(a) - Number(b)) / Number(b) : Number(a) - Number(b);
      }
      if (node.name === 'percentOfTotal') {
        const a = run(node.args[0]!, group), total = aggregateValue('sum', peers.map(g => run(node.args[0]!, g)));
        return a === null || total === null || total === 0 ? null : Number(a) / Number(total);
      }
      const sorts = list(node.args[rank ? 0 : 1]);
      const compare = (a: Group, b: Group) => { for (const sort of sorts) { const expression = sort.kind === 'sort' ? sort.expression : sort; const order = compareValues(run(expression, a), run(expression, b)) * (sort.kind === 'sort' && sort.direction === 'DESC' ? -1 : 1); if (order) return order; } return 0; };
      peers.sort(compare);
      if (rank) {
        const lower = peers.filter(g => compare(g, group) < 0);
        return node.name === 'rank' ? lower.length + 1 : lower.reduce((n, g, i) => i === 0 || compare(g, lower[i - 1]!) ? n + 1 : n, 0) + 1;
      }
      if (node.name === 'runningSum') return aggregateValue('sum', peers.filter(g => compare(g, group) <= 0).map(g => run(node.args[0]!, g)));
      const index = peers.indexOf(group) + Number(node.args[2] ? evaluate(node.args[2]) : 1), previous = peers[index];
      if (!previous) return null;
      const a = run(node.args[0]!, group), b = run(node.args[0]!, previous);
      return a === null || b === null || node.name === 'percentDifference' && b === 0 ? null : node.name === 'percentDifference' ? (Number(a) - Number(b)) / Math.abs(Number(b)) : Number(a) - Number(b);
    });
    results.set(group, value); return value;
  };
  // Aggregate filters precede table calculations; table-calculation filters follow them.
  for (const level of ['aggregate', 'table'] as const) {
    const filters = plan.filters.filter(f => calculations.get(f.columnName)?.level === level);
    if (filters.length) visible = visible.filter(g => filters.every(f => matchesFilter(f, { [f.columnName]: run(calculations.get(f.columnName)!, g) })));
  }
  return visible.map(group => Object.fromEntries([
    ...plan.dimensions.map((d, i) => [d.outputName, group.dimensions[i]!]),
    ...plan.measures.map(m => { const c = calculations.get(m.columnName); return [m.outputName, c && ['aggregate', 'table'].includes(c.level) ? run(c, group) : aggregateValue(m.aggregation.toLowerCase(), group.rows.map(row => row[m.columnName] ?? null))]; }),
  ]));
}
