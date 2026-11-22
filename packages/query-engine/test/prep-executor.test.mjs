import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { previewPrepPostgres } from '../dist/index.js';
const source = { id: 'source', connectorId: 'postgresql', schema: 'public', table: 'source', columns: [{ name: 'amount', type: 'INTEGER' }], security: 'unrestricted' };
const pipeline = { version: 1, input: 'source', steps: [] };
const config = { connectionEnv: 'OPENSIGHT_TEST_PREP_CONNECTION' };
function setup(t) {
  const old = process.env.OPENSIGHT_TEST_PREP_CONNECTION;
  process.env.OPENSIGHT_TEST_PREP_CONNECTION = 'postgres://localhost/synthetic';
  t.after(() => { if (old === undefined) delete process.env.OPENSIGHT_TEST_PREP_CONNECTION; else process.env.OPENSIGHT_TEST_PREP_CONNECTION = old; });
  t.mock.method(Client.prototype, 'connect', async () => {});
  return t.mock.method(Client.prototype, 'end', async () => {});
}
test('Postgres prep uses a read-only UTC transaction, deadline, bounded SQL and precision-safe output', async t => {
  const end = setup(t), calls = [];
  t.mock.method(Client.prototype, 'query', async arg => { calls.push(arg); return { rows: typeof arg === 'string' ? [] : [{ amount: '9007199254740993' }, { amount: '2' }] }; });
  const result = await previewPrepPostgres(pipeline, [source], config, { limit: 1 });
  assert.equal(result.rows[0].amount, '9007199254740993'); assert.equal(result.truncated, true); assert.equal(result.totalRows, null);
  assert.deepEqual(calls.slice(0,3), ['BEGIN READ ONLY', "SET LOCAL TIME ZONE 'UTC'", "SET LOCAL statement_timeout = '10s'"]);
  assert.match(calls[3].text, /LIMIT 2$/); assert.equal(calls.at(-1), 'COMMIT'); assert.equal(end.mock.callCount(), 1);
});
test('Postgres prep sanitizes query and connection construction failures', async t => {
  const end = setup(t);
  t.mock.method(Client.prototype, 'query', async () => { throw new Error('synthetic-private-driver-detail'); });
  const safe = e => e.code === 'PREP_EXECUTION_FAILED' && !e.message.includes('synthetic-private-driver-detail');
  await assert.rejects(previewPrepPostgres(pipeline, [source], config), safe); assert.equal(end.mock.callCount(), 1);
  process.env.OPENSIGHT_TEST_PREP_CONNECTION = 'postgres://[invalid';
  await assert.rejects(previewPrepPostgres(pipeline, [source], config), safe);
});
test('Postgres prep validates authorization and environment config before connecting', async t => {
  setup(t); const connect = Client.prototype.connect;
  // Replacing an existing test mock twice leaks the first mock with --test-isolation=none.
  // Update its implementation so later real pg-wire tests receive the restored client.
  connect.mock.mockImplementation(async () => { throw new Error('must not connect'); });
  await assert.rejects(previewPrepPostgres(pipeline, [{ ...source, security: 'protected' }], config), e => e.code === 'PREP_SECURITY_REJECTED');
  delete process.env.OPENSIGHT_TEST_PREP_CONNECTION;
  await assert.rejects(previewPrepPostgres(pipeline, [source], config), e => e.code === 'PREP_SOURCE_NOT_FOUND');
  assert.equal(connect.mock.callCount(), 0);
});

import { diagnosePrepJoinPostgres, diagnosePrepJoinDuckDb, PrepJoinBudget, withPrepMemory } from '../dist/index.js';
const joinPipeline = { ...pipeline, steps: [{ id: 'join', kind: 'join', config: { source: 'source', joinType: 'inner', keys: [{ left: 'amount', right: 'amount' }], prefix: 'r_' } }] };
test('Postgres join diagnostics share one deadline across connection, bounded query and counts', async t => {
  setup(t); let clock = 0; const calls = [];
  t.mock.method(Client.prototype, 'query', async arg => {
    calls.push(arg); clock += 1000;
    return { rows: typeof arg === 'string' ? [] : [{ matchedRows: '2', unmatchedLeft: '0', unmatchedRight: '0', maxLeftMultiplicity: '1', maxRightMultiplicity: '2', leftRowsSampled: '1', rightRowsSampled: '2', leftTruncated: 'f', rightTruncated: 'f' }] };
  });
  const result = await diagnosePrepJoinPostgres(joinPipeline, [source], config, 'join', {}, new PrepJoinBudget(() => clock));
  assert.equal(result.matchedRows, 2); assert.equal(result.maxRightMultiplicity, 2);
  assert.equal(calls[2], "SET LOCAL statement_timeout = '8000ms'"); assert.match(calls[3].text, /AS MATERIALIZED.*LIMIT 10001/);
  clock = 0; Client.prototype.query.mock.mockImplementation(async () => { clock += 4000; return { rows: [] }; });
  await assert.rejects(diagnosePrepJoinPostgres(joinPipeline, [source], config, 'join', {}, new PrepJoinBudget(() => clock)), { code: 'PREP_EXECUTION_FAILED' });
});
test('DuckDB join diagnostics execute samples through the shared core and reject expired budgets', async () => {
  const s = { ...source, schema: undefined, connectorId: 'file' };
  await withPrepMemory([{ source: s, rowCount: 3, value: r => r < 2 ? 1 : null }], async c => {
    const result = await diagnosePrepJoinDuckDb(c, joinPipeline, [s], 'join');
    assert.equal(result.matchedRows, 4); assert.equal(result.unmatchedLeft, 1); assert.equal(result.unmatchedRight, 1);
    let time = 0; const budget = new PrepJoinBudget(() => time); time = 10000;
    await assert.rejects(diagnosePrepJoinDuckDb(c, joinPipeline, [s], 'join', {}, budget), { code: 'PREP_EXECUTION_FAILED' });
  });
});
