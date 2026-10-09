import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorRoutes } from '../dist/connector-routes.js';
import { PrepRoutes } from '../dist/prep-routes.js';

// Route integration without a listening socket; HTTP authorization is covered
// by local-data.test.mjs. Exercise the same parsers, stores and DuckDB executor.
test('durable local routes restore upload → prepare → chart across close/reopen and fail closed at expiry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-durable-routes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let connectors, prep;
  const open = async () => {
    connectors = new ConnectorRoutes(true);
    await connectors.openLocal(join(dir, 'uploads.duckdb'));
    prep = await PrepRoutes.create(connectors, join(dir, 'prep.json'));
  };
  const identity = { namespaceId: 'local', userId: 'local' };
  async function call(path, method = 'GET', body, owner = identity) {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    request.method = method; request.headers = { 'content-type': 'application/json' };
    let status, result;
    const response = { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } };
    await (path.startsWith('/api/uploads') ? connectors : prep).route(request, response, path, '', owner);
    return { status, body: result };
  }
  await open(); t.after(() => connectors.close());
  const uploaded = await call('/api/uploads', 'POST', { config: { format: 'csv' }, base64: Buffer.from('team,amount\nNorth,2\nSouth,3\nNorth,4').toString('base64') });
  assert.equal(uploaded.status, 201);
  const pipeline = { version: 1, input: uploaded.body.id, steps: [{ id: 'double', kind: 'calculate', config: { name: 'doubled', expression: '{amount} * 2' } }] };
  const query = { dimensions: [{ fieldId: 'team', columnName: 'team' }], measures: [{ fieldId: 'total', columnName: 'doubled', aggregation: 'SUM' }], filters: [] };
  assert.equal((await call('/api/datasets/chart/prep', 'PUT', { name: 'Uploaded chart', pipeline })).status, 201);
  const before = await call('/api/datasets/chart/query', 'POST', query);
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.rows, [{ team: 'North', total: 12 }, { team: 'South', total: 6 }]);
  await connectors.close(); await open();
  assert.deepEqual((await call(`/api/uploads/${uploaded.body.id}`)).body.upload, uploaded.body);
  assert.deepEqual(await call('/api/datasets/chart/query', 'POST', query), before);
  assert.equal((await call('/api/datasets/chart/prep/preview', 'POST', { pipeline })).status, 200);
  assert.equal((await call('/api/prep-sources')).body.find(s => s.id === 'chart').available, true);
  assert.equal((await call(`/api/uploads/${uploaded.body.id}`, 'GET', undefined, { namespaceId: 'other', userId: 'local' })).body.errorCode, 'UPLOAD_NOT_FOUND');
  await connectors.close();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(uploaded.body.expiresAt) });
  await open();
  assert.equal((await call(`/api/uploads/${uploaded.body.id}`)).body.errorCode, 'UPLOAD_NOT_FOUND');
  assert.equal((await call('/api/datasets/chart/query', 'POST', query)).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  assert.equal((await call('/api/prep-sources')).body.find(s => s.id === 'chart').available, false);
  await connectors.close();
});
