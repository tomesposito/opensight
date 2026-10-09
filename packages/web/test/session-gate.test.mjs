import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { SessionGate, SESSION_TIMEOUT_MS } from '../build/test/SessionGate.js';
import { SignIn } from '../build/test/SignIn.js';
import { FirstRun } from '../build/test/FirstRun.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { Author } from '../build/test/Author.js';
import { DataPrep } from '../build/test/DataPrep.js';
import { DataSources } from '../build/test/DataSources.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { AccessProvider, demoAccess, useAccess } from '../build/test/access.js';
import { ApiError, createApiClient } from '../build/test/api-client.js';

const registered = { id: 'registered', namespaceId: 'workspace', name: 'Registered user', role: 'author' };
const missing = () => { throw new ApiError('private details', 503, 'SECURITY_NOT_CONFIGURED'); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function Probe() { return createElement('output', { 'data-access': useAccess() }, 'Existing application'); }

async function mount(t, element) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const events = new EventTarget();
  const storage = new Map();
  globalThis.window = {
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    setInterval: (...args) => setInterval(...args), clearInterval: id => clearInterval(id),
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(async () => { renderer = create(element); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { renderer, focus: () => act(async () => events.dispatchEvent(new Event('focus'))) };
}
const gate = (client, offline = false) => createElement(SessionGate, { client, offline }, createElement(Probe));
const first = ui => ui.renderer.root.findByType(FirstRun);
const signin = ui => ui.renderer.root.findByType(SignIn);

test('missing security blocks application mount until the user explicitly chooses samples', async t => {
  let calls = 0;
  const ui = await mount(t, gate({ async getSession() { calls++; return missing(); } }));
  assert.equal(first(ui).props.issue, 'not-configured');
  assert.equal(ui.renderer.root.findAllByType(Probe).length, 0);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /private details/);
  await act(async () => first(ui).props.onDemo());
  assert.equal(ui.renderer.root.findByType('output').props['data-access'].mode, 'demo');
  assert.equal(ui.renderer.root.findByType('output').props['data-access'].aiClient, undefined);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Public samples only.*No hosted session/);
  await ui.focus();
  assert.equal(calls, 1);
  await act(async () => ui.renderer.root.findByType('button').props.onClick());
  assert.equal(calls, 2);
  assert.equal(first(ui).props.issue, 'not-configured');
});

test('valid configured session preserves registered identity, capabilities and client', async t => {
  const client = { async getSession() { return registered; }, getAIStatus() {} };
  const ui = await mount(t, gate(client));
  assert.deepEqual(ui.renderer.root.findByType('output').props['data-access'], { mode: 'hosted', session: registered, aiClient: client });
  assert.equal(ui.renderer.root.findAllByType(FirstRun).length, 0);
  assert.equal(ui.renderer.root.findAllByType('aside').length, 0);
});

test('rejected credentials and outages get distinct recovery screens; explicit retry succeeds', async t => {
  let failure = new ApiError('private session details', 401);
  const ui = await mount(t, gate({ async getSession() { if (failure) throw failure; return registered; } }));
  assert.equal(signin(ui).props.onSignIn instanceof Function, true);
  failure = new TypeError('connection refused');
  await act(async () => signin(ui).props.onRetry());
  assert.equal(first(ui).props.issue, 'unavailable');
  failure = undefined;
  await act(async () => first(ui).props.onRetry());
  assert.equal(ui.renderer.root.findByType('output').props['data-access'].mode, 'hosted');
});

test('focus revocation removes the app, explicit retry recovers, and demo stops polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let valid = true, calls = 0;
  const ui = await mount(t, gate({ async getSession() { calls++; if (valid) return registered; throw new ApiError('Expired', 403); } }));
  valid = false;
  await ui.focus();
  assert.equal(signin(ui).props.onSignIn instanceof Function, true);
  assert.equal(ui.renderer.root.findAllByType(Probe).length, 0);
  valid = true;
  await act(async () => signin(ui).props.onRetry());
  assert.equal(ui.renderer.root.findAllByType(Probe).length, 1);
  valid = false;
  await ui.focus();
  await act(async () => signin(ui).props.onDemo());
  const before = calls;
  await act(async () => t.mock.timers.tick(90_000));
  assert.equal(calls, before);
});

test('slow session requests time out into actionable recovery and abort on unmount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let signal;
  const ui = await mount(t, gate({ getSession(value) { signal = value; return new Promise((_, reject) => value.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } }));
  // The landing page must not flash during the first check — a minimal loading state shows instead.
  assert.equal(ui.renderer.root.findAllByType(FirstRun).length, 0);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Checking your workspace/);
  await ui.focus(); // Does not start a duplicate request.
  await act(async () => t.mock.timers.tick(SESSION_TIMEOUT_MS));
  assert.equal(signal.aborted, true);
  assert.equal(first(ui).props.checking, false);
  assert.equal(first(ui).props.issue, 'unavailable');
  await act(async () => first(ui).props.onRetry());
  assert.equal(signal.aborted, false);
  await act(async () => ui.renderer.unmount());
  assert.equal(signal.aborted, true);
});

