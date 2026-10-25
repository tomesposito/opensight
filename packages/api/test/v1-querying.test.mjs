import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authFixture, decode32 } from './hosted-helpers.mjs';
import { totp } from '../dist/auth-crypto.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { upload } from './source-helpers.mjs';
import { serving } from './v1-helpers.mjs';

const path = '/api/v1/datasets/sales/query';
const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }],
  measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const expected = { columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }],
  rows: [{ region: 'east', total: 40 }, { region: 'west', total: 20 }] };

async function fixture(t, env = {}, sourceInput = upload()) {
  const f = await authFixture(t), call = await serving(t, f, env);
  let token = (await f.login()).token;
  const request = (url, options = {}) => call(url, { token, ...options });
  const mutate = async (url, options) => {
    const r = await request(url, options);
    assert.ok(r.status < 400, JSON.stringify(r.body));
    token = (await f.login()).token;
    return r;
  };
  const source = (await mutate('/api/uploads', { method: 'POST', body: sourceInput })).body;
  // Seed through the unversioned API; v1 limiter tests start with a fresh bucket.
  await mutate('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales',
    pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } });
  return { ...f, call, request, mutate, source, renew: async () => { token = (await f.login()).token; },
    run: (body = query, options = {}) => request(path, { method: 'POST', body, ...options }) };
}

function error(r, status, code) {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.errorCode, code);
  assert.equal(typeof r.body.errorCode, 'string');
  assert.equal('rows' in r.body, false);
}
function shape(body, cached = false) {
  assert.deepEqual(Object.keys(body).sort(), cached ? ['columns', 'execution', 'rows'] : ['columns', 'rows']);
  for (const c of body.columns) {
    assert.deepEqual(Object.keys(c).sort(), ['name', 'type']);
    assert.equal(typeof c.name, 'string');
    assert.ok(['string', 'number'].includes(c.type));
  }
  for (const row of body.rows) {
    assert.deepEqual(Object.keys(row).sort(), body.columns.map(c => c.name).sort());
    for (const c of body.columns) assert.ok(row[c.name] === null || typeof row[c.name] === c.type);
  }
  if (cached) assert.deepEqual(body.execution, { mode: 'BLAZE', cached: true });
}

test('v1 querying: exact direct result shape and unchanged unversioned endpoint', async t => {
  const f = await fixture(t), r = await f.run();
  assert.equal(r.status, 200); shape(r.body); assert.deepEqual(r.body, expected);
  assert.deepEqual((await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).body, expected);
  const filtered = await f.run({ ...query, filters: [{ columnName: 'region', value: 'east' }] });
  assert.deepEqual(filtered.body, { ...expected, rows: [expected.rows[0]] });
  // Queries do not gain the list endpoint's pagination envelope.
  assert.deepEqual((await f.run(query, { headers: { Limit: '1' } })).body, expected);
});

test('v1 querying: BLAZE provenance and cold/stale cache fail closed', async t => {
  const f = await fixture(t);
  await f.mutate('/api/datasets/sales/execution', { method: 'PUT', body: { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 } });
  error(await f.run(), 429, 'BLAZE_NOT_READY');
  assert.equal((await f.request('/api/datasets/sales/refresh', { method: 'POST', body: {} })).status, 200);
  const r = await f.run(); assert.equal(r.status, 200); shape(r.body, true);
  assert.deepEqual(r.body, { ...expected, execution: { mode: 'BLAZE', cached: true } });
  assert.deepEqual((await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).body, expected);
  await f.mutate(`/api/sources/${f.source.id}/bind`, { method: 'POST', body: { expectedVersion: 1, policy: { rowLevel: false, rowRules: [] } } });
  error(await f.run(), 429, 'BLAZE_NOT_READY');
});

