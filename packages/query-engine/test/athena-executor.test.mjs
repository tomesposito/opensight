import test from 'node:test';
import assert from 'node:assert/strict';
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand, StopQueryExecutionCommand } from '@aws-sdk/client-athena';
import { executeAthena, executeConnector } from '@opensight/query-engine';
import { ExecutionCancelledError } from '../dist/prep-stream.js';
import { request, calculation } from './helpers.mjs';

const config = { regionEnv: 'ATHENA_REGION', databaseEnv: 'ATHENA_DATABASE', outputLocationEnv: 'ATHENA_OUTPUT', workGroupEnv: 'ATHENA_WORKGROUP' };
const environment = { ATHENA_REGION: 'us-east-1', ATHENA_DATABASE: 'public', ATHENA_OUTPUT: 's3://example-results/queries/', ATHENA_WORKGROUP: 'test-workgroup' };
const athenaRequest = id => {
  const r = request(id), source = r.dataSource.DataSource;
  source.Type = 'ATHENA'; source.DataSourceParameters = { AthenaParameters: { WorkGroup: 'metadata-is-not-connection-config' } };
  return r;
};
const metadata = [{ Name: 'region', Type: 'varchar' }, { Name: 'revenue', Type: 'double' }];
const wire = values => ({ Data: values.map(value => value === null ? {} : { VarCharValue: value }) });
const page = (values = [['East', '42.5']], { columns = metadata, header = true, nextToken } = {}) => ({ ResultSet: { ResultSetMetadata: { ColumnInfo: columns }, Rows: [...(header ? [wire(columns.map(c => c.Name))] : []), ...values.map(wire)] }, ...(nextToken ? { NextToken: nextToken } : {}) });
function fake(handlers = {}) {
  const calls = [], sleeps = []; let destroyed = 0, created = 0, time = 0;
  const client = { async send(command, options) {
    calls.push(command);
    const handler = handlers[command.constructor.name];
    if (handler) return handler(command.input, options, calls);
    if (command instanceof StartQueryExecutionCommand) return { QueryExecutionId: 'test-query' };
    if (command instanceof GetQueryExecutionCommand) return { QueryExecution: { Status: { State: 'SUCCEEDED' } } };
    if (command instanceof GetQueryResultsCommand) return page();
    if (command instanceof StopQueryExecutionCommand) return {};
    throw new Error('Unexpected SDK command');
  }, destroy() { destroyed++; } };
  return { calls, sleeps, client, get destroyed() { return destroyed; }, get created() { return created; },
    options: { config, environment, clientFactory(settings) { created++; assert.deepEqual(settings, { region: 'us-east-1' }); return client; }, now: () => time, sleep: async ms => { sleeps.push(ms); time += ms; } } };
}

test('Athena library end-to-end uses real SDK commands, trusted config, positional parameters and typed rows', async () => {
  const f = fake(), result = await executeAthena(athenaRequest('revenue-by-region'), f.options);
  assert.deepEqual(result.rows, [{ region: 'East', revenue: 42.5 }]);
  assert.deepEqual(result.provenance, { source: 'live' }); assert.equal(result.plan.dialect, 'athena');
  assert.deepEqual(f.calls.map(c => c.constructor.name), ['StartQueryExecutionCommand', 'GetQueryExecutionCommand', 'GetQueryResultsCommand']);
  assert.deepEqual(f.calls[0].input, { QueryString: result.plan.sql, ExecutionParameters: ['East'], QueryExecutionContext: { Database: 'public' }, WorkGroup: 'test-workgroup', ResultConfiguration: { OutputLocation: 's3://example-results/queries/' } });
  assert.deepEqual(f.calls[1].input, { QueryExecutionId: 'test-query' });
  assert.deepEqual(f.calls[2].input, { QueryExecutionId: 'test-query', MaxResults: 1000 });
  assert.equal(f.destroyed, 1);
});
