import type { SecurityContext } from './security.js';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { interactiveRequest, type InteractiveQuery } from './interactive.js';
import { planVisual } from './planner.js';
import { evaluatePlan } from './evaluate.js';
import { fail } from './validation.js';
import type { ResultRow } from './types.js';
import type { PrepScalar } from './prep-stream.js';

/** Trusted, already-authorized in-memory data; this function never opens a source. */
export function planPreparedQuery(columns: readonly PrepColumn[], body: InteractiveQuery, security?: SecurityContext) {
  const supported = columns.filter(c => c.type !== 'BOOLEAN');
  if (!supported.length) fail('UNSUPPORTED_FEATURE', '$.columns', 'Visual queries require numeric, string or datetime columns; Boolean fields are supported in prep');
  const schema = supported.map(c => ({ Name: c.name, Type: c.type }));
  const arn = 'urn:opensight:prepared', sourceArn = 'urn:opensight:memory';
  const request = interactiveRequest(body, {
    dataSet: { DataSet: { Arn: arn, DataSetId: 'prepared', Name: 'Prepared output', ImportMode: 'DIRECT_QUERY',
      PhysicalTableMap: { output: { RelationalTable: { DataSourceArn: sourceArn, Schema: 'main', Name: 'output', InputColumns: schema } } },
      LogicalTableMap: { output: { Alias: 'output', Source: { PhysicalTableId: 'output' }, DataTransforms: [] } }, OutputColumns: schema } },
    dataSource: { DataSource: { Arn: sourceArn, DataSourceId: 'memory', Name: 'Memory', Type: 'POSTGRESQL', Status: 'CREATION_SUCCESSFUL', DataSourceParameters: { PostgreSqlParameters: { Host: 'unused', Port: 1, Database: 'unused' } } } },
    localData: { provenance: 'Authorized prepared output; no source access', dataSetArn: arn, physicalTableId: 'output', csv: 'unused.csv', nullEncoding: 'empty cell', timezone: 'UTC', security: { dataset: 'unrestricted', source: 'unrestricted' } },
  });
  return planVisual({ ...request, ...(security ? { security: { ...security, policy: { ...security.policy, dataSetArn: arn } } } : {}) });
}

export function queryPrepared(columns: readonly PrepColumn[], rowCount: number, value: (row: number, column: number) => PrepScalar, body: InteractiveQuery) {
  const supported = columns.filter(c => c.type !== 'BOOLEAN');
  const plan = planPreparedQuery(columns, body), indexes = supported.map(c => columns.indexOf(c));
  const rows: ResultRow[] = Array.from({ length: rowCount }, (_, r) => Object.fromEntries(supported.map((c, i) => {
    const cell = value(r, indexes[i]!);
    // SQL BIGINT outside JS's exact range cannot safely enter numeric evaluation.
    if (c.type === 'INTEGER' && typeof cell === 'string') fail('EXECUTION_ERROR', `$.columns.${c.name}`, 'Integer exceeds the exact numeric range of the shared evaluator');
    return [c.name, cell as string | number | null];
  })));
  return { columns: [...plan.dimensions.map(d => ({ name: d.outputName, type: 'string' as const })), ...plan.measures.map(m => ({ name: m.outputName, type: 'number' as const }))], rows: evaluatePlan(plan, rows) };
}
