import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataSources } from '../build/test/DataSources.js';
import { createApiClient } from '../build/test/api-client.js';
import { connectors } from '@opensight/query-engine/browser';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const client = {
  uploadFile: async () => { throw new Error('not called'); },
  validateConnector: async () => { throw new Error('not called'); },
  listPrepSources: async () => [],
};
const pg = { id: 'operator-source', connectorId: 'postgresql', available: true, columns: [] };
async function mount(t, props = {}) {
  let renderer;
  await act(async () => { renderer = create(createElement(DataSources, props)); });
  t.after(async () => act(() => renderer.unmount()));
  return {
    root: () => renderer.root,
    text: () => JSON.stringify(renderer.toJSON()),
    cards: () => renderer.root.findAll(n => n.type === 'span' && n.props.className === 'connector-name').map(n => n.children.join('')),
    toggle: async checked => act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked } })),
    search: async value => act(() => renderer.root.findByProps({ type: 'search' }).props.onChange({ target: { value } })),
    select: async name => act(() => renderer.root.findAllByType('button').find(n => n.findAll(x => x.props.className === 'connector-name' && x.children[0] === name).length).props.onClick()),
    update: async next => act(() => renderer.update(createElement(DataSources, next))),
  };
}
test('static gallery leads with disabled upload and omits all unavailable cards by default', () => {
  const html = renderToStaticMarkup(createElement(DataSources));
  assert.match(html, /Upload a file/);
  for (const connector of connectors.filter(c => c.id !== 'file')) assert.ok(!html.includes(connector.name), connector.name);
  assert.match(html, /Uploads are unavailable in the static demo/);
  assert.match(html, /type="checkbox"/); assert.doesNotMatch(html, /checked|Not yet available/);
  assert.match(html, /type="file"[^>]*disabled/); assert.match(html, /type="submit" disabled/);
  assert.doesNotMatch(html, /Upload staged|Connected successfully|type="password"|Hosted form limit/);
});
for (const local of [true, false]) test(`${local ? 'local' : 'hosted without configured sources'} gallery exposes only the working upload path`, async t => {
  const ui = await mount(t, { client, local });
  assert.deepEqual(ui.cards(), ['Upload a file']);
  assert.match(ui.text(), /Upload now, prepare your data, then build a chart/);
  assert.match(ui.text(), /Ready for file upload/);
  assert.equal(ui.root().findByProps({ type: 'file' }).props.disabled, false);
  assert.doesNotMatch(ui.text(), /Upload staged|Not yet available|Needs hosted API/);
});
for (const props of [{}, { client, local: true }, { client }]) test(`toggle groups and unmounts unavailable cards and selected details (${!props.client ? 'static' : props.local ? 'local' : 'hosted'})`, async t => {
  const ui = await mount(t, props);
  await ui.toggle(true);
  assert.deepEqual(ui.cards(), connectors.map(c => c.name));
  const group = ui.root().findByProps({ 'aria-labelledby': 'unavailable-connectors-title' });
  assert.equal(group.findAllByType('button').length, 22);
  await ui.select('MySQL');
  assert.match(ui.text(), /Not yet implemented/);
  assert.equal(ui.root().findByProps({ type: 'submit' }).props.disabled, true);
  await ui.select('PostgreSQL');
  assert.match(ui.text(), /operator-configured connection/);
  if (props.local) assert.match(ui.text(), /Connection setup is unavailable in this local workspace/);
  assert.doesNotMatch(ui.text(), /Needs hosted API \/ not configured/);
  await ui.toggle(false);
  assert.deepEqual(ui.cards(), ['Upload a file']);
  assert.doesNotMatch(ui.text(), /MySQL|PostgreSQL|Not yet available/);
  assert.equal(ui.root().findByProps({ 'aria-label': 'Upload a file setup' }).type, 'aside');
});
test('search cannot reveal hidden connectors and works by name or category when enabled', async t => {
  const ui = await mount(t, { client, local: true });
  await ui.search('mysql');
  assert.deepEqual(ui.cards(), []); assert.match(ui.text(), /Turn on Show unavailable connectors/);
  await ui.toggle(true); assert.deepEqual(ui.cards(), ['MySQL']);
  await ui.search('AWS'); assert.deepEqual(ui.cards(), connectors.filter(c => c.category === 'AWS').map(c => c.name));
  await ui.search('no such connector'); assert.match(ui.text(), /No data sources match/);
  await ui.search(''); await ui.toggle(false); assert.deepEqual(ui.cards(), ['Upload a file']);
});
test('browsing the unavailable catalog preserves the active upload form', async t => {
  const ui = await mount(t, { client, local: true });
  await act(() => ui.root().findAllByType('select')[0].props.onChange({ target: { value: 'tsv' } }));
  await ui.toggle(true); await ui.toggle(false);
  assert.equal(ui.root().findAllByType('select')[0].props.value, 'tsv');
});
test('only a discovered available hosted PostgreSQL source exposes Needs setup and its prep action', async t => {
  const calls = [], onPrep = source => calls.push(source);
  const hosted = { ...client, listPrepSources: async () => [pg] };
  const ui = await mount(t, { client: hosted, onPrep });
  assert.deepEqual(ui.cards(), ['Upload a file', 'PostgreSQL']);
  await ui.select('PostgreSQL'); assert.match(ui.text(), /Needs setup/);
  await act(() => ui.root().findAllByType('button').find(n => n.children[0] === 'Prepare PostgreSQL data').props.onClick());
  assert.deepEqual(calls, [pg.id]);
  await ui.toggle(true);
  assert.equal(ui.root().findByProps({ 'aria-labelledby': 'unavailable-connectors-title' }).findAllByType('button').length, 21);
  await ui.toggle(false); assert.match(ui.text(), /PostgreSQL setup/);
  await ui.update({ client: hosted, local: true, onPrep });
  assert.deepEqual(ui.cards(), ['Upload a file']); assert.doesNotMatch(ui.text(), /PostgreSQL setup/);
});
test('unavailable sources, prepared references, absent prep navigation and failed discovery cannot promote PostgreSQL', async t => {
  for (const sources of [[], [{ ...pg, available: false }], [{ ...pg, ref: { dataset: 'derived' } }]]) {
    const ui = await mount(t, { client: { ...client, listPrepSources: async () => sources }, onPrep: () => {} });
    assert.deepEqual(ui.cards(), ['Upload a file']);
  }
  const noPrep = await mount(t, { client: { ...client, listPrepSources: async () => [pg] } });
  assert.deepEqual(noPrep.cards(), ['Upload a file']);
  const failed = await mount(t, { client: { ...client, listPrepSources: async () => { throw new Error('SOURCE_ACCESS_DENIED'); } }, onPrep: () => {} });
  assert.deepEqual(failed.cards(), ['Upload a file']);
  await failed.toggle(true); assert.match(failed.text(), /Could not check configured connections:.*SOURCE_ACCESS_DENIED/);
});
test('late discovery responses cannot restore a prior client connection or enable local discovery', async t => {
  let finish, localCalls = 0;
  const hosted = { ...client, listPrepSources: () => new Promise(resolve => { finish = resolve; }) };
  const onPrep = () => {};
  const ui = await mount(t, { client: hosted, onPrep });
  await ui.update({ client, onPrep });
  await act(async () => finish([pg]));
  assert.deepEqual(ui.cards(), ['Upload a file']);
  await ui.update({ client: { ...client, listPrepSources: async () => { localCalls++; return [pg]; } }, local: true, onPrep });
  assert.equal(localCalls, 0); assert.deepEqual(ui.cards(), ['Upload a file']);
});
test('connector client sends only config and bytes through existing authenticated transport', async () => {
  const calls = [];
  const client = createApiClient('/api', async (url, options) => { calls.push([url, options]); return new Response(JSON.stringify({ state: 'not_configured' }), { status: 200 }); });
  await client.validateConnector('mysql', { hostEnv: 'MYSQL_HOST' });
  await client.uploadFile({ config: { format: 'csv' }, base64: 'YQ==' });
  assert.equal(calls[0][0], '/api/api/connectors/mysql/connect');
  assert.deepEqual(JSON.parse(calls[0][1].body), { config: { hostEnv: 'MYSQL_HOST' } });
  assert.equal(calls[1][0], '/api/api/uploads'); assert.equal(calls[1][1].credentials, 'same-origin');
});