test('v1 querying: SQL payloads and nested injection attempts are rejected with located, named errors', async t => {
  const f = await fixture(t), sql = 'SELECT * FROM sales; DROP TABLE sales; --';
  const bodyAttacks = [sql, { sql }, { query: sql }, { ...query, sql }, { ...query, where: '1=1' },
    { ...query, query }, { ...query, dimensions: [{ ...query.dimensions[0], sql }] },
    { ...query, measures: [{ ...query.measures[0], expression: sql }] },
    { ...query, filters: [{ columnName: 'region', value: 'east', sql }] },
    { ...query, filters: [{ columnName: 'region', value: 'east', operator: 'OR 1=1' }] },
    { ...query, parameterDeclarations: [{ name: 'Region', type: 'string', multiple: false, sql }] }];
  for (const body of bodyAttacks) {
    const r = await f.run(body); error(r, 400, 'HOSTED_REQUEST_INVALID');
    assert.equal(typeof r.body.path, 'string');
  }
  for (const [body, code] of [
    [{ ...query, dimensions: [{ fieldId: 'region', columnName: 'region"; DROP TABLE sales; --' }] }, 'UNRESOLVED_BINDING'],
    [{ ...query, measures: [{ ...query.measures[0], aggregation: 'SUM); DROP TABLE sales; --' }] }, 'UNSUPPORTED_FEATURE'],
    [{ ...query, filters: [{ columnName: 'region OR 1=1', value: 'east' }] }, 'UNRESOLVED_BINDING'],
    [{ ...query, calculatedFields: [{ name: 'injected', expression: sql }], measures: [{ fieldId: 'bad', columnName: 'injected', aggregation: 'SUM' }] }, 'TYPE_MISMATCH'],
  ]) {
    const r = await f.run(body);
    error(r, 422, code);
    assert.equal(typeof r.body.path, 'string'); assert.equal('rows' in r.body, false);
  }
  error(await f.run(query, { rawBody: sql, headers: { 'Content-Type': 'text/plain' } }), 400, 'HOSTED_REQUEST_INVALID');
  assert.deepEqual((await f.run()).body, expected, 'injections cannot change data or the query engine');
});

test('v1 querying: parameter filters bind values as data and retain shared query semantics', async t => {
  const f = await fixture(t), selection = { ...query, filters: [{ columnName: 'region', parameterName: 'Region' }],
    parameterDeclarations: [{ name: 'Region', type: 'string', multiple: false }], parameterBindings: { Region: ['east'] } };
  assert.deepEqual((await f.run(selection)).body, { ...expected, rows: [expected.rows[0]] });
  // SQL-looking literals are valid data: neither concatenated SQL nor a blacklist.
  for (const filters of [[{ columnName: 'region', value: "east' OR 1=1 --" }], [{ columnName: 'region', values: ["east' OR 1=1 --"] }]]) {
    assert.deepEqual((await f.run({ ...query, filters })).body, { ...expected, rows: [] });
  }
  assert.deepEqual((await f.run({ ...selection, parameterBindings: { Region: ["east' OR 1=1 --"] } })).body, { ...expected, rows: [] });
  error(await f.run({ ...selection, parameterBindings: {} }), 400, 'HOSTED_REQUEST_INVALID');
  error(await f.run({ ...selection, parameterBindings: { Region: ['east'], SQL: ['SELECT *'] } }), 400, 'HOSTED_REQUEST_INVALID');
  const range = { ...query, filters: [{ columnName: 'amount', parameterName: 'Minimum', operator: 'GREATER_THAN_OR_EQUAL_TO' }],
    parameterDeclarations: [{ name: 'Minimum', type: 'number', multiple: false }], parameterBindings: { Minimum: [20] } };
  assert.deepEqual((await f.run(range)).body.rows, [{ region: 'east', total: 30 }, { region: 'west', total: 20 }]);
  error(await f.run({ ...range, parameterBindings: { Minimum: ['0 OR 1=1'] } }), 400, 'HOSTED_REQUEST_INVALID');
  const calculation = await f.run({ ...query, calculatedFields: [{ name: 'twice', expression: '{amount} * 2' }],
    measures: [{ fieldId: 'total', columnName: 'twice', aggregation: 'SUM' }] });
  assert.deepEqual(calculation.body.rows, [{ region: 'east', total: 80 }, { region: 'west', total: 40 }]);
});

test('v1 querying: null cells and empty results preserve declared column types', async t => {
  const source = { ...upload(), base64: Buffer.from('region,amount,private\neast,10,a\n,20,b\nwest,,c\n').toString('base64') };
  const f = await fixture(t, {}, source), r = await f.run();
  assert.equal(r.status, 200); shape(r.body);
  assert.ok(r.body.rows.some(row => row.region === null));
  assert.ok(r.body.rows.some(row => row.total === null));
  const empty = await f.run({ ...query, filters: [{ columnName: 'region', values: [] }] });
  assert.deepEqual(empty.body, { ...expected, rows: [] }); shape(empty.body);
});

