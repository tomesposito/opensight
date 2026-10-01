import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { OEntry } from '../build/test/OEntry.js';
import { LiveAuthorVisual } from '../build/test/LiveAuthorVisual.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { activeSheet, authorReducer, dataFields, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { prepareOVisual } from '../build/test/o-authoring.js';
import { interpretQuestion } from '@opensight/o-interpreter';

const local = { mode: 'local' };
const hosted = { mode: 'hosted', session: { id: 'user', namespaceId: 'default', name: 'Author', role: 'author_ai' } };
const uploaded = { id: 'prepared-teams', name: 'Team totals', columns: [{ name: 'team', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }, { name: 'day', type: 'DATETIME' }] };
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
    async update(value) { props = { ...props, ...value }; await act(() => renderer.update(element(access))); },
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

test('uploaded O fields compile and ADD TO ANALYSIS preserves the dataset and selected answer', async t => {
  let draft = { ...emptyDraft(), dataset: uploaded };
  const calls = [], rows = [{ team: 'North', 'O sum amount': 6 }, { team: 'South', 'O sum amount': 3 }];
  const client = { dataset: uploaded, async queryDataset(...args) { calls.push(args); return { rows }; } };
  const ui = await mount(t, { client, draft, dispatch(action) { draft = authorReducer(draft, action); } });
  await ui.ask('amount by team');
  assert.equal(calls[0][0], uploaded.id);
  assert.deepEqual(calls[0][1].calculatedFields, [{ name: 'O sum amount', expression: 'sum({amount})' }]);
  assert.deepEqual(ui.card().visual.rows, rows);
  assert.equal(ui.source(), 'Team totals API query.');
  const button = ui.renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS');
  assert.equal(button.props.disabled, false);
  await act(() => button.props.onClick());
  validateDraft(draft);
  assert.equal(draft.dataset, uploaded);
  assert.equal(activeSheet(draft).visuals[0].dimension, 'team');
  assert.deepEqual(activeSheet(draft).visuals[0].measures, ['O sum amount']);
  assert.deepEqual(draft.calculatedFields.map(({ name, expression }) => ({ name, expression })), calls[0][1].calculatedFields);
  assert.equal(ui.renderer.root.findAllByType(VisualCard).length, 0);
});

test('uploaded dates and calculated dates retain schema types and query granularity', async t => {
  const calculatedFields = [{ name: 'next_day', role: 'dimension', expression: "addDateTime(1, 'DD', {day})" }];
  const calls = [];
  const client = { dataset: uploaded, async queryDataset(id, query) { calls.push(query); return { rows: [] }; } };
  const ui = await mount(t, { client, draft: { ...emptyDraft(), dataset: uploaded, calculatedFields } });
  for (const name of ['day', 'next_day']) {
    await ui.ask(`sum amount by ${name} yearly`);
    assert.deepEqual(calls.at(-1).dimensions, [{ fieldId: name, columnName: name, granularity: 'YEAR' }]);
    assert.equal(ui.card().dataMessage, undefined);
  }
});

for (const code of ['PREP_SOURCE_NOT_FOUND', 'PREP_NOT_FOUND']) test(`expired uploaded O answer surfaces recovery for ${code}`, async t => {
  const calls = [];
  const client = { dataset: uploaded, async queryDataset(id) { calls.push(id); throw new Error(`${code}: Source unavailable`); } };
  const ui = await mount(t, { client, draft: { ...emptyDraft(), dataset: uploaded } });
  await ui.ask('amount by team');
  assert.deepEqual(calls, [uploaded.id]);
  assert.equal(ui.card().visual.rows, null); assert.equal(ui.card().loading, false);
  assert.match(ui.card().dataMessage, /Source data expired or is unavailable — re-upload the file, prepare it, then reopen and reconnect this draft/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /re-upload the file/);
});

test('O preparation rejects unknown uploaded fields and displays unsupported calculation alerts', async t => {
  const interpretation = interpretQuestion('sum revenue by region', dataFields()).interpretations[0];
  assert.throws(() => prepareOVisual(interpretation, [], uploaded), /O_UNKNOWN_FIELD: revenue/);
  const calculatedFields = [{ name: 'total_amount', role: 'measure', expression: 'sum({amount})' }];
  const client = { dataset: uploaded, queryDataset() { assert.fail('Invalid preparation must not query'); } };
  const ui = await mount(t, { client, draft: { ...emptyDraft(), dataset: uploaded, calculatedFields }, dispatch() {} });
  await ui.ask('sum total_amount by team');
  assert.match(ui.renderer.root.findByProps({ role: 'alert' }).props.children, /O_UNSUPPORTED_CALCULATION/);
  assert.equal(ui.renderer.root.findAllByType(VisualCard).length, 0);
  assert.equal(ui.renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS').props.disabled, true);
});

test('changing the dataset clears an O answer before it can query with a stale interpretation', async t => {
  const client = { async queryDataset() { return { rows: [] }; } };
  const ui = await mount(t, { client });
  await ui.ask();
  assert.equal(ui.renderer.root.findAllByType(VisualCard).length, 1);
  await ui.update({ draft: { ...emptyDraft(), dataset: uploaded }, client: { dataset: uploaded, queryDataset() { assert.fail('Stale sales interpretation'); } } });
  assert.equal(ui.renderer.root.findAllByType(VisualCard).length, 0);
});
