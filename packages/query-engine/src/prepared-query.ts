import type { SecurityContext } from './security.js';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { interactiveRequest, type InteractiveQuery } from './interactive.js';
import { planVisual } from './planner.js';
import { evaluatePlan } from './evaluate.js';
import { fail } from './validation.js';
import type { PlanRequest, QueryPlan, ResultRow } from './types.js';
import type { PrepScalar } from './prep-stream.js';

function preparedMetadata(columns: readonly PrepColumn[], arn = 'urn:opensight:prepared'): Pick<PlanRequest, 'dataSet' | 'dataSource' | 'localData'> {
  const supported = columns.filter(c => c.type !== 'BOOLEAN');
  if (!supported.length) fail('UNSUPPORTED_FEATURE', '$.columns', 'Visual queries require numeric, string or datetime columns; Boolean fields are supported in prep');
  const schema = supported.map(c => ({ Name: c.name, Type: c.type }));
  const sourceArn = 'urn:opensight:memory';
  return {
    dataSet: { DataSet: { Arn: arn, DataSetId: 'prepared', Name: 'Prepared output', ImportMode: 'DIRECT_QUERY',
      PhysicalTableMap: { output: { RelationalTable: { DataSourceArn: sourceArn, Schema: 'main', Name: 'output', InputColumns: schema } } },
      LogicalTableMap: { output: { Alias: 'output', Source: { PhysicalTableId: 'output' }, DataTransforms: [] } }, OutputColumns: schema } },
    dataSource: { DataSource: { Arn: sourceArn, DataSourceId: 'memory', Name: 'Memory', Type: 'POSTGRESQL', Status: 'CREATION_SUCCESSFUL', DataSourceParameters: { PostgreSqlParameters: { Host: 'unused', Port: 1, Database: 'unused' } } } },
    localData: { provenance: 'Authorized prepared output; no source access', dataSetArn: arn, physicalTableId: 'output', csv: 'unused.csv', nullEncoding: 'empty cell', timezone: 'UTC', security: { dataset: 'unrestricted', source: 'unrestricted' } },
  };
}
/** Trusted, already-authorized in-memory data; these functions never open a source. */
export function planPreparedQuery(columns: readonly PrepColumn[], body: InteractiveQuery, security?: SecurityContext) {
  const request = interactiveRequest(body, preparedMetadata(columns));
  return planVisual({ ...request, ...(security ? { security: { ...security, policy: { ...security.policy, dataSetArn: 'urn:opensight:prepared' } } } : {}) });
}
export function planPreparedVisual(columns: readonly PrepColumn[], analysis: unknown, visualId: string, dataSetArn: string, security?: SecurityContext) {
  return planVisual({ ...preparedMetadata(columns, dataSetArn), analysis, visualId, ...(security ? { security: { ...security, policy: { ...security.policy, dataSetArn } } } : {}) });
}
export function queryPreparedVisual(columns: readonly PrepColumn[], rowCount: number, value: (row: number, column: number) => PrepScalar, analysis: unknown, visualId: string, dataSetArn: string) {
  return evaluatePrepared(columns, rowCount, value, planPreparedVisual(columns, analysis, visualId, dataSetArn));
}

export function queryPrepared(columns: readonly PrepColumn[], rowCount: number, value: (row: number, column: number) => PrepScalar, body: InteractiveQuery) {
  return evaluatePrepared(columns, rowCount, value, planPreparedQuery(columns, body));
}
function evaluatePrepared(columns: readonly PrepColumn[], rowCount: number, value: (row: number, column: number) => PrepScalar, plan: QueryPlan) {
  const supported = columns.filter(c => c.type !== 'BOOLEAN'), indexes = supported.map(c => columns.indexOf(c));
  const rows: ResultRow[] = Array.from({ length: rowCount }, (_, r) => Object.fromEntries(supported.map((c, i) => {
    const cell = value(r, indexes[i]!);
    // SQL BIGINT outside JS's exact range cannot safely enter numeric evaluation.
    if (c.type === 'INTEGER' && typeof cell === 'string') fail('EXECUTION_ERROR', `$.columns.${c.name}`, 'Integer exceeds the exact numeric range of the shared evaluator');
    return [c.name, cell as string | number | null];
  })));
  return { columns: [...plan.dimensions.map(d => ({ name: d.outputName, type: 'string' as const })), ...plan.measures.map(m => ({ name: m.outputName, type: 'number' as const }))], rows: evaluatePlan(plan, rows) };
}