test('v1 querying: read POST idempotency rechecks admission and invalidates revised data', async t => {
  const f = await fixture(t), headers = { 'Idempotency-Key': 'query-once' };
  const first = await f.run(query, { headers }), replay = await f.run(query, { headers });
  assert.deepEqual(first.body, expected); assert.deepEqual(replay.body, expected);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
  error(await f.run({ ...query, sql: 'SELECT *' }, { headers }), 400, 'HOSTED_REQUEST_INVALID');
  error(await f.run(query, { headers: { 'Idempotency-Key': 'invalid key' } }), 400, 'METADATA_INVALID');
  await f.mutate('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales', expectedVersion: 1,
    pipeline: { version: 1, input: f.source.id, steps: [{ id: 'west', kind: 'filter', config: { filters: [{ columnName: 'region', value: 'west' }] } }] } } });
  const revised = await f.run(query, { headers });
  assert.deepEqual(revised.body, { ...expected, rows: [expected.rows[1]] });
  assert.equal(revised.headers['idempotent-replayed'], undefined);
  await f.mutate(`/api/sources/${f.source.id}/bind`, { method: 'POST', body: { expectedVersion: 1,
    policy: { rowLevel: true, rowRules: [] } } });
  error(await f.run(query, { headers }), 403, 'PREP_SECURITY_REJECTED');
});

test('v1 querying: retry keys reject different queries without replacing the original receipt', async t => {
  const f = await fixture(t), headers = { 'Idempotency-Key': 'filtered-once' };
  const east = { ...query, filters: [{ columnName: 'region', value: 'east' }] };
  const west = { ...query, filters: [{ columnName: 'region', value: 'west' }] };
  const first = await f.run(east, { headers });
  assert.equal(first.status, 200); assert.deepEqual(first.body, { ...expected, rows: [expected.rows[0]] });
  assert.equal(first.headers['idempotent-replayed'], undefined);
  const conflict = await f.run(west, { headers });
  error(conflict, 409, 'IDEMPOTENCY_CONFLICT');
  assert.equal(conflict.headers['idempotent-replayed'], undefined);
  const replay = await f.run(east, { headers });
  assert.equal(replay.status, 200); assert.deepEqual(replay.body, first.body);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
});

test('v1 querying: concurrent identical retries execute once and replay the same result', async t => {
  const f = await fixture(t), headers = { 'Idempotency-Key': 'concurrent-same' };
  const execute = t.mock.method(HostedPrep.prototype, 'execute');
  const replies = await Promise.all([f.run(query, { headers }), f.run(query, { headers })]);
  for (const r of replies) { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body, expected); }
  assert.equal(replies.filter(r => r.headers['idempotent-replayed'] === 'true').length, 1);
  assert.equal(execute.mock.callCount(), 1);
});

