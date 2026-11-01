import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { initializeIdeas, submitIdea, myIdeas, listIdeas, limitIdeas, transitionIdea } from '../dist/ideas.js';
import { readOperatorAudit } from '../dist/operator-audit.js';
import { createApiServer } from '../dist/index.js';
import { readFileSync } from 'node:fs';
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
import { publicPath, adaptGatewayRequest, validateViewerRequest } from '../dist/runtime-ingress.js';
import { runtimeEnv, event } from './runtime-helpers.mjs';

const valid = { title: ' A useful improvement ', description: ' Let me explain.\nMore detail here. ', surface: 'data-empty' };
const context = (namespaceId = 'one', userId = 'admin') => ({ tenantId: `tenant-${namespaceId}`, namespaceId, userId, authorizationRevision: 1 });
const error = (response, status, code) => { assert.equal(response.status, status); assert.equal(response.body.errorCode, code); };
async function setup(t, extra = {}) {
  const f = await h8Fixture(t);
  await f.db.transaction(async c => {
    await c.query("INSERT INTO h2_identities (subject,email,status) VALUES ('other','other@example.test','active')");
    await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES ('other','tenant-one','one','other','active')");
  });
  const serving = await serveH8(t, f, { security: { authenticate: async req => req.headers.authorization === 'other' ? { namespaceId: 'one', userId: 'other' }
    : ['one', 'two'].includes(req.headers.authorization) ? { namespaceId: req.headers.authorization, userId: 'admin' } : undefined }, ...extra });
  const submit = (body = valid, user = 'one') => serving.request('/api/ideas', { method: 'POST', headers: { authorization: user }, body });
  const mine = (user = 'one', path = '/api/ideas') => serving.request(path, { headers: { authorization: user } });
  const transition = (id, body, headers = serving.operator) => serving.request(`/api/host/ideas/${id}`, { method: 'PATCH', headers, body });
  return { ...f, ...serving, submit, mine, transition };
}

test('ideas store trusted identity/version, trimmed text, initial status and newest-first private list', async t => {
  const f = await setup(t);
  const first = await submitIdea(f.db, context(), valid, 1000), second = (await f.submit()).body;
  assert.equal(first.title, valid.title.trim()); assert.equal(first.description, valid.description.trim());
  assert.equal(first.productVersion, packageInfo.version); assert.equal(first.userId, 'admin'); assert.equal(first.name, 'admin');
  assert.equal(first.email, 'one@example.test'); assert.equal(first.tenantId, 'tenant-one'); assert.equal(first.status, 'received');
  assert.equal(first.createdAt, first.updatedAt); assert.equal(first.declineNote, null); assert.equal(first.shippedReference, null);
  assert.deepEqual((await f.mine()).body.ideas.map(i => i.id), [second.id, first.id]);
  await initializeIdeas(f.db); assert.equal((await myIdeas(f.db, context())).length, 2);
});

test('idea validation requires bounded text and surface; rejects control characters and forged fields', async t => {
  const f = await setup(t);
  for (const [key, max] of [['title', 160], ['description', 10000], ['surface', 80]]) {
    for (const value of [undefined, null, 42, '', '  ', 'x'.repeat(max + 1), 'a\0b']) {
      await assert.rejects(submitIdea(f.db, context(), { ...valid, [key]: value }), { code: 'IDEA_INVALID', status: 400 });
    }
    assert.equal((await submitIdea(f.db, context(), { ...valid, [key]: 'x'.repeat(max) }))[key].length, max);
  }
  for (const key of ['title', 'surface']) await assert.rejects(submitIdea(f.db, context(), { ...valid, [key]: 'one\ntwo' }), { code: 'IDEA_INVALID' });
  for (const body of [{ ...valid, userId: 'other' }, { ...valid, tenantId: 'tenant-two' }, { ...valid, productVersion: 'forged' }, { ...valid, status: 'accepted' }]) {
    const response = await f.submit(body); assert.ok([400, 403].includes(response.status));
  }
  assert.equal((await f.mine()).body.ideas.length, 3);
});

test('all legal transitions, terminal states, decline reasons, shipped reference and atomic operator audit', async t => {
  const f = await setup(t);
  for (const target of ['accepted', 'declined', 'shipped']) {
    const idea = await submitIdea(f.db, context(), valid);
    error(await f.transition(idea.id, { status: target }), target === 'accepted' ? 409 : 400,
      target === 'accepted' ? 'IDEA_TRANSITION_INVALID' : target === 'declined' ? 'IDEA_DECLINE_REASON_REQUIRED' : 'IDEA_SHIPPED_REFERENCE_REQUIRED');
    assert.equal((await f.transition(idea.id, { status: 'under_review' })).body.status, 'under_review');
    const details = target === 'declined' ? { declineCategory: 'not-aligned', declineNote: ' Outside the product scope. ' }
      : target === 'shipped' ? { shippedReference: ' https://example.test/releases/1 ' } : {};
    const response = await f.transition(idea.id, { status: target, ...details }); assert.equal(response.status, 200); assert.equal(response.body.status, target);
    if (target === 'accepted') assert.equal((await f.transition(idea.id, { status: 'shipped', shippedReference: 'Release 1' })).body.status, 'shipped');
    else if (target === 'declined') assert.equal(response.body.declineNote, 'Outside the product scope.');
    else assert.equal(response.body.shippedReference, 'https://example.test/releases/1');
    error(await f.transition(idea.id, { status: 'under_review' }), 409, 'IDEA_TRANSITION_INVALID');
  }
  const audit = (await readOperatorAudit(f.db)).filter(e => e.action === 'idea.transitioned');
  assert.equal(audit.length, 7); assert.ok(audit.every(e => e.actor === 'deployment-operator' && e.tenantId === 'tenant-one' && e.subject && e.createdAt));
});

