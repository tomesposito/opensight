import { rowFilterSql } from './row-filter.js';
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
  const now = options.now ?? new Date().toISOString();
  let from = relation(source), selectedFrom = from, selectedColumns = columns;
  const bind = (value: string | number): string => { parameters.push(value); return `$${parameters.length}`; };
  let selectedParameters = 0, selectedCtes = 0;
  for (const [i, step] of pipeline.steps.entries()) {
    const path = `$.opensightPrep.steps[${i}].config`;
    const column = (name: string, cols = columns): PrepColumn => cols.find(c => c.name === name) ?? prepFail('PREP_SCHEMA_MISMATCH', path, `Unknown column: ${name}`);
    const measure = (name: string, aggregation: string): PrepColumn => {
      const c = column(name);
      if (['SUM', 'AVG'].includes(aggregation) && !['INTEGER', 'DECIMAL'].includes(c.type) || c.type === 'BOOLEAN' && aggregation !== 'COUNT') prepFail('PREP_SCHEMA_MISMATCH', path, 'Invalid aggregation for column type');
      return { name, type: aggregation === 'COUNT' ? 'INTEGER' : ['SUM', 'AVG'].includes(aggregation) ? 'DECIMAL' : c.type };
    };
    const aggregateSql = (value: string, aggregation: string): string => ['SUM', 'AVG'].includes(aggregation) ? `${aggregation}(CAST(${value} AS ${dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE'}))` : `${aggregation}(${value})`;
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
      case 'filter': {
        const predicates = step.config.filters.map(f => {
          const c = column(f.columnName), values = 'value' in f ? [f.value] : f.values;
          if (c.type === 'BOOLEAN' || values.some(v => ['INTEGER', 'DECIMAL'].includes(c.type) ? typeof v !== 'number' : typeof v !== 'string')) prepFail('PREP_SCHEMA_MISMATCH', path, 'Filter values must match the column type');
          if (c.type === 'DATETIME' && values.some(v => typeof v !== 'string' || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)?$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v.slice(0,10))) prepFail('PREP_SCHEMA_MISMATCH', path, 'Expected an ISO date or UTC timestamp');
          return rowFilterSql({ ...f, path, scalarType: scalarType(c.type) }, dialect, bind);
        });
        sql = `SELECT * FROM ${from} WHERE ${predicates.join(' AND ')}`; break;
      }
      case 'calculate': {
        const expression = parseExpression(step.config.expression, path, { now, bind: name => ({ scalarType: scalarType(column(name).type), nullable: true }) });
        if (expression.level !== 'row') prepFail('UNSUPPORTED_PREP_STEP', path, 'Prep calculated columns require row expressions; use Aggregate for grouping. Visual table and level-aware calculations belong to visual post-processing');
        if (expression.scalarType === 'unknown') prepFail('PREP_SCHEMA_MISMATCH', path, 'Calculated column must have a known scalar type');
        sql = `SELECT *, ${expressionSql(expression, dialect, bind)} AS ${q(step.config.name)} FROM ${from}`;
        const type: PrepType = expression.scalarType === 'number' ? 'DECIMAL' : expression.scalarType === 'datetime' ? 'DATETIME' : expression.scalarType === 'boolean' ? 'BOOLEAN' : 'STRING';
        columns = [...columns, { name: step.config.name, type }]; break;
      }
      case 'aggregate': {
        const c = step.config, groups = c.groupBy.map(name => column(name));
        const measures = c.measures.map(m => ({ ...measure(m.column, m.aggregation), name: m.name }));
        const projections = [...groups.map(g => q(g.name)), ...c.measures.map(m => `${aggregateSql(q(m.column), m.aggregation)} AS ${q(m.name)}`)];
        sql = `SELECT ${projections.join(', ')} FROM ${from}${groups.length ? ` GROUP BY ${groups.map(g => q(g.name)).join(', ')}` : ''}`;
        columns = [...groups, ...measures]; break;
      }
      case 'join': {
        const c = step.config, right = prepSource(c.source, sources, dialect);
        const keys = c.keys.map(k => {
          const leftCol = column(k.left), rightCol = column(k.right, [...right.columns]);
          if (leftCol.type !== rightCol.type) prepFail('PREP_SCHEMA_MISMATCH', path, 'Join keys must have identical types');
          return `l.${q(k.left)} = r.${q(k.right)}`;
        });
        const added = c.columns.map(c => ({ ...column(c.column, [...right.columns]), name: c.name }));
        sql = `SELECT ${[...columns.map(c => `l.${q(c.name)}`), ...c.columns.map(c => `r.${q(c.column)} AS ${q(c.name)}`)].join(', ')} FROM ${from} l ${c.joinType.toUpperCase()} JOIN ${relation(right)} r ON ${keys.join(' AND ')}`;
        columns = [...columns, ...added]; break;
      }
      case 'append': {
        const right = prepSource(step.config.source, sources, dialect);
        if (right.columns.length !== columns.length || columns.some(c => !right.columns.some(r => r.name === c.name && r.type === c.type))) prepFail('PREP_SCHEMA_MISMATCH', path, 'Append requires identical names and types; column order is matched by name');
        const projection = columns.map(c => q(c.name)).join(', ');
        sql = `SELECT ${projection} FROM ${from} UNION ALL SELECT ${projection} FROM ${relation(right)}`; break;
      }
      case 'pivot': {
        const c = step.config, key = column(c.column), groups = c.groupBy.map(name => column(name)), result = measure(c.value, c.aggregation);
        if (key.type === 'BOOLEAN' || key.type === 'DATETIME') prepFail('UNSUPPORTED_PREP_STEP', path, 'Pivot keys must be string or numeric');
        if (c.values.some(v => typeof v.value !== (key.type === 'STRING' ? 'string' : 'number')) || new Set(c.values.map(v => JSON.stringify(v.value))).size !== c.values.length) prepFail('PREP_SCHEMA_MISMATCH', path, 'Pivot values must be unique and match the key type');
        const projections = [...groups.map(g => q(g.name)), ...c.values.map(v => `${aggregateSql(`CASE WHEN ${q(c.column)} = ${bind(v.value)} THEN ${q(c.value)} END`, c.aggregation)} AS ${q(v.name)}`)];
        sql = `SELECT ${projections.join(', ')} FROM ${from}${groups.length ? ` GROUP BY ${groups.map(g => q(g.name)).join(', ')}` : ''}`;
        columns = [...groups, ...c.values.map(v => ({ name: v.name, type: result.type }))]; break;
      }
      case 'unpivot': {
        const c = step.config, values = c.columns.map(name => column(name)), kept = columns.filter(col => !c.columns.includes(col.name));
        if (values.some(v => v.type !== values[0]!.type)) prepFail('PREP_SCHEMA_MISMATCH', path, 'Unpivot columns must have identical types');
        sql = values.map(v => `SELECT ${[...kept.map(c => q(c.name)), `${bind(v.name)} AS ${q(c.nameColumn)}`, `${q(v.name)} AS ${q(c.valueColumn)}`].join(', ')} FROM ${from}`).join(' UNION ALL ');
        columns = [...kept, { name: c.nameColumn, type: 'STRING' }, { name: c.valueColumn, type: values[0]!.type }]; break;
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

const scalarType = (type: PrepType): ScalarType => type === 'STRING' ? 'string' : type === 'DATETIME' ? 'datetime' : type === 'BOOLEAN' ? 'boolean' : 'number';
