import type { Aggregation, BoundColumn, Dimension, QueryPlan } from './types.js';
import { array, fail, keys, object, string, unique } from './validation.js';

/** Trusted caller-owned configuration; do not accept assertions from an imported asset. */
export interface AggregateTableDeclaration {
  readonly name: string;
  readonly tableName: string;
  readonly tableSchema?: string;
  readonly dimensions: readonly { readonly columnName: string; readonly granularity?: Dimension['granularity'] }[];
  readonly measures: readonly { readonly columnName: string; readonly aggregation: Aggregation }[];
  readonly countColumn?: string;
}

function identifier(value: unknown, path: string): string {
  const name = string(value, path);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail('INVALID_INPUT', path, 'expected a plain identifier');
  return name;
}

export function validateAggregates(value: unknown, columns: readonly BoundColumn[]): AggregateTableDeclaration[] {
  const names = new Set<string>();
  return array(value, '$.options.aggregates').map((raw, i) => {
    const path = `$.options.aggregates[${i}]`, declaration = object(raw, path);
    keys(declaration, ['name', 'tableName', 'tableSchema', 'dimensions', 'measures', 'countColumn'], path);
    const name = string(declaration.name, `${path}.name`);
    unique(names, name, `${path}.name`);
    const used = new Set<string>();
    const column = (value: unknown, path: string): BoundColumn => {
      const name = identifier(value, path);
      unique(used, name, path);
      const source = columns.find(c => c.name === name);
      if (!source) fail('UNRESOLVED_BINDING', path, `unknown source column: ${name}`);
      return source;
    };
    const dimensions = array(declaration.dimensions, `${path}.dimensions`).map((raw, j) => {
      const p = `${path}.dimensions[${j}]`, d = object(raw, p);
      keys(d, ['columnName', 'granularity'], p);
      const source = column(d.columnName, `${p}.columnName`);
      if (d.granularity === undefined) return { columnName: source.name };
      if (!['YEAR', 'QUARTER', 'MONTH', 'DAY'].includes(String(d.granularity))) fail('INVALID_INPUT', `${p}.granularity`, 'unsupported date granularity');
      if (source.type !== 'DATETIME') fail('TYPE_MISMATCH', `${p}.granularity`, 'date granularity requires a datetime column');
      return { columnName: source.name, granularity: d.granularity as Dimension['granularity'] };
    });
    const measures = array(declaration.measures, `${path}.measures`).map((raw, j) => {
      const p = `${path}.measures[${j}]`, m = object(raw, p);
      keys(m, ['columnName', 'aggregation'], p);
      const source = column(m.columnName, `${p}.columnName`);
      if (source.scalarType !== 'number') fail('TYPE_MISMATCH', p, 'aggregate measure requires a numeric source column');
      if (!['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(String(m.aggregation))) fail('INVALID_INPUT', `${p}.aggregation`, 'unsupported aggregation');
      return { columnName: source.name, aggregation: m.aggregation as Aggregation };
    });
    const countColumn = declaration.countColumn === undefined ? undefined : identifier(declaration.countColumn, `${path}.countColumn`);
    if (countColumn !== undefined) unique(used, countColumn, `${path}.countColumn`);
    return { name, tableName: identifier(declaration.tableName, `${path}.tableName`), dimensions, measures,
      ...(declaration.tableSchema === undefined ? {} : { tableSchema: identifier(declaration.tableSchema, `${path}.tableSchema`) }),
      ...(countColumn === undefined ? {} : { countColumn }) };
  });
}

export function matchingAggregate(plan: Omit<QueryPlan, 'sql' | 'parameters'>, aggregates: readonly AggregateTableDeclaration[]): AggregateTableDeclaration | undefined {
  if (plan.calculations.length || plan.rowSecurity || plan.securityProtected || plan.postProcess) return;
  return aggregates.find(a =>
    plan.dimensions.every(d => a.dimensions.some(g => g.columnName === d.columnName && g.granularity === d.granularity)) &&
    plan.measures.every(m => m.aggregation === 'SUM'
      ? a.measures.some(s => s.columnName === m.columnName && s.aggregation === 'SUM')
      : m.aggregation === 'COUNT' && a.countColumn !== undefined) &&
    // Raw timestamp filters cannot in general be applied to pre-truncated values.
    plan.filters.every(f => a.dimensions.some(d => d.columnName === f.columnName && d.granularity === undefined)));
}
