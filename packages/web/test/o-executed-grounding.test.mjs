import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { OEntry } from '../build/test/OEntry.js';
import { authorReducer, emptyDraft } from '../build/test/authoring.js';

// Issue #171: the Ask O grounding line must name the governed-metric version that
// executed (from the query response), not the version known at interpretation time.
const metric = { id: 'margin', version: 2, name: 'Margin', expression: 'sum({profit}) / sum({revenue})', defaultAggregation: 'AVG', format: { style: 'percent', decimalPlaces: 1 }, description: '', synonyms: ['profit rate'] };
const dataset = { id: 'prepared', name: 'Sales', columns: [{ name: 'revenue', type: 'DECIMAL' }, { name: 'profit', type: 'DECIMAL' }, { name: 'region', type: 'STRING' }], metrics: [metric] };

function fakeClient(versions) {
  const calls = [];
  return {
    dataset, calls,
    async queryDataset(id, query) {
      calls.push({ id, query });
      const version = versions[Math.min(calls.length - 1, versions.length - 1)];
      return { rows: [], metrics: [{ ...metric, version }] };
    },
  };
}

async function mount(t, client) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  function Harness() {
    const [draft, dispatch] = useReducer(authorReducer, { ...emptyDraft(), dataset });
    return createElement(OEntry, { draft, dispatch, client });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
  return {
    renderer, flush,
    // Grounding lines render as two adjacent text nodes (label + value), which
    // JSON-serialise with a '","' seam; remove the seam so assertions read naturally.
    text: () => JSON.stringify(renderer.toJSON()).replaceAll('","', ''),
    click: async label => {
      const button = renderer.root.findAllByType('button').find(b => b.props['aria-label'] === label || b.props.children === label);
      assert.ok(button, label); await act(() => button.props.onClick()); await flush();
    },
    ask: async value => {
      await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value } }));
      await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
      await flush();
    },
  };
}

test('grounding names the executed metric version and keeps the interpreted version separate', async t => {
  const client = fakeClient([3]);
  const ui = await mount(t, client);
  await ui.ask('profit rate by region');
  assert.equal(client.calls.length, 1);
  assert.match(ui.text(), /Governed metrics \(as executed\): Margin · version 3/);
  assert.match(ui.text(), /Interpreted against: Margin · version 2/);
  assert.doesNotMatch(ui.text(), /Governed metrics: Margin · version 2/);
});

test('grounding follows a re-query after step edits to the newly executed version', async t => {
  const client = fakeClient([3, 4]);
  const ui = await mount(t, client);
  await ui.ask('profit rate by region top 1');
  assert.match(ui.text(), /Governed metrics \(as executed\): Margin · version 3/);
  await act(() => ui.renderer.root.findByProps({ 'aria-label': 'Top N step' }).props.onChange({ target: { value: '2' } }));
  await ui.flush();
  assert.equal(client.calls.length, 2);
  assert.match(ui.text(), /Governed metrics \(as executed\): Margin · version 4/);
  assert.match(ui.text(), /Interpreted against: Margin · version 2/);
});

test('no interpreted-against line when the executed version matches the interpreted one', async t => {
  const client = fakeClient([2]);
  const ui = await mount(t, client);
  await ui.ask('profit rate by region');
  assert.match(ui.text(), /Governed metrics \(as executed\): Margin · version 2/);
  assert.doesNotMatch(ui.text(), /Interpreted against:/);
});

test('without a client the fixture grounding keeps the interpretation-time label', async t => {
  const ui = await mount(t, undefined);
  await ui.ask('profit rate by region');
  assert.match(ui.text(), /Governed metrics: Margin · version 2/);
  assert.doesNotMatch(ui.text(), /as executed/);
});
