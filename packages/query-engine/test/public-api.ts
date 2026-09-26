import { executeLocal, planVisual, QueryEngineError } from '@opensight/query-engine';
import type { LocalDataBinding, PlanRequest, QueryPlan, QueryResult, RowExpression } from '@opensight/query-engine';
const binding: LocalDataBinding = {
  provenance: 'Synthetic test', dataSetArn: 'synthetic', physicalTableId: 'sales', csv: 'sales.csv',
  nullEncoding: 'empty cell', timezone: 'UTC', security: { dataset: 'unrestricted', source: 'unrestricted' },
};
const request: PlanRequest = { analysis: {}, dataSet: {}, dataSource: {}, localData: binding, visualId: 'v' };
function consumer(): void {
  const plan: QueryPlan = planVisual(request);
  const expression: RowExpression | undefined = plan.calculations[0]?.expression;
  const result: Promise<QueryResult> = executeLocal(request, { dataRoot: '/tmp' });
  // @ts-expect-error Plans are read-only at the public type boundary.
  plan.sql = 'SELECT 1';
  // @ts-expect-error Execution requires a complete planning request, not arbitrary SQL.
  executeLocal({ sql: 'SELECT 1' }, { dataRoot: '/tmp' });
  // @ts-expect-error Arbitrary strings do not establish unrestricted security.
  const invalid: LocalDataBinding['security'] = { dataset: 'maybe', source: 'unrestricted' };
  void [expression, result, invalid, QueryEngineError];
}
void consumer;
