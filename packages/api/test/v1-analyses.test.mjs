import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysisDefinition, projectDefinition, convertDefinition } from '@opensight/web/analysis';

const schema = new Map([['sales', { columns: [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }, { name: 'private', type: 'STRING' }], deniedColumns: ['private'] }]]);
const draft = () => ({ dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:sales' }], sheets: [{ sheetId: 'sheet', visuals: [] }], calculatedFields: [], filterGroups: [] });
const visual = (id = 'total', columnName = 'amount') => ({ kpiVisual: { visualId: id, chartConfiguration: { fieldWells: { values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'sales', columnName }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }] } } } });
const calc = (name, expression) => ({ dataSetIdentifier: 'sales', name, expression });
function valid(d) { return validateAnalysisDefinition(d, schema); }
function invalid(d, code) { assert.throws(() => valid(d), e => { assert.equal(e.code, code, e.message); assert.match(e.path, /^\$\./); return true; }); }

test('v1 analyses shared validation: PascalCase projection round-trips UI fields and opaque values', () => {
  const d = draft(); d.sheets[0].visuals = [visual()]; d.calculatedFields = [calc('twice', '{amount} * 2')]; d.extension = { UserLabel: 'verbatim' };
  assert.deepEqual(convertDefinition(projectDefinition(d)), d);
  delete d.extension; assert.deepEqual(valid(d).Errors, []);
  assert.ok(projectDefinition(d).Sheets[0].Visuals[0].KPIVisual.ChartConfiguration.FieldWells.Values);
  invalid({ ...d, Sheets: [] }, 'INVALID_INPUT');
});
test('v1 analyses shared validation: every calculation, including unused and cyclic fields, is admitted by the parser', () => {
  for (const [expression, code] of [['SELECT * FROM secrets', 'TYPE_MISMATCH'], ['pg_sleep(1)', 'UNSUPPORTED_FEATURE'], ['{amount}; DROP TABLE sales', 'INVALID_INPUT'], ['{region} * 2', 'TYPE_MISMATCH'], ['{private}', 'COLUMN_ACCESS_DENIED'], ['{missing}', 'UNRESOLVED_BINDING']]) {
    invalid({ ...draft(), calculatedFields: [calc('unused', expression)] }, code);
  }
  invalid({ ...draft(), calculatedFields: [calc('one', '{two}'), calc('two', '{one}')] }, 'CALCULATION_CYCLE');
  const d = { ...draft(), calculatedFields: [calc('twice', '{amount} * 2'), calc('total', 'sum({twice})'), calc('literal', "'SELECT * FROM secrets; DROP TABLE sales'")] };
  assert.deepEqual(valid(d).Errors, []);
});
test('v1 analyses shared validation: incomplete visuals are diagnostics, invalid calculated measures are errors', () => {
  const d = draft(); assert.deepEqual(valid(d).Errors, []);
  d.sheets[0].visuals = [{ kpiVisual: { visualId: 'unfinished' } }];
  assert.equal(valid(d).Errors[0].errorCode, 'ANALYSIS_VISUAL_NOT_EXECUTABLE');
  d.sheets[0].visuals = [{ kpiVisual: { visualId: 'unfinished', chartConfiguration: { fieldWells: { values: [{ calculatedMeasureField: { fieldId: 'bad', expression: 'pg_sleep(1)' } }] } } } }];
  invalid(d, 'UNSUPPORTED_FEATURE');
});
test('v1 analyses shared validation: parameters and dangling layout, filter, calculation references reject', () => {
  const d = draft(); d.calculatedFields = [calc('scaled', '{amount} * ${Scale}')];
  invalid(d, 'UNRESOLVED_BINDING');
  d.parameterDeclarations = [{ integerParameterDeclaration: { name: 'Scale', parameterValueType: 'SINGLE_VALUED', defaultValues: { staticValues: [2] } } }];
  assert.deepEqual(valid(d).Errors, []);
  d.sheets[0].layouts = [{ configuration: { gridLayout: { elements: [{ elementId: 'gone', elementType: 'VISUAL' }] } } }];
  invalid(d, 'UNRESOLVED_BINDING'); delete d.sheets[0].layouts;
  d.filterGroups = [{ filterGroupId: 'group', status: 'DISABLED', filters: [], scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{ sheetId: 'sheet', scope: 'SELECTED_VISUALS', visualIds: ['gone'] }] } } }];
  invalid(d, 'UNRESOLVED_BINDING');
});
test('v1 analyses shared validation: identities, bindings, SQL envelopes and authority assertions fail closed', () => {
  invalid({ ...draft(), sheets: [{ sheetId: 'sheet' }, { sheetId: 'sheet' }] }, 'INVALID_INPUT');
  const d = draft(); d.sheets[0].visuals = [visual(), visual()]; invalid(d, 'INVALID_INPUT');
  invalid({ ...draft(), calculatedFields: [{ ...calc('bad', '1'), dataSetIdentifier: 'missing' }] }, 'UNRESOLVED_BINDING');
  invalid({ ...draft(), sql: 'SELECT 1' }, 'UNSUPPORTED_FEATURE');
  invalid({ ...draft(), metadata: { ownerId: 'another-user' } }, 'SECURITY_REJECTED');
});

