import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixture } from './hosted-helpers.mjs';
import { serving } from './v1-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { createApiServer } from '../dist/index.js';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const analyses = '/api/v1/analyses', dashboards = '/api/v1/dashboards';
const at = version => ({ 'If-Match': `"${version}"` });
const visual = (columnName = 'amount') => ({ kpiVisual: { visualId: 'total', chartConfiguration: { fieldWells: { values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'sales', columnName }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }] } } } });
const empty = () => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 'sheet', visuals: [] }], calculatedFields: [], filterGroups: [] });
const input = (id = 'analysis', withData = false, local = false) => ({ analysisId: id, name: 'Published analysis', definition: withData ? { ...empty(), dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:sales' }], sheets: [{ sheetId: 'sheet', visuals: [visual(local ? 'revenue' : 'amount')] }] } : empty(), datasetBindings: withData ? { sales: { kind: local ? 'dataset' : 'prepared-dataset', id: 'sales' } } : {} });
function good(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.body)); return r; }
function error(r, status, code) { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.errorCode, code, JSON.stringify(r.body)); }
async function hosted(t, env = {}, data = false) {
  const f = await authFixture(t), call = await serving(t, f, env), metadata = new TenantMetadata(f.db, f.db);
  let token = (await f.login()).token;
  const request = (path, options = {}) => call(path, { token, ...options });
  const renew = async () => { token = (await f.login()).token; };
  const identity = await f.auth.verify(token), context = () => metadata.authenticate(null, async () => identity);
  if (data) {
    const source = good(await request('/api/uploads', { method: 'POST', body: upload() }), 201); await renew();
    good(await request('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 0 } })); await renew();
  }
  return { ...f, call, request, metadata, identity, context, renew };
}
async function local(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'opensight-v1-dashboards-')), root = join(directory, 'data');
  await cp(resolve('../../fixtures/renderable-sales'), root, { recursive: true });
  const settings = typeof options === 'function' ? options(directory, root) : options;
  let server;
  const close = async () => { if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); };
  const start = async () => { server = await createApiServer({ dataRoot: root, ...settings }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); };
  await start(); t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, body: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text }); });
    }); req.on('error', reject); req.end(bytes);
  });
  return { root, directory, request, restart: async () => { await close(); await start(); } };
}
async function publish(f, source = 'analysis', dashboardId, headers) {
  return f.request(`${analyses}/${source}/publish`, { method: 'POST', body: dashboardId ? { dashboardId } : {}, headers });
}
for (const [plane, fixture] of [['hosted', hosted], ['local', local]]) test(`v1 dashboards ${plane}: durable publish, append, immutable old versions, deletes and severed source links`, async t => {
  const f = await fixture(t);
  const original = input(); good(await f.request(analyses, { method: 'POST', body: original }), 201);
  const first = good(await publish(f), 201), id = first.body.DashboardId; assert.equal(first.body.Version, 1); assert.equal(first.headers.etag, '"1"');
  const v1 = good(await f.request(`${dashboards}/${id}/versions/1`));
  const { analysisId, ...replacement } = original;
  good(await f.request(`${analyses}/analysis`, { method: 'PUT', body: { ...replacement, name: 'Second name' }, headers: at(1) }));
  const second = good(await publish(f, 'analysis', id), 201); assert.equal(second.body.Version, 2);
  assert.equal(JSON.stringify((await f.request(`${dashboards}/${id}/versions/1`)).body), JSON.stringify(v1.body));
  assert.equal((await f.request(`${dashboards}/${id}`)).body.Name, 'Second name');
  if (f.restart) { await f.restart(); assert.equal(JSON.stringify((await f.request(`${dashboards}/${id}/versions/1`)).body), JSON.stringify(v1.body)); }
  else { const call = await serving(t, f); assert.deepEqual((await call(`${dashboards}/${id}/versions/1`, { token: (await f.login()).token })).body, v1.body); }
  error(await f.request(`${dashboards}/${id}`, { method: 'DELETE', headers: at(1) }), 412, 'DASHBOARD_PRECONDITION_FAILED');
  error(await f.request(`${dashboards}/${id}`, { method: 'DELETE' }), 412, 'DASHBOARD_PRECONDITION_FAILED');
  error(await f.request(`${dashboards}/${id}/versions/2`, { method: 'DELETE', headers: at(2) }), 409, 'DASHBOARD_LATEST_VERSION');
  good(await f.request(`${dashboards}/${id}/versions/1`, { method: 'DELETE', headers: at(2) }));
  error(await f.request(`${dashboards}/${id}/versions/1`), 404, 'RESOURCE_NOT_FOUND');
  good(await f.request(`${analyses}/analysis`, { method: 'DELETE', headers: at(2) }));
  good(await f.request(`${dashboards}/${id}`)); error(await publish(f, 'analysis', id), 404, plane === 'local' ? 'RESOURCE_NOT_FOUND' : 'RESOURCE_NOT_FOUND');
  good(await f.request(analyses, { method: 'POST', body: original }), 201);
  error(await publish(f, 'analysis', id), 409, 'DASHBOARD_SOURCE_MISMATCH');
  good(await f.request(`${dashboards}/${id}`, { method: 'DELETE', headers: { ...at(2), 'Idempotency-Key': 'delete' } }));
  assert.equal(good(await f.request(`${dashboards}/${id}`, { method: 'DELETE', headers: { ...at(2), 'Idempotency-Key': 'delete' } })).headers['idempotent-replayed'], 'true');
  error(await f.request(`${dashboards}/${id}/versions/2`), 404, 'RESOURCE_NOT_FOUND');
});

