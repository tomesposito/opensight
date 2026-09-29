import { validatePrepPipeline, prepFail, prepName, prepTypes, type PrepColumn, type PrepPipeline, type PrepType } from '@opensight/bundle-parser/prep';
import { connectorDefinition, connectorDialect } from './connectors.js';
import { parseExpression, expressionSql } from './expressions.js';
import type { ScalarType } from './types.js';
import { quoteIdentifier as q } from './validation.js';

export interface PrepSource {
  id: string; connectorId: string; table: string; schema?: string; columns: readonly PrepColumn[];
  /** Caller-owned authorization result. Imported metadata cannot grant access. */
  security: 'unrestricted' | 'protected';
}
export interface PrepPlan {
  dialect: 'duckdb' | 'postgres'; pipeline: PrepPipeline; columns: PrepColumn[];
  stages: { id: string; columns: PrepColumn[] }[]; sql: string; parameters: (string | number)[];
  limit: number; through: string | null;
}
export function prepColumns(columns: readonly PrepColumn[], path: string): PrepColumn[] {
  if (!Array.isArray(columns) || !columns.length || columns.length > 256) prepFail('PREP_SCHEMA_MISMATCH', path, 'Expected 1–256 columns');
  const seen = new Set<string>();
  for (const c of columns) {
    if (!c || !prepTypes.includes(c.type)) prepFail('PREP_SCHEMA_MISMATCH', path, 'Unsupported column type');
    prepName(c.name, path);
    if (seen.has(c.name.toLowerCase())) prepFail('PREP_SCHEMA_MISMATCH', path, 'Duplicate or case-ambiguous output columns');
    seen.add(c.name.toLowerCase());
  }
  return columns.map(c => ({ ...c }));
}
export function prepSource(id: string, sources: readonly PrepSource[], dialect: PrepPlan['dialect']): PrepSource {
  const matching = sources.filter(s => s.id === id);
  if (matching.length !== 1) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Source is missing or ambiguous');
  const source = matching[0]!;
  if (source.security !== 'unrestricted') prepFail('PREP_SECURITY_REJECTED', '$.input', 'Protected or unresolved source requires security-aware preparation');
  connectorDefinition(source.connectorId);
  if (connectorDialect(source.connectorId) !== dialect) prepFail('UNSUPPORTED_PREP_STEP', '$.input', 'Sources must use the same supported connector dialect');
  prepName(source.table, '$.source.table'); if (source.schema !== undefined) prepName(source.schema, '$.source.schema');
  prepColumns(source.columns, '$.source.columns');
  return source;
}
const relation = (s: PrepSource): string => s.schema ? `${q(s.schema)}.${q(s.table)}` : q(s.table);
export function compilePrep(raw: unknown, sources: readonly PrepSource[], options: { dialect?: PrepPlan['dialect']; through?: string | null; limit?: number; now?: string } = {}): PrepPlan {
  const pipeline = validatePrepPipeline(raw), dialect = options.dialect ?? 'duckdb', limit = options.limit ?? 100;
  if (!['duckdb', 'postgres'].includes(dialect)) prepFail('UNSUPPORTED_PREP_STEP', '$.dialect', 'Only DuckDB and Postgres preparation is supported');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) prepFail('PREP_LIMIT_EXCEEDED', '$.limit', 'Preview limit must be 1–500 rows');
  const through = options.through === undefined ? pipeline.steps.at(-1)?.id ?? null : options.through;
  if (through !== null && !pipeline.steps.some(s => s.id === through)) prepFail('PREP_NOT_FOUND', '$.through', 'Step not found');
  const source = prepSource(pipeline.input, sources, dialect);
  let columns = prepColumns(source.columns, '$.source.columns');
  // Never shadow a caller-owned physical table with a generated CTE name.
  let prefix = '__prep_'; while (sources.some(s => s.table.toLowerCase().startsWith(prefix))) prefix += '_';
  const ctes: string[] = [], parameters: (string | number)[] = [], stages: PrepPlan['stages'] = [];
  let from = relation(source), selectedFrom = from, selectedColumns = columns;
  const bind = (value: string | number): string => { parameters.push(value); return `$${parameters.length}`; };
  let selectedParameters = 0, selectedCtes = 0;
  for (const [i, step] of pipeline.steps.entries()) {
    const path = `$.opensightPrep.steps[${i}].config`;
    const column = (name: string, cols = columns): PrepColumn => cols.find(c => c.name === name) ?? prepFail('PREP_SCHEMA_MISMATCH', path, `Unknown column: ${name}`);
    let sql: string;
    switch (step.kind) {
      case 'changeType': {
        const c = column(step.config.column), type = step.config.type;
        const types: Record<PrepType, string> = { INTEGER: 'BIGINT', DECIMAL: dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE', STRING: 'VARCHAR', DATETIME: 'TIMESTAMP', BOOLEAN: 'BOOLEAN' };
        // Integer conversion truncates toward zero in both dialects. Invalid values fail the preview.
        const value = type === 'INTEGER' && c.type === 'DECIMAL' ? `TRUNC(${q(c.name)})` : q(c.name);
        if (type !== c.type && !(type === 'STRING' || ['INTEGER', 'DECIMAL'].includes(type) && ['INTEGER', 'DECIMAL', 'STRING'].includes(c.type) || type === 'DATETIME' && c.type === 'STRING' || type === 'BOOLEAN' && c.type === 'STRING')) prepFail('UNSUPPORTED_PREP_STEP', path, 'Unsupported type conversion');
        const conversion = c.type === 'STRING' && type !== 'STRING' ? type === 'INTEGER' ? 'parseInt' : type === 'DECIMAL' ? 'parseDecimal' : type === 'DATETIME' ? 'parseDate' : undefined : undefined;
        const parsed = conversion ? expressionSql(parseExpression(`${conversion}({value})`, path, { bind: () => ({ scalarType: 'string', nullable: true }) }), dialect, bind).replaceAll(q('value'), q(c.name)) : undefined;
        const converted = parsed ?? (c.type === 'STRING' && type === 'BOOLEAN' ? `CASE WHEN ${q(c.name)} = 'true' THEN TRUE WHEN ${q(c.name)} = 'false' THEN FALSE END` : c.type === 'DATETIME' && type === 'STRING' ? timestamp(q(c.name), dialect) : c.type === 'BOOLEAN' && type === 'STRING' ? `CASE WHEN ${q(c.name)} THEN 'true' WHEN NOT ${q(c.name)} THEN 'false' END` : `CAST(${value} AS ${types[type]})`);
        sql = `SELECT ${columns.map(col => col.name === c.name ? `${converted} AS ${q(col.name)}` : q(col.name)).join(', ')} FROM ${from}`;
        columns = columns.map(col => col.name === c.name ? { ...col, type } : col); break;
      }
      case 'rename': {
        column(step.config.column);
        sql = `SELECT ${columns.map(c => `${q(c.name)}${c.name === step.config.column ? ` AS ${q(step.config.name)}` : ''}`).join(', ')} FROM ${from}`;
        columns = columns.map(c => c.name === step.config.column ? { ...c, name: step.config.name } : c); break;
      }
      case 'select': {
        columns = step.config.columns.map(name => column(name)); sql = `SELECT ${columns.map(c => q(c.name)).join(', ')} FROM ${from}`; break;
      }
      default: prepFail('UNSUPPORTED_PREP_STEP', path, 'Transformation compiler is unavailable');
    }
    columns = prepColumns(columns, path);
    from = q(`${prefix}${i}`); ctes.push(`${from} AS (${sql})`); stages.push({ id: step.id, columns });
    if (step.id === through) { selectedFrom = from; selectedColumns = columns; selectedParameters = parameters.length; selectedCtes = ctes.length; }
  }
  const projection = selectedColumns.map(c => `${c.type === 'DATETIME' ? timestamp(q(c.name), dialect) : q(c.name)} AS ${q(c.name)}`).join(', ');
  const withSql = selectedCtes ? `WITH ${ctes.slice(0, selectedCtes).join(',\n')}\n` : '';
  return { dialect, pipeline, columns: selectedColumns, stages, parameters: parameters.slice(0, selectedParameters), sql: `${withSql}SELECT ${projection} FROM ${selectedFrom} LIMIT ${limit + 1}`, limit, through };
}
function timestamp(value: string, dialect: PrepPlan['dialect']): string {
  return dialect === 'postgres' ? `TO_CHAR(${value}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` : `STRFTIME(${value}, '%Y-%m-%dT%H:%M:%S.%gZ')`;
}