import { authFixture } from './hosted-helpers.mjs';
import { serving } from './v1-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { readerMember } from './embed-content-helpers.mjs';
import { createApiServer } from '../dist/index.js';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const base = '/api/v1/analyses';
const empty = () => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 'sheet', visuals: [] }], calculatedFields: [], filterGroups: [] });
const create = (analysisId = 'analysis', definition = draft(), kind = 'prepared-dataset') => ({ analysisId, name: 'Analysis', definition, datasetBindings: Object.fromEntries(definition.dataSetIdentifierDeclarations.map(d => [d.identifier, { kind, id: 'sales' }])) });
function error(r, status, code, path = false) {
  assert.equal(r.status, status, JSON.stringify(r.body)); if (code) assert.equal(r.body.errorCode, code, JSON.stringify(r.body));
  assert.equal(typeof r.body.errorCode, 'string'); if (path) assert.equal(typeof r.body.path, 'string');
}
async function hosted(t, env = {}, sourceInput = upload()) {
  const f = await authFixture(t), call = await serving(t, f, env), metadata = new TenantMetadata(f.db, f.db);
  let token = (await f.login()).token;
  const request = (path, options = {}) => call(path, { token, ...options });
  const renew = async () => { token = (await f.login()).token; };
  const identity = await f.auth.verify(token), context = () => metadata.authenticate(null, async () => identity);
  const source = await request('/api/uploads', { method: 'POST', body: sourceInput }); assert.equal(source.status, 201, JSON.stringify(source.body)); await renew();
  const prepared = await request('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 0 } });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body)); await renew();
  return { ...f, call, request, metadata, identity, context, renew, source: source.body };
}
async function local(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'opensight-v1-analyses-')), root = join(directory, 'data');
  await cp(resolve('fixtures/renderable-sales'), root, { recursive: true }).catch(async () => cp(resolve('../../fixtures/renderable-sales'), root, { recursive: true }));
  const settings = typeof options === 'function' ? options(directory, root) : options;
  let server;
  const close = async () => { if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); };
  const start = async () => { server = await createApiServer({ dataRoot: root, ...settings }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); };
  await start(); t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(bytes);
  });
  return { root, directory, request, restart: async () => { await close(); await start(); } };
}
const at = version => ({ 'If-Match': `"${version}"` });

