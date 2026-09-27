import { executeLocal, executePostgres, planVisual, QueryEngineError } from '@opensight/query-engine';
import type { LocalDataBinding, PlanOptions, PlanRequest, PostgresExecuteOptions, QueryPlan, QueryResult, RowExpression, SqlDialect } from '@opensight/query-engine';
const binding: LocalDataBinding = {
  provenance: 'Synthetic test', dataSetArn: 'synthetic', physicalTableId: 'sales', csv: 'sales.csv',
  nullEncoding: 'empty cell', timezone: 'UTC', security: { dataset: 'unrestricted', source: 'unrestricted' },
};
const request: PlanRequest = { analysis: {}, dataSet: {}, dataSource: {}, localData: binding, visualId: 'v' };
function consumer(): void {
  const plan: QueryPlan = planVisual(request);
  const expression: RowExpression | undefined = plan.calculations[0]?.expression;
  const result: Promise<QueryResult> = executeLocal(request, { dataRoot: '/tmp' });
  const dialect: SqlDialect = 'postgres';
  const planOptions: PlanOptions = { dialect };
  const postgresPlan: QueryPlan = planVisual(request, planOptions);
  const postgresOptions: PostgresExecuteOptions = { connectionString: 'postgres://localhost/test' };
  const postgresResult: Promise<QueryResult> = executePostgres(request, postgresOptions);
  // @ts-expect-error Dialects are a closed capability set.
  planVisual(request, { dialect: 'sqlite' });
  // @ts-expect-error Postgres execution requires caller-owned connection details.
  executePostgres(request, { dataRoot: '/tmp' });
  // @ts-expect-error Postgres execution also requires a complete planning request.
  executePostgres({ sql: 'SELECT 1' }, postgresOptions);
  // @ts-expect-error Plans are read-only at the public type boundary.
  plan.sql = 'SELECT 1';
  // @ts-expect-error Execution requires a complete planning request, not arbitrary SQL.
  executeLocal({ sql: 'SELECT 1' }, { dataRoot: '/tmp' });
  // @ts-expect-error Arbitrary strings do not establish unrestricted security.
  const invalid: LocalDataBinding['security'] = { dataset: 'maybe', source: 'unrestricted' };
  void [expression, result, postgresPlan, postgresResult, invalid, QueryEngineError];
}
void consumer;
