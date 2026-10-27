import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { HostedDashboards } from '../build/test/Dashboards.js';
import { PublishedDashboard } from '../build/test/PublishedDashboard.js';
import { QSidePanel } from '../build/test/QSidePanel.js';
import { OEntry } from '../build/test/OEntry.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { ControlInput } from '../build/test/ControlInput.js';
import { emptyDraft, authorReducer, serializeDraft } from '../build/test/authoring.js';
import { createApiClient } from '../build/test/api-client.js';
import { projectDefinition } from '../build/test/definition-converter.js';
import { readerControls } from '../build/test/published-dashboard.js';
import { routeHash, parseRoute } from '../build/test/app-navigation.js';

export function published() {
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  const id = draft.sheets[0].visuals[0].id;
  draft.sheets[0].visuals[0] = { ...draft.sheets[0].visuals[0], dimension: 'region', measures: ['revenue'], filters: [{ columnName: 'region', parameterName: 'Region', values: [] }] };
  draft.parameters = [{ id: 'parameter-1', name: 'Region', type: 'string', multiple: false, values: ['east'], defaultValues: ['east'] }];
  draft.sheets[0].controls = [{ id: 'region', kind: 'dropdown', parameterId: 'parameter-1', label: 'Region', options: ['east', 'west'] }];
  return { id: 'daily', name: 'Daily Orders', version: 3, errors: [], definition: serializeDraft(draft).definition, visualId: id };
}
async function mount(t, content, role = 'reader') {
  const before = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(() => { ui = create(h(AccessProvider, { access: { mode: 'hosted', session: { id: 'r', namespaceId: 'n', role } } }, content)); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = before; }); return ui;
}
test('collection loads tenant dashboards and opens bookmarkable routes', async t => {
  let route; const ui = await mount(t, h(HostedDashboards, { navigate: r => { route = r; }, client: { async listDashboards() { return [{ id: 'daily', name: 'Daily Orders', version: 3 }]; } } }));
  const link = ui.root.findAllByType('a').find(n => n.props.children === 'Daily Orders');
  assert.equal(link.props.href, '#/dashboards/daily'); assert.deepEqual(parseRoute(link.props.href), { page: 'dashboards', dashboardId: 'daily' });
  assert.equal(routeHash(parseRoute(link.props.href)), link.props.href);
});
test('collection failure is not an empty state or synthetic fallback', async t => {
  const ui = await mount(t, h(HostedDashboards, { navigate() {}, client: { async listDashboards() { throw new Error('AUTH_EXPIRED'); } } }));
  assert.match(JSON.stringify(ui.toJSON()), /AUTH_EXPIRED/); assert.doesNotMatch(JSON.stringify(ui.toJSON()), /No published dashboards|Pinned/);
});
test('reader queries pinned published version and refreshes rows when a declared control changes', async t => {
  const value = published(), queries = [];
  const client = { async getPublishedDashboard() { return value; }, async queryDashboardVisual(...args) { queries.push(args); return { rows: [{ region: args[3].region?.[0] ?? 'east', revenue: 40 }] }; } };
  const ui = await mount(t, h(PublishedDashboard, { id: 'daily', client, navigate() {} }));
  assert.deepEqual(queries[0].slice(0, 4), ['daily', 3, value.visualId, {}]);
  await act(() => ui.root.findByType(ControlInput).props.onChange(['west']));
  assert.deepEqual(queries.at(-1)[3], { region: ['west'] });
  assert.equal(ui.root.findByType(VisualCard).props.visual.rows[0].region, 'west');
  assert.equal(ui.root.findAllByProps({ className: 'author-menu' }).length, 0);
});
test('reader clears old rows immediately and retains named access failures', async t => {
  const value = published(); let reject, calls = 0;
  const client = { async getPublishedDashboard() { return value; }, queryDashboardVisual() { return ++calls === 1 ? Promise.resolve({ rows: [{ region: 'east', revenue: 40 }] }) : new Promise((_, r) => { reject = r; }); } };
  const ui = await mount(t, h(PublishedDashboard, { id: 'daily', client, navigate() {} }));
  await act(() => ui.root.findByType(ControlInput).props.onChange(['west']));
  assert.equal(ui.root.findByType(VisualCard).props.visual.rows, null);
  await act(() => reject(new Error('DASHBOARD_DATASET_ACCESS_DENIED')));
  assert.equal(ui.root.findByType(VisualCard).props.visual.rows, null);
  assert.match(JSON.stringify(ui.toJSON()), /DASHBOARD_DATASET_ACCESS_DENIED/);
});
test('v1 collection pagination, published definition and live query use authenticated client contracts', async () => {
  const value = published(), calls = [];
  const api = createApiClient('/', async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/query')) return Response.json({ columns: [{ name: 'region', type: 'string' }], rows: [{ region: 'west' }] });
    if (url.endsWith('/daily')) return Response.json({ DashboardId: 'daily', Name: value.name, Version: 3, Errors: [], Definition: projectDefinition(value.definition) });
    return Response.json({ items: [{ id: calls.length === 1 ? 'one' : 'two', name: 'Dashboard', version: 1 }], nextCursor: calls.length === 1 ? 'next' : null });
  });
  assert.equal((await api.listDashboards()).length, 2); assert.equal(calls[1].headers.Cursor, 'next');
  assert.equal((await api.getPublishedDashboard('daily')).version, 3);
  const result = await api.queryDashboardVisual('daily', 3, value.visualId, { region: ['west'] });
  assert.equal(result.rows[0].region, 'west'); assert.deepEqual(JSON.parse(calls.at(-1).body), { controlValues: { region: ['west'] } });
});
test('linked control choices fail visibly instead of querying arbitrary reader data', () => {
  const value = published(); value.definition.sheets[0].parameterControls[0].dropdown.selectableValues = { linkToDataSetColumn: { dataSetIdentifier: 'sales_data', columnName: 'region' } };
  assert.match(readerControls(value.definition, value.definition.sheets[0]).bindings[0].problem, /DASHBOARD_CONTROL_OPTIONS_UNAVAILABLE/);
});