for (const budget of ['OPENSIGHT_RETRY_CACHE_MAX_BYTES', 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES']) {
  test(`v1 analyses: ${budget} counts retained definitions before saving and preserves fitting retries`, async t => {
    const large = create('large', empty());
    large.definition.sheets = Array.from({ length: 10 }, (_, i) => ({ sheetId: `sheet${i}`, visuals: [] }));
    const replyOnly = { status: 201, body: { AnalysisId: large.analysisId, Name: large.name, Definition: projectDefinition(large.definition), Errors: [] }, version: 1 };
    // The projected reply fits; retaining its original definition as well does not.
    const f = await hosted(t, { [budget]: String(Buffer.byteLength(JSON.stringify(replyOnly)) + 150) });
    let r = await f.request(base, { method: 'POST', body: large, headers: { 'Idempotency-Key': 'large' } });
    error(r, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(r.headers['retry-after'], '60');
    error(await f.request(`${base}/large`), 404, 'RESOURCE_NOT_FOUND');
    const body = create('small', empty()), headers = { 'Idempotency-Key': 'small' };
    const first = await f.request(base, { method: 'POST', body, headers });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    r = await f.request(base, { method: 'POST', body, headers });
    assert.equal(r.status, 201); assert.equal(r.headers['idempotent-replayed'], 'true'); assert.deepEqual(r.body, first.body);
    const { analysisId, ...replacement } = large;
    r = await f.request(`${base}/small`, { method: 'PUT', body: replacement, headers: { ...at(1), 'Idempotency-Key': 'update' } });
    error(r, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(r.headers['retry-after'], '60');
    const unchanged = await f.request(`${base}/small`);
    assert.equal(unchanged.headers.etag, '"1"'); assert.deepEqual(unchanged.body, first.body);
    r = await f.request(base, { method: 'POST', body, headers });
    assert.equal(r.status, 201); assert.equal(r.headers['idempotent-replayed'], 'true'); assert.deepEqual(r.body, first.body);
  });
}

test('v1 analyses: update capacity includes the prior access snapshot before saving', async t => {
  const f = await hosted(t, { OPENSIGHT_RETRY_CACHE_MAX_BYTES: '1000' });
  const body = create('analysis', empty());
  body.definition.sheets = Array.from({ length: 60 }, (_, i) => ({ sheetId: `sheet${i}`, visuals: [] }));
  const first = await f.request(base, { method: 'POST', body }); assert.equal(first.status, 201);
  const { analysisId, ...replacement } = create('analysis', empty());
  const r = await f.request(`${base}/analysis`, { method: 'PUT', body: replacement, headers: { ...at(1), 'Idempotency-Key': 'update' } });
  error(r, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(r.headers['retry-after'], '60');
  const unchanged = await f.request(`${base}/analysis`);
  assert.equal(unchanged.status, 200); assert.equal(unchanged.headers.etag, '"1"'); assert.deepEqual(unchanged.body, first.body);
});

test('v1 analyses: query and analysis receipts share the same global entry budget', async t => {
  const f = await hosted(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '1' });
  const headers = { 'Idempotency-Key': 'query' }, query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
  const first = await f.request('/api/v1/datasets/sales/query', { method: 'POST', body: query, headers }); assert.equal(first.status, 200);
  const blocked = await f.request(base, { method: 'POST', body: create(), headers: { 'Idempotency-Key': 'analysis' } });
  error(blocked, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(blocked.headers['retry-after'], '60');
  error(await f.request(`${base}/analysis`), 404, 'RESOURCE_NOT_FOUND');
  const replay = await f.request('/api/v1/datasets/sales/query', { method: 'POST', body: query, headers });
  assert.equal(replay.headers['idempotent-replayed'], 'true'); assert.deepEqual(replay.body, first.body);
});

test('v1 analyses local: shared retry budgets apply without hosted routes', async t => {
  const name = 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES', previous = process.env[name];
  process.env[name] = '1';
  let f;
  try { f = await local(t); } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
  const body = create('local', empty()), headers = { 'Idempotency-Key': 'first' };
  const first = await f.request(base, { method: 'POST', body, headers }); assert.equal(first.status, 201);
  const blocked = await f.request(base, { method: 'POST', body: create('second', empty()), headers: { 'Idempotency-Key': 'second' } });
  error(blocked, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(blocked.headers['retry-after'], '60');
  error(await f.request(`${base}/second`), 404, 'RESOURCE_NOT_FOUND');
  const replay = await f.request(base, { method: 'POST', body, headers });
  assert.equal(replay.headers['idempotent-replayed'], 'true'); assert.deepEqual(replay.body, first.body);
});

test('v1 analyses hosted CRUD: real definitions, ETags, creator grants and durable metadata round trip', async t => {
  const f = await hosted(t), input = create(); input.definition.sheets[0].visuals = [visual()];
  const r = await f.request(base, { method: 'POST', body: input }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.headers.etag, '"1"');
  assert.deepEqual(Object.keys(r.body).sort(), ['AnalysisId', 'Definition', 'Errors', 'Name']); assert.deepEqual(r.body.Errors, []);
  assert.deepEqual(convertDefinition(r.body.Definition), input.definition);
  assert.deepEqual((await f.request(`${base}/analysis`)).body, r.body);
  assert.deepEqual((await f.request(base)).body, { items: [{ kind: 'analysis', id: 'analysis', name: 'Analysis' }], nextCursor: null });
  const stored = await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' });
  assert.deepEqual(stored.body.grants, [{ principal: { type: 'user', id: f.identity.userId }, role: 'co-owner' }]);
  assert.deepEqual(stored.body.datasets, [{ kind: 'prepared-dataset', id: 'sales', ownerId: f.identity.userId }]);
  const second = await serving(t, f); assert.deepEqual((await second(`${base}/analysis`, { token: (await f.login()).token })).body, r.body);
  const { analysisId, ...replacement } = input;
  const updated = await f.request(`${base}/analysis`, { method: 'PUT', body: { ...replacement, name: 'Replaced' }, headers: at(1) });
  assert.equal(updated.status, 200, JSON.stringify(updated.body)); assert.equal(updated.headers.etag, '"2"'); assert.equal(updated.body.Name, 'Replaced');
  const deleted = await f.request(`${base}/analysis`, { method: 'DELETE', headers: at(2) }); assert.deepEqual(deleted.body, { id: 'analysis', removed: true });
  error(await f.request(`${base}/analysis`), 404, 'RESOURCE_NOT_FOUND');
});

test('v1 analyses every authoring verb shares one version and rejects dangling removals', async t => {
  const f = await hosted(t); assert.equal((await f.request(base, { method: 'POST', body: create() })).status, 201);
  let version = 1;
  const mutate = async (suffix, method, body) => {
    const r = await f.request(`${base}/analysis${suffix}`, { method, body, headers: at(version) });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.headers.etag, `"${++version}"`); return r;
  };
  await mutate('/sheets/sheet/visuals', 'POST', visual());
  const duplicate = await f.request(`${base}/analysis/sheets/sheet/visuals`, { method: 'POST', body: visual(), headers: at(version) }); error(duplicate, 422, 'INVALID_INPUT', true);
  const layouts = [{ configuration: { gridLayout: { elements: [{ elementId: 'total', elementType: 'VISUAL', columnSpan: 12, rowSpan: 6 }] } } }];
  await mutate('/sheets/sheet/layouts', 'PUT', layouts);
  error(await f.request(`${base}/analysis/sheets/sheet/visuals/total`, { method: 'DELETE', headers: at(version) }), 422, 'UNRESOLVED_BINDING', true);
  await mutate('/calculated-fields', 'PUT', [calc('twice', '{amount} * 2')]);
  await mutate('/sheets/sheet/visuals/total', 'PUT', visual('total', 'twice'));
  error(await f.request(`${base}/analysis/calculated-fields`, { method: 'PUT', body: [], headers: at(version) }), 422, 'UNRESOLVED_BINDING', true);
  const group = { filterGroupId: 'filter', status: 'ENABLED', filters: [{ categoryFilter: { filterId: 'region-filter', column: { dataSetIdentifier: 'sales', columnName: 'region' }, configuration: { filterListConfiguration: { matchOperator: 'CONTAINS', categoryValues: ['east'] } } } }], scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{ sheetId: 'sheet', scope: 'SELECTED_VISUALS', visualIds: ['total'] }] } } };
  await mutate('/filter-groups', 'POST', group);
  await mutate('/filter-groups/filter', 'PUT', { ...group, status: 'DISABLED' });
  await mutate('/sheets/sheet/layouts', 'PUT', []);
  error(await f.request(`${base}/analysis/sheets/sheet/visuals/total`, { method: 'DELETE', headers: at(version) }), 422, 'UNRESOLVED_BINDING', true);
  await mutate('/filter-groups/filter', 'DELETE');
  await mutate('/sheets/sheet/visuals/total', 'DELETE');
  const final = await mutate('/calculated-fields', 'PUT', []); assert.deepEqual(final.body.Errors, []);
  error(await f.request(`${base}/analysis/filter-groups/missing`, { method: 'DELETE', headers: at(version) }), 404, 'RESOURCE_NOT_FOUND');
  error(await f.request(`${base}/analysis/sheets/missing/layouts`, { method: 'PUT', body: [], headers: at(version) }), 404, 'RESOURCE_NOT_FOUND');
});

test('v1 analyses If-Match, concurrent edits, reread/reapply and all mutation replay semantics', async t => {
  const f = await hosted(t), input = create('analysis', empty()), createOptions = { method: 'POST', body: input, headers: { 'Idempotency-Key': 'create' } };
  const initial = await f.request(base, createOptions); assert.equal(initial.status, 201, JSON.stringify(initial.body));
  const replay = await f.request(base, createOptions); assert.equal(replay.headers['idempotent-replayed'], 'true'); assert.equal(replay.headers.etag, '"1"');
  error(await f.request(base, { ...createOptions, body: { ...input, name: 'Different' } }), 409, 'IDEMPOTENCY_CONFLICT');
  const path = `${base}/analysis/calculated-fields`;
  error(await f.request(path, { method: 'PUT', body: [] }), 428, 'V1_IF_MATCH_REQUIRED');
  for (const value of ['1', '*', 'W/"1"', '"01"', '"9007199254740992"']) error(await f.request(path, { method: 'PUT', body: [], headers: { 'If-Match': value } }), 400, 'V1_IF_MATCH_INVALID');
  const results = await Promise.all([1, 2].map(() => f.request(path, { method: 'PUT', body: [], headers: at(1) })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(results.find(r => r.status === 409).body.errorCode, 'METADATA_CONFLICT');
  const current = await f.request(`${base}/analysis`); assert.equal(current.headers.etag, '"2"');
  const options = { method: 'PUT', body: [], headers: { ...at(2), 'Idempotency-Key': 'edit' } };
  const edit = await f.request(path, options); assert.equal(edit.headers.etag, '"3"');
  assert.deepEqual((await f.request(path, options)).body, edit.body);
  assert.equal((await f.request(`${base}/analysis`)).headers.etag, '"3"');
  error(await f.request(path, { ...options, body: [calc('unknown', '1')] }), 409, 'IDEMPOTENCY_CONFLICT');
  const del = { method: 'DELETE', headers: { ...at(3), 'Idempotency-Key': 'delete' } };
  assert.equal((await f.request(`${base}/analysis`, del)).status, 200);
  const again = await f.request(`${base}/analysis`, del); assert.equal(again.status, 200, JSON.stringify(again.body)); assert.equal(again.headers['idempotent-replayed'], 'true');
});

test('v1 analyses local durable writes survive restart, preserve legacy reads and obey maintenance fence', async t => {
  const f = await local(t), input = create('local-analysis', draft(), 'dataset'); input.definition.sheets[0].visuals = [visual('total', 'revenue')];
  const created = await f.request(base, { method: 'POST', body: input }); assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual((await f.request('/analyses')).body.find(a => a.id === 'local-analysis'), { kind: 'analysis', id: 'local-analysis', name: 'Analysis' });
  const legacy = await f.request('/analyses/local-analysis/definition'); assert.equal(legacy.status, 200); assert.deepEqual(legacy.body.Definition, created.body.Definition);
  await f.restart(); assert.deepEqual((await f.request(`${base}/local-analysis`)).body, created.body);
  const updated = await f.request(`${base}/local-analysis/sheets/sheet/visuals/total`, { method: 'PUT', body: visual('total', 'revenue'), headers: at(1) }); assert.equal(updated.headers.etag, '"2"');
  await f.restart(); assert.equal((await f.request(`${base}/local-analysis`)).headers.etag, '"2"');
  await writeFile(`${f.root}.h1-frozen`, 'synthetic-maintenance');
  error(await f.request(`${base}/local-analysis`, { method: 'DELETE', headers: at(2) }), 503, 'LEGACY_STORE_FROZEN');
  await rm(`${f.root}.h1-frozen`);
  assert.equal((await f.request(`${base}/local-analysis`, { method: 'DELETE', headers: at(2) })).status, 200);
  await f.restart(); error(await f.request(`${base}/local-analysis`), 404, 'RESOURCE_NOT_FOUND');
  const proto = create('__proto__', empty()); assert.equal((await f.request(base, { method: 'POST', body: proto })).status, 201);
  await f.restart(); assert.equal((await f.request(`${base}/__proto__`)).body.AnalysisId, '__proto__');
});

async function member(f, role = 'author') {
  const m = await readerMember(f);
  const user = await f.metadata.get(await f.context(), { kind: 'user', id: m.identity.userId });
  await f.metadata.put(await f.context(), { kind: 'user', id: m.identity.userId }, { ...user.body, role }, user.version);
  await f.renew(); return m;
}
async function otherTenant(f) {
  const tenant = await f.provisioning.provision('analysis-other-tenant', { ...f.input, name: 'Other tenant' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  const session = await f.auth.login(f.email, f.password, f.code(), tenant.tenantId, 'local'); f.advance(); return session.token;
}
async function put(f, kind, id, body) {
  const context = await f.context(); let version = 0;
  try { version = (await f.metadata.get(context, { kind, id })).version; } catch (error) { if (error.code !== 'RESOURCE_NOT_FOUND') throw error; }
  await f.metadata.put(context, { kind, id }, body, version);
}
async function changeAsset(f, id, changes) {
  const r = await f.metadata.get(await f.context(), { kind: 'analysis', id }); await put(f, 'analysis', id, { ...r.body, ...changes });
}
const grant = (id, role = 'co-owner', type = 'user') => ({ principal: { type, id }, role });

test('v1 analyses access: build roles, creator co-owner, asset and folder restrictions, pagination after filtering', async t => {
  const f = await hosted(t), m = await member(f);
  for (const id of ['a-hidden', 'b-visible', 'c-visible', 'd-hidden']) assert.equal((await f.request(base, { method: 'POST', body: create(id, empty()) })).status, 201);
  await changeAsset(f, 'b-visible', { grants: [grant(m.identity.userId)] });
  await changeAsset(f, 'c-visible', { grants: [grant(m.identity.userId, 'viewer')] });
  await changeAsset(f, 'd-hidden', { grants: [grant(m.identity.userId)] });
  await put(f, 'folder', 'private', { name: 'Private', grants: [] }); await changeAsset(f, 'd-hidden', { folderId: 'private' }); await f.renew();
  let token = (await m.login()).token;
  const call = (path, options = {}) => f.call(path, { token, ...options });
  const first = await call(base, { headers: { Limit: '1' } }); assert.deepEqual(first.body.items.map(v => v.id), ['b-visible']);
  const second = await call(base, { headers: { Limit: '1', Cursor: first.body.nextCursor } }); assert.deepEqual(second.body.items.map(v => v.id), ['c-visible']); assert.equal(second.body.nextCursor, null);
  error(await call(`${base}/a-hidden`), 404, 'RESOURCE_NOT_FOUND'); error(await call(`${base}/d-hidden`), 404, 'RESOURCE_NOT_FOUND');
  const c = await call(`${base}/c-visible`); assert.equal(c.status, 200);
  error(await call(`${base}/c-visible/calculated-fields`, { method: 'PUT', body: [], headers: { 'If-Match': c.headers.etag } }), 404, 'RESOURCE_NOT_FOUND');
  const own = await call(base, { method: 'POST', body: create('mine', empty()) }); assert.equal(own.status, 201);
  assert.deepEqual((await f.metadata.get(await f.context(), { kind: 'analysis', id: 'mine' })).body.grants, [grant(m.identity.userId)]);
  // Imported absent-grant analyses preserve embedded-console author behavior.
  const imported = { definition: { AnalysisId: 'imported', Name: 'Imported', Definition: projectDefinition(empty()) }, datasets: [], folderId: null };
  await put(f, 'analysis', 'imported', imported); token = (await m.login()).token;
  assert.equal((await call(`${base}/imported/calculated-fields`, { method: 'PUT', body: [], headers: at(1) })).status, 200);
  await put(f, 'user', m.identity.userId, { name: 'Reader', role: 'reader' }); await f.renew(); token = (await m.login()).token;
  for (const [path, method, body] of [[base, 'GET'], [base, 'POST', create('reader', empty())], [`${base}/mine`, 'DELETE']]) {
    const r = await call(path, { method, body, headers: at(1) }); assert.equal(r.status, 403); assert.equal(typeof r.body.errorCode, 'string');
  }
  assert.equal((await f.request(`${base}/d-hidden`)).status, 200, 'administrator behavior is retained');
});

test('v1 analyses access: cross-owner/tenant bindings, forged principals and replay cannot grant data access', async t => {
  const f = await hosted(t), m = await member(f), options = { method: 'POST', body: create(), headers: { 'Idempotency-Key': 'private-analysis' } };
  assert.equal((await f.request(base, options)).status, 201);
  await changeAsset(f, 'analysis', { grants: [grant(m.identity.userId)] }); await f.renew();
  const token = (await m.login()).token;
  error(await f.call(`${base}/analysis`, { token }), 422, 'SECURITY_REJECTED', true);
  error(await f.call(`${base}/analysis/calculated-fields`, { token, method: 'PUT', body: [], headers: at(2) }), 422, 'SECURITY_REJECTED', true);
  error(await f.call(base, { ...options, token }), 404, 'RESOURCE_NOT_FOUND', true);
  // An editor cannot replace someone else's bindings with an empty definition.
  const replacement = create('analysis', empty()); delete replacement.analysisId;
  error(await f.call(`${base}/analysis`, { token, method: 'PUT', body: replacement, headers: at(2) }), 422, 'SECURITY_REJECTED', true);
  const other = await otherTenant(f);
  error(await f.call(`${base}/analysis`, { token: other }), 404, 'RESOURCE_NOT_FOUND');
  error(await f.call(base, { ...options, token: other }), 404, 'RESOURCE_NOT_FOUND', true);
  for (const key of ['x-user-id', 'x-tenant-id', 'x-namespace-id', 'x-role']) error(await f.request(base, { headers: { [key]: 'forged' } }), 403, 'FORGED_PRINCIPAL');
  for (const body of [{ ...create('bad'), ownerId: m.identity.userId }, { ...create('bad'), datasetBindings: { sales: { kind: 'prepared-dataset', id: 'sales', ownerId: m.identity.userId } } }]) error(await f.request(base, { method: 'POST', body }), 422, 'SECURITY_REJECTED', true);
});

test('v1 analyses revocation immediately before read, save and replay is enforced', async t => {
  const f = await hosted(t), m = await member(f);
  let token = (await m.login()).token;
  const call = (path, options = {}) => f.call(path, { token, ...options });
  const body = create('mine', empty()), options = { method: 'POST', body, headers: { 'Idempotency-Key': 'mine' } };
  assert.equal((await call(base, options)).status, 201);
  await changeAsset(f, 'mine', { grants: [] }); await f.renew(); token = (await m.login()).token;
  error(await call(`${base}/mine`), 404, 'RESOURCE_NOT_FOUND');
  error(await call(`${base}/mine/calculated-fields`, { method: 'PUT', body: [], headers: at(2) }), 404, 'RESOURCE_NOT_FOUND');
  error(await call(base, options), 404, 'RESOURCE_NOT_FOUND');
  // Revocation between schema admission and transactional save aborts the write.
  assert.equal((await f.request(base, { method: 'POST', body: create('race') })).status, 201);
  const original = HostedPrep.prototype.describe; let revoked = false;
  t.mock.method(HostedPrep.prototype, 'describe', async function (context, ...args) {
    const result = await original.call(this, context, ...args);
    if (!revoked) { revoked = true; await this.data.sources.metadata.put(await f.context(), { kind: 'user', id: f.identity.userId }, { name: 'Demoted', role: 'reader' }, (await f.metadata.get(await f.context(), { kind: 'user', id: f.identity.userId })).version); }
    return result;
  });
  const r = await f.request(`${base}/race/calculated-fields`, { method: 'PUT', body: [], headers: at(1) }); assert.ok([401, 403].includes(r.status), JSON.stringify(r.body));
  const row = await f.db.transaction(c => c.query("SELECT version FROM h1_resources WHERE kind = 'analysis' AND resource_id = 'race'")); assert.equal(row[0].version, 1);
});

test('v1 analyses legacy dataset bindings check denied columns, missing policies and source owner; deletes preserve published definitions', async t => {
  const f = await hosted(t);
  await put(f, 'dataset', 'sales', { definition: { DataSet: { DataSetId: 'sales' } }, sources: [{ kind: 'source', id: f.source.id, ownerId: f.identity.userId }] }); await f.renew();
  const input = create('legacy', draft(), 'dataset'); assert.equal((await f.request(base, { method: 'POST', body: input })).status, 201);
  await put(f, 'policy', 'deny-private', { datasetId: 'sales', dataSetArn: 'urn:synthetic:sales', rowLevel: false, rowRules: [], protectedColumns: ['private'], columnGrants: [] }); await f.renew();
  const invalid = { ...input, analysisId: 'invalid', definition: { ...draft(), calculatedFields: [calc('unused', '{private}')] } };
  error(await f.request(base, { method: 'POST', body: invalid }), 422, 'COLUMN_ACCESS_DENIED', true);
  const definition = { DashboardId: 'published', Name: 'Published', Definition: projectDefinition(input.definition) };
  await put(f, 'dashboard', 'published', { definition, datasets: [{ kind: 'dataset', id: 'sales' }], folderId: null }); await f.renew();
  assert.equal((await f.request(`${base}/legacy`, { method: 'DELETE', headers: at(1) })).status, 200);
  assert.deepEqual((await f.metadata.get(await f.context(), { kind: 'dashboard', id: 'published' })).body.definition, definition);
  await put(f, 'dataset', 'unresolved-policy', { definition: { DataSet: { DataSetId: 'unresolved-policy', RowLevelPermissionDataSet: {} } }, sources: [{ kind: 'source', id: f.source.id, ownerId: f.identity.userId }] }); await f.renew();
  error(await f.request(base, { method: 'POST', body: { ...input, analysisId: 'missing-policy', datasetBindings: { sales: { kind: 'dataset', id: 'unresolved-policy' } } } }), 422, 'SECURITY_REJECTED', true);
});

test('v1 analyses tenant-wide rate limits cover all thirteen operations and share the datasets bucket', async t => {
  const f = await hosted(t, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '1' }), m = await member(f), token = (await m.login()).token;
  assert.equal((await f.request('/api/v1/datasets')).status, 200);
  const endpoints = [['GET', base], ['GET', `${base}/a`], ['POST', base], ['PUT', `${base}/a`], ['DELETE', `${base}/a`], ['POST', `${base}/a/sheets/s/visuals`], ['PUT', `${base}/a/sheets/s/visuals/v`], ['DELETE', `${base}/a/sheets/s/visuals/v`], ['PUT', `${base}/a/sheets/s/layouts`], ['POST', `${base}/a/filter-groups`], ['PUT', `${base}/a/filter-groups/f`], ['DELETE', `${base}/a/filter-groups/f`], ['PUT', `${base}/a/calculated-fields`]];
  for (const [method, path] of endpoints) {
    const r = await f.call(path, { method, token }); error(r, 429, 'RATE_LIMIT_EXCEEDED'); assert.ok(Number(r.headers['retry-after']) >= 1);
  }
  const tenantToken = await otherTenant(f); assert.equal((await f.call(base, { token: tenantToken })).status, 200);
});

test('v1 analyses write admission: HTTP errors, SQL injection, all unused calculations and identical mutation diagnostics', async t => {
  const f = await hosted(t); assert.equal((await f.request(base, { method: 'POST', body: create() })).status, 201);
  for (const expression of ['SELECT * FROM secrets', 'pg_sleep(1)', '{amount}; DROP TABLE sales', '{region} + 1', '{missing}']) {
    const fields = [calc('unused', expression)], whole = create('analysis'); whole.definition.calculatedFields = fields; delete whole.analysisId;
    const a = await f.request(`${base}/analysis`, { method: 'PUT', body: whole, headers: at(1) });
    const b = await f.request(`${base}/analysis/calculated-fields`, { method: 'PUT', body: fields, headers: at(1) });
    error(a, 422, undefined, true); assert.deepEqual(a.body, b.body);
  }
  for (const body of [null, [], {}, { ...create('bad'), definition: { ...draft(), options: 'wrong' } }, { ...create('bad'), definition: { ...draft(), sheets: [{ sheetId: 'bad', name: 1 }] } }, { ...create('bad'), definition: { ...draft(), sheets: [{ sheetId: 'bad', visuals: [{ kpiVisual: { visualId: 'bad', chartConfiguration: { fieldWells: { values: 'wrong' } } } }] }] } }, { ...create('bad'), Name: 'wrong' }, { ...create('bad'), definition: projectDefinition(draft()) }, { ...create('bad'), datasetBindings: {} }, { ...create('bad'), datasetBindings: { sales: { kind: 'prepared-dataset', id: 'sales' }, extra: { kind: 'dataset', id: 'sales' } } }]) error(await f.request(base, { method: 'POST', body }), 422, undefined, true);
  for (const body of [{ ...create('bad'), sql: 'SELECT 1' }, { ...create('bad'), definition: { ...draft(), extension: { customSql: 'SELECT 1' } } }]) error(await f.request(base, { method: 'POST', body }), 422, 'UNSUPPORTED_FEATURE', true);
  error(await f.request(base, { method: 'POST', rawBody: '{' }), 400, 'HOSTED_REQUEST_INVALID');
  error(await f.request(`${base}/analysis`, { method: 'DELETE', body: {}, headers: at(1) }), 400, 'ASSET_INVALID_INPUT');
  error(await f.request(`${base}/analysis/sheets/sheet/visuals`, { method: 'PUT', body: visual(), headers: at(1) }), 405, 'METHOD_NOT_ALLOWED');
  error(await f.request(`${base}/analysis/visuals/new`, { method: 'POST', body: visual(), headers: at(1) }), 404, 'RESOURCE_NOT_FOUND');
  for (const header of [{ Limit: '0' }, { Limit: '1001' }, { Cursor: 'not-a-cursor' }]) error(await f.request(base, { headers: header }), 400, 'INVALID_PAGINATION');
  const draftVisual = { kpiVisual: { visualId: 'draft', chartConfiguration: { fieldWells: { values: [] } } } };
  const added = await f.request(`${base}/analysis/sheets/sheet/visuals`, { method: 'POST', body: draftVisual, headers: at(1) }); assert.equal(added.status, 200, JSON.stringify(added.body)); assert.equal(added.body.Errors.length, 1);
  assert.deepEqual((await f.request(`${base}/analysis`)).body.Errors, added.body.Errors);
  error(await f.request(`${base}/analysis/sheets/sheet/visuals/draft`, { method: 'PUT', body: visual('different'), headers: at(2) }), 422, 'INVALID_INPUT', true);
  const measure = { kpiVisual: { visualId: 'draft', chartConfiguration: { fieldWells: { values: [{ calculatedMeasureField: { fieldId: 'calculated', expression: 'pg_sleep(1)' } }] } } } };
  error(await f.request(`${base}/analysis/sheets/sheet/visuals/draft`, { method: 'PUT', body: measure, headers: at(2) }), 422, 'UNSUPPORTED_FEATURE', true);
  measure.kpiVisual.chartConfiguration.fieldWells.values[0].calculatedMeasureField.expression = 'sum({amount}) * 2';
  assert.equal((await f.request(`${base}/analysis/sheets/sheet/visuals/draft`, { method: 'PUT', body: measure, headers: at(2) })).status, 200);
  const literal = [calc('literal', "'SELECT * FROM secrets; DROP TABLE sales'")];
  assert.equal((await f.request(`${base}/analysis/calculated-fields`, { method: 'PUT', body: literal, headers: at(3) })).status, 200);
});

test('v1 analyses local authenticated authors persist creator grants, versions and delete tombstones', async t => {
  const f = await local(t, directory => ({ security: {
    storePath: join(directory, 'security.json'),
    authenticate: req => ['author', 'peer', 'admin', 'reader'].includes(req.headers.authorization?.slice(7)) ? { namespaceId: 'default', userId: req.headers.authorization.slice(7) } : undefined,
    initialState: { version: 1, namespaces: [{ id: 'default', name: 'Default' }], users: ['author', 'peer', 'admin', 'reader'].map(id => ({ id, namespaceId: 'default', name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' })), groups: [], datasets: [] },
  } }));
  const auth = user => ({ Authorization: `Bearer ${user}` });
  const input = create('owned', empty());
  assert.equal((await f.request(base, { method: 'POST', body: input, headers: auth('author') })).status, 201);
  error(await f.request(`${base}/owned`, { headers: auth('peer') }), 404);
  const saved = JSON.parse(await readFile(join(f.directory, 'security.json'), 'utf8'));
  assert.deepEqual(saved.assets.find(a => a.id === 'owned').grants, [grant('author')]);
  await f.restart(); assert.equal((await f.request(`${base}/owned`, { headers: auth('author') })).headers.etag, '"1"');
  const legacy = await f.request('/analyses/owned/definition', { headers: auth('author') }); assert.equal(legacy.status, 200);
  error(await f.request(base, { method: 'POST', body: create('denied', empty()), headers: auth('reader') }), 403);
  assert.equal((await f.request(`${base}/owned/calculated-fields`, { method: 'PUT', body: [], headers: { ...auth('author'), ...at(1) } })).headers.etag, '"2"');
  assert.equal((await f.request(`${base}/owned`, { method: 'DELETE', headers: { ...auth('author'), ...at(2) } })).status, 200);
  await f.restart(); error(await f.request(`${base}/owned`, { headers: auth('admin') }), 404);
  assert.equal((await f.request(base, { method: 'POST', body: input, headers: auth('peer') })).status, 201);
  error(await f.request(`${base}/owned`, { headers: auth('author') }), 404);
});

test('v1 analyses local prepared bindings use the authenticated local owner and persist with durable prep/upload stores', async t => {
  const f = await local(t, directory => ({ localData: true, localUploadPath: join(directory, 'uploads.duckdb'), prepStorePath: join(directory, 'prep.json') }));
  const source = upload(); delete source.policy; delete source.expiresAt;
  const staged = await f.request('/api/uploads', { method: 'POST', body: source }); assert.equal(staged.status, 201, JSON.stringify(staged.body));
  const prepared = await f.request('/api/datasets/sales-prepared/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: staged.body.id, steps: [] } } }); assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
  const input = create('local-prepared'); input.datasetBindings.sales.id = 'sales-prepared'; input.definition.sheets[0].visuals = [visual()];
  const created = await f.request(base, { method: 'POST', body: input }); assert.equal(created.status, 201, JSON.stringify(created.body));
  await f.restart(); assert.deepEqual((await f.request(`${base}/local-prepared`)).body, created.body);
});

test('v1 analyses replay rechecks current dataset policy, and deletion replay cannot delete a recreated ID', async t => {
  const f = await hosted(t), options = { method: 'POST', body: create(), headers: { 'Idempotency-Key': 'creation' } };
  assert.equal((await f.request(base, options)).status, 201);
  const bound = await f.request(`/api/sources/${f.source.id}/bind`, { method: 'POST', body: { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } } }); assert.equal(bound.status, 200); await f.renew();
  error(await f.request(base, options), 403, 'PREP_SECURITY_REJECTED', true);
  // Deletion replay has its own authorization snapshot and never writes twice.
  const clean = create('recreated', empty()); assert.equal((await f.request(base, { method: 'POST', body: clean })).status, 201);
  const del = { method: 'DELETE', headers: { ...at(1), 'Idempotency-Key': 'remove' } };
  assert.equal((await f.request(`${base}/recreated`, del)).status, 200);
  assert.equal((await f.request(base, { method: 'POST', body: clean })).status, 201);
  error(await f.request(`${base}/recreated`, del), 409, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.request(`${base}/recreated`)).status, 200);
});

test('v1 analyses OpenAPI pins all approved operations and the closed dataset binding schema', async () => {
  const yaml = await readFile(new URL('../../../docs/api/openapi-v1.yaml', import.meta.url), 'utf8');
  const analysisPaths = yaml.slice(yaml.indexOf('  /analyses:'), yaml.indexOf('  /datasets:'));
  assert.deepEqual([...analysisPaths.matchAll(/operationId: (\w+)/g)].map(m => m[1]).sort(), ['list_analyses', 'describe_analysis', 'create_analysis', 'update_analysis', 'delete_analysis', 'add_visual', 'update_visual', 'remove_visual', 'set_layouts', 'add_filter_group', 'update_filter_group', 'remove_filter_group', 'set_calculated_fields'].sort());
  const bindings = yaml.slice(yaml.indexOf('    DatasetBindings:'), yaml.indexOf('    AnalysisCreate:'));
  assert.match(bindings, /kind: \{ const: dataset \}/); assert.match(bindings, /kind: \{ const: prepared-dataset \}/);
  assert.equal([...bindings.matchAll(/additionalProperties: false/g)].length, 2); assert.equal([...bindings.matchAll(/required: \[kind, id\]/g)].length, 2);
});

test('v1 analyses every approved mutation replays once, preserves ETags, and requires current preconditions', async t => {
  const f = await local(t);
  let version = 0, index = 0;
  const mutate = async (path, method, body, removed = false) => {
    const isCreate = path === base;
    if (!isCreate) {
      error(await f.request(path, { method, body }), 428, 'V1_IF_MATCH_REQUIRED');
      error(await f.request(path, { method, body, headers: { 'If-Match': 'bad' } }), 400, 'V1_IF_MATCH_INVALID');
      error(await f.request(path, { method, body, headers: at(version + 10) }), removed ? 412 : 409, removed ? 'ASSET_PRECONDITION_FAILED' : 'METADATA_CONFLICT');
    }
    const options = { method, body, headers: { ...(isCreate ? {} : at(version)), 'Idempotency-Key': `operation-${++index}` } };
    const [first, replay] = await Promise.all([f.request(path, options), f.request(path, options)]);
    assert.equal(first.status, isCreate ? 201 : 200, JSON.stringify(first.body)); assert.deepEqual(replay.body, first.body); assert.equal(replay.headers['idempotent-replayed'], 'true');
    if (!removed) { version++; assert.equal(first.headers.etag, `"${version}"`); assert.equal(replay.headers.etag, first.headers.etag); }
  };
  const path = `${base}/replay`, body = create('replay', empty());
  await mutate(base, 'POST', body);
  const { analysisId, ...replacement } = body; await mutate(path, 'PUT', { ...replacement, name: 'Changed' });
  await mutate(`${path}/sheets/sheet/visuals`, 'POST', { kpiVisual: { visualId: 'draft' } });
  await mutate(`${path}/sheets/sheet/visuals/draft`, 'PUT', { kpiVisual: { visualId: 'draft', chartConfiguration: { fieldWells: { values: [] } } } });
  await mutate(`${path}/sheets/sheet/layouts`, 'PUT', [{ configuration: { gridLayout: { elements: [{ elementId: 'draft', elementType: 'VISUAL' }] } } }]);
  const group = { filterGroupId: 'group', status: 'ENABLED', filters: [], scopeConfiguration: { allSheets: {} } };
  await mutate(`${path}/filter-groups`, 'POST', group); await mutate(`${path}/filter-groups/group`, 'PUT', { ...group, status: 'DISABLED' });
  await mutate(`${path}/filter-groups/group`, 'DELETE'); await mutate(`${path}/calculated-fields`, 'PUT', []);
  await mutate(`${path}/sheets/sheet/layouts`, 'PUT', []); await mutate(`${path}/sheets/sheet/visuals/draft`, 'DELETE'); await mutate(path, 'DELETE', undefined, true);
});

test('v1 analyses dependencies include action targets, selected fields and dangling sort fields', () => {
  const d = draft(); d.sheets[0].visuals = [visual('source'), visual('target')];
  d.sheets[0].visuals[0].kpiVisual.actions = [{ customActionId: 'action', name: 'Filter', status: 'ENABLED', trigger: 'DATA_POINT_CLICK', actionOperations: [{ filterOperation: { selectedFieldsConfiguration: { selectedFields: ['value'] }, targetVisualsConfiguration: { sameSheetTargetVisualConfiguration: { targetVisuals: ['target'] } } } }] }];
  valid(d); d.sheets[0].visuals.pop(); invalid(d, 'UNRESOLVED_BINDING');
  d.sheets[0].visuals[0].kpiVisual.actions[0].actionOperations[0].filterOperation.targetVisualsConfiguration.sameSheetTargetVisualConfiguration.targetVisuals = ['source'];
  d.sheets[0].visuals[0].kpiVisual.actions[0].actionOperations[0].filterOperation.selectedFieldsConfiguration.selectedFields = ['gone']; invalid(d, 'UNRESOLVED_BINDING');
  delete d.sheets[0].visuals[0].kpiVisual.actions;
  d.sheets[0].visuals[0].kpiVisual.chartConfiguration.sortConfiguration = { fieldSort: { fieldId: 'gone', direction: 'ASC' } }; invalid(d, 'UNRESOLVED_BINDING');
});

test('v1 analyses unsupported query semantics are visible as diagnostics even when field wells are complete', () => {
  const d = draft(); d.sheets[0].visuals = [visual()];
  d.filterGroups = [{ filterGroupId: 'group', status: 'ENABLED', crossDataset: 'SINGLE_DATASET', scopeConfiguration: { allSheets: {} }, filters: [{ numericRangeFilter: { filterId: 'numeric', column: { dataSetIdentifier: 'sales', columnName: 'amount' }, rangeMinimum: { staticValue: 10 } } }] }];
  assert.ok(valid(d).Errors.length > 0);
  d.filterGroups[0].filters[0].numericRangeFilter.operator = 'OR 1=1'; invalid(d, 'UNSUPPORTED_FEATURE');
});


test('v1 analyses concurrent creates cannot commit different identities under one retry key', async t => {
  for (const f of [await hosted(t), await local(t)]) {
    const requests = ['first', 'second'].map(id => ({ method: 'POST', headers: { 'Idempotency-Key': 'one-create-key' }, body: create(id, empty()) }));
    const replies = await Promise.all(requests.map(options => f.request(base, options)));
    assert.deepEqual(replies.map(r => r.status).sort(), [201, 409]);
    const loser = replies.findIndex(r => r.status === 409), winner = 1 - loser;
    error(replies[loser], 409, 'IDEMPOTENCY_CONFLICT');
    error(await f.request(`${base}/${requests[loser].body.analysisId}`), 404);
    const replay = await f.request(base, requests[winner]);
    assert.equal(replay.status, 201); assert.equal(replay.headers['idempotent-replayed'], 'true');
    assert.deepEqual(replay.body, replies[winner].body);
  }
});


test('v1 analyses local prepared owner pins reject same-ID substitution even by administrators', async t => {
  const f = await local(t, directory => ({ prepStorePath: join(directory, 'prep.json'), security: {
    storePath: join(directory, 'security.json'),
    authenticate: req => ['author', 'admin'].includes(req.headers.authorization?.slice(7)) ? { namespaceId: 'default', userId: req.headers.authorization.slice(7) } : undefined,
    initialState: { version: 1, namespaces: [{ id: 'default', name: 'Default' }], users: ['author', 'admin'].map(id => ({ id, namespaceId: 'default', name: id, role: id === 'admin' ? 'administrator' : 'author' })), groups: [], datasets: [] },
  } }));
  const auth = user => ({ Authorization: `Bearer ${user}` });
  for (const user of ['author', 'admin']) {
    const source = { config: { format: 'csv' }, base64: Buffer.from('region,amount\nEast,2\n').toString('base64') };
    const staged = await f.request('/api/uploads', { method: 'POST', body: source, headers: auth(user) }); assert.equal(staged.status, 201, JSON.stringify(staged.body));
    const prepared = await f.request('/api/datasets/owner-data/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: staged.body.id, steps: [] } }, headers: auth(user) }); assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
  }
  const input = create(); input.datasetBindings.sales.id = 'owner-data';
  assert.equal((await f.request(base, { method: 'POST', body: input, headers: auth('author') })).status, 201);
  assert.equal((await f.request(`${base}/analysis`, { headers: auth('author') })).status, 200);
  const saved = JSON.parse(await readFile(join(f.directory, 'security.json'), 'utf8'));
  assert.equal(saved.assets.find(a => a.id === 'analysis').datasetBindingOwnerId, 'author');
  for (const options of [{}, { method: 'PUT', body: { name: 'Rebind', definition: draft(), datasetBindings: input.datasetBindings } }]) {
    error(await f.request(`${base}/analysis`, { ...options, headers: { ...auth('admin'), ...at(1) } }), 422, 'SECURITY_REJECTED', true);
  }
  error(await f.request(base, { method: 'POST', body: { ...create('forged'), definition: { ...draft(), datasetBindingOwnerId: 'author' } }, headers: auth('admin') }), 422, 'SECURITY_REJECTED', true);
  await f.restart();
  error(await f.request(`${base}/analysis`, { headers: auth('admin') }), 422, 'SECURITY_REJECTED', true);
  // D-59 authorizes definition deletion independently of prepared-data access.
  assert.equal((await f.request(`${base}/analysis`, { method: 'DELETE', headers: { ...auth('admin'), ...at(1) } })).status, 200);
});
