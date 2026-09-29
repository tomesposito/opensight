import type { RowFilter, SqlDialect } from './types.js';
import type { ParameterValue } from './parameters.js';
import { quoteIdentifier } from './validation.js';
import { mysqlDateCast } from './mysql-sql.js';
/** Shared Phase 2b predicate semantics for visual queries and dataset preparation. */
export function rowFilterSql(f: RowFilter, dialect: SqlDialect, bind: (value: ParameterValue) => string): string {
  const q = (name: string) => quoteIdentifier(name, dialect);
  const column = dialect === 'mysql' && (!f.scalarType || f.scalarType === 'string') ? `${q(f.columnName)} COLLATE utf8mb4_0900_bin` : q(f.columnName);
  const placeholder = (value: ParameterValue) => f.scalarType === 'datetime' ? dialect === 'mysql' ? mysqlDateCast(bind(value)) : `CAST(${bind(value)} AS TIMESTAMP)` : bind(value);
  if ('value' in f) return `${column} ${f.operator === 'GREATER_THAN_OR_EQUAL_TO' ? '>=' : f.operator === 'LESS_THAN_OR_EQUAL_TO' ? '<=' : '='} ${placeholder(f.value)}`;
  return f.values.length ? `${column} IN (${f.values.map(placeholder).join(', ')})` : 'FALSE';
}