for (const role of ['reader', 'reader_ai', 'author', 'author_ai', 'administrator']) test(`published dashboard Ask O respects ${role} capabilities and scopes questions`, async t => {
  const value = published(); const client = { async getPublishedDashboard() { return value; }, async queryDashboardVisual() { return { rows: [] }; } };
  const ui = await mount(t, h(PublishedDashboard, { id: 'daily', client, navigate() {} }), role);
  const triggers = ui.root.findAllByProps({ className: 'q-trigger' });
  assert.equal(triggers.length, ['reader_ai', 'author_ai', 'administrator'].includes(role) ? 1 : 0);
  if (!triggers.length) return;
  assert.match(triggers[0].findByProps({ className: 'q-trigger-label' }).props.children.join(''), /Daily Orders/);
  await act(() => triggers[0].props.onClick());
  assert.equal(ui.root.findByType(OEntry).props.dashboardId, 'daily');
  assert.deepEqual(ui.root.findByType(QSidePanel).props.draft.dataset.columns.map(c => c.name), ['region', 'revenue']);
  assert.match(JSON.stringify(ui.toJSON()), /not configured/);
  assert.equal(ui.root.findByProps({ role: 'switch' }).props.disabled, true);
});

test('admin dashboard grants are explicit and retain server errors', async t => {
  let grant; const client = { async getPublishedDashboard() { return published(); }, async queryDashboardVisual() { return { rows: [] }; }, async listUsers() { return [{ id: 'reader', name: 'Daily reader' }]; }, async shareDashboard(...args) { grant = args; throw new Error('ASSET_PRECONDITION_FAILED'); } };
  const ui = await mount(t, h(PublishedDashboard, { id: 'daily', client, navigate() {} }), 'administrator');
  await act(() => ui.root.findByProps({ 'aria-label': 'Viewer' }).props.onChange({ target: { value: 'reader' } }));
  await act(() => ui.root.findByProps({ className: 'dashboard-access' }).findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(grant, ['daily', 'reader']); assert.match(JSON.stringify(ui.toJSON()), /ASSET_PRECONDITION_FAILED/);
  assert.doesNotMatch(JSON.stringify(ui.toJSON()), /viewing access granted/);
});