test('v1 dashboards: draft publishes with diagnostics, identity mismatch, pagination, retries and concurrent publish', async t => {
  const f = await hosted(t);
  good(await f.request(analyses, { method: 'POST', body: input() }), 201);
  const bad = input('unfinished'); bad.definition.sheets[0].visuals = [{ kpiVisual: { visualId: 'unfinished' } }];
  good(await f.request(analyses, { method: 'POST', body: bad }), 201);
  // D-49: drafts publish with their diagnostics attached to the version.
  const draft = good(await publish(f, 'unfinished'), 201); assert.ok(draft.body.Errors.length);
  const draftId = draft.body.DashboardId;
  assert.ok(good(await f.request(`${dashboards}/${draftId}`)).body.Errors.length);
  assert.equal((await f.request(dashboards)).body.items.length, 1);
  const opts = { 'Idempotency-Key': 'one-publication' };
  const replies = await Promise.all([publish(f, 'analysis', undefined, opts), publish(f, 'analysis', undefined, opts)]);
  replies.forEach(r => good(r, 201)); assert.deepEqual(replies[0].body, replies[1].body); assert.equal(replies[1].headers['idempotent-replayed'], 'true');
  const id = replies[0].body.DashboardId;
  const repeated = await Promise.all([publish(f, 'analysis', id, { 'Idempotency-Key': 'republish' }), publish(f, 'analysis', id, { 'Idempotency-Key': 'republish' })]);
  repeated.forEach(r => good(r, 201)); assert.equal(repeated[0].body.Version, 2); assert.deepEqual(repeated[0].body, repeated[1].body);
  error(await publish(f, 'analysis', id, opts), 409, 'IDEMPOTENCY_CONFLICT');
  good(await f.request(analyses, { method: 'POST', body: input('other') }), 201);
  error(await publish(f, 'other', id), 409, 'DASHBOARD_SOURCE_MISMATCH');
  good(await publish(f, 'other'), 201);
  const page1 = good(await f.request(dashboards, { headers: { Limit: '1' } })).body;
  const page2 = good(await f.request(dashboards, { headers: { Limit: '1', Cursor: page1.nextCursor } })).body;
  const page3 = good(await f.request(dashboards, { headers: { Limit: '1', Cursor: page2.nextCursor } })).body;
  assert.equal(page1.items.length, 1); assert.equal(page2.items.length, 1); assert.equal(page3.items.length, 1);
  assert.notEqual(page1.items[0].id, page2.items[0].id); assert.notEqual(page2.items[0].id, page3.items[0].id);
  assert.equal(page3.nextCursor, null);
  const versions = good(await f.request(`${dashboards}/${id}/versions`, { headers: { Limit: '1' } })).body;
  assert.equal(versions.items[0].version, 1); assert.equal(typeof versions.items[0].publishedBy, 'string');
  const rest = good(await f.request(`${dashboards}/${id}/versions`, { headers: { Cursor: versions.nextCursor, Limit: '1' } })).body;
  assert.equal(rest.items[0].version, 2); assert.equal(rest.nextCursor, null);
  for (const path of [dashboards, `${dashboards}/${id}/versions`]) error(await f.request(path, { headers: { Limit: '0' } }), 400, 'INVALID_PAGINATION');
});

