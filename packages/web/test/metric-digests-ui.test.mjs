import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { MetricSubscriptions, MetricDetail } from '../build/test/MetricSubscriptions.js';
import { parseRoute, routeHash, routeProblem } from '../build/test/app-navigation.js';
const metric = { id: 'revenue', published: { name: 'Revenue', version: 2, expression: '{amount}', format: { style: 'number', decimalPlaces: 2 } } };
async function mount(t, component, props) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(component, props)); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; }); return ui;
}
const button = (ui, name) => ui.root.findAllByType('button').find(b => b.children.join('') === name);
test('metric digests UI defaults weekly, self-subscribes, previews no change and unsubscribes', async t => {
  const calls = [], items = [], client = { listMetricSubscriptions: async () => [...items], subscribeMetric: async (id, input) => { calls.push([id, input]); items.push({ ...input, destination: { kind: 'self' }, id: 'sub', nextRun: '2026-11-09T09:00:00Z' }); }, unsubscribeMetric: async id => { calls.push(id); items.pop(); }, previewMetricDigest: async () => ({ current: 10, previous: 10, change: 0, periods: { current: { start: '2026-10-26', end: '2026-11-02' } }, drivers: [] }) };
  const ui = await mount(t, MetricSubscriptions, { metric, client, columns: [{ name: 'day', type: 'DATETIME' }, { name: 'region', type: 'STRING' }] });
  await act(() => ui.root.findByType('textarea').props.onChange({ target: { value: 'region' } }));
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[0], ['revenue', { cadence: 'weekly', timeColumn: 'day', dimensions: ['region'] }]);
  await act(async () => button(ui, 'View digest').props.onClick()); assert.match(JSON.stringify(ui.toJSON()), /No change/);
  await act(async () => button(ui, 'Unsubscribe').props.onClick()); assert.equal(calls[1], 'sub'); assert.match(JSON.stringify(ui.toJSON()), /No active subscriptions/);
});
test('metric digests UI reports hosted requirement and routes drill-back without an author-only page gate', async t => {
  const client = { listMetricSubscriptions: async () => { throw Error('HOSTED_API_REQUIRED'); } };
  const ui = await mount(t, MetricSubscriptions, { metric, client }); assert.match(JSON.stringify(ui.toJSON()), /Needs hosted API/); assert.equal(button(ui, 'Subscribe to email digest'), undefined);
  assert.deepEqual(parseRoute('#/metrics/revenue'), { page: 'metric', metricId: 'revenue' }); assert.equal(routeHash({ page: 'metric', metricId: 'revenue' }), '#/metrics/revenue');
  assert.equal(routeProblem({ mode: 'hosted', session: { role: 'reader' } }, 'metric'), undefined);
  await act(async () => ui.update(createElement(MetricDetail, { id: 'revenue' }))); assert.match(JSON.stringify(ui.toJSON()), /Needs hosted API/);
});


test('metric digests UI loads explicit members, submits IDs, and shows the shared empty-intersection preview', async t => {
  const items = [], calls = [], client = { listMetricSubscriptions: async () => [...items], jobRecipients: async () => [{ id: 'one', name: 'First', email: 'first@example.test' }, { id: 'two', name: 'Second', email: 'second@example.test' }],
    subscribeMetric: async (id, input) => { calls.push([id, input]); items.push({ ...input, id: 'sub', destination: { kind: 'shared', recipients: input.destination.recipientIds } }); },
    previewMetricDigest: async () => ({ emptyIntersection: true, current: null, previous: null, change: null, periods: { current: { start: '2026-10-26', end: '2026-11-02' } }, drivers: [] }) };
  const ui = await mount(t, MetricSubscriptions, { metric, client, columns: [{ name: 'day', type: 'DATETIME' }] });
  const destination = ui.root.findAllByType('select').find(s => s.props.value === 'self');
  await act(async () => destination.props.onChange({ target: { value: 'shared' } }));
  assert.equal(button(ui, 'Subscribe to email digest').props.disabled, true);
  assert.match(JSON.stringify(ui.toJSON()), /second@example.test/);
  for (const box of ui.root.findAllByType('input').filter(i => i.props.type === 'checkbox')) await act(() => box.props.onChange({ target: { checked: true } }));
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[0][1].destination, { kind: 'shared', recipientIds: ['one', 'two'] });
  assert.doesNotMatch(JSON.stringify(calls), /@/);
  await act(async () => button(ui, 'View digest').props.onClick());
  assert.match(JSON.stringify(ui.toJSON()), /No data is visible to all recipients/); assert.doesNotMatch(JSON.stringify(ui.toJSON()), /Current:/);
});

test('metric digests UI surfaces member-list and shared-creation API errors', async t => {
  const client = { listMetricSubscriptions: async () => [], jobRecipients: async () => { throw Error('JOB_WRITE_FORBIDDEN'); }, subscribeMetric: async () => { throw Error('DIGEST_SHARED_FORBIDDEN'); } };
  const ui = await mount(t, MetricSubscriptions, { metric, client, columns: [{ name: 'day', type: 'DATETIME' }] });
  await act(async () => ui.root.findAllByType('select').find(s => s.props.value === 'self').props.onChange({ target: { value: 'shared' } }));
  assert.match(JSON.stringify(ui.toJSON()), /JOB_WRITE_FORBIDDEN/); assert.equal(button(ui, 'Subscribe to email digest').props.disabled, true);
  await act(async () => ui.update(createElement(MetricSubscriptions, { metric, client: { ...client, jobRecipients: async () => [{ id: 'one', name: 'First', email: 'first@example.test' }] }, columns: [{ name: 'day', type: 'DATETIME' }] })));
  await act(() => ui.root.findAllByType('input').find(i => i.props.type === 'checkbox').props.onChange({ target: { checked: true } }));
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(JSON.stringify(ui.toJSON()), /DIGEST_SHARED_FORBIDDEN/);
});
