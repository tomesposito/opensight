import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { createSessionEmbeddingClient } from '@opensight/embedding-sdk';
import { createEmbedChannel } from '../build/test/embed-channel.js';
import { EmbeddedDashboard } from '../build/test/EmbeddedDashboard.js';

test('#340 a selected row reaches the mounted host and menu actions send only their authorized projection', async t => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui;
  t.after(async () => { if (ui) await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const origin = 'https://embed.example', parentOrigin = 'https://product.example', id = 's'.repeat(32);
  const host = new EventTarget(), iframe = new EventTarget(), received = [];
  const dispatch = (target, data, source, origin) => target.dispatchEvent(Object.assign(new Event('message'), { data: structuredClone(data), source, origin }));
  Object.assign(host, { location: { origin: parentOrigin }, crypto, postMessage(data, target) {
    assert.equal(target, parentOrigin); dispatch(host, data, frame, origin);
  } });
  const frame = { location: { origin }, parent: host, postMessage(data, target) {
    assert.equal(target, origin);
    const event = { data: structuredClone(data), source: host, origin: parentOrigin };
    if (channel.initialize(event)) channel.status('ready'); else channel.receive(event);
  } };
  Object.assign(iframe, { contentWindow: frame, style: {}, setAttribute() {}, remove() {} });
  const channel = createEmbedChannel({ sessionId: id, allowedDomains: [parentOrigin] }, frame, () => true);
  const client = createSessionEmbeddingClient({ allowedEmbedOrigins: [origin], getEmbedUrl: async () => ({
    sessionId: id, EmbedUrl: `${origin}/embed/sessions/${id}#bootstrap=key.${id}.${'a'.repeat(43)}.${'b'.repeat(43)}`,
    bootstrapExpiresAt: new Date(Date.now() + 120000).toISOString(),
  }) });
  const handle = await client.mount({ ownerDocument: { defaultView: host, createElement: () => iframe }, appendChild() {} }, {
    onDataEvent: event => received.push(event),
    customActions: [{ id: 'amount', label: 'Use total', columns: ['amount'] }, { id: 'denied', label: 'Use private field', columns: ['amount', 'private'] }],
  });
  t.after(handle.destroy); iframe.dispatchEvent(new Event('load'));
  const field = (fieldId, columnName) => ({ FieldId: fieldId, Column: { DataSetIdentifier: 'data', ColumnName: columnName } });
  const visual = { id: 'sales', source: 'api', path: 'sales', placement: { column: 0, columns: 36, row: 0, rows: 6 },
    definition: { TableVisual: { VisualId: 'sales', ChartConfiguration: { FieldWells: { TableAggregatedFieldWells: {
      GroupBy: [{ CategoricalDimensionField: field('r', 'region') }],
      Values: [{ NumericalMeasureField: { ...field('private', 'amount'), AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } }],
    } } } } },
    // The server integration test proves this exact alias collision is safe under CLS.
    bindings: { r: 'r', private: 'private' }, contextColumns: { region: 'r', amount: 'private' },
    rows: [{ r: 'East', private: 40 }, { r: 'West', private: 20 }],
  };
  const initial = { kind: 'dashboard', title: 'Totals', controls: { filters: [], parameters: [] }, visuals: [visual] };
  await act(() => { ui = create(createElement(EmbeddedDashboard, { transport: { events: channel }, initial, onState() {} })); });
  const click = node => act(() => node.props.onClick({ stopPropagation() {} }));
  const toggle = () => click(ui.root.findByProps({ 'aria-label': 'Run action' }));
  const item = name => ui.root.findAllByProps({ role: 'menuitem' }).find(button => button.children.join('') === name);
  await toggle(); assert.equal(item('Use total').props.disabled, true); await toggle();
  await click(ui.root.findAllByType('button').find(button => button.children.join('') === 'West'));
  await toggle(); await click(item('Use total'));
  await toggle(); await click(item('Use private field'));
  assert.deepEqual(received, [
    { type: 'selection', visualId: 'sales', values: { region: 'West' } },
    { type: 'customAction', visualId: 'sales', actionId: 'amount', values: { amount: 20 } },
  ]);
});
