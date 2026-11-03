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
  const calls = [], items = [], client = { listMetricSubscriptions: async () => [...items], subscribeMetric: async (id, input) => { calls.push([id, input]); items.push({ ...input, id: 'sub', nextRun: '2026-11-09T09:00:00Z' }); }, unsubscribeMetric: async id => { calls.push(id); items.pop(); }, previewMetricDigest: async () => ({ current: 10, previous: 10, change: 0, periods: { current: { start: '2026-10-26', end: '2026-11-02' } }, drivers: [] }) };
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
  const detail = await mount(t, MetricDetail, { id: 'revenue' }); assert.match(JSON.stringify(detail.toJSON()), /Needs hosted API/);
});
