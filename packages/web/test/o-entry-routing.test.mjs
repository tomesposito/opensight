import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { OEntry } from '../build/test/OEntry.js';
import { LiveAuthorVisual } from '../build/test/LiveAuthorVisual.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { emptyDraft } from '../build/test/authoring.js';

const local = { mode: 'local' };
const hosted = { mode: 'hosted', session: { id: 'user', namespaceId: 'default', name: 'Author', role: 'author_ai' } };
async function mount(t, props = {}, access = local) {
  const before = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const element = access => createElement(AccessProvider, { access }, createElement(OEntry, { draft: emptyDraft(), ...props }));
  let renderer;
  await act(() => { renderer = create(element(access)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = before; });
  return {
    renderer,
    async ask(question = 'revenue by region') {
      await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: question } }));
      await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    },
    async access(value) { await act(() => renderer.update(element(value))); },
    card: () => renderer.root.findByType(VisualCard).props,
    source: () => renderer.root.findByProps({ className: 'o-source' }).props.children,
  };
}

test('local O uses the visual builder queryDataset path and keeps generative mode disabled', async t => {
  const calls = [], rows = [{ region: 'East', 'O sum revenue': 123 }];
  const client = {
    async queryDataset(...args) { calls.push(args); return { rows }; },
    queryO() { assert.fail('Local O must never call the hosted O endpoint'); },
  };
  const ui = await mount(t, { client });
  assert.equal(ui.renderer.root.findByProps({ role: 'switch' }).props.disabled, true);
  await ui.ask();
  assert.equal(calls.length, 1);
  const [id, query, signal] = calls[0];
  assert.equal(id, 'sales'); assert.ok(signal instanceof AbortSignal);
  assert.deepEqual(query.dimensions, [{ fieldId: 'region', columnName: 'region' }]);
  assert.deepEqual(query.calculatedFields, [{ name: 'O sum revenue', expression: 'sum({revenue})' }]);
  assert.deepEqual(ui.card().visual.rows, rows); assert.equal(ui.card().loading, false);
  assert.equal(ui.source(), 'Local sales API query.');
  await ui.ask('new question'); assert.equal(signal.aborted, true);
});

test('local O carries the current dataset to the preview and queries its id', async t => {
  const dataset = { id: 'prepared-sales', name: 'Uploaded sales', columns: [{ name: 'region', type: 'STRING' }, { name: 'revenue', type: 'INTEGER' }] };
  const ids = [], rows = [{ region: 'North', 'O sum revenue': 6 }];
  // queryO is deliberately absent: local deterministic questions need no hosted endpoint.
  const client = { dataset, async queryDataset(id) { ids.push(id); return { rows }; } };
  const ui = await mount(t, { client, draft: { ...emptyDraft(), dataset } });
  await ui.ask();
  assert.equal(ui.renderer.root.findByType(LiveAuthorVisual).props.client.dataset, dataset);
  assert.deepEqual(ids, [dataset.id]); assert.deepEqual(ui.card().visual.rows, rows);
});

test('hosted O uses queryO with dashboard scope, including after access mode changes', async t => {
  const datasetCalls = [], oCalls = [], rows = [{ region: 'West', 'O sum revenue': 42 }];
  const client = {
    async queryDataset(...args) { datasetCalls.push(args); return { rows }; },
    async queryO(...args) { oCalls.push(args); return { rows }; },
  };
  const ui = await mount(t, { client, dashboardId: 'published-dashboard' });
  await ui.ask();
  await ui.access(hosted);
  assert.equal(datasetCalls.length, 1); assert.equal(oCalls.length, 1);
  assert.deepEqual(oCalls[0][0], datasetCalls[0][1]);
  assert.equal(oCalls[0][1], 'published-dashboard'); assert.ok(oCalls[0][2] instanceof AbortSignal);
  assert.equal(datasetCalls[0][2].aborted, true); assert.deepEqual(ui.card().visual.rows, rows);
});

test('hosted O without queryO fails closed without falling back to queryDataset', async t => {
  const ui = await mount(t, { client: { queryDataset() { assert.fail('Hosted O must not bypass queryO'); } } }, hosted);
  await ui.ask();
  assert.equal(ui.card().visual.rows, null);
  assert.match(ui.card().dataMessage, /SECURITY_AI_REQUIRED: Hosted O endpoint required/);
});

test('no-client demo O retains synthetic rows and the offline source label', async t => {
  const ui = await mount(t, {}, demoAccess);
  await ui.ask();
  assert.deepEqual(ui.card().visual.rows, [{ region: 'East', 'O sum revenue': 500 }, { region: 'West', 'O sum revenue': 400 }]);
  assert.equal(ui.renderer.root.findByType(LiveAuthorVisual).props.client, undefined);
  assert.match(ui.source(), /^Offline demo: recomputed synthetic sales rows/);
});
