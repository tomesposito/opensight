import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { CalculationPromotion, PrepPromotions } from '../build/test/PrepPromotions.js';
import { GovernedMetrics } from '../build/test/GovernedMetrics.js';
const definition = { name: 'Doubled', expression: '{amount} * 2', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] };
const dataset = { dataset: { kind: 'prepared-dataset', id: 'sales', ownerId: 'owner' }, name: 'Sales', owned: true, canPublish: true, columns: [{ name: 'amount', type: 'INTEGER' }, { name: 'Doubled', type: 'INTEGER' }], calculations: [{ id: 'calc', name: 'Doubled', expression: definition.expression, definition }] };
const resource = { resourceType: 'dataset', dataSetId: 'sales', name: 'Sales', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'source', steps: [{ id: 'calc', kind: 'calculate', config: { name: 'Doubled', expression: definition.expression } }] } };
const template = { id: 'template', version: 1, owner: 'owner', createdBy: 'owner', source: { id: 'sales', ownerId: 'owner', version: 1 }, publishedVersion: null, state: 'draft', definition: { name: 'Double amounts', pipeline: { ...resource.opensightPrep, input: 'input' } }, slots: ['input'], publishedSlots: [], permissions: { edit: true, publish: true } };
async function mount(t, component, props) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(component, props)); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; }); return ui;
}
const button = (ui, name) => ui.root.findAllByType('button').find(b => b.children.join('') === name);
const field = (ui, name, type) => ui.root.findAllByType('label').find(l => l.children.join('').startsWith(name)).findByType(type);
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
const submit = ui => act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
test('calc promotion reuses the definition form, preserves defaults and reports conflicts before saving draft', async t => {
  const calls = []; let closed = false;
  const client = { metricDatasets: async () => [dataset], promoteCalculation: async (...args) => { calls.push(args); if (args[3].name === 'Doubled') throw new Error('METRIC_NAME_CONFLICT'); } };
  const ui = await mount(t, CalculationPromotion, { client, datasetId: 'sales', calculationId: 'calc', onClose() { closed = true; } });
  assert.equal(field(ui, 'Expression', 'textarea').props.value, definition.expression);
  await submit(ui); assert.match(JSON.stringify(ui.toJSON()), /METRIC_NAME_CONFLICT/); assert.equal(closed, false);
  await change(field(ui, 'Name', 'input'), 'Shared double'); await submit(ui);
  assert.equal(closed, true); assert.equal(calls[1][2], 'calc'); assert.deepEqual(calls[1][1], dataset.dataset); assert.equal(calls[1][3].name, 'Shared double');
});
test('dataset metric list exposes saved calculation promotion and provenance', async t => {
  const calls = [], client = { metricDatasets: async () => [dataset], listMetrics: async () => ({ items: [], canCreate: true, canPublish: true }), saveMetric() {}, publishMetric() {}, metricHistory() {}, promoteCalculation: async (...args) => calls.push(args) };
  const ui = await mount(t, GovernedMetrics, { client });
  await act(() => button(ui, 'Promote Doubled').props.onClick()); await change(field(ui, 'Name', 'input'), 'Shared'); await submit(ui);
  assert.equal(calls[0][2], 'calc'); assert.equal(calls[0][3].name, 'Shared');
});
test('templates propose a draft, show approver steps and owner, publish then bind a copied dataset', async t => {
  const calls = []; let current = [];
  const client = { listPrepTemplates: async () => current, proposePrepTemplate: async (...args) => { calls.push(['propose', ...args]); current = [template]; }, publishPrepTemplate: async (...args) => { calls.push(['publish', ...args]); current = [{ ...template, state: 'published', version: 2, publishedVersion: 2, publishedSlots: ['input'] }]; }, createFromPrepTemplate: async (...args) => { calls.push(['create', ...args]); return { resource }; } };
  const created = [], props = { client, dataset: resource, sources: [{ id: 'mine', name: 'My input', available: true, connectorId: 'file', columns: [] }], propose: true, onClose() {}, onCreated: r => created.push(r) };
  const ui = await mount(t, PrepPromotions, props);
  await change(field(ui, 'Template name', 'input'), 'Double amounts'); await submit(ui);
  assert.equal(calls[0][2], 'sales'); assert.match(JSON.stringify(ui.toJSON()), /Draft awaiting approval/); assert.match(JSON.stringify(ui.toJSON()), /amount/); assert.match(JSON.stringify(ui.toJSON()), /owner/);
  await act(async () => button(ui, 'Publish Double amounts').props.onClick());
  await act(() => button(ui, 'Start from Double amounts').props.onClick());
  assert.equal(button(ui, 'Create prepared dataset').props.disabled, true);
  await change(ui.root.findByType('select'), JSON.stringify('mine'));
  assert.equal(button(ui, 'Create prepared dataset').props.disabled, false); await submit(ui);
  assert.deepEqual(calls.at(-1)[4], { input: 'mine' }); assert.deepEqual(created, [resource]);
});
test('template binding failures retain inputs; peers see no approve control; offline promotions never succeed', async t => {
  const published = { ...template, state: 'published', publishedVersion: 2, version: 2, publishedSlots: ['input'], permissions: { edit: false, publish: false } };
  const client = { listPrepTemplates: async () => [published], proposePrepTemplate() {}, publishPrepTemplate() {}, createFromPrepTemplate: async () => { throw new Error('TEMPLATE_BINDING_FAILED'); } };
  const props = { client, dataset: resource, sources: [{ id: 'mine', available: true, connectorId: 'file', columns: [] }], propose: false, onClose() {}, onCreated() { assert.fail('must not create'); } };
  const ui = await mount(t, PrepPromotions, props);
  assert.equal(button(ui, 'Publish Double amounts'), undefined);
  await act(() => button(ui, 'Start from Double amounts').props.onClick()); await change(ui.root.findByType('select'), JSON.stringify('mine')); await submit(ui);
  assert.match(JSON.stringify(ui.toJSON()), /TEMPLATE_BINDING_FAILED/); assert.equal(ui.root.findByType('select').props.value, JSON.stringify('mine'));
  await act(async () => ui.update(createElement(PrepPromotions, { ...props, client: undefined })));
  assert.match(JSON.stringify(ui.toJSON()), /Needs a local or hosted API/); assert.equal(button(ui, 'Create prepared dataset'), undefined);
  const calc = await mount(t, CalculationPromotion, { datasetId: 'sales', calculationId: 'calc', onClose() {} });
  assert.match(JSON.stringify(calc.toJSON()), /Needs a local or hosted API/); assert.equal(button(calc, 'Save draft'), undefined);
});