for (const budget of ['OPENSIGHT_RETRY_CACHE_MAX_BYTES', 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES']) {
  test(`v1 querying: ${budget} rejects oversized results without retaining a receipt`, async t => {
    const size = Buffer.byteLength(JSON.stringify({ fingerprint: '0'.repeat(64), status: 200, body: expected }));
    const f = await fixture(t, { [budget]: String(size - 1) }), headers = { 'Idempotency-Key': 'oversize' };
    const execute = t.mock.method(HostedPrep.prototype, 'execute');
    for (let i = 0; i < 2; i++) {
      const r = await f.run(query, { headers });
      error(r, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(r.headers['retry-after'], '60');
      assert.equal(r.headers['idempotent-replayed'], undefined);
    }
    assert.equal(execute.mock.callCount(), 2, 'oversized results execute but leave no receipt');
    const smaller = { ...query, filters: [{ columnName: 'region', values: [] }] };
    const first = await f.run(smaller, { headers }); assert.equal(first.status, 200); assert.deepEqual(first.body.rows, []);
    const replay = await f.run(smaller, { headers });
    assert.equal(replay.status, 200); assert.equal(replay.headers['idempotent-replayed'], 'true'); assert.deepEqual(replay.body, first.body);
    assert.equal(execute.mock.callCount(), 3);
  });
}

test('v1 querying: exhausted byte headroom rejects new execution while the stored result replays', async t => {
  const size = Buffer.byteLength(JSON.stringify({ fingerprint: '0'.repeat(64), status: 200, body: expected }));
  const f = await fixture(t, { OPENSIGHT_RETRY_CACHE_MAX_BYTES: String(size) }), headers = { 'Idempotency-Key': 'fits-exactly' };
  const execute = t.mock.method(HostedPrep.prototype, 'execute');
  assert.equal((await f.run(query, { headers })).status, 200);
  const blocked = await f.run(query, { headers: { 'Idempotency-Key': 'second' } });
  error(blocked, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(blocked.headers['retry-after'], '60');
  const replay = await f.run(query, { headers });
  assert.equal(replay.status, 200); assert.equal(replay.headers['idempotent-replayed'], 'true'); assert.deepEqual(replay.body, expected);
  assert.equal(execute.mock.callCount(), 1);
});

test('v1 querying: concurrent distinct keys reserve entry capacity before executing', async t => {
  const f = await fixture(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '1' });
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { finish = resolve; });
  t.after(() => finish());
  const original = HostedPrep.prototype.execute;
  const execute = t.mock.method(HostedPrep.prototype, 'execute', async function (...args) {
    entered(); await waiting; return original.apply(this, args);
  });
  const first = f.run(query, { headers: { 'Idempotency-Key': 'first' } }); await started;
  const blocked = await f.run(query, { headers: { 'Idempotency-Key': 'second' } });
  finish();
  error(blocked, 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED'); assert.equal(blocked.headers['retry-after'], '60');
  assert.equal((await first).status, 200); assert.equal(execute.mock.callCount(), 1);
});

test('v1 querying: concurrent different queries sharing a retry key conflict', async t => {
  const f = await fixture(t), headers = { 'Idempotency-Key': 'concurrent-different' };
  const execute = t.mock.method(HostedPrep.prototype, 'execute');
  const bodies = ['east', 'west'].map(value => ({ ...query, filters: [{ columnName: 'region', value }] }));
  const replies = await Promise.all(bodies.map(body => f.run(body, { headers })));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  for (const [i, r] of replies.entries()) {
    assert.equal(r.headers['idempotent-replayed'], undefined);
    if (r.status === 200) assert.deepEqual(r.body, { ...expected, rows: [expected.rows[i]] });
    else error(r, 409, 'IDEMPOTENCY_CONFLICT');
  }
  assert.equal(execute.mock.callCount(), 1);
});

test('v1 querying: failed execution leaves its retry key available to queued requests', async t => {
  const f = await fixture(t), headers = { 'Idempotency-Key': 'retry-after-failure' };
  const original = HostedPrep.prototype.execute;
  let fail = true;
  const execute = t.mock.method(HostedPrep.prototype, 'execute', async function (...args) {
    if (fail) { fail = false; throw new Error('temporary query failure'); }
    return original.apply(this, args);
  });
  const replies = await Promise.all([f.run(query, { headers }), f.run(query, { headers })]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 500]);
  for (const r of replies) {
    assert.equal(r.headers['idempotent-replayed'], undefined);
    if (r.status === 200) assert.deepEqual(r.body, expected);
    else error(r, 500, 'HOSTED_INTERNAL_ERROR');
  }
  const replay = await f.run(query, { headers });
  assert.equal(replay.status, 200); assert.deepEqual(replay.body, expected);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
  assert.equal(execute.mock.callCount(), 2);
});

test('v1 querying: authentication, methods, body boundary and unsupported routes have named errors', async t => {
  const f = await fixture(t);
  for (const token of [undefined, 'forged']) {
    const r = await f.call(path, { method: 'POST', body: query, token });
    assert.equal(r.status, 401); assert.equal(typeof r.body.errorCode, 'string');
  }
  error(await f.run({ ...query, userId: 'other' }), 403, 'FORGED_PRINCIPAL');
  error(await f.run(query, { headers: { 'X-Tenant-Id': 'other' } }), 403, 'FORGED_PRINCIPAL');
  error(await f.request(path), 405, 'METHOD_NOT_ALLOWED');
  error(await f.request(path, { method: 'DELETE' }), 405, 'METHOD_NOT_ALLOWED');
  error(await f.request(`${path}?limit=1`, { method: 'POST', body: query }), 400, 'HOSTED_REQUEST_INVALID');
  error(await f.run(query, { rawBody: '{' }), 400, 'HOSTED_REQUEST_INVALID');
  error(await f.run(query, { rawBody: JSON.stringify('x'.repeat(1024 * 1024)) }), 413, 'HOSTED_REQUEST_INVALID');
  error(await f.request('/api/v1/datasets/missing/query', { method: 'POST', body: query }), 404, 'RESOURCE_NOT_FOUND');
  for (const url of ['/api/v1/analyses/example/visuals/chart/query', '/api/v1/o/query']) {
    error(await f.request(url, { method: 'POST', body: {} }), 404, 'RESOURCE_NOT_FOUND');
  }
});

async function otherMember(f) {
  const email = 'other@example.test', password = randomBytes(24).toString('base64');
  await f.provisioning.inviteMember('other-member', f.tenant.tenantId, { email, name: 'Other', role: 'administrator' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await f.auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret);
  const code = () => totp(secret, Math.floor(f.clock() / 30000));
  await f.auth.accept(invitation, password, code(), 'local'); f.advance();
  const session = await f.auth.login(email, password, code(), f.tenant.tenantId, 'local'); f.advance();
  await f.renew(); return session.token;
}
async function otherTenant(f) {
  const other = await f.provisioning.provision('other-tenant', { ...f.input, name: 'Other tenant' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  const session = await f.auth.login(f.email, f.password, f.code(), other.tenantId, 'local'); f.advance();
  return session.token;
}

test('v1 querying: dataset and replay data cannot cross owner or tenant boundaries', async t => {
  const f = await fixture(t), member = await otherMember(f), tenant = await otherTenant(f), headers = { 'Idempotency-Key': 'private-result' };
  assert.deepEqual((await f.run(query, { headers })).body, expected);
  for (const token of [member, tenant]) error(await f.call(path, { method: 'POST', body: query, token, headers }), 404, 'RESOURCE_NOT_FOUND');
});

test('v1 querying: one tenant exhausting receipts does not block a second tenant', async t => {
  const f = await fixture(t, { OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES: '1' });
  const tenant = await f.provisioning.provision('budget-tenant', { ...f.input, name: 'Other tenant' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  let token;
  // Authenticate afresh after data revisions, in the second tenant.
  const renew = async () => { token = (await f.auth.login(f.email, f.password, f.code(), tenant.tenantId, 'local')).token; f.advance(); };
  await renew();
  const source = await f.call('/api/uploads', { token, method: 'POST', body: upload() }); assert.equal(source.status, 201);
  await renew();
  const prepared = await f.call('/api/datasets/sales/prep', { token, method: 'PUT', body: { name: 'Other sales', pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 0 } });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body)); await renew(); await f.renew();
  const headers = { 'Idempotency-Key': 'same-key' };
  assert.equal((await f.run(query, { headers })).status, 200);
  error(await f.run(query, { headers: { 'Idempotency-Key': 'overflow' } }), 429, 'IDEMPOTENCY_CAPACITY_EXCEEDED');
  const other = await f.call(path, { token, method: 'POST', body: query, headers });
  assert.equal(other.status, 200, JSON.stringify(other.body)); assert.deepEqual(other.body, expected);
  const replay = await f.call(path, { token, method: 'POST', body: query, headers });
  assert.equal(replay.headers['idempotent-replayed'], 'true');
});

test('v1 querying: rate limit is shared across users and v1 resources, isolated across tenants', async t => {
  const f = await fixture(t, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '2' });
  const member = await otherMember(f), tenant = await otherTenant(f);
  assert.equal((await f.run()).status, 200);
  assert.equal((await f.call('/api/v1/datasets', { token: member })).status, 200);
  const r = await f.run(); error(r, 429, 'RATE_LIMIT_EXCEEDED');
  assert.ok(Number(r.headers['retry-after']) >= 1 && Number(r.headers['retry-after']) <= 60);
  error(await f.call(path, { method: 'POST', body: query, token: member }), 429, 'RATE_LIMIT_EXCEEDED');
  assert.equal((await f.call('/api/v1/datasets', { token: tenant })).status, 200);
  assert.deepEqual((await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).body, expected);
});

test('v1 querying: policy revision during execution prevents publication', async t => {
  const f = await fixture(t), execute = HostedPrep.prototype.execute;
  t.mock.method(HostedPrep.prototype, 'execute', async function (context, ...args) {
    const result = await execute.call(this, context, ...args);
    await this.data.sources.bind(context, f.source.id, { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } });
    return result;
  });
  error(await f.run(), 401, 'AUTHENTICATION_FAILED');
});
