import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
const dataRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const csv = text => ({ config: { format: 'csv', delimiter: ';' }, base64: Buffer.from(text).toString('base64') });
const input = csv('team;amount;day;active\nNorth;2;2026-01-01;true\nSouth;3;2026-01-02;false\nNorth;4;2026-01-03;true\n');
async function api(t, options = {}) {
  const server = await createApiServer({ dataRoot, localData: true, mailTransport: new StubMailTransport(), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async (path, method = 'GET', body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
}
const query = { dimensions: [{ fieldId: 'team', columnName: 'team' }], measures: [{ fieldId: 'total', columnName: 'doubled', aggregation: 'SUM' }], filters: [] };
const pipeline = input => ({ version: 1, input, steps: [
  { id: 'rename', kind: 'rename', config: { column: 'amount', name: 'units' } },
  { id: 'calculate', kind: 'calculate', config: { name: 'doubled', expression: '{units} * 2' } },
  { id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'team', value: 'North' }] } },
] });
test('local CSV stages inferred types, prepares transformations and queries the actual DuckDB output', async t => {
  const call = await api(t), before = Date.now();
  assert.deepEqual((await call('/api/local-data')).body, { mode: 'local', maxUploadBytes: 8388608, uploadTtlSeconds: 86400 });
  const staged = await call('/api/uploads', 'POST', input);
  assert.equal(staged.status, 201); assert.equal(staged.body.rowCount, 3); assert.equal(staged.body.delimiter, ';');
  assert.deepEqual(staged.body.columns.map(c => c.type), ['STRING', 'INTEGER', 'DATETIME', 'BOOLEAN']);
  assert.ok(Date.parse(staged.body.expiresAt) >= before + 86400000);
  assert.ok(Date.parse(staged.body.expiresAt) <= Date.now() + 86400000);
  const sources = await call('/api/prep-sources'); assert.equal(sources.body[0].id, staged.body.id);
  const p = pipeline(staged.body.id), path = '/api/datasets/local-prepared/prep';
  const preview = await call(path + '/preview', 'POST', { pipeline: p });
  assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.equal(preview.body.dialect, 'duckdb');
  assert.deepEqual(preview.body.rows.map(r => r.doubled), [4, 8]);
  assert.equal((await call(path, 'PUT', { name: 'Local prepared', pipeline: p })).status, 201);
  const result = await call('/api/datasets/local-prepared/query', 'POST', query);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(result.body.rows, [{ team: 'North', total: 12 }]);
  assert.equal(result.body.execution.mode, 'DIRECT_QUERY'); assert.equal(result.body.execution.cached, false);
  const changed = { ...p, steps: p.steps.slice(0, 2) };
  await call(path, 'PUT', { name: 'All teams', pipeline: changed });
  assert.deepEqual((await call('/api/datasets/local-prepared/query', 'POST', query)).body.rows, [{ team: 'North', total: 12 }, { team: 'South', total: 6 }]);
});
test('local access never creates a session, enables remote connectors or accepts forged principals', async t => {
  const call = await api(t);
  for (const path of ['/api/session', '/api/connectors', '/api/users', '/api/admin/ai']) assert.equal((await call(path)).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  for (const id of ['mysql', 'postgresql']) assert.equal((await call(`/api/connectors/${id}/connect`, 'POST', { config: {} })).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  assert.equal((await call('/api/uploads', 'POST', input, { Authorization: 'Bearer local' })).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  assert.equal((await call('/api/uploads', 'POST', input, { 'x-user-id': 'local' })).body.errorCode, 'FORGED_PRINCIPAL');
  assert.equal((await call('/api/namespaces/other/prep-sources')).status, 404);
  assert.equal((await call('/api/uploads?mode=hosted', 'POST', input)).status, 400);
});
test('unconfigured and authenticated servers never gain local upload through request flags or environment', async t => {
  const call = await api(t, { localData: false });
  for (const path of ['/api/uploads', '/api/uploads?localData=true', '/api/uploads?mode=fixture']) assert.equal((await call(path, 'POST', input)).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  assert.equal((await call('/api/local-data')).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  await assert.rejects(createApiServer({ dataRoot, localData: true, security: { initialState: emptySecurityState(), authenticate: () => undefined } }), /LOCAL_DATA_MODE_CONFLICT/);
  await assert.rejects(createApiServer({ dataRoot, localData: true, prepPostgresBindings: [{}] }), /LOCAL_DATA_MODE_CONFLICT/);
  const original = process.env.OPENSIGHT_MODE;
  process.env.OPENSIGHT_MODE = 'hosted';
  try {
    await assert.rejects(createApiServer({ dataRoot, localData: true }), /LOCAL_DATA_MODE_CONFLICT/);
    const hostedUnconfigured = await api(t, { localData: false });
    const denied = await hostedUnconfigured('/api/uploads', 'POST', input);
    assert.equal(denied.status, 503); assert.equal(denied.body.errorCode, 'SECURITY_NOT_CONFIGURED');
  }
  finally { if (original === undefined) delete process.env.OPENSIGHT_MODE; else process.env.OPENSIGHT_MODE = original; }
});
test('local intake accepts more than the hosted envelope but caps bytes and safely rejects malformed data', async t => {
  const call = await api(t);
  const large = csv('label;amount\n' + Array.from({ length: 2000 }, () => `${'x'.repeat(600)};2\n`).join(''));
  assert.equal((await call('/api/uploads', 'POST', large)).status, 201);
  const over = await call('/api/uploads', 'POST', csv('x'.repeat(8 * 1024 * 1024 + 1)));
  assert.equal(over.status, 413); assert.equal(over.body.errorCode, 'UPLOAD_LIMIT_EXCEEDED');
  assert.equal((await call('/api/uploads', 'POST', { ...input, base64: 'a'.repeat(12 * 1024 * 1024) })).status, 413);
  for (const body of [csv('a;b\n1'), { ...input, base64: 'Zh==' }, { ...input, base64: '====' }, { ...input, filename: '../../escape.csv' }, { ...input, config: { format: 'csv', path: '/tmp/escape.csv' } }, csv('a;b\n1;2\n3;bad'), { ...input, base64: Buffer.from([255]).toString('base64') }]) assert.equal((await call('/api/uploads', 'POST', body)).status, 400);
  const formula = await call('/api/uploads', 'POST', csv('formula;amount\n=1+1;2\n@SUM(A1);3'));
  assert.equal(formula.status, 201);
  assert.deepEqual((await call(`/api/uploads/${formula.body.id}`)).body.rows, [{ formula: '=1+1', amount: 2 }, { formula: '@SUM(A1)', amount: 3 }]);
});
test('local uploads expire at the boundary, reclaim staging and fail closed for saved direct queries', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  const call = await api(t), staged = await call('/api/uploads', 'POST', input), path = '/api/datasets/expires/prep';
  await call(path, 'PUT', { name: 'Expires', pipeline: pipeline(staged.body.id) });
  t.mock.timers.tick(86400000);
  assert.equal((await call('/api/datasets/expires/query', 'POST', query)).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  assert.equal((await call(`/api/uploads/${staged.body.id}`)).body.errorCode, 'UPLOAD_NOT_FOUND');
  const source = (await call('/api/prep-sources')).body.find(s => s.id === 'expires');
  assert.equal(source.available, false); assert.equal(source.errorCode, 'PREP_SOURCE_NOT_FOUND');
  assert.equal((await call('/api/uploads', 'POST', input)).status, 201);
});
test('local restart retains only pipeline metadata and never resolves old uploads to fixture data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-local-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const prepStorePath = join(dir, 'prep.json'), call = await api(t, { prepStorePath });
  const staged = await call('/api/uploads', 'POST', input);
  await call('/api/datasets/restarted/prep', 'PUT', { name: 'Local', pipeline: pipeline(staged.body.id) });
  assert.doesNotMatch(await readFile(prepStorePath, 'utf8'), /South|2026-01-03|base64/);
  const restarted = await api(t, { prepStorePath });
  assert.equal((await restarted('/api/datasets/restarted/query', 'POST', query)).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
});

import { polishEndpoints } from './polish-endpoints.mjs';
const salesQuery = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'revenue', aggregation: 'SUM' }], filters: [] };
test('Issue #35: fixture-only API deliberately exposes sample queries, not local upload/prep or hosted O', async t => {
  const call = await api(t, { localData: false });
  for (const [path, method] of polishEndpoints) {
    const body = method === 'POST' || method === 'PUT' ? salesQuery : undefined;
    const result = await call(path, method, body);
    if (path === '/api/datasets/sales/query') {
      assert.equal(result.status, 200); assert.deepEqual(result.body.rows, [{ total: 900 }]);
    } else if (path === '/api/datasets/polish/query') {
      assert.equal(result.status, 404, 'Fixture-only API has no prepared dataset registry');
    } else {
      assert.equal(result.status, 503, path); assert.equal(result.body.errorCode, 'SECURITY_NOT_CONFIGURED', path);
    }
    assert.equal((await call(path, method, body, { 'x-user-id': 'local' })).body.errorCode, 'FORGED_PRINCIPAL', path);
  }
});
test('Issue #35: local upload, all prep operations and dataset queries share explicit local access', async t => {
  const call = await api(t);
  assert.deepEqual((await call('/api/datasets/sales/query', 'POST', salesQuery)).body.rows, [{ total: 900 }]);
  const staged = await call('/api/uploads', 'POST', input);
  assert.equal(staged.status, 201);
  assert.equal((await call(`/api/uploads/${staged.body.id}`)).status, 200);
  assert.equal((await call('/api/prep-sources')).status, 200);
  const path = '/api/datasets/polish', p = pipeline(staged.body.id);
  assert.equal((await call(`${path}/prep/preview`, 'POST', { pipeline: p })).status, 200);
  assert.equal((await call(`${path}/prep`, 'PUT', { name: 'Polish audit', pipeline: p })).status, 201);
  assert.equal((await call(`${path}/prep`, 'GET')).status, 200);
  assert.equal((await call('/api/prep-datasets')).body.datasets.length, 1);
  assert.equal((await call(`${path}/execution`)).body.mode, 'DIRECT_QUERY');
  assert.deepEqual((await call(`${path}/query`, 'POST', query)).body.rows, [{ team: 'North', total: 12 }]);
  assert.equal((await call(`${path}/execution`, 'PUT', { mode: 'BLAZE', intervalMinutes: null })).status, 200);
  assert.equal((await call(`${path}/refresh`, 'POST', {})).status, 200);
  assert.equal((await call(`${path}/rows`)).body.rowCount, 2);
  assert.equal((await call(`${path}/prep`, 'DELETE')).status, 200);
  for (const path of ['/api/o/query', '/api/o/generate']) {
    const result = await call(path, 'POST', salesQuery);
    assert.equal(result.status, 503); assert.equal(result.body.errorCode, 'SECURITY_NOT_CONFIGURED');
    assert.match(result.body.Message, /Hosted authentication required/);
  }
  for (const [path, method] of polishEndpoints) {
    const body = method === 'POST' || method === 'PUT' ? {} : undefined;
    assert.equal((await call(path, method, body, { 'x-user-id': 'local' })).body.errorCode, 'FORGED_PRINCIPAL', path);
    assert.equal((await call(path, method, body, { Authorization: 'Bearer local' })).body.errorCode, 'SECURITY_NOT_CONFIGURED', path);
  }
});