test('late hosted responses cannot replace an opted-in demo or a newer request', async t => {
  const requests = [];
  const ui = await mount(t, gate({ getSession(signal) { const value = deferred(); requests.push({ ...value, signal }); return value.promise; } }));
  // The demo escape hatch is available in the loading state during the first check.
  const demoButton = ui.renderer.root.findAllByType('button').find(b => b.children?.includes('Explore sample data'));
  assert.ok(demoButton, 'loading state offers the sample-data escape hatch');
  await act(async () => demoButton.props.onClick());
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => ui.renderer.root.findByType('button').props.onClick());
  assert.equal(requests.length, 2);
  await act(async () => requests[0].resolve(registered));
  assert.equal(ui.renderer.root.findAllByType(Probe).length, 0);
  await act(async () => requests[1].reject(new ApiError('Missing', 503, 'SECURITY_NOT_CONFIGURED')));
  assert.equal(first(ui).props.issue, 'not-configured');
});

test('static offline build never resolves a session and has no startup screen', async t => {
  const ui = await mount(t, gate({ getSession() { assert.fail('offline auth request'); } }, true));
  assert.equal(ui.renderer.root.findByType('output').props['data-access'].mode, 'demo');
  assert.equal(ui.renderer.root.findAllByType(FirstRun).length, 0);
  await ui.focus();
});

test('fixture application never supplies API clients, even when API/admin modes are forced', async t => {
  const api = createApiClient('/api', () => { assert.fail('demo issued an API request'); });
  const fixtures = ['other', 'renderable-sales'].map(id => ({ id, name: id, description: '', provenance: '', notice: '', sheets: [] }));
  const ui = await mount(t, createElement(AccessProvider, { access: demoAccess }, createElement(Application, { api, fixtures })));
  assert.equal(ui.renderer.root.findByType(Dashboard).props.fixture.id, 'renderable-sales');
  const choose = mode => act(async () => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: mode }));
  await choose('security');
  assert.equal(ui.renderer.root.findByProps({ 'aria-disabled': 'true' }).props.children, 'API definition preview · Needs hosted API');
  for (const [mode, Component] of [['author', Author], ['data-prep', DataPrep], ['data-sources', DataSources]]) {
    await choose(mode);
    assert.equal(ui.renderer.root.findByType(Component).props.client, undefined);
  }
  for (const mode of ['api', 'ai-settings', 'users']) {
    await choose(mode);
    assert.match(JSON.stringify(ui.renderer.toJSON()), mode === 'api' ? /Needs hosted API/ : /SECURITY_ADMIN_REQUIRED/);
  }
});

test('configured author retains its API client and the original initial fixture', async t => {
  const api = createApiClient('/api', async () => Response.json({ lastGood: null, state: 'never', error: null, datasetId: 'sales' }));
  const fixtures = ['other', 'renderable-sales'].map(id => ({ id, name: id, description: '', provenance: '', notice: '', sheets: [] }));
  const ui = await mount(t, createElement(AccessProvider, { access: { mode: 'hosted', session: registered } }, createElement(Application, { api, fixtures })));
  assert.equal(ui.renderer.root.findByType(Dashboard).props.fixture.id, 'renderable-sales');
  await act(() => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: 'security' }));
  assert.equal(ui.renderer.root.findAllByType('a').some(a => a.props.href === '#/admin/developer/api'), true);
  await act(async () => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: 'fixtures' }));
  assert.equal(ui.renderer.root.findByType(Dashboard).props.fixture.id, 'other');
  await act(async () => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: 'author' }));
  assert.equal(ui.renderer.root.findByType(Author).props.client, api);
});

test('explicit local capability opens file workspace without inventing a session or AI identity', async t => {
  let available = true;
  const ui = await mount(t, gate({ getSession: missing, async getLocalData() { return available; } }));
  assert.deepEqual(ui.renderer.root.findByType('output').props['data-access'], { mode: 'local' });
  available = false;
  await ui.focus();
  assert.equal(first(ui).props.issue, 'not-configured');
  assert.equal(ui.renderer.root.findAllByType(Probe).length, 0);
});
test('rejected hosted sessions never probe or fall back to local data', async t => {
  const ui = await mount(t, gate({ getSession() { throw new ApiError('Rejected', 401, 'AUTHENTICATION_FAILED'); }, getLocalData() { assert.fail('No local fallback for rejected auth'); } }));
  assert.equal(signin(ui).props.onSignIn instanceof Function, true);
});
test('local capability transport validates explicit mode and respects abort', async () => {
  const signal = new AbortController().signal;
  for (const [body, status, expected] of [[{ mode: 'local', maxUploadBytes: 8388608, uploadTtlSeconds: 86400 }, 200, true], [{ mode: 'hosted' }, 200, false], [{ mode: 'local' }, 200, false], [{}, 503, false]]) {
    const client = createApiClient('/', async (url, options) => {
      assert.equal(url, '/api/local-data'); assert.equal(options.signal, signal);
      return Response.json(body, { status });
    });
    assert.equal(await client.getLocalData(signal), expected);
  }
});
