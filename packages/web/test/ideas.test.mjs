import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { Ideas } from '../build/test/Ideas.js';
import { OperatorIdeas } from '../build/test/OperatorIdeas.js';
import { DataLanding } from '../build/test/DataLanding.js';
import { createApiClient } from '../build/test/api-client.js';
import { ideaReferenceUrl } from '../build/test/ideas.js';
import { parseRoute, routeHash } from '../build/test/app-navigation.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const access = { mode: 'hosted', session: { id: 'u', name: 'Synthetic Member', tenantId: 'tenant-one', namespaceId: 'one', role: 'reader' } };
const idea = { id: 'idea-1', tenantId: 'tenant-one', namespaceId: 'one', userId: 'u', name: 'Synthetic Member', email: 'member@example.test', title: 'Useful improvement', description: 'A detailed suggestion.', surface: 'ideas', productVersion: '0.0.0', status: 'received', declineCategory: null, declineNote: null, shippedReference: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
async function mount(t, Component, props = {}, currentAccess = access) {
  let ui;
  const element = a => createElement(AccessProvider, { access: a }, createElement(Component, props));
  await act(async () => { ui = create(element(currentAccess)); });
  t.after(() => act(() => ui.unmount()));
  return { get root() { return ui.root; }, text: () => JSON.stringify(ui.toJSON()), update: a => act(() => ui.update(element(a))) };
}
const button = (ui, name) => ui.root.findAllByType('button').find(node => node.children.join('') === name);
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
const field = (ui, label) => ui.root.findAllByType('label').find(node => node.children[0] === label).find(node => ['input', 'textarea', 'select'].includes(node.type));
const submit = (ui, name) => act(async () => ui.root.findByProps({ 'aria-label': name }).props.onSubmit({ preventDefault() {} }));

test('Ideas are hosted-only, including static preview and self-hosted sessions without tenant context', async t => {
  for (const mode of ['local', 'demo', 'hosted']) {
    let calls = 0;
    const ui = await mount(t, Ideas, { client: { listMyIdeas() { calls++; }, submitIdea() { calls++; } } }, { mode });
    assert.match(ui.text(), /Ideas need a hosted workspace/); assert.match(ui.text(), /GitHub issues/);
    assert.equal(ui.root.findAllByType('form').length, 0); assert.equal(calls, 0);
  }
  const ui = await mount(t, Ideas);
  assert.match(ui.text(), /Ideas need a hosted workspace/);
});

test('member form sends only title, description and surface; success resets, failures preserve text', async t => {
  let items = [], calls = [], fail = false;
  const client = { listMyIdeas: async () => ({ ideas: items }), submitIdea: async input => { calls.push(input); if (fail) throw Error('IDEA_RATE_LIMITED'); items = [{ ...idea, ...input }]; return items[0]; } };
  const ui = await mount(t, Ideas, { client, surface: 'data-empty' });
  assert.match(ui.text(), /A human reviews every idea/); assert.match(ui.text(), /Nothing is built automatically/);
  assert.equal(ui.root.findAllByType('input').length, 1); assert.equal(ui.root.findAllByType('textarea').length, 1);
  assert.ok(button(ui, 'Submit idea').props.disabled);
  await change(field(ui, 'Title'), ' Improve datasets '); await change(field(ui, 'Description'), ' More context ');
  fail = true; await submit(ui, 'Suggest an idea');
  assert.match(ui.text(), /IDEA_RATE_LIMITED/); assert.equal(field(ui, 'Title').props.value, ' Improve datasets ');
  fail = false; await submit(ui, 'Suggest an idea');
  assert.deepEqual(calls[1], { title: 'Improve datasets', description: 'More context', surface: 'data-empty' });
  assert.equal(field(ui, 'Title').props.value, ''); assert.equal(field(ui, 'Description').props.value, '');
  assert.match(ui.text(), /Idea received/); assert.match(ui.text(), /Received/); assert.match(ui.text(), /Improve datasets/);
});

test('private list renders every plain status, decline reason and safe shipped references', async t => {
  const items = Object.keys({ received: 1, under_review: 1, accepted: 1, declined: 1, shipped: 1 }).map((status, i) => ({ ...idea, id: String(i), status, declineCategory: 'not-aligned', declineNote: 'Outside the product scope.', shippedReference: 'https://example.test/releases/1' }));
  const ui = await mount(t, Ideas, { client: { listMyIdeas: async () => ({ ideas: items }) } });
  for (const label of ['Received', 'Under review', 'Accepted', 'Declined', 'Shipped', 'Outside the product scope.']) assert.match(ui.text(), new RegExp(label));
  assert.equal(ui.root.findByType('a').props.href, 'https://example.test/releases/1');
  for (const ref of ['javascript:alert(1)', 'data:text/html,unsafe', '//example.test', 'Release 1', 'https://user:password@example.test']) assert.equal(ideaReferenceUrl(ref), undefined);
  assert.equal(ideaReferenceUrl('https://example.test/releases/1'), 'https://example.test/releases/1');
});

test('an in-flight submission is sent once and prevents editing', async t => {
  let finish, calls = 0;
  const ui = await mount(t, Ideas, { client: { listMyIdeas: async () => ({ ideas: [] }), submitIdea: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } });
  await change(field(ui, 'Title'), 'Title'); await change(field(ui, 'Description'), 'Description');
  await submit(ui, 'Suggest an idea'); await submit(ui, 'Suggest an idea');
  assert.equal(calls, 1); assert.ok(field(ui, 'Title').props.disabled); assert.ok(button(ui, 'Submitting…').props.disabled);
  await act(async () => finish(idea)); assert.match(ui.text(), /Idea received/);
});

test('late private-list responses are discarded when workspace or member changes', async t => {
  const pending = [];
  const client = { listMyIdeas: signal => new Promise(resolve => pending.push({ signal, resolve })) };
  const ui = await mount(t, Ideas, { client });
  await ui.update({ ...access, session: { ...access.session, id: 'other' } });
  assert.equal(pending[0].signal.aborted, true);
  await act(async () => pending[0].resolve({ ideas: [idea] })); assert.doesNotMatch(ui.text(), /Useful improvement/);
  await act(async () => pending[1].resolve({ ideas: [] })); assert.match(ui.text(), /No ideas submitted yet/);
});

test('list failures show an error with retry instead of stale successful content', async t => {
  let fail = true;
  const ui = await mount(t, Ideas, { client: { listMyIdeas: async () => { if (fail) throw Error('PRINCIPAL_REQUIRED'); return { ideas: [] }; } } });
  assert.match(ui.text(), /PRINCIPAL_REQUIRED/); assert.doesNotMatch(ui.text(), /No ideas submitted yet/);
  fail = false; await act(async () => button(ui, 'Refresh ideas').props.onClick()); assert.match(ui.text(), /No ideas submitted yet/);
});

test('data empty states offer suggestions only with a hosted client and route preserves originating surface', async t => {
  const route = { page: 'ideas', ideaSurface: 'data-empty' }; assert.deepEqual(parseRoute(routeHash(route)), route);
  const client = { listPrepDatasets: async () => ({ datasets: [], persistence: 'durable' }), listPrepSources: async () => [] };
  for (const mode of ['demo', 'local', 'hosted']) for (const connected of [true, false]) for (const initialTab of ['Datasets', 'Data sources']) {
    let clicked = 0;
    const ui = await mount(t, DataLanding, { client: connected ? client : undefined, initialTab, onSuggestIdea: () => clicked++ }, { ...access, mode });
    const suggest = button(ui, 'Suggest an idea'); assert.equal(!!suggest, mode === 'hosted' && connected);
    if (suggest) { await act(() => suggest.props.onClick()); assert.equal(clicked, 1); }
  }
  const legacy = await mount(t, DataLanding, { client, onSuggestIdea() {} }, { ...access, session: { ...access.session, tenantId: undefined } });
  assert.equal(button(legacy, 'Suggest an idea'), undefined);
});

test('API client uses authenticated transport, preserves named rate errors and sends no user-supplied identity', async () => {
  const calls = [], client = createApiClient('/api', async (url, options) => { calls.push({ url, options }); return Response.json(options.method === 'POST' ? { errorCode: 'IDEA_RATE_LIMITED' } : { ideas: [idea] }, { status: options.method === 'POST' ? 429 : 200 }); });
  assert.deepEqual(await client.listMyIdeas(), { ideas: [idea] });
  await assert.rejects(client.submitIdea({ title: 'Title', description: 'Description', surface: 'ideas' }), { status: 429, errorCode: 'IDEA_RATE_LIMITED' });
  assert.equal(calls[0].url, '/api/api/ideas'); assert.equal(calls[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[1].options.body), { title: 'Title', description: 'Description', surface: 'ideas' });
});

test('operator queue filters, reviews with mandatory reasons/references and uses separate in-memory authorization', async t => {
  let saved = { ...idea }, calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options }); assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, 'Operator synthetic-test-key');
    if (options.method === 'PATCH') { saved = { ...saved, ...JSON.parse(options.body) }; return Response.json(saved); }
    return Response.json({ ideas: [saved] });
  };
  const ui = await mount(t, OperatorIdeas, { fetcher });
  await change(field(ui, 'Operator credential'), 'synthetic-test-key'); await submit(ui, 'Operator connection');
  assert.equal(field(ui, 'Operator credential').props.value, ''); assert.match(ui.text(), /Useful improvement/);
  await change(field(ui, 'Status'), 'received'); await change(field(ui, 'Tenant ID'), 'tenant-one'); await submit(ui, 'Filter ideas');
  assert.equal(calls.at(-1).options.headers['Idea-Status'], 'received'); assert.equal(calls.at(-1).options.headers['Idea-Tenant'], 'tenant-one');
  await submit(ui, `Review ${idea.title}`); assert.equal(saved.status, 'under_review');
  await change(field(ui, 'Next status'), 'declined'); assert.ok(button(ui, 'Update status').props.disabled);
  await change(field(ui, 'Decline category'), 'duplicate'); await change(field(ui, 'Decline note'), 'Tracked already.');
  await submit(ui, `Review ${idea.title}`); assert.equal(saved.declineNote, 'Tracked already.'); assert.equal(saved.status, 'declined');
  assert.equal(button(ui, 'Update status'), undefined); assert.match(ui.text(), /Idea status updated/);
  saved = { ...idea, status: 'accepted' }; await submit(ui, 'Filter ideas'); assert.ok(button(ui, 'Update status').props.disabled);
  await change(field(ui, 'Shipped reference'), 'Release 1'); await submit(ui, `Review ${idea.title}`); assert.equal(saved.status, 'shipped'); assert.equal(saved.shippedReference, 'Release 1');
  await act(() => button(ui, 'Disconnect').props.onClick()); assert.doesNotMatch(ui.text(), /Useful improvement/);
});

test('operator queue never displays an optimistic transition on an API error', async t => {
  const fetcher = async (_url, options) => Response.json(options.method === 'PATCH' ? { errorCode: 'IDEA_TRANSITION_INVALID' } : { ideas: [idea] }, { status: options.method === 'PATCH' ? 409 : 200 });
  const ui = await mount(t, OperatorIdeas, { fetcher });
  await change(field(ui, 'Operator credential'), 'synthetic'); await submit(ui, 'Operator connection'); await submit(ui, `Review ${idea.title}`);
  assert.match(ui.text(), /IDEA_TRANSITION_INVALID/); assert.doesNotMatch(ui.text(), /Idea status updated/);
});
