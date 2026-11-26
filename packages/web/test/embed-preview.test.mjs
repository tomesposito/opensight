import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmbedFrame, defaultEmbedBrand, embedAsset } from '../build/test/EmbedFrame.js';
import { atlasBrand, previewAssets } from '../build/test/embed-preview-fixtures.js';
import { EmbeddedDashboard } from '../build/test/EmbeddedDashboard.js';
import { VisualCard } from '../build/test/VisualCard.js';

const interactiveContent = () => ({ kind: 'dashboard', title: 'Regional totals', visuals: [{ id: 'total', source: 'api', path: 'test', sheet: 'Sheet', placement: { column: 0, columns: 36, row: 0, rows: 6 }, bindings: { amount: 'amount' }, rows: [{ amount: 40 }],
  definition: { KPIVisual: { VisualId: 'total', ChartConfiguration: { FieldWells: { Values: [{ NumericalMeasureField: { FieldId: 'amount', Column: { DataSetIdentifier: 'data', ColumnName: 'amount' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } }] } } } } }],
  controls: { filters: [{ id: 'region-filter', name: 'region-filter', label: 'Regions', type: 'string', multiple: true, values: ['east'] }], parameters: [{ id: 'Minimum', name: 'Minimum', label: 'Minimum amount', type: 'number', integer: true, multiple: false, values: [0] }] } });

for (const [state, title] of [['loading', 'Loading dashboard'], ['empty', 'No visuals in this dashboard'], ['error', 'Data access was denied'], ['expired', 'Embed URL expired']]) {
  test(`H5 ${state} preview preserves notices and permission semantics across branding`, () => {
    for (const appearance of [defaultEmbedBrand, atlasBrand]) {
      const html = renderToStaticMarkup(createElement(EmbedFrame, { state, appearance, assets: previewAssets }, 'SHOULD NEVER RENDER PROTECTED CONTENT'));
      assert.ok(html.includes(title)); assert.ok(html.includes(appearance.productName)); assert.ok(html.includes(appearance.iframeTitle));
      assert.ok(html.includes('OpenSight · Apache-2.0')); assert.ok(html.includes('Data access permissions apply'));
      assert.ok(html.includes(state === 'error' ? 'role="alert"' : 'role="status"'));
      assert.doesNotMatch(html, /SHOULD NEVER|<button|<input|<a |<script|https?:/);
      assert.equal(html.includes('<img '), appearance === atlasBrand);
      assert.ok(html.includes(appearance === atlasBrand ? 'embed-teal embed-sans embed-compact' : 'embed-navy embed-system embed-comfortable'));
    }
  });
}
test('H5 shared frame escapes untrusted text and refuses external, SVG and forged asset strings', () => {
  const attacks = ['javascript:alert(1)', 'https://evil.example/logo.png', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:image/png;base64,AAAA" onerror="alert(1)', 'data:image/png;base64,' + 'a'.repeat(90001)];
  for (const value of attacks) assert.equal(embedAsset('logo', { logo: value }), undefined);
  assert.equal(embedAsset('constructor', {}), undefined);
  const html = renderToStaticMarkup(createElement(EmbedFrame, { state: 'ready', appearance: { ...atlasBrand, productName: '<script>alert(1)</script>', iframeTitle: '" onload="alert(1)' }, title: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(html, /<script|<img| onload="/); assert.match(html, /&lt;script&gt;/);
});

test('#335 frame controls submit complete typed state, hide stale results and reset through the server', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [], states = [], initial = interactiveContent(); let renderer;
  const transport = { request: (action, body) => new Promise((resolve, reject) => requests.push({ action, body, resolve, reject })) };
  function Frame({ visible = true }) {
    const [content, setContent] = useState(initial);
    return visible && createElement(EmbeddedDashboard, { initial: content, transport, onState: state => states.push(state), onContent: setContent });
  }
  await act(() => { renderer = create(createElement(Frame)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const input = label => renderer.root.findAllByType('input').find(i => i.props['aria-label'] === label);
  const applyButton = () => renderer.root.findAllByType('button').find(b => b.children.join('') === 'Apply');
  const submit = () => applyButton().props.onClick();
  assert.equal(applyButton().props.type, 'button'); // The frame sandbox disallows native forms.
  await act(() => input('Minimum amount').props.onChange({ target: { value: '1.5' } }));
  await act(submit); assert.equal(requests.length, 0); assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /safe integer/);
  await act(() => input('Minimum amount').props.onChange({ target: { value: '25' } }));
  await act(() => { submit(); submit(); });
  assert.equal(requests.length, 1); assert.equal(requests[0].action, 'content');
  assert.deepEqual(requests[0].body, { filters: { 'region-filter': ['east'] }, parameters: { Minimum: [25] } });
  assert.deepEqual(states, [requests[0].body]); assert.equal(renderer.root.findAllByType(VisualCard).length, 0);
  assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
  const result = structuredClone(initial); result.visuals[0].rows = [{ amount: 30 }]; result.controls.parameters[0].values = [25];
  await act(() => requests[0].resolve(result)); assert.deepEqual(renderer.root.findByType(VisualCard).props.visual.rows, [{ amount: 30 }]);
  await act(() => renderer.update(createElement(Frame, { visible: false })));
  assert.equal(renderer.root.findAllByType(VisualCard).length, 0);
  await act(() => renderer.update(createElement(Frame, { visible: true })));
  assert.deepEqual(renderer.root.findByType(VisualCard).props.visual.rows, [{ amount: 30 }]);
  assert.equal(input('Minimum amount').props.value, '25');
  await act(() => renderer.root.findAllByType('button').find(b => b.children.join('') === 'Reset all').props.onClick());
  assert.deepEqual(requests[1].body, {}); assert.equal(renderer.root.findAllByType(VisualCard).length, 0);
  await act(() => requests[1].reject(new Error('revoked')));
  assert.equal(renderer.root.findAllByType(VisualCard).length, 0); assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /Unable to update/);
});

test('#335 flags-off frame has no controls and labels are escaped', () => {
  const initial = interactiveContent(), transport = { request: () => assert.fail('No background queries') };
  initial.controls = { filters: [], parameters: [] };
  const html = renderToStaticMarkup(createElement(EmbeddedDashboard, { initial, transport, onState() {} }));
  assert.doesNotMatch(html, /embed-reader-controls|<input|<form/);
  initial.controls.parameters = [{ name: 'Title', id: 'Title', type: 'string', multiple: false, label: '<script>unsafe</script>', values: ['<img src=x>'] }];
  const escaped = renderToStaticMarkup(createElement(EmbeddedDashboard, { initial, transport, onState() {} }));
  assert.doesNotMatch(escaped, /<script>|<img src=x>/); assert.match(escaped, /&lt;script&gt;/);
});
