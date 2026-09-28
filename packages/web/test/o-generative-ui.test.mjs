import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { OEntry } from '../build/test/OEntry.js';
import { BuildForMe } from '../build/test/BuildForMe.js';
import { emptyDraft } from '../build/test/authoring.js';
import { interpretQuestion } from '@opensight/o-interpreter';
import { dataFields } from '../build/test/authoring.js';
const context = (role, aiClient) => ({ mode: 'hosted', session: { id: 'u', namespaceId: 'default', name: 'User', role }, aiClient });
async function mount(t, component, access) {
  const before = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(AccessProvider, { access }, component)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = before; });
  return renderer;
}
const status = { configured: true, state: 'configured' };
const answer = () => interpretQuestion('sum revenue', dataFields([]));

test('generative O enables with configured provider, submits server request and ignores stale responses', async t => {
  let resolve; const requests = [];
  const aiClient = { async getAIStatus() { return status; }, generateO(body) { requests.push(body); return new Promise(r => { resolve = r; }); } };
  const renderer = await mount(t, createElement(OEntry, { draft: emptyDraft(), dashboardId: 'published' }), context('reader_ai', aiClient));
  assert.equal(renderer.root.findByProps({ role: 'switch' }).props.disabled, false);
  await act(() => renderer.root.findByProps({ role: 'switch' }).props.onChange({ target: { checked: true } }));
  await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: 'How much did we sell?' } }));
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(requests[0], { question: 'How much did we sell?', calculatedFields: [], dashboardId: 'published' });
  await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: 'Changed question' } }));
  await act(() => resolve(answer()));
  assert.equal(renderer.root.findAllByProps({ className: 'o-answer' }).length, 0);
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  await act(() => resolve(answer()));
  assert.equal(renderer.root.findAllByProps({ className: 'o-answer' }).length, 1);
  assert.equal(renderer.root.findAllByType('button').some(b => b.props.children === 'ADD TO ANALYSIS'), false);
});
test('provider failure is displayed with no silent deterministic fallback', async t => {
  const aiClient = { async getAIStatus() { return status; }, async generateO() { throw new Error('AI_PROVIDER_FAILED: unavailable'); } };
  const renderer = await mount(t, createElement(OEntry, { draft: emptyDraft() }), context('author_ai', aiClient));
  await act(() => renderer.root.findByProps({ role: 'switch' }).props.onChange({ target: { checked: true } }));
  await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: 'sum revenue' } }));
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(JSON.stringify(renderer.toJSON()), /AI_PROVIDER_FAILED/);
  assert.equal(renderer.root.findAllByProps({ className: 'o-answer' }).length, 0);
});
test('AI Build for me requires explicit insertion of a validated server suggestion', async t => {
  let inserted; const requests = [];
  const suggestion = { name: 'Double', expression: '{revenue} * 2', role: 'measure', explanation: 'Double revenue.' };
  const aiClient = { async getAIStatus() { return status; }, async generateCalculation(body) { requests.push(body); return { suggestion }; } };
  const renderer = await mount(t, createElement(BuildForMe, { fields: [], onInsert(value) { inserted = value; } }), context('author_ai', aiClient));
  await act(() => renderer.root.findByProps({ role: 'switch' }).props.onChange({ target: { checked: true } }));
  await act(() => renderer.root.findByProps({ maxLength: 2000 }).props.onChange({ target: { value: 'Double sales' } }));
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'Suggest expression').props.onClick());
  assert.equal(requests[0].question, 'Double sales'); assert.equal(inserted, undefined);
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'INSERT EXPRESSION').props.onClick());
  assert.equal(inserted.expression, '{revenue} * 2');
});
test('plain authors keep only deterministic templates and cannot fetch AI configuration', async t => {
  let calls = 0;
  const aiClient = { async getAIStatus() { calls++; return status; } };
  const renderer = await mount(t, createElement(BuildForMe, { fields: [], onInsert() {} }), context('author', aiClient));
  assert.equal(renderer.root.findByProps({ role: 'switch' }).props.disabled, true); assert.equal(calls, 0);
});
