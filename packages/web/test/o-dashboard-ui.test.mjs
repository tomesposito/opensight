import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { interpretQuestion } from '@opensight/o-interpreter';
import { AccessProvider } from '../build/test/access.js';
import { OEntry } from '../build/test/OEntry.js';
import { OSteps } from '../build/test/OSteps.js';
import { activeSheet, emptyDraft, authorReducer, dataFields } from '../build/test/authoring.js';
import { prepareOVisual } from '../build/test/o-authoring.js';
const result = question => ({ ...interpretQuestion(question, dataFields([])), question });
const status = { configured: true, state: 'configured', mode: 'managed' };
async function mount(t, options = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const actions = [], calls = [], aiClient = { getAIStatus: async () => options.status ?? status,
    planO: async body => { calls.push(['plan', body]); return { sheetTitle: 'Sales overview', delivered: 2, tiles: ['sum revenue', 'sum revenue by region'].map(question => ({ question, status: 'ok', result: result(question) })) }; },
    generateO: async () => { throw Error('Re-ask failed'); }, reviseO: async body => { calls.push(['revise', body]); return result('sum revenue by order_date per month'); }, ...options.aiClient };
  const draft = options.draft ?? emptyDraft(); let renderer, preview = null, outline;
  const props = { draft, dispatch: action => actions.push(action), onCanvasPreview: node => { preview = node; }, onRevisionPreview: id => { outline = id; }, ...options.props };
  const render = () => createElement(AccessProvider, { access: { mode: 'hosted', session: { id: 'u', namespaceId: 'default', role: 'author_ai', name: 'Author' }, aiClient } }, createElement(OEntry, props));
  await act(() => { renderer = create(render()); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
  return { renderer, actions, calls, draft, props, get preview() { return preview; }, get outline() { return outline; }, update: async () => { await act(() => renderer.update(render())); } };
}
const button = (r, label) => r.root.findAllByType('button').find(b => b.props.children === label);
const toggle = async f => act(() => f.renderer.root.findByProps({ role: 'switch' }).props.onChange({ target: { checked: true } }));
async function build(f) {
  await toggle(f); await act(() => button(f.renderer, 'Build a dashboard').props.onClick());
  await act(() => f.renderer.root.findByProps({ 'aria-label': 'Dashboard prompt' }).props.onChange({ target: { value: 'Sales overview' } }));
  await act(() => f.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
}
function nodeButton(node, label) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(n => nodeButton(n, label)).find(Boolean);
  if (node.type === 'button' && node.props.children === label) return node;
  return nodeButton(node.props?.children, label);
}
test('#196 Build is author-only and entirely absent without generative mode', async t => {
  const f = await mount(t); assert.equal(button(f.renderer, 'Build a dashboard'), undefined); await toggle(f); assert.ok(button(f.renderer, 'Build a dashboard'));
  const reader = await mount(t, { props: { dispatch: undefined } }); await toggle(reader); assert.equal(button(reader.renderer, 'Build a dashboard'), undefined);
  const off = await mount(t, { status: { configured: false, state: 'not-configured' } }); assert.equal(button(off.renderer, 'Build a dashboard'), undefined); assert.equal(off.renderer.root.findAllByProps({ 'aria-label': 'Revise this tile' }).length, 0);
});
test('#196 staged preview, edits, failed re-ask and discard never mutate the real draft', async t => {
  const f = await mount(t), before = JSON.stringify(f.draft); await build(f);
  assert.equal(f.actions.length, 0); assert.ok(f.preview); assert.match(JSON.stringify(f.renderer.toJSON()), /Removed tiles were delivered and charged/);
  const steps = f.renderer.root.findByType(OSteps); await act(() => steps.props.edit({ aggregation: 'AVG' }));
  await act(() => button(f.renderer, 'Re-ask').props.onClick()); assert.match(JSON.stringify(f.renderer.toJSON()), /Re-ask failed/);
  assert.equal(f.renderer.root.findByType(OSteps).props.interpretation.aggregation, 'AVG');
  await act(() => nodeButton(f.preview, 'Discard proposed sheet').props.onClick());
  assert.equal(f.preview, null); assert.equal(f.actions.length, 0); assert.equal(JSON.stringify(f.draft), before);
});
test('#196 one commit carries final steps and only kept tiles; last-credit preview remains committable', async t => {
  let called = false;
  const f = await mount(t, { aiClient: { getAIStatus: async () => ({ ...status, configured: !called, state: called ? 'credit-limit' : 'configured' }), planO: async () => { called = true; return { sheetTitle: 'Sales', delivered: 1, tiles: [{ question: 'sum revenue', status: 'ok', result: result('sum revenue') }] }; } } });
  await build(f); await act(() => f.renderer.root.findByType(OSteps).props.edit({ aggregation: 'AVG' }));
  await act(() => nodeButton(f.preview, 'Add as new sheet').props.onClick());
  assert.equal(f.actions.length, 1); assert.equal(f.actions[0].type, 'o-add-many'); assert.deepEqual(f.actions[0].target, { kind: 'new-sheet', name: 'Sales' }); assert.equal(f.actions[0].items[0].visual.o.interpretation.aggregation, 'AVG'); assert.equal(f.preview, null);
});
test('#196 new-route 404 fails closed as not configured without a local planner', async () => {
  const { createApiClient } = await import('../build/test/api-client.js');
  const client = createApiClient('/', async () => Response.json({ Message: 'Missing route' }, { status: 404 }));
  for (const call of [() => client.planO({ question: 'overview' }), () => client.reviseO({ question: 'monthly', currentQuestion: 'sum revenue' })]) await assert.rejects(call(), { errorCode: 'AI_NOT_CONFIGURED', status: 404 });
});