test('v1 dashboards: operator retention prunes oldest versions without reusing numbers', async t => {
  const f = await hosted(t, { OPENSIGHT_DASHBOARD_VERSION_CAP: '2' });
  good(await f.request(analyses, { method: 'POST', body: input() }), 201);
  const id = good(await publish(f), 201).body.DashboardId;
  for (let i = 2; i <= 4; i++) assert.equal(good(await publish(f, 'analysis', id), 201).body.Version, i);
  assert.deepEqual((await f.request(`${dashboards}/${id}/versions`)).body.items.map(v => v.version), [3, 4]);
  error(await f.request(`${dashboards}/${id}/versions/2`), 404, 'RESOURCE_NOT_FOUND');
  good(await f.request(`${dashboards}/${id}/versions/3`, { method: 'DELETE', headers: at(4) }));
  assert.equal(good(await publish(f, 'analysis', id), 201).body.Version, 5);
});

import { readerMember } from './embed-content-helpers.mjs';
async function put(f, kind, id, body) {
  const context = await f.context(); let version = 0;
  try { version = (await f.metadata.get(context, { kind, id })).version; } catch (e) { if (e.code !== 'RESOURCE_NOT_FOUND') throw e; }
  await f.metadata.put(context, { kind, id }, body, version);
}
test('v1 dashboards: admin user/group shares are definition-only, readers cannot access publisher data or manage grants', async t => {
  const f = await hosted(t, {}, true), reader = await readerMember(f); await f.renew();
  good(await f.request(analyses, { method: 'POST', body: input('analysis', true) }), 201);
  const id = good(await publish(f), 201).body.DashboardId;
  const path = `${dashboards}/${id}`, userShare = `${path}/shares/user/${reader.identity.userId}`;
  let token = (await reader.login()).token;
  error(await f.call(path, { token }), 404, 'RESOURCE_NOT_FOUND');
  const shared = good(await f.request(userShare, { method: 'PUT', body: { role: 'viewer' }, headers: { 'Idempotency-Key': 'grant' } }));
  assert.deepEqual(good(await f.request(userShare)).body, shared.body);
  assert.equal(good(await f.request(userShare, { method: 'PUT', body: { role: 'viewer' }, headers: { 'Idempotency-Key': 'grant' } })).headers['idempotent-replayed'], 'true');
  assert.equal(good(await f.call(path, { token })).body.Version, 1);
  error(await f.call(`${path}/versions/1/visuals/total/query`, { token, method: 'POST', body: {} }), 403, 'DASHBOARD_DATASET_ACCESS_DENIED');
  error(await f.call(`${path}/exports`, { token, method: 'POST', body: { format: 'csv' } }), 403, 'DASHBOARD_DATASET_ACCESS_DENIED');
  for (const method of ['GET', 'PUT', 'DELETE']) error(await f.call(userShare, { token, method, ...(method === 'PUT' ? { body: { role: 'co-owner' } } : {}) }), 403, 'METADATA_WRITE_FORBIDDEN');
  assert.equal((await publish({ request: (p, o) => f.call(p, { ...o, token }) })).status, 403);
  good(await publish(f, 'analysis', id), 201); assert.deepEqual((await f.request(userShare)).body, shared.body);
  good(await f.request(userShare, { method: 'DELETE', headers: { 'Idempotency-Key': 'revoke' } }));
  assert.equal(good(await f.request(userShare, { method: 'DELETE', headers: { 'Idempotency-Key': 'revoke' } })).headers['idempotent-replayed'], 'true');
  error(await f.call(path, { token }), 404, 'RESOURCE_NOT_FOUND');
  await put(f, 'group', 'readers', { name: 'Readers', userIds: [reader.identity.userId] }); await f.renew(); token = (await reader.login()).token;
  const group = `${path}/shares/group/readers`;
  good(await f.request(group, { method: 'PUT', body: { role: 'viewer' } })); assert.equal(good(await f.request(group)).body.principal.type, 'group');
  good(await f.call(path, { token }));
  good(await f.request(group, { method: 'DELETE' })); error(await f.request(group), 404, 'RESOURCE_NOT_FOUND');
  error(await f.call(path, { token }), 404, 'RESOURCE_NOT_FOUND');
});

