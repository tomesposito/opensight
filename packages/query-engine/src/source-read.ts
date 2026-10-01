import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { prepColumns, type PrepSource } from './prep.js';
import { resolveSecurity, rowSecuritySql, validateRowRule, type SecurityContext, type RowPredicate } from './security.js';
import { withPrepMemory, streamDuckDbPlan, streamPostgresPlan, type PrepMemoryTable, type PrepReadLimits, type PrepSink } from './prep-stream.js';
import { fail, quoteIdentifier as q } from './validation.js';
import type { BoundColumn } from './types.js';
export interface SourceRead {
  source: PrepSource; security: SecurityContext; columns: readonly string[];
  /** Immutable operator binding, composed outside the user's OR rules. */
  tenantPredicate?: RowPredicate;
}
export interface SourceConnection { host: string; port: number; database: string; user: string; password: string; ssl: false | { rejectUnauthorized: true } }
function bound(columns: readonly PrepColumn[]): BoundColumn[] {
  return columns.map(c => ({ name: c.name, type: c.type === 'BOOLEAN' ? 'STRING' : c.type,
    scalarType: c.type === 'BOOLEAN' ? 'boolean' : c.type === 'STRING' ? 'string' : c.type === 'DATETIME' ? 'datetime' : 'number', nullable: true }));
}
/** A single projection/predicate compiler for SQL, uploaded rows and server caches. */
export function planSourceRead(read: SourceRead, limits: PrepReadLimits, dialect: 'postgres' | 'duckdb') {
  const columns = prepColumns(read.source.columns, '$.columns'), physical = bound(columns);
  const resolved = resolveSecurity(read.security, physical, read.security.policy.dataSetArn);
  if (!read.columns.length || new Set(read.columns).size !== read.columns.length) fail('INVALID_INPUT', '$.columns', 'Expected unique requested columns');
  const selected = read.columns.map(name => {
    if (resolved.deniedColumns.includes(name)) fail('COLUMN_ACCESS_DENIED', '$.columns', 'Requested column is denied');
    return columns.find(c => c.name === name) ?? fail('INVALID_INPUT', '$.columns', 'Unknown requested column');
  });
  const parameters: (string | number)[] = [], bind = (v: string | number) => { parameters.push(v); return `$${parameters.length}`; };
  const predicates: string[] = [];
  if (read.tenantPredicate) {
    validateRowRule({ id: 'tenant', principals: [{ type: 'user', id: read.security.userId }], predicate: read.tenantPredicate }, physical);
    predicates.push(rowSecuritySql(read.tenantPredicate, physical, bind, dialect));
  }
  if (resolved.rowPredicate) predicates.push(rowSecuritySql(resolved.rowPredicate, physical, bind, dialect));
  const projection = selected.map(c => {
    const value = c.type !== 'DATETIME' ? q(c.name) : dialect === 'postgres' ? `TO_CHAR(${q(c.name)}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` : `STRFTIME(${q(c.name)}, '%Y-%m-%dT%H:%M:%S.%gZ')`;
    return `${value} AS ${q(c.name)}`;
  });
  const relation = (read.source.schema ? `${q(read.source.schema)}.` : '') + q(read.source.table);
  return { columns: selected, parameters, sql: `SELECT ${projection.join(', ')} FROM ${relation}${predicates.length ? ` WHERE ${predicates.map(p => `(${p})`).join(' AND ')}` : ''} LIMIT ${limits.maxRows + 1}` };
}
export async function streamSourcePostgres(read: SourceRead, connection: SourceConnection, limits: PrepReadLimits, sink: PrepSink): Promise<void> {
  const plan = planSourceRead(read, limits, 'postgres'); // Reject every invalid reference before connecting.
  return streamPostgresPlan(plan, connection, limits, sink);
}
export async function streamSourceMemory(read: SourceRead, table: PrepMemoryTable, limits: PrepReadLimits, sink: PrepSink): Promise<void> {
  const memory = { ...read, source: { ...read.source, table: table.source.table, schema: undefined } };
  const plan = planSourceRead(memory, limits, 'duckdb');
  return withPrepMemory([table], c => streamDuckDbPlan(c, plan, limits, sink));
}