test('transition matrix fails closed, including stale concurrent transitions and unknown ideas', async t => {
  const f = await setup(t);
  const states = ['received', 'under_review', 'accepted', 'declined', 'shipped'];
  const legal = { received: ['under_review'], under_review: ['accepted', 'declined', 'shipped'], accepted: ['shipped'], declined: [], shipped: [] };
  for (const from of states) for (const to of states) {
    const idea = await submitIdea(f.db, context(), valid);
    await f.db.transaction(c => c.query('UPDATE h8_ideas SET status = ? WHERE id = ?', [from, idea.id]));
    const body = { status: to, ...(to === 'declined' ? { declineCategory: 'duplicate', declineNote: 'Already tracked.' } : {}), ...(to === 'shipped' ? { shippedReference: 'Release 1' } : {}) };
    const response = await f.transition(idea.id, body);
    if (legal[from].includes(to)) assert.equal(response.status, 200); else error(response, 409, 'IDEA_TRANSITION_INVALID');
  }
  const idea = await submitIdea(f.db, context(), valid);
  const responses = await Promise.all([f.transition(idea.id, { status: 'under_review' }), f.transition(idea.id, { status: 'under_review' })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  error(await f.transition('missing', { status: 'under_review' }), 404, 'IDEA_NOT_FOUND');
  error(await f.transition(idea.id, { status: 'building' }), 400, 'IDEA_STATUS_INVALID');
});

test('declines need a fixed category and one-line note; shipped needs bounded reference; invalid edits leave state intact', async t => {
  const f = await setup(t), idea = await submitIdea(f.db, context(), valid);
  await f.transition(idea.id, { status: 'under_review' });
  for (const body of [
    { status: 'declined' }, { status: 'declined', declineCategory: 'unknown', declineNote: 'Reason' },
    ...[undefined, '', ' ', 'a\nb', 'a\rb', 'x'.repeat(501)].map(declineNote => ({ status: 'declined', declineCategory: 'later', declineNote })),
    ...[undefined, '', ' ', 42, 'x'.repeat(501)].map(shippedReference => ({ status: 'shipped', shippedReference })),
    { status: 'accepted', declineNote: 'Not allowed' }, { status: 'accepted', shippedReference: 'Not allowed' },
  ]) assert.equal((await f.transition(idea.id, body)).status, 400);
  assert.equal((await f.mine()).body.ideas[0].status, 'under_review');
  assert.equal((await readOperatorAudit(f.db)).filter(e => e.action === 'idea.transitioned').length, 1);
});

test('durable per-user rate cap returns named 429, survives server recreation, separates users and expires', async t => {
  const f = await setup(t);
  for (let i = 0; i < 5; i++) assert.equal((await f.submit()).status, 201);
  error(await f.submit(), 429, 'IDEA_RATE_LIMITED');
  const restarted = await serveH8(t, f);
  error(await restarted.request('/api/ideas', { method: 'POST', headers: { authorization: 'one' }, body: valid }), 429, 'IDEA_RATE_LIMITED');
  assert.equal((await f.submit(valid, 'other')).status, 201); assert.equal((await f.submit(valid, 'two')).status, 201);
  await limitIdeas(f.db, context(), Date.now() + 600001);
  await f.db.transaction(c => c.query("DELETE FROM h2_attempts WHERE bucket LIKE 'idea:%'"));
  for (let i = 0; i < 5; i++) assert.equal((await f.submit({})).status, 400);
  error(await f.submit(), 429, 'IDEA_RATE_LIMITED');
});

test('privacy bypasses: only the caller sees own ideas, never peers or other tenants; members cannot transition', async t => {
  const f = await setup(t), one = (await f.submit()).body, other = (await f.submit(valid, 'other')).body, two = (await f.submit(valid, 'two')).body;
  for (const [user, own] of [['one', one], ['other', other], ['two', two]]) {
    assert.deepEqual((await f.mine(user)).body.ideas.map(i => i.id), [own.id]);
    for (const foreign of [one, other, two].filter(i => i.id !== own.id)) {
      assert.equal((await f.mine(user, `/api/ideas/${foreign.id}`)).status, 404);
      error(await f.transition(foreign.id, { status: 'under_review' }, { authorization: user }), 403, 'OPERATOR_REQUIRED');
      assert.equal((await f.request(`/api/ideas/${foreign.id}`, { method: 'PATCH', headers: { authorization: user }, body: { status: 'under_review' } })).status, 404);
    }
    error(await f.mine(user, '/api/host/ideas'), 403, 'OPERATOR_REQUIRED');
  }
  error(await f.mine('one', '/api/namespaces/two/ideas'), 404, 'RESOURCE_NOT_FOUND');
  assert.deepEqual((await f.request('/api/ideas', { headers: { authorization: 'one', 'idea-tenant': 'tenant-two', 'idea-status': 'shipped' } })).body.ideas.map(i => i.id), [one.id]);
  error(await f.mine('one', '/api/ideas?userId=other'), 400, 'HOSTED_REQUEST_INVALID');
  error(await f.request('/api/ideas', { headers: { authorization: 'one', 'x-user-id': 'other' } }), 403, 'FORGED_PRINCIPAL');
  error(await f.request('/api/ideas'), 401, 'PRINCIPAL_REQUIRED');
  await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed' WHERE subject = 'other'"));
  error(await f.mine('other'), 401, 'AUTHENTICATION_FAILED');
  await assert.rejects(submitIdea(f.db, context('one', 'other'), valid), { code: 'PRINCIPAL_REQUIRED' });
});

test('operator list filters and same-origin UI are authorized without weakening neighboring operator routes', async t => {
  const f = await setup(t), one = (await f.submit()).body; await f.submit(valid, 'two');
  await f.transition(one.id, { status: 'under_review' });
  const request = headers => f.request('/api/host/ideas', { headers: { ...f.operator, ...headers } });
  assert.equal((await request({})).body.ideas.length, 2);
  assert.deepEqual((await request({ 'idea-status': 'under_review', 'idea-tenant': 'tenant-one' })).body.ideas.map(i => i.id), [one.id]);
  assert.deepEqual((await request({ 'idea-status': 'shipped' })).body.ideas, []);
  error(await request({ 'idea-status': 'unknown' }), 400, 'IDEA_STATUS_INVALID');
  error(await request({ 'idea-tenant': "tenant-one' OR 1=1" }), 400, 'IDEA_FILTER_INVALID');
  assert.equal((await request({ origin: f.env.OPENSIGHT_PUBLIC_ORIGIN })).status, 200);
  assert.equal((await f.transition(one.id, { status: 'accepted' }, { ...f.operator, origin: f.env.OPENSIGHT_PUBLIC_ORIGIN })).status, 200);
  error(await request({ origin: 'https://foreign.example' }), 403, 'UNTRUSTED_ORIGIN');
  error(await f.request('/api/host/access-requests', { headers: { ...f.operator, origin: f.env.OPENSIGHT_PUBLIC_ORIGIN } }), 403, 'OPERATOR_REQUIRED');
});

test('local and unconfigured API fail closed with IDEAS_HOSTED_ONLY for all idea paths', async t => {
  for (const options of [{}, { localData: true }]) {
    const server = await createApiServer({ dataRoot: fileURLToPath(new URL('../../../fixtures', import.meta.url)), ...options });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    for (const path of ['/api/ideas', '/api/ideas/someone-elses', '/api/host/ideas', '/api/namespaces/one/ideas']) for (const method of ['GET', 'POST', 'PATCH']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, ...(method !== 'GET' ? { body: JSON.stringify(valid) } : {}) });
      assert.equal(response.status, 409); assert.equal((await response.json()).errorCode, 'IDEAS_HOSTED_ONLY');
    }
  }
});

