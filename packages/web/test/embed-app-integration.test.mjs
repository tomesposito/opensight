import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import App from '../build/test/App.js';
import { Author } from '../build/test/Author.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { fixture, prepared, input } from '../../api/test/embed-full-app-helpers.mjs';
import { embedAppClient } from '../build/test/embed-app-client.js';
import { AskOPage } from '../build/test/AskOPage.js';
import { AccessProvider } from '../build/test/access.js';
import { OEntry } from '../build/test/OEntry.js';
import { HostedAISettings } from '../../api/dist/hosted-ai-settings.js';

function testWindow(t, hash) {
  const previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const events = new EventTarget(), location = { hash };
  globalThis.window = { location, get localStorage() { throw Error('Embed must not use browser storage'); },
    history: { pushState: (_s, _t, hash) => { location.hash = hash; }, replaceState: (_s, _t, hash) => { location.hash = hash; } },
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(() => { globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct; });
  return location;
}

test('full-app real App mounts every allowed landing class through the scoped HTTP client', async t => {
  const f = await fixture(t); await prepared(f);
  const settings = new HostedAISettings(f.metadata, f.hostedConfig.encryptionKey.toString('base64'), {});
  await settings.save(await f.context(), { provider: 'openai', model: 'synthetic-model' });
  await settings.saveKey(await f.context(), { key: 'synthetic-test-only-not-a-credential' });
  const active = await f.open('/data');
  assert.equal((await active.app('/api/v1/analyses', 'POST', input())).status, 201);
  const published = await active.app('/api/v1/analyses/working/publish', 'POST', {}); assert.equal(published.status, 201);
  const client = embedAppClient({ app: async (path, init = {}) => {
    const result = await active.app(path, init.method, init.body ? JSON.parse(init.body) : undefined, Object.fromEntries(new Headers(init.headers)));
    return Response.json(result.body, { status: result.status, headers: result.headers });
  } });
  const location = testWindow(t, '#/data');
  const embedded = { api: client.api, session: await client.session(), embed: { storage: client.storage, loadAnalysis: client.loadAnalysis, authorizeRoute: client.authorizeRoute } };
  for (const [path, title] of [['/dashboards', 'Dashboards'], [`/dashboards/${published.body.DashboardId}`, 'Original'], ['/data', 'Data'], ['/analyses/author', null], ['/analyses/author/working', null], ['/data/preparation', 'Transformation pipeline'], ['/ask-o', 'Ask O']]) {
    location.hash = `#${path}`; let ui;
    try {
      await act(() => { ui = create(h(App, { embedded })); });
      const loaded = () => title ? ui.root.findAllByType('h1').some(node => node.props.children === title) : ui.root.findAllByType(Author).length === 1;
      for (let i = 0; i < 100 && !loaded(); i++) await act(() => new Promise(resolve => setTimeout(resolve, 20)));
      assert.ok(loaded(), `${path}: ${JSON.stringify(ui.toJSON()).slice(0, 1500)}`);
      assert.ok(!JSON.stringify(ui.toJSON()).includes('EMBED_SCOPE_DENIED'), path);
    } finally { if (ui) await act(() => ui.unmount()); }
  }
  client.clear();
});

test('full-app App opens real Author, edits and saves twice, then navigates under the same HTTP session', async t => {
  const f = await fixture(t); await prepared(f); const active = await f.open('/analyses/author');
  assert.equal((await active.app('/api/v1/analyses', 'POST', input())).status, 201);
  const client = embedAppClient({ app: async (path, init = {}) => {
    const result = await active.app(path, init.method, init.body ? JSON.parse(init.body) : undefined, Object.fromEntries(new Headers(init.headers)));
    return Response.json(result.body, { status: result.status, headers: result.headers });
  } });
  const previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const events = new EventTarget(), location = { hash: '#/analyses/author/working' };
  globalThis.window = { location, get localStorage() { throw Error('Embed must not use browser storage'); },
    history: { pushState: (_s, _t, hash) => { location.hash = hash; }, replaceState: (_s, _t, hash) => { location.hash = hash; } },
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui;
  t.after(async () => { if (ui) await act(() => ui.unmount()); globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct; client.clear(); });
  const embedded = { api: client.api, session: await client.session(), embed: { storage: client.storage, loadAnalysis: client.loadAnalysis, authorizeRoute: client.authorizeRoute } };
  await act(() => { ui = create(h(App, { embedded })); });
  const until = async condition => {
    for (let i = 0; i < 100 && !condition(); i++) await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    assert.ok(condition(), JSON.stringify(ui.toJSON()).slice(0, 1800));
  };
  await until(() => ui.root.findAllByType(Author).length === 1);
  const title = () => ui.root.findByProps({ className: 'analysis-title' }).findByType('input');
  assert.equal(title().props.value, 'Original');
  for (const name of ['First edit', 'Second edit']) {
    await act(() => title().props.onChange({ target: { value: name } }));
    await act(() => ui.root.findAllByType('button').find(b => b.props.children === 'Save analysis').props.onClick());
    await until(() => JSON.stringify(ui.toJSON()).includes('Analysis saved to this hosted workspace.'));
    assert.equal((await active.app('/analysis/working')).body.name, name);
    assert.equal(ui.root.findAllByType(Author).length, 1);
  }
  await act(() => ui.root.findByType(AppNavigation).props.navigate({ page: 'data' }));
  await until(() => location.hash === '#/data');
  assert.equal((await f.call(`${active.root}/status`, 'GET', undefined, active.auth)).status, 200);
});

test('full-app Ask O gives AI readers dashboard-scoped questions without authoring requests', async t => {
  const calls = [], definition = { dataSetIdentifierDeclarations: [{ identifier: 'data', dataSetArn: 'urn:opensight:dataset' }], sheets: [{ sheetId: 'sheet', visuals: [{ kpiVisual: {
    visualId: 'total', chartConfiguration: { fieldWells: { values: [{ numericalMeasureField: { fieldId: 'amount', column: { dataSetIdentifier: 'data', columnName: 'amount' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }] } },
  } }] }] };
  const client = {
    listDashboards: async () => [{ id: 'shared', name: 'Shared dashboard', version: 1 }],
    getPublishedDashboard: async id => ({ id, name: 'Shared dashboard', version: 1, definition, errors: [] }),
    listPrepSources: async () => { throw Error('Reader must not request authoring resources'); },
    queryO: async (query, id) => { calls.push({ query, id }); return { rows: [Object.fromEntries(query.measures.map(m => [m.fieldId, 3]))] }; },
  };
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui;
  t.after(async () => { if (ui) await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct; });
  await act(() => { ui = create(h(AccessProvider, { access: { mode: 'hosted', session: { id: 'reader', namespaceId: 'space', role: 'reader_ai', name: 'Reader' } } }, h(AskOPage, { client }))); });
  assert.equal(ui.root.findAllByType('select').length, 1);
  await act(() => ui.root.findByType('select').props.onChange({ target: { value: 'shared' } }));
  const entry = ui.root.findByType(OEntry);
  assert.equal(entry.props.dashboardId, 'shared');
  await assert.rejects(entry.props.client.queryDataset('foreign', {}), /DASHBOARD_QUERY_REQUIRED/);
  await act(() => ui.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: 'total amount' } }));
  await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 'shared');
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0, JSON.stringify(ui.toJSON()));
});
