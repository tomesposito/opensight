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
  assert.deepEqual(f.calls[0].input, { QueryString: result.plan.sql, ExecutionParameters: ["'East'"], QueryExecutionContext: { Database: 'public' }, WorkGroup: 'test-workgroup', ResultConfiguration: { OutputLocation: 's3://example-results/queries/' } });
  assert.deepEqual(f.calls[1].input, { QueryExecutionId: 'test-query' });
  assert.deepEqual(f.calls[2].input, { QueryExecutionId: 'test-query', MaxResults: 1000 });
  assert.equal(f.destroyed, 1);
});

test('Athena executeConnector dispatch reaches the SDK boundary without credential or network lookup', async t => {
  const f = fake();
  t.mock.method(AthenaClient.prototype, 'send', f.client.send);
  t.mock.method(AthenaClient.prototype, 'destroy', f.client.destroy);
  const result = await executeConnector('athena', config, athenaRequest('revenue-by-region'), environment);
  assert.deepEqual(result.rows, [{ region: 'East', revenue: 42.5 }]); assert.equal(f.destroyed, 1);
});

test('Athena omits optional workgroup and empty parameters, and encodes numeric/date binds as typed literals', async () => {
  const r = athenaRequest('total-revenue');
  r.analysis.Definition.FilterGroups = [];
  const f = fake(), minimal = { ...config }; delete minimal.workGroupEnv;
  await executeAthena(r, { ...f.options, config: minimal });
  assert.equal(Object.hasOwn(f.calls[0].input, 'WorkGroup'), false);
  assert.equal(Object.hasOwn(f.calls[0].input, 'ExecutionParameters'), false);
  r.parameterDeclarations = [{ name: 'Amount', type: 'number', multiple: false }, { name: 'Day', type: 'datetime', multiple: false }];
  r.parameterBindings = { Amount: [12.5], Day: ['2026-01-01T00:00:00Z'] };
  r.parameterFilters = [{ columnName: 'revenue', parameterName: 'Amount' }, { columnName: 'order_date', parameterName: 'Day' }];
  const f2 = fake(); await executeAthena(r, f2.options);
  assert.deepEqual(f2.calls[0].input.ExecutionParameters, ['12.5', "'2026-01-01T00:00:00Z'"]);
});

test('Athena encodes string execution parameters as quoted literals, keeping numbers bare (#301)', async () => {
  const r = athenaRequest('total-revenue');
  r.analysis.Definition.FilterGroups = [];
  r.parameterDeclarations = [
    { name: 'Empty', type: 'string', multiple: false },
    { name: 'Apostrophe', type: 'string', multiple: false },
    { name: 'NumericText', type: 'string', multiple: false },
    { name: 'Expression', type: 'string', multiple: false },
    { name: 'Day', type: 'datetime', multiple: false },
    { name: 'Amount', type: 'number', multiple: false },
  ];
  r.parameterBindings = { Empty: [''], Apostrophe: ["O'Brien"], NumericText: ['001'], Expression: ["East' OR 1=1 --"], Day: ['2026-01-01'], Amount: [42] };
  r.parameterFilters = [
    { columnName: 'region', parameterName: 'Empty' },
    { columnName: 'category', parameterName: 'Apostrophe' },
    { columnName: 'region', parameterName: 'NumericText' },
    { columnName: 'category', parameterName: 'Expression' },
    { columnName: 'order_date', parameterName: 'Day' },
    { columnName: 'revenue', parameterName: 'Amount' },
  ];
  const f = fake(); await executeAthena(r, f.options);
  // Parameters stay out of the QueryString: the SQL still carries bare ? placeholders.
  assert.doesNotMatch(f.calls[0].input.QueryString, /O''Brien|OR 1=1/);
  assert.deepEqual(f.calls[0].input.ExecutionParameters, ["''", "'O''Brien'", "'001'", "'East'' OR 1=1 --'", "'2026-01-01'", '42']);
});

test('Athena polling uses bounded exponential backoff, including requeued executions', async () => {
  const states = ['QUEUED', 'RUNNING', 'QUEUED', 'RUNNING', 'RUNNING', 'RUNNING', 'SUCCEEDED'];
  const f = fake({ GetQueryExecutionCommand: () => ({ QueryExecution: { Status: { State: states.shift() } } }) });
  await executeAthena(athenaRequest(), f.options);
  assert.deepEqual(f.sleeps, [100, 200, 400, 800, 1000, 1000]);
});

