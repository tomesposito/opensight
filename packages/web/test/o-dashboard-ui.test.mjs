import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { interpretQuestion } from '@opensight/o-interpreter';
import { AccessProvider } from '../build/test/access.js';
import { OEntry } from '../build/test/OEntry.js';
import { OSteps } from '../build/test/OSteps.js';
import { ORevision } from '../build/test/ORevision.js';
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
  t.after(async () => { await act(() => renderer.unmount());  });
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
  const off = await mount(t, { status: { configured: false, state: 'not-configured' } }); assert.equal(button(off.renderer, 'Build a dashboard'), undefined); assert.equal(off.renderer.root.findAllByType(ORevision).length, 0);
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
const stamped = () => authorReducer(emptyDraft(), { type: 'o-add', ...prepareOVisual(result('sum revenue by region').interpretations[0]) });
test('#196 revise proposal seeds from stamp, outlines target, allows edits and discards untouched', async t => {
  const draft = stamped(), f = await mount(t, { draft }), before = JSON.stringify(draft); await toggle(f);
  await act(() => f.renderer.root.findByProps({ 'aria-label': 'Tile follow-up' }).props.onChange({ target: { value: 'monthly' } }));
  await act(() => f.renderer.root.findByType(ORevision).findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(f.calls[0][1].currentQuestion, activeSheet(draft).visuals[0].o.question); assert.equal(f.outline, activeSheet(draft).selectedId);
  assert.match(JSON.stringify(f.renderer.toJSON()), /Revision ready · 1 credit used/); assert.match(JSON.stringify(f.renderer.toJSON()), /Was:/);
  await act(() => f.renderer.root.findByType(OSteps).props.edit({ granularity: 'YEAR' })); await act(() => button(f.renderer, 'Replace').props.onClick());
  assert.equal(f.actions[0].type, 'o-replace'); assert.equal(f.actions[0].visual.o.interpretation.granularity, 'YEAR'); assert.equal(JSON.stringify(draft), before); assert.equal(f.outline, undefined);
  f.props.draft = authorReducer(draft, f.actions[0]); await f.update();
  await act(() => f.renderer.root.findByProps({ 'aria-label': 'Tile follow-up' }).props.onChange({ target: { value: 'monthly again' } }));
  await act(() => f.renderer.root.findByType(ORevision).findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(f.calls[1][1].currentQuestion, activeSheet(f.props.draft).visuals[0].o.question);
  const committed = JSON.stringify(f.props.draft);
  await act(() => button(f.renderer, 'Discard revision').props.onClick());
  assert.equal(f.actions.length, 1); assert.equal(JSON.stringify(f.props.draft), committed); assert.equal(f.outline, undefined);

});
test('#196 unstamped and stale governed metric seeds cannot replace', async t => {
  const unstamped = stamped(); delete activeSheet(unstamped).visuals[0].o;
  const f = await mount(t, { draft: unstamped }); await toggle(f);
  assert.match(JSON.stringify(f.renderer.toJSON()), /This visual wasn't created by Ask O/); assert.equal(button(f.renderer, 'Replace'), undefined); assert.equal(button(f.renderer, 'Propose revision'), undefined);
  const stale = stamped(); activeSheet(stale).visuals[0].o.interpretation.grounding.metricsUsed = [{ id: 'net', name: 'Net sales', version: 1 }];
  const g = await mount(t, { draft: stale }), before = JSON.stringify(stale); await toggle(g);
  await act(() => g.renderer.root.findByProps({ 'aria-label': 'Tile follow-up' }).props.onChange({ target: { value: 'monthly' } }));
  await act(() => g.renderer.root.findByType(ORevision).findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(JSON.stringify(g.renderer.toJSON()), /METRIC_STALE/); assert.equal(g.calls.length, 0); assert.equal(button(g.renderer, 'Replace'), undefined); assert.equal(JSON.stringify(stale), before);
});

test('#196 new-route 404 fails closed as not configured without a local planner', async () => {
  const { createApiClient } = await import('../build/test/api-client.js');
  const client = createApiClient('/', async () => Response.json({ Message: 'Missing route' }, { status: 404 }));
  for (const call of [() => client.planO({ question: 'overview' }), () => client.reviseO({ question: 'monthly', currentQuestion: 'sum revenue' })]) await assert.rejects(call(), { errorCode: 'AI_NOT_CONFIGURED', status: 404 });
});