function controlledInput() {
  const body = input('analysis', true), d = body.definition;
  d.parameterDeclarations = [{ integerParameterDeclaration: { name: 'Scale', parameterValueType: 'SINGLE_VALUED', defaultValues: { staticValues: [2] } } }];
  d.calculatedFields = [{ dataSetIdentifier: 'sales', name: 'scaled', expression: '{amount} * ${Scale}' }];
  d.sheets[0].visuals = [visual('scaled')];
  d.sheets[0].parameterControls = [{ textField: { parameterControlId: 'scale-control', sourceParameterName: 'Scale', title: 'Scale' } }];
  d.filterGroups = [{ filterGroupId: 'region-filter', status: 'ENABLED', crossDataset: 'SINGLE_DATASET', scopeConfiguration: { allSheets: {} }, filters: [{ categoryFilter: { filterId: 'region', column: { dataSetIdentifier: 'sales', columnName: 'region' }, configuration: { filterListConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', categoryValues: ['east', 'west'] } } } }] }];
  d.sheets[0].filterControls = [{ dropdown: { filterControlId: 'region-control', sourceFilterId: 'region', title: 'Region' } }];
  return body;
}
test('v1 dashboards: typed declared controls change live queries, injection and undeclared controls reject, frozen definition stays unchanged', async t => {
  const f = await hosted(t, {}, true), body = controlledInput();
  good(await f.request(analyses, { method: 'POST', body }), 201);
  const id = good(await publish(f), 201).body.DashboardId, path = `${dashboards}/${id}/versions/1/visuals/total/query`;
  const before = good(await f.request(`${dashboards}/${id}/versions/1`)).body;
  assert.deepEqual(good(await f.request(path, { method: 'POST', body: {} })).body.rows, [{ value: 120 }]);
  const selected = { controlValues: { 'scale-control': [3], 'region-control': ['east'] } };
  assert.deepEqual(good(await f.request(path, { method: 'POST', body: selected, headers: { 'Idempotency-Key': 'query' } })).body.rows, [{ value: 120 }]);
  assert.equal(good(await f.request(path, { method: 'POST', body: selected, headers: { 'Idempotency-Key': 'query' } })).headers['idempotent-replayed'], 'true');
  assert.deepEqual(good(await f.request(path, { method: 'POST', body: { controlValues: { 'region-control': ['west'] } } })).body.rows, [{ value: 40 }]);
  for (const rejected of [{ controlValues: { Scale: [1] } }, { controlValues: { unknown: ['east'] } }, { filters: [] }, { sql: 'SELECT 1' }, { ownerId: 'other' }, { controlValues: {}, parameterBindings: {} }]) error(await f.request(path, { method: 'POST', body: rejected }), 422, 'DASHBOARD_UNDECLARED_CONTROL');
  for (const value of [['1'], [1, 2], [1.5], { sql: 'SELECT 1' }]) error(await f.request(path, { method: 'POST', body: { controlValues: { 'scale-control': value } } }), 422, 'DASHBOARD_CONTROL_VALUE_INVALID');
  assert.deepEqual((await f.request(`${dashboards}/${id}/versions/1`)).body, before);
});

test('v1 dashboards: synchronous CSV/PDF artifacts use frozen definitions and live data, never stored renders', async t => {
  // Portable protocol fixture; a real Chromium smoke render is also recorded in the slice notes.
  const rendererRoot = await mkdtemp(join(tmpdir(), 'opensight-pdf-protocol-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const renderer = join(rendererRoot, 'renderer');
  await writeFile(renderer, `#!${process.execPath}
const fs = require('node:fs');
let buffer = '';
const input = fs.createReadStream(null, { fd: 3 });
input.on('data', bytes => {
  buffer += bytes.toString(); let end;
  while ((end = buffer.indexOf('\\0')) >= 0) {
    const m = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const result = m.method === 'Target.createTarget' ? { targetId: 'target' } : m.method === 'Target.attachToTarget' ? { sessionId: 'session' }
      : m.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'frame' } } }
      : m.method === 'Page.printToPDF' ? { data: Buffer.from('%PDF-1.4\\nprotocol fixture\\n%%EOF').toString('base64') } : {};
    fs.writeSync(4, JSON.stringify({ id: m.id, result }) + '\\0');
  }
});
`, { mode: 0o700 });
  const f = await hosted(t, { OPENSIGHT_PDF_CHROMIUM: process.env.OPENSIGHT_TEST_PDF_CHROMIUM ?? renderer }, true);
  good(await f.request(analyses, { method: 'POST', body: input('analysis', true) }), 201);
  const id = good(await publish(f), 201).body.DashboardId, path = `${dashboards}/${id}/exports`;
  const { analysisId, ...replacement } = input('analysis', true); replacement.definition.calculatedFields = [{ dataSetIdentifier: 'sales', name: 'double', expression: '{amount} * 2' }]; replacement.definition.sheets[0].visuals = [visual('double')];
  good(await f.request(`${analyses}/analysis`, { method: 'PUT', body: replacement, headers: at(1) })); good(await publish(f, 'analysis', id), 201);
  const before = await f.metadata.get(await f.context(), { kind: 'dashboard', id });
  const first = good(await f.request(path, { method: 'POST', body: { version: 1, format: 'csv' }, headers: { 'Idempotency-Key': 'csv' } }));
  assert.match(first.headers['content-type'], /text\/csv/); assert.match(first.body, /60/); assert.equal(first.headers.etag, '"1"');
  const latest = good(await f.request(path, { method: 'POST', body: { format: 'csv' } })); assert.match(latest.body, /120/); assert.equal(latest.headers.etag, '"2"');
  const replay = good(await f.request(path, { method: 'POST', body: { version: 1, format: 'csv' }, headers: { 'Idempotency-Key': 'csv' } })); assert.equal(replay.body, first.body); assert.equal(replay.headers['idempotent-replayed'], 'true');
  const pdf = good(await f.request(path, { method: 'POST', body: { version: 1, format: 'pdf' } })); assert.equal(pdf.headers['content-type'], 'application/pdf'); assert.match(pdf.body, /^%PDF-/);
  assert.deepEqual(await f.metadata.get(await f.context(), { kind: 'dashboard', id }), before);
  const fresh = upload(); fresh.base64 = Buffer.from('region,amount,private\neast,100,a\n').toString('base64');
  const source = good(await f.request('/api/uploads', { method: 'POST', body: fresh }), 201); await f.renew();
  good(await f.request('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Live replacement', pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 1 } })); await f.renew();
  assert.match(good(await f.request(path, { method: 'POST', body: { version: 1, format: 'csv' } })).body, /100/);
  assert.deepEqual(await f.metadata.get(await f.context(), { kind: 'dashboard', id }), before);
  error(await f.request(path, { method: 'POST', body: { format: 'png' } }), 422, 'DASHBOARD_EXPORT_FORMAT_INVALID');
  error(await f.request(path, { method: 'POST', body: { version: 999, format: 'csv' } }), 404, 'RESOURCE_NOT_FOUND');
});

async function authorMember(f) {
  const m = await readerMember(f);
  await put(f, 'user', m.identity.userId, { name: 'Author', role: 'author' }); await f.renew();
  return m;
}
test('v1 dashboards: source co-owner and folder checks, access-filtered lists, revocation and replay', async t => {
  const f = await hosted(t), member = await authorMember(f), memberId = member.identity.userId;
  const grant = role => ({ principal: { type: 'user', id: memberId }, role });
  good(await f.request(analyses, { method: 'POST', body: input() }), 201);
  let source = await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' });
  await put(f, 'analysis', 'analysis', { ...source.body, grants: [grant('viewer')] }); await f.renew();
  let token = (await member.login()).token;
  const call = (path, opts = {}) => f.call(path, { ...opts, token });
  error(await publish({ request: call }), 404, 'RESOURCE_NOT_FOUND');
  source = await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' });
  await put(f, 'analysis', 'analysis', { ...source.body, grants: [grant('co-owner')] }); await f.renew(); token = (await member.login()).token;
  const options = { 'Idempotency-Key': 'author-publish' };
  const id = good(await publish({ request: call }, 'analysis', undefined, options), 201).body.DashboardId;
  good(await publish(f), 201); // A private second dashboard is not visible to the author.
  const list = good(await call(dashboards, { headers: { Limit: '1' } })).body; assert.equal(list.items.length, 1); assert.equal(list.items[0].id, id); assert.equal(list.nextCursor, null);
  const asset = await f.metadata.get(await f.context(), { kind: 'dashboard', id });
  await put(f, 'folder', 'private', { name: 'Private', grants: [] });
  await put(f, 'dashboard', id, { ...asset.body, folderId: 'private' }); await f.renew(); token = (await member.login()).token;
  error(await call(`${dashboards}/${id}`), 404, 'RESOURCE_NOT_FOUND');
  error(await publish({ request: call }, 'analysis', undefined, options), 404, 'RESOURCE_NOT_FOUND');
  error(await call(`${dashboards}/${id}`, { method: 'DELETE', headers: at(1) }), 404, 'RESOURCE_NOT_FOUND');
  await put(f, 'folder', 'private', { name: 'Private', grants: [grant('viewer')] }); await f.renew(); token = (await member.login()).token;
  good(await call(`${dashboards}/${id}`)); error(await call(`${dashboards}/${id}`, { method: 'DELETE', headers: at(1) }), 404, 'RESOURCE_NOT_FOUND');
  for (const header of ['x-user-id', 'x-tenant-id', 'x-namespace-id', 'x-role']) error(await f.request(dashboards, { headers: { [header]: 'forged' } }), 403, 'FORGED_PRINCIPAL');
});

test('v1 dashboards: every route participates in the tenant rate limit', async t => {
  const f = await hosted(t, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '1' });
  good(await f.request(dashboards));
  for (const [method, path, body] of [
    ['POST', `${analyses}/analysis/publish`, {}], ['GET', dashboards], ['GET', `${dashboards}/d`], ['DELETE', `${dashboards}/d`],
    ['GET', `${dashboards}/d/versions`], ['GET', `${dashboards}/d/versions/1`], ['DELETE', `${dashboards}/d/versions/1`],
    ...['user', 'group'].flatMap(kind => ['GET', 'PUT', 'DELETE'].map(method => [method, `${dashboards}/d/shares/${kind}/p`, method === 'PUT' ? { role: 'viewer' } : undefined])),
    ['POST', `${dashboards}/d/versions/1/visuals/v/query`, {}], ['POST', `${dashboards}/d/exports`, { format: 'csv' }],
  ]) { const r = await f.request(path, { method, body, headers: at(1) }); error(r, 429, 'RATE_LIMIT_EXCEEDED'); assert.ok(Number(r.headers['retry-after']) >= 1); }
});

function securityOptions(directory) {
  return { storePath: join(directory, 'security.json'), authenticate: req => ['author', 'peer', 'admin', 'reader'].includes(req.headers.authorization?.slice(7)) ? { namespaceId: 'default', userId: req.headers.authorization.slice(7) } : undefined,
    initialState: { version: 1, namespaces: [{ id: 'default', name: 'Default' }], users: ['author', 'peer', 'admin', 'reader'].map(id => ({ id, namespaceId: 'default', name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' })), groups: [{ namespaceId: 'default', id: 'readers', name: 'Readers', userIds: ['reader'] }], datasets: [] } };
}
test('v1 dashboards local authenticated: grants and frozen versions survive restart, pinned embed uses published version', async t => {
  const { randomBytes } = await import('node:crypto');
  const old = process.env.OPENSIGHT_EMBED_SECRET; process.env.OPENSIGHT_EMBED_SECRET = randomBytes(48).toString('base64');
  t.after(() => { if (old === undefined) delete process.env.OPENSIGHT_EMBED_SECRET; else process.env.OPENSIGHT_EMBED_SECRET = old; });
  const f = await local(t, directory => ({ security: securityOptions(directory), embedding: { origin: 'https://api.example.test', allowedParentOrigins: ['https://app.example.test'] } }));
  const request = (path, opts = {}, user = 'author') => f.request(path, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${user}` } });
  good(await request(analyses, { method: 'POST', body: input() }), 201);
  const id = good(await publish({ request }), 201).body.DashboardId;
  const { analysisId, ...replacement } = input(); replacement.name = 'Second';
  good(await request(`${analyses}/analysis`, { method: 'PUT', body: replacement, headers: at(1) })); good(await publish({ request }, 'analysis', id), 201);
  const url = `/dashboards/${id}/embed-url`, body = { parentOrigin: 'https://app.example.test' };
  const signed = good(await request(url, { method: 'POST', body: { ...body, version: 1 } })).body.url;
  const latest = good(await request(url, { method: 'POST', body })).body.url;
  const claims = value => JSON.parse(Buffer.from(new URL(value).searchParams.get('token').split('.')[0], 'base64url'));
  assert.equal(claims(signed).dashboardVersion, 1); assert.equal(claims(latest).dashboardVersion, 2);
  assert.equal(claims(signed).expiresAt - claims(signed).issuedAt, 300);
  const render = async value => { const u = new URL(value); return f.request(u.pathname + u.search); };
  assert.match(good(await render(signed)).body, /Published analysis/); assert.match(good(await render(latest)).body, /Second/);
  const share = `${dashboards}/${id}/shares/group/readers`;
  good(await request(share, { method: 'PUT', body: { role: 'viewer' } }, 'admin'));
  good(await request(`${dashboards}/${id}`, {}, 'reader'));
  error(await request(share, {}, 'author'), 403, 'SECURITY_ADMIN_REQUIRED');
  await f.restart(); good(await request(share, {}, 'admin')); good(await request(`${dashboards}/${id}`, {}, 'reader'));
  assert.equal((await request(`/dashboards/${id}/definition`)).body.Name, 'Second');
  good(await request(`${dashboards}/${id}/versions/1`, { method: 'DELETE', headers: at(2) }));
  error(await render(signed), 404, 'RESOURCE_NOT_FOUND'); good(await render(latest));
  const state = JSON.parse(await readFile(join(f.directory, 'security.json'), 'utf8'));
  assert.deepEqual(state.assets.find(a => a.kind === 'dashboard').dashboard.versions.map(v => v.version), [2]);
});

test('v1 dashboards local legacy: live query/export, maintenance fencing and transient artifacts', async t => {
  const f = await local(t), body = input('analysis', true, true);
  body.definition.dataSetIdentifierDeclarations[0].dataSetArn = JSON.parse(await readFile(join(f.root, 'local-data.json'), 'utf8')).dataSetArn;
  good(await f.request(analyses, { method: 'POST', body }), 201);
  const id = good(await publish(f), 201).body.DashboardId, path = `${dashboards}/${id}`;
  const result = good(await f.request(`${path}/versions/1/visuals/total/query`, { method: 'POST', body: {} })); assert.ok(result.body.rows[0].value > 0);
  const before = await readFile(join(f.root, '.opensight-analyses.json'), 'utf8');
  const csv = good(await f.request(`${path}/exports`, { method: 'POST', body: { format: 'csv' } })); assert.match(csv.body, /sheetId,visualId,row,column,value/);
  assert.equal(await readFile(join(f.root, '.opensight-analyses.json'), 'utf8'), before);
  error(await f.request(`${path}/exports`, { method: 'POST', body: { format: 'pdf' } }), 503, 'DASHBOARD_PDF_RENDERER_REQUIRED');
  await writeFile(`${f.root}.h1-frozen`, 'synthetic-maintenance');
  error(await publish(f, 'analysis', id), 503, 'LEGACY_STORE_FROZEN');
  assert.equal((await f.request(`${path}/versions`)).body.items.length, 1);
  await rm(`${f.root}.h1-frozen`);
});

test('v1 dashboards local prepared: same-ID administrator data cannot substitute for publisher data, including legacy query and embed seams', async t => {
  const f = await local(t, directory => ({ security: securityOptions(directory), prepStorePath: join(directory, 'prep.json') }));
  const request = (path, opts = {}, user = 'author') => f.request(path, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${user}` } });
  for (const user of ['author', 'admin']) {
    const upload = good(await request('/api/uploads', { method: 'POST', body: { config: { format: 'csv' }, base64: Buffer.from(`region,amount\neast,${user === 'author' ? 2 : 99}\n`).toString('base64') } }, user), 201);
    good(await request('/api/datasets/owned-sales/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: upload.body.id, steps: [] } } }, user), 201);
  }
  const source = input('analysis', true); source.datasetBindings.sales.id = 'owned-sales';
  good(await request(analyses, { method: 'POST', body: source }), 201);
  const id = good(await publish({ request }), 201).body.DashboardId;
  const query = `${dashboards}/${id}/versions/1/visuals/total/query`;
  assert.deepEqual(good(await request(query, { method: 'POST', body: {} })).body.rows, [{ value: 2 }]);
  good(await request(`${dashboards}/${id}`, {}, 'admin'));
  error(await request(query, { method: 'POST', body: {} }, 'admin'), 403, 'DASHBOARD_DATASET_ACCESS_DENIED');
  error(await request(`/dashboards/${id}/visuals/total/query`, { method: 'POST', body: {} }, 'admin'), 403, 'DASHBOARD_DATASET_ACCESS_DENIED');
  error(await request(`${dashboards}/${id}/exports`, { method: 'POST', body: { format: 'csv' } }, 'admin'), 403, 'DASHBOARD_DATASET_ACCESS_DENIED');
});

test('v1 dashboards: tenant boundaries apply to versions, shares, queries, exports and publication retries', async t => {
  const f = await hosted(t); good(await f.request(analyses, { method: 'POST', body: input() }), 201);
  const id = good(await publish(f, 'analysis', undefined, { 'Idempotency-Key': 'tenant-publish' }), 201).body.DashboardId;
  const tenant = await f.provisioning.provision('dashboards-other-tenant', { ...f.input, name: 'Other tenant' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  const token = (await f.auth.login(f.email, f.password, f.code(), tenant.tenantId, 'local')).token; f.advance();
  for (const [path, method, body] of [
    [`${dashboards}/${id}`, 'GET'], [`${dashboards}/${id}/versions`, 'GET'], [`${dashboards}/${id}/versions/1`, 'GET'],
    [`${dashboards}/${id}/shares/user/p`, 'PUT', { role: 'viewer' }], [`${dashboards}/${id}/versions/1/visuals/v/query`, 'POST', {}],
    [`${dashboards}/${id}/exports`, 'POST', { format: 'csv' }], [`${analyses}/analysis/publish`, 'POST', {}],
  ]) error(await f.call(path, { token, method, body, headers: { 'Idempotency-Key': 'tenant-publish' } }), 404, 'RESOURCE_NOT_FOUND');
});

test('v1 dashboards: current data-policy revocation blocks query/export replays and publication with diagnostics', async t => {
  const f = await hosted(t, {}, true);
  good(await f.request(analyses, { method: 'POST', body: input('analysis', true) }), 201);
  const id = good(await publish(f), 201).body.DashboardId, path = `${dashboards}/${id}`;
  const query = { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'query-before-revocation' } };
  const artifact = { method: 'POST', body: { format: 'csv' }, headers: { 'Idempotency-Key': 'export-before-revocation' } };
  good(await f.request(`${path}/versions/1/visuals/total/query`, query)); good(await f.request(`${path}/exports`, artifact));
  const prepared = await f.metadata.get(await f.context(), { kind: 'prepared-dataset', id: 'sales', ownerId: f.identity.userId });
  const sourceId = prepared.body.resource.opensightPrep.input;
  good(await f.request(`/api/sources/${sourceId}/bind`, { method: 'POST', body: { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } } })); await f.renew();
  error(await f.request(`${path}/versions/1/visuals/total/query`, query), 403, 'PREP_SECURITY_REJECTED');
  error(await f.request(`${path}/exports`, artifact), 403, 'PREP_SECURITY_REJECTED');
  const rejected = await publish(f, 'analysis', id); error(rejected, 403, 'PREP_SECURITY_REJECTED'); assert.equal(rejected.body.Errors.length, 1);
  assert.equal(good(await f.request(`${path}/versions`)).body.items.length, 1);
});

test('v1 dashboards: successful readmission after a revision change never replays prior data bytes', async t => {
  const f = await hosted(t, {}, true);
  good(await f.request(analyses, { method: 'POST', body: input('analysis', true) }), 201);
  const id = good(await publish(f), 201).body.DashboardId, path = `${dashboards}/${id}`;
  const query = { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'revision-query' } };
  const artifact = { method: 'POST', body: { format: 'csv' }, headers: { 'Idempotency-Key': 'revision-export' } };
  good(await f.request(`${path}/versions/1/visuals/total/query`, query)); good(await f.request(`${path}/exports`, artifact));
  // An authorization revision with readmission still successful models the
  // security boundary needed for reductions that return fewer permitted rows.
  await put(f, 'group', 'new-group', { name: 'Group', userIds: [] }); await f.renew();
  good(await f.request(`${path}/versions/1/visuals/total/query`, { method: 'POST', body: {} }));
  error(await f.request(`${path}/versions/1/visuals/total/query`, query), 409, 'DASHBOARD_REPLAY_REVISED');
  error(await f.request(`${path}/exports`, artifact), 409, 'DASHBOARD_REPLAY_REVISED');
});

test('v1 dashboards: hosted embed/report legacy paths cannot reinterpret a published prepared binding', async t => {
  const { EmbedContent } = await import('../dist/embed-content.js');
  const { EmbedSources } = await import('../dist/embed-sources.js');
  const { HostedData } = await import('../dist/hosted-data.js');
  const { JobRenderer } = await import('../dist/job-renderer.js');
  const f = await hosted(t, {}, true);
  good(await f.request(analyses, { method: 'POST', body: input('analysis', true) }), 201);
  const id = good(await publish(f), 201).body.DashboardId;
  const prepared = await f.metadata.get(await f.context(), { kind: 'prepared-dataset', id: 'sales', ownerId: f.identity.userId });
  await put(f, 'dataset', 'sales', { definition: { DataSet: { DataSetId: 'sales' } }, sources: [{ kind: 'source', id: prepared.body.resource.opensightPrep.input, ownerId: f.identity.userId }] }); await f.renew();
  const context = await f.context(), asset = await f.metadata.get(context, { kind: 'dashboard', id });
  const data = new HostedData(new EmbedSources(f.metadata, f.config.encryptionKey.toString('base64'), []));
  const content = new EmbedContent(data), jobs = new JobRenderer(data, content);
  await assert.rejects(content.visuals(context, { anonymous: false, tags: {}, experience: { kind: 'dashboard', dashboardId: id } }, asset), e => e.code === 'EMBED_DATASET_UNSUPPORTED');
  await assert.rejects(jobs.authorize(context, { kind: 'report', dashboardId: id }), e => e.code === 'JOB_DATASET_UNSUPPORTED');
});