test('Athena paginates and skips only the first header, preserving identical later data', async () => {
  const columns = [{ Name: 'label', Type: 'varchar' }, { Name: 'count', Type: 'varchar' }];
  const f = fake({ GetQueryResultsCommand: input => input.NextToken ? page([['label', 'count'], [null, '']], { columns, header: false }) : page([['one', 'two']], { columns, nextToken: 'page-two' }) });
  const result = await executeAthena(athenaRequest(), f.options);
  assert.deepEqual(result.rows, [{ label: 'one', count: 'two' }, { label: 'label', count: 'count' }, { label: null, count: '' }]);
  assert.deepEqual(f.calls.filter(c => c instanceof GetQueryResultsCommand).map(c => c.input.NextToken), [undefined, 'page-two']);
});

test('Athena maps every admitted result family, preserves unsafe integers and supports empty results', async () => {
  const types = ['tinyint', 'smallint', 'integer', 'bigint', 'double', 'float', 'decimal(10,2)', 'boolean', 'boolean', 'varchar', 'char', 'date', 'timestamp', 'bigint'];
  const values = ['1', '2', '3', '9007199254740993', '2.5', '-3.5', '4.25', 'true', 'false', '001', 'a', '2026-01-01', '2026-01-01 01:02:03.000', null];
  const columns = types.map((Type, i) => ({ Name: `c${i}`, Type }));
  const f = fake({ GetQueryResultsCommand: () => page([values], { columns }) });
  const result = await executeAthena(athenaRequest(), f.options);
  assert.deepEqual(Object.values(result.rows[0]), [1, 2, 3, '9007199254740993', 2.5, -3.5, 4.25, 1, 0, '001', 'a', '2026-01-01', '2026-01-01 01:02:03.000', null]);
  const empty = fake({ GetQueryResultsCommand: () => page([]) });
  assert.deepEqual((await executeAthena(athenaRequest(), empty.options)).rows, []);
});

for (const state of ['FAILED', 'CANCELLED', 'UNRECOGNIZED', undefined]) test(`Athena state ${state} fails closed without exposing StateChangeReason`, async () => {
  const reason = 'private SQL and output location must not escape';
  const f = fake({ GetQueryExecutionCommand: () => ({ QueryExecution: { Status: { State: state, StateChangeReason: reason } } }) });
  await assert.rejects(executeAthena(athenaRequest(), f.options), error => error.code === 'EXECUTION_ERROR' && !error.message.includes(reason));
  assert.equal(f.calls.some(c => c instanceof GetQueryResultsCommand), false); assert.equal(f.destroyed, 1);
});
for (const phase of ['StartQueryExecutionCommand', 'GetQueryExecutionCommand', 'GetQueryResultsCommand']) test(`Athena sanitizes raw SDK failures in ${phase}`, async () => {
  const f = fake({ [phase]: () => { throw new Error('private SQL credentials and location'); } });
  await assert.rejects(executeAthena(athenaRequest(), f.options), { code: 'EXECUTION_ERROR', message: '$.athena: Athena connection or query failed' });
  assert.equal(f.destroyed, 1);
});
test('Athena sanitizes client construction and ignores destroy failure', async () => {
  const f = fake();
  await assert.rejects(executeAthena(athenaRequest(), { ...f.options, clientFactory() { throw new Error('private region'); } }), { code: 'EXECUTION_ERROR', message: '$.athena: Athena connection or query failed' });
  f.client.destroy = () => { throw new Error('private cleanup'); };
  await executeAthena(athenaRequest(), f.options);
});

