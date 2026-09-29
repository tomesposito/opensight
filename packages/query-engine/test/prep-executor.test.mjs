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
  setup(t); const connect = t.mock.method(Client.prototype, 'connect', async () => { throw new Error('must not connect'); });
  await assert.rejects(previewPrepPostgres(pipeline, [{ ...source, security: 'protected' }], config), e => e.code === 'PREP_SECURITY_REJECTED');
  delete process.env.OPENSIGHT_TEST_PREP_CONNECTION;
  await assert.rejects(previewPrepPostgres(pipeline, [source], config), e => e.code === 'PREP_SOURCE_NOT_FOUND');
  assert.equal(connect.mock.callCount(), 0);
});
