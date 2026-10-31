import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { GovernedMetrics, MetricDefinitionForm } from '../build/test/GovernedMetrics.js';
const definition = { name: 'Margin', expression: 'sum({profit}) / sum({revenue})', defaultAggregation: 'SUM', format: { style: 'percent', decimalPlaces: 1 }, description: 'Net margin', synonyms: ['profit rate'] };
const dataset = { dataset: { kind: 'prepared-dataset', id: 'sales', ownerId: 'owner' }, name: 'Sales', columns: [{ name: 'profit', type: 'DECIMAL' }, { name: 'revenue', type: 'DECIMAL' }], canPublish: false, owned: false };
const summary = { id: 'margin', dataset: dataset.dataset, version: 1, publishedVersion: null, state: 'draft', definition, published: null, permissions: { edit: true, publish: false } };
async function mount(t, component, props) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(component, props)); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; }); return ui;
}
const button = (ui, name) => ui.root.findAllByType('button').find(b => b.children.join('') === name);
const field = (ui, name, type) => ui.root.findAllByType('label').find(l => l.children[0] === name).findByType(type);
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
test('metric form saves all definition fields and surfaces validation/server errors without publishing', async t => {
  const calls = [], ui = await mount(t, MetricDefinitionForm, { dataset, onSave: async d => { calls.push(d); throw new Error('METRIC_NAME_CONFLICT'); }, onClose() {} });
  await change(field(ui, 'Name', 'input'), 'Margin');
  await change(field(ui, 'Expression', 'textarea'), 'sum({missing})');
  assert.match(JSON.stringify(ui.toJSON()), /missing/); assert.equal(button(ui, 'Save draft').props.disabled, true);
  await change(field(ui, 'Expression', 'textarea'), definition.expression);
  await change(field(ui, 'Format', 'select'), 'percent');
  await change(field(ui, 'Decimal places', 'input'), '1');
  await change(field(ui, 'Description', 'textarea'), 'Net margin');
  await change(field(ui, 'Synonyms (one per line)', 'textarea'), 'profit rate\nmargin rate');
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[0], { ...definition, synonyms: ['profit rate', 'margin rate'] });
  assert.match(JSON.stringify(ui.toJSON()), /METRIC_NAME_CONFLICT/);
  assert.ok(!ui.root.findAllByType('button').some(b => b.children.join('').startsWith('Publish')));
});
test('editor can draft for approval; owner can publish and inspect complete version history', async t => {
  const calls = [];
  const client = { metricDatasets: async () => [dataset], listMetrics: async () => ({ items: [summary], canCreate: true, canPublish: false }),
    saveMetric: async (...args) => { calls.push(['save', ...args]); return summary; }, publishMetric: async (...args) => { calls.push(['publish', ...args]); }, metricHistory: async () => [{ version: 1, state: 'draft', definition, actor: 'editor', at: '2026-10-31T00:00:00Z' }] };
  const ui = await mount(t, GovernedMetrics, { client });
  assert.match(JSON.stringify(ui.toJSON()), /draft for approval/); assert.equal(button(ui, 'Publish Margin'), undefined);
  await act(() => button(ui, 'Edit Margin').props.onClick());
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[0][1], 'margin'); assert.equal(calls[0][4], 1);
  const owner = { ...client, listMetrics: async () => ({ items: [{ ...summary, permissions: { edit: true, publish: true } }], canCreate: true, canPublish: true }) };
  await act(async () => ui.update(createElement(GovernedMetrics, { client: owner })));
  await act(async () => button(ui, 'Publish Margin').props.onClick());
  assert.deepEqual(calls.at(-1), ['publish', 'margin', 1]);
  await act(async () => button(ui, 'History of Margin').props.onClick());
  assert.match(JSON.stringify(ui.toJSON()), /Net margin/); assert.match(JSON.stringify(ui.toJSON()), /profit rate/); assert.match(JSON.stringify(ui.toJSON()), /editor/);
});
test('metric empty and offline states contain no staged definitions', async t => {
  const ui = await mount(t, GovernedMetrics, {}); assert.match(JSON.stringify(ui.toJSON()), /Needs a local or hosted API/); assert.equal(button(ui, 'Create metric'), undefined);
  const client = { metricDatasets: async () => [], listMetrics: async () => ({ items: [], canCreate: true, canPublish: true }), saveMetric() {}, publishMetric() {}, metricHistory() {} };
  await act(async () => ui.update(createElement(GovernedMetrics, { client })));
  assert.match(JSON.stringify(ui.toJSON()), /No datasets available/); assert.equal(button(ui, 'Create metric').props.disabled, true);
});