test('serverless tenant ingress admits Ideas GET/POST while operator queue stays private', () => {
  const env = runtimeEnv();
  for (const path of ['/api/api/ideas', '/api/api/namespaces/one/ideas']) {
    assert.match(publicPath(path), /ideas$/);
    validateViewerRequest({ protocol: 'https', uri: path, querystring: {}, headers: { host: { value: 'opensight.example' } } }, env.OPENSIGHT_PUBLIC_ORIGIN);
    for (const method of ['GET', 'POST']) assert.match(adaptGatewayRequest(event(path, method, method === 'POST' ? valid : undefined), env).path, /ideas$/);
  }
  assert.throws(() => publicPath('/api/api/host/ideas'), { code: 'RESOURCE_NOT_FOUND' });
});

test('invocation Ideas route uses existing schema without runtime DDL', async t => {
  const f = await setup(t);
  const db = { durable: true, transaction: work => f.db.transaction(c => work({ query: (sql, args) => { assert.doesNotMatch(sql, /^(CREATE|ALTER|DROP) /); return c.query(sql, args); } })), close: async () => {} };
  const invoked = await serveH8(t, f, { membershipDatabase: db, invocation: { signal: new AbortController().signal } });
  const response = await invoked.request('/api/ideas', { method: 'POST', headers: { authorization: 'one' }, body: valid });
  assert.equal(response.status, 201); assert.equal((await f.mine()).body.ideas[0].id, response.body.id);
});