test('Athena hard polling timeout attempts StopQueryExecution and ignores stop errors', async () => {
  const f = fake({ GetQueryExecutionCommand: () => ({ QueryExecution: { Status: { State: 'RUNNING' } } }), StopQueryExecutionCommand: () => { throw new Error('private stop failure'); } });
  await assert.rejects(executeAthena(athenaRequest(), { ...f.options, timeoutMs: 250 }), { code: 'EXECUTION_ERROR', message: '$.athena: Athena query timed out' });
  assert.deepEqual(f.sleeps, [100, 150]);
  assert.deepEqual(f.calls.at(-1).input, { QueryExecutionId: 'test-query' }); assert.ok(f.calls.at(-1) instanceof StopQueryExecutionCommand); assert.equal(f.destroyed, 1);
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const phase of ['StartQueryExecutionCommand', 'GetQueryExecutionCommand', 'GetQueryResultsCommand']) test(`Athena hard deadline bounds a stalled ${phase}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred(); let transport;
  const f = fake({ [phase]: (_input, options) => { transport = options.abortSignal; entered.resolve(); return new Promise(() => {}); } });
  const pending = assert.rejects(executeAthena(athenaRequest(), { ...f.options, timeoutMs: 25 }), { code: 'EXECUTION_ERROR', message: '$.athena: Athena query timed out' });
  await entered.promise; t.mock.timers.tick(25); await pending;
  assert.equal(transport.aborted, true);
  assert.equal(f.calls.filter(c => c instanceof StopQueryExecutionCommand).length, phase === 'StartQueryExecutionCommand' ? 0 : 1);
  assert.equal(f.destroyed, 1);
});
for (const phase of ['GetQueryExecutionCommand', 'GetQueryResultsCommand']) test(`Athena abort stops a stalled ${phase} and throws ExecutionCancelledError`, async () => {
  const controller = new AbortController(), entered = deferred(); let transport;
  const f = fake({ [phase]: (_input, options) => { transport = options.abortSignal; entered.resolve(); return new Promise(() => {}); } });
  const pending = assert.rejects(executeAthena(athenaRequest(), { ...f.options, signal: controller.signal }), error => error instanceof ExecutionCancelledError);
  await entered.promise; controller.abort(); await pending;
  assert.equal(transport.aborted, true); assert.equal(f.calls.filter(c => c instanceof StopQueryExecutionCommand).length, 1); assert.equal(f.destroyed, 1);
});
test('Athena abort during polling sleep and during start response stops exactly once', async () => {
  for (const phase of ['sleep', 'start']) {
    const controller = new AbortController();
    const f = fake({ ...(phase === 'start' ? { StartQueryExecutionCommand: () => { controller.abort(); return { QueryExecutionId: 'test-query' }; } } : { GetQueryExecutionCommand: () => ({ QueryExecution: { Status: { State: 'RUNNING' } } }) }) });
    await assert.rejects(executeAthena(athenaRequest(), { ...f.options, signal: controller.signal, sleep: async () => { controller.abort(); } }), error => error instanceof ExecutionCancelledError);
    assert.equal(f.calls.filter(c => c instanceof StopQueryExecutionCommand).length, 1); assert.equal(f.destroyed, 1);
  }
});
test('Athena pre-aborted execution never constructs a client', async () => {
  const f = fake(); await assert.rejects(executeAthena(athenaRequest(), { ...f.options, signal: AbortSignal.abort() }), error => error instanceof ExecutionCancelledError);
  assert.equal(f.created, 0);
});
test('Athena cancellation cleanup is bounded even when StopQueryExecution stalls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), entered = deferred();
  const f = fake({ GetQueryExecutionCommand: () => { controller.abort(); return {}; }, StopQueryExecutionCommand: () => { entered.resolve(); return new Promise(() => {}); } });
  const pending = assert.rejects(executeAthena(athenaRequest(), { ...f.options, signal: controller.signal }), error => error instanceof ExecutionCancelledError);
  await entered.promise; t.mock.timers.tick(1000); await pending; assert.equal(f.destroyed, 1);
});

for (const type of ['array(varchar)', 'map(varchar,bigint)', 'row(x bigint)', 'struct', 'binary', 'json', 'interval day to second', 'unknown']) test(`Athena rejects ${type} for null and empty results`, async () => {
  for (const values of [[[null]], []]) {
    const f = fake({ GetQueryResultsCommand: () => page(values, { columns: [{ Name: 'bad', Type: type }] }) });
    await assert.rejects(executeAthena(athenaRequest(), f.options), { code: 'UNSUPPORTED_FEATURE' }); assert.equal(f.destroyed, 1);
  }
});
for (const [label, result] of [
  ['header name', { ...page(), ResultSet: { ...page().ResultSet, Rows: [wire(['wrong', 'revenue'])] } }],
  ['header width', { ...page(), ResultSet: { ...page().ResultSet, Rows: [wire(['region'])] } }],
  ['missing header', page([], { header: false })],
  ['row width', page([['East']])],
  ['duplicate columns', page([], { columns: [metadata[0], metadata[0]] })],
  ['missing metadata', { ResultSet: { Rows: [] } }],
  ['missing type', page([], { columns: [{ Name: 'revenue' }] })],
  ['nonfinite numeric', page([['East', 'NaN']])],
]) test(`Athena rejects malformed results: ${label}`, async () => {
  const f = fake({ GetQueryResultsCommand: () => result });
  await assert.rejects(executeAthena(athenaRequest(), f.options), { code: 'EXECUTION_ERROR' }); assert.equal(f.destroyed, 1);
});
test('Athena rejects changing metadata and repeated pagination tokens', async () => {
  for (const change of [true, false]) {
    const f = fake({ GetQueryResultsCommand: input => page([], { header: !input.NextToken, nextToken: 'same', columns: change && input.NextToken ? [{ Name: 'different', Type: 'varchar' }] : metadata }) });
    await assert.rejects(executeAthena(athenaRequest(), f.options), { code: 'EXECUTION_ERROR', message: change ? '$.athena: Athena result metadata changed between pages' : '$.athena: Athena repeated a result pagination token' });
  }
});
test('Athena enforces row, page and byte bounds without silently truncating', async () => {
  const rows = fake({ GetQueryResultsCommand: () => page([['East', '1'], ['West', '2']]) });
  await assert.rejects(executeAthena(athenaRequest(), { ...rows.options, maxRows: 1 }), /row limit exceeded/);
  const pages = fake({ GetQueryResultsCommand: () => page([], { nextToken: 'more' }) });
  await assert.rejects(executeAthena(athenaRequest(), { ...pages.options, maxPages: 1 }), /page limit exceeded/);
  assert.equal(pages.calls.filter(c => c instanceof GetQueryResultsCommand).length, 1);
  const bytes = fake({ GetQueryResultsCommand: () => page([['x'.repeat(64 * 1024 * 1024 + 1), '1']]) });
  await assert.rejects(executeAthena(athenaRequest(), bytes.options), /byte limit exceeded/);
});
test('Athena rejects a missing execution ID before polling', async () => {
  const f = fake({ StartQueryExecutionCommand: () => ({}) });
  await assert.rejects(executeAthena(athenaRequest(), f.options), { code: 'EXECUTION_ERROR' }); assert.equal(f.calls.length, 1);
});
test('Athena config, missing environment and database mismatch fail before client construction', async () => {
  for (const [overrides, code] of [
    [{ config: { ...config, credentialsEnv: 'SECRET' } }, 'INVALID_CONNECTOR_CONFIG'],
    [{ environment: {} }, 'CONNECTOR_NOT_CONFIGURED'],
    [{ environment: { ...environment, ATHENA_WORKGROUP: '' } }, 'CONNECTOR_NOT_CONFIGURED'],
    [{ environment: { ...environment, ATHENA_REGION: 'bad\0region' } }, 'CONNECTOR_NOT_CONFIGURED'],
    [{ environment: { ...environment, ATHENA_DATABASE: 'other' } }, 'INVALID_CONNECTOR_CONFIG'],
    [{ timeoutMs: 0 }, 'INVALID_INPUT'], [{ timeoutMs: Infinity }, 'INVALID_INPUT'], [{ maxRows: 100001 }, 'INVALID_INPUT'], [{ maxPages: 1001 }, 'INVALID_INPUT'],
  ]) { const f = fake(); await assert.rejects(executeAthena(athenaRequest(), { ...f.options, ...overrides }), { code }); assert.equal(f.created, 0); }
});
test('Athena SQL and security validation precede client construction, including bypass attempts', async () => {
  for (const [change, code] of [
    [r => { r.localData.security.dataset = 'protected'; }, 'SECURITY_REJECTED'],
    [r => { r.dataSource.DataSource.SslProperties = { DisableSsl: true }; }, 'SECURITY_REJECTED'],
    [r => { r.dataSource.DataSource.DataSourceParameters.AthenaParameters.credentials = 'secret'; }, 'UNSUPPORTED_FEATURE'],
    [r => { calculation(r, 'median({revenue})'); }, 'UNSUPPORTED_FEATURE'],
  ]) { const r = athenaRequest(), f = fake(); change(r); await assert.rejects(executeAthena(r, f.options), { code }); assert.equal(f.created, 0); }
});
test('Athena shared post-processing applies visual filters and table calculations to typed source rows', async () => {
  const r = athenaRequest('revenue-by-region'); calculation(r, 'percentOfTotal(sum({revenue}))');
  const columns = r.dataSet.DataSet.OutputColumns.map(c => ({ Name: c.Name, Type: ({ INTEGER: 'bigint', DECIMAL: 'double', STRING: 'varchar', DATETIME: 'varchar' })[c.Type] }));
  const f = fake({ GetQueryResultsCommand: () => page([['1', '2026-01-01T00:00:00.000Z', 'East', 'Hardware', '10', '1'], ['2', '2026-01-01T00:00:00.000Z', 'West', 'Hardware', '30', '2']], { columns }) });
  const result = await executeAthena(r, f.options);
  assert.equal(result.plan.postProcess, true); assert.deepEqual(result.rows, [{ region: 'East', calculated: 1 }]);
});

function securedAthena() {
  const r = athenaRequest('revenue-by-region'); r.localData.security.dataset = 'protected';
  r.security = { namespaceId: 'test', userId: 'reader', users: [{ id: 'reader', namespaceId: 'test' }], groups: [],
    policy: { namespaceId: 'test', dataSetArn: r.localData.dataSetArn, rowLevel: true, rowRules: [{ id: 'east', principals: [{ type: 'user', id: 'reader' }], predicate: { column: 'region', operator: 'eq', value: "East' OR TRUE --" } }] } };
  return r;
}
for (const [label, change, code] of [
  ['missing principal', r => { delete r.security.userId; }, 'PRINCIPAL_REQUIRED'],
  ['unknown principal', r => { r.security.userId = 'forged'; }, 'UNKNOWN_PRINCIPAL'],
  ['no matching rule', r => { r.security.policy.rowRules = []; }, 'ROW_ACCESS_DENIED'],
  ['wrong namespace', r => { r.security.policy.namespaceId = 'other'; }, 'NAMESPACE_ACCESS_DENIED'],
  ['denied measure', r => { r.security.policy.protectedColumns = ['revenue']; }, 'UNRESOLVED_BINDING'],
  ['denied calculation dependency', r => { r.security.policy.protectedColumns = ['revenue']; calculation(r, 'sum({revenue})'); }, 'UNRESOLVED_BINDING'],
]) test(`Athena security blocks ${label} before constructing the client`, async () => {
  const r = securedAthena(), f = fake(); change(r);
  await assert.rejects(executeAthena(r, f.options), { code }); assert.equal(f.created, 0);
});
test('Athena RLS SQL precedes visual aggregation, binds injection text and retains NULLS FIRST', async () => {
  const f = fake(), result = await executeAthena(securedAthena(), f.options);
  assert.match(result.plan.sql, /^WITH "__opensight_security" AS \(SELECT \* FROM "public"\."sales" WHERE \("region" = \?\)\)/);
  assert.match(result.plan.sql, /FROM "__opensight_security" WHERE "region" = \?/);
  assert.doesNotMatch(result.plan.sql, /OR TRUE/);
  assert.deepEqual(f.calls[0].input.ExecutionParameters, ["'East'' OR TRUE --'", "'East'"]);
});
test('Athena null execution parameters fail closed before client construction', async () => {
  const f = fake(), r = athenaRequest(); r.analysis.Definition.FilterGroups = [];
  r.parameterDeclarations = [{ name: 'Amount', type: 'number', multiple: false }]; r.parameterBindings = { Amount: [null] };
  r.parameterFilters = [{ columnName: 'revenue', parameterName: 'Amount' }];
  // Public parameter validation rejects null before the Athena-specific bind guard.
  await assert.rejects(executeAthena(r, f.options), { code: 'INVALID_INPUT' }); assert.equal(f.created, 0);
});
