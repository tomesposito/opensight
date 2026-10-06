import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ROLES, hasCapability } from '@opensight/query-engine/browser';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { Author } from '../build/test/Author.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { QSidePanel } from '../build/test/QSidePanel.js';
import { OEntry } from '../build/test/OEntry.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { activeSheet, emptyDraft } from '../build/test/authoring.js';
import { createDraftStore } from '../build/test/local-drafts.js';

const fixture = { id: 'sample', name: 'Sample sales', description: '', notice: '', provenance: 'Synthetic data', sheets: [] };
async function mount(t, element, access = demoAccess) {
  const previous = { window: globalThis.window, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = { localStorage: storage, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let focused, renderer, keydown;
  const triggerNode = { focus: () => { focused = 'trigger'; } };
  const inputNode = { focus: () => { focused = 'question'; } };
  const panelNode = { querySelector: selector => selector === 'input[type="search"]' ? inputNode : null, ownerDocument: {
    addEventListener(type, listener) { if (type === 'keydown') keydown = listener; },
    removeEventListener(type, listener) { if (type === 'keydown' && keydown === listener) keydown = undefined; },
  } };
  const wrap = access => createElement(AccessProvider, { access }, element);
  await act(() => { renderer = create(wrap(access), { createNodeMock: node => node.props.className === 'q-trigger' ? triggerNode : node.props.className === 'q-side-panel' ? panelNode : null }); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = previous.window; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act; });
  return {
    renderer, focused: () => focused, keydown: async event => { await act(() => keydown?.(event)); }, listening: () => !!keydown,
    trigger: () => renderer.root.findByProps({ className: 'q-trigger' }),
    panel: () => renderer.root.findByProps({ role: 'dialog' }),
    saved: () => createDraftStore(() => storage, demoAccess).restore()?.draft,
    click: async name => {
      const button = renderer.root.findAllByType('button').find(n => n.props.children === name || n.props['aria-label'] === name);
      assert.ok(button, name); await act(() => button.props.onClick());
    },
    ask: async question => {
      await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: question } }));
      await act(() => renderer.root.findByProps({ className: 'o-bar' }).props.onSubmit({ preventDefault() {} }));
    },
    access: async next => { await act(() => renderer.update(wrap(next))); },
  };
}

for (const surface of ['Home', 'Author']) test(`${surface}: Ask Q opens a named dialog, focuses the query and restores trigger focus on Escape and Close`, async t => {
  const ui = await mount(t, surface === 'Author' ? createElement(Author) : createElement(Dashboard, { fixture, sample: true }));
  assert.equal(ui.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(ui.renderer.root.findAllByType(OEntry).length, 0, 'no inline interpreter');
  assert.equal(ui.trigger().type, 'button');
  assert.equal(ui.trigger().props['aria-expanded'], false);
  await act(() => ui.trigger().props.onClick());
  const panel = ui.panel();
  assert.equal(ui.trigger().props['aria-controls'], panel.props.id);
  assert.equal(ui.renderer.root.findByProps({ id: panel.props['aria-labelledby'] }).props.children, 'ASK Q');
  assert.equal(ui.focused(), 'question');
  assert.equal(ui.trigger().props['aria-expanded'], true);
  await ui.ask('revenue by region');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Local deterministic interpreter · No AI/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Interpreted question/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /grammar match/);
  assert.equal(panel.findByType(VisualCard).props.visual.rows[0]['O sum revenue'], 500);
  const alternative = panel.findAllByType('button').find(b => String(b.props.children[0]).includes('Showing avg'));
  assert.ok(alternative, 'Did you mean alternatives');
  await act(() => alternative.props.onClick());
  assert.equal(panel.findByType(VisualCard).props.visual.rows[0]['O avg revenue'], 125);
  assert.equal(panel.findAllByType('button').filter(b => b.props.children === 'ADD TO ANALYSIS').length, surface === 'Author' ? 1 : 0);
  if (surface === 'Author') {
    await ui.click('ADD TO ANALYSIS');
    await ui.click('Save draft');
    assert.equal(activeSheet(ui.saved()).visuals[0].measures[0], 'O avg revenue');
    assert.equal(panel.findAllByType(VisualCard).length, 0);
  } else {
    await ui.click('Close answer');
    assert.equal(panel.findAllByType(VisualCard).length, 0);
  }
  let prevented = false;
  await ui.keydown({ key: 'Enter' });
  assert.equal(ui.panel(), panel, 'other keys do not dismiss the panel');
  await ui.keydown({ key: 'Escape', defaultPrevented: true });
  assert.equal(ui.panel(), panel, 'consumed Escape events do not dismiss the panel');
  await ui.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(ui.listening(), false, 'closing removes the document listener');
  assert.equal(ui.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(ui.focused(), 'trigger');
  assert.equal(ui.trigger().props['aria-expanded'], false);
  await act(() => ui.trigger().props.onClick());
  assert.equal(ui.focused(), 'question');
  assert.equal(ui.renderer.root.findByProps({ id: 'o-question' }).props.value, '', 'reopening starts a fresh question');
  await ui.click('Close Ask Q');
  assert.equal(ui.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(ui.focused(), 'trigger');
});

test('Q trigger preserves hosted capability gating and leaves non-AI author toolbars available', () => {
  for (const role of [...ROLES, undefined]) {
    const access = { mode: 'hosted', session: role ? { id: 'test', namespaceId: 'test', name: 'Test', role } : undefined };
    const html = renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(QSidePanel, { draft: emptyDraft(), renderTrigger: trigger => createElement('nav', {}, 'Toolbar', trigger) })));
    assert.match(html, /Toolbar/);
    assert.equal(html.includes('Ask a question'), hasCapability(role, 'ai'));
  }
});

test('hosted dashboard keeps published query scope, aborts preview on close and hides Q after access revocation', async t => {
  const calls = [];
  const client = { queryDataset() { assert.fail('Must use published O query'); }, async queryO(...args) { calls.push(args); return { rows: [] }; } };
  const access = { mode: 'hosted', session: { id: 'test', namespaceId: 'test', name: 'Test', role: 'reader_ai' } };
  const ui = await mount(t, createElement(Dashboard, { fixture, hosted: true, dashboardId: 'published', client }), access);
  await act(() => ui.trigger().props.onClick());
  await ui.ask('revenue by region');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'published');
  assert.equal(calls[0][2].aborted, false);
  await ui.click('Close Ask Q');
  assert.equal(calls[0][2].aborted, true);
  await act(() => ui.trigger().props.onClick());
  await ui.access({ ...access, session: { ...access.session, role: 'reader' } });
  assert.equal(ui.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(ui.renderer.root.findAllByType('button').filter(b => b.props.className === 'q-trigger').length, 0);
});
