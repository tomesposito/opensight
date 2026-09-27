import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, types } from 'pg';
import { executePostgres, QueryEngineError } from '@opensight/query-engine';
import { calculation, request } from './helpers.mjs';

const options = { connectionString: 'postgres://user:secret@example.invalid/test' };
const empty = { fields: [], rows: [] };

function mockClient(t, { query = () => empty, connect = () => {}, end = () => {} } = {}) {
  const clients = [];
  const connectMock = t.mock.method(Client.prototype, 'connect', async function () {
    clients.push(this);
    return connect();
  });
  const queryMock = t.mock.method(Client.prototype, 'query', async function (config) {
    assert.ok(clients.includes(this), 'queries must use the connected client');
    return query(config);
  });
  const endMock = t.mock.method(Client.prototype, 'end', async function () {
    assert.ok(clients.includes(this), 'cleanup must use the same client, even on failed connect');
    return end();
  });
  return { clients, connectMock, queryMock, endMock };
}

test('Postgres binds planned parameters, sets UTC and closes one client per call', async t => {
  const mocks = mockClient(t, { query: config => typeof config === 'string' ? empty : {
    fields: [{ name: 'region', dataTypeID: types.builtins.TEXT }, { name: 'revenue', dataTypeID: types.builtins.FLOAT8 }],
    rows: [['East', '500']],
  } });
  const r = request('revenue-by-region');
  const result = await executePostgres(r, options);
  assert.equal(result.plan.dialect, 'postgres');
  assert.deepEqual(result.rows, [{ region: 'East', revenue: 500 }]);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes(options.connectionString));
  assert.equal(mocks.connectMock.mock.callCount(), 1);
  assert.equal(mocks.endMock.mock.callCount(), 1);
  const calls = mocks.queryMock.mock.calls;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].arguments[0], "SET TIME ZONE 'UTC'");
  const config = calls[1].arguments[0];
  assert.equal(config.text, result.plan.sql);
  assert.deepEqual(config.values, ['East']);
  assert.equal(config.rowMode, 'array');
  assert.equal(config.types.getTypeParser(types.builtins.INT8)('9007199254740993'), '9007199254740993');
  await executePostgres(r, options);
  assert.equal(mocks.clients.length, 2);
  assert.notEqual(mocks.clients[0], mocks.clients[1]);
  assert.equal(mocks.endMock.mock.callCount(), 2);
});

test('Postgres converts wire numeric values without changing global parsers or numeric-looking strings', async t => {
  const parser = types.getTypeParser(types.builtins.INT8);
  const scalars = [
    ['text', types.builtins.TEXT, '00123', '00123'],
    ['small', types.builtins.INT2, '2', 2],
    ['integer', types.builtins.INT4, '-4', -4],
    ['count', types.builtins.INT8, '8', 8],
    ['safe', types.builtins.INT8, '9007199254740991', 9007199254740991],
    ['large', types.builtins.INT8, '9007199254740993', '9007199254740993'],
    ['negative', types.builtins.NUMERIC, '-9007199254740993', '-9007199254740993'],
    ['sum', types.builtins.NUMERIC, '9007199254740993', '9007199254740993'],
    ['small_sum', types.builtins.NUMERIC, '12', 12],
    ['average', types.builtins.NUMERIC, '12.5', 12.5],
    ['float', types.builtins.FLOAT8, '12.5', 12.5],
    ['null', types.builtins.NUMERIC, null, null],
    ['__proto__', types.builtins.TEXT, 'safe', 'safe'],
  ];
  mockClient(t, { query: config => typeof config === 'string' ? empty : {
    fields: scalars.map(([name, dataTypeID]) => ({ name, dataTypeID })),
    rows: [scalars.map(([, , value]) => value)],
  } });
  assert.deepEqual((await executePostgres(request(), options)).rows,
    [Object.fromEntries(scalars.map(([name, , , value]) => [name, value]))]);
  assert.equal(types.getTypeParser(types.builtins.INT8), parser);
});

for (const stage of ['connect', 'timezone', 'query', 'end']) {
  test(`Postgres closes the client and sanitizes ${stage} failure`, async t => {
    const fail = () => { throw new Error(`driver failure: ${options.connectionString}`); };
    const mocks = mockClient(t, {
      connect: stage === 'connect' ? fail : undefined,
      end: stage === 'end' ? fail : undefined,
      query: config => {
        if (stage === (typeof config === 'string' ? 'timezone' : 'query')) fail();
        return empty;
      },
    });
    await assert.rejects(executePostgres(request(), options), error => {
      assert.ok(error instanceof QueryEngineError);
      assert.equal(error.code, 'EXECUTION_ERROR');
      assert.equal(error.path, '$.postgres');
      assert.ok(!error.stack.includes(options.connectionString));
      assert.ok(!error.message.includes('secret'));
      return true;
    });
    assert.equal(mocks.endMock.mock.callCount(), 1);
    assert.equal(mocks.queryMock.mock.callCount(), stage === 'connect' ? 0 : stage === 'timezone' ? 1 : 2);
  });
}

for (const [value, oid] of [
  ['NaN', types.builtins.FLOAT8], ['Infinity', types.builtins.NUMERIC], ['-Infinity', types.builtins.FLOAT4],
]) {
  test(`Postgres rejects nonfinite ${value} results and closes the client`, async t => {
    const mocks = mockClient(t, { query: config => typeof config === 'string' ? empty : {
      fields: [{ name: 'revenue', dataTypeID: oid }], rows: [[value]],
    } });
    await assert.rejects(executePostgres(request(), options), { code: 'EXECUTION_ERROR', path: '$.result' });
    assert.equal(mocks.endMock.mock.callCount(), 1);
  });
}

test('Postgres validates requests and connection options before connecting', async t => {
  const mocks = mockClient(t);
  for (const connectionString of ['', null, undefined, 123, 'bad\0url']) {
    await assert.rejects(executePostgres(request(), { connectionString }), { code: 'INVALID_INPUT', path: '$.options.connectionString' });
  }
  await assert.rejects(executePostgres(null, options), { code: 'INVALID_INPUT', path: '$' });
  const r = request(); calculation(r, 'unsupportedFunction({revenue})');
  await assert.rejects(executePostgres(r, options), { code: 'UNSUPPORTED_FEATURE' });
  assert.equal(mocks.connectMock.mock.callCount(), 0);
});

test('Postgres sanitizes client construction failures', async () => {
  await assert.rejects(executePostgres(request(), { connectionString: 'postgres://user:secret@[' }),
    { code: 'EXECUTION_ERROR', message: '$.postgres: Postgres connection or query failed' });
});

test('Postgres driver normalizes boolean scalar columns before the shared table stages', async t => {
  mockClient(t, { query: config => typeof config === 'string' ? empty : {
    fields: [{ name: 'region', dataTypeID: types.builtins.TEXT }, { name: 'revenue', dataTypeID: types.builtins.FLOAT8 }, { name: 'Flag', dataTypeID: types.builtins.BOOL }],
    rows: [['East', '100', 't'], ['West', '50', 'f']],
  } });
  const r = request('revenue-by-region'); r.analysis.Definition.FilterGroups = [];
  calculation(r, 'percentOfTotal(sum(ifelse({Flag}, {revenue}, 0)))');
  r.analysis.Definition.CalculatedFields.push({ Name: 'Flag', DataSetIdentifier: 'sales_data', Expression: '{revenue} > 75' });
  assert.deepEqual((await executePostgres(r, options)).rows, [{ region: 'East', calculated: 1 }, { region: 'West', calculated: 0 }]);
});
