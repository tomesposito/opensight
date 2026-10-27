import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { emptyDraft } from '../build/test/authoring.js';
async function mount(t, mode, onPublish, publishing = false) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(() => { ui = create(h(AccessProvider, { access: { mode, session: { id: 'author', namespaceId: 'tenant', role: 'author' } } }, h(AuthorToolbar, { draft: emptyDraft(), dispatch() {}, fit: true, onFit() {}, onJson() {}, onBundle() {}, onImport() {}, onPublish, publishing }))); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  return { ui, button: () => ui.root.findAllByType('button').find(b => b.props.children === (publishing ? 'PUBLISHING…' : 'PUBLISH')), notice: () => ui.root.findByProps({ className: 'toolbar-notice' }).children.filter(c => typeof c === 'string').join('') };
}
test('hosted Publish presents progress, a real receipt, and named failures', async t => {
  let resolve, reject;
  const view = await mount(t, 'hosted', () => new Promise((yes, no) => { resolve = yes; reject = no; }));
  await act(() => view.button().props.onClick()); assert.match(view.notice(), /Saving analysis and publishing/);
  await act(() => resolve('Published “Daily Orders” · version 1.')); assert.match(view.notice(), /Published “Daily Orders”/);
  await act(() => view.button().props.onClick()); await act(() => reject(new Error('SECURITY_REJECTED: Dataset access was revoked.')));
  assert.match(view.notice(), /SECURITY_REJECTED/); assert.doesNotMatch(view.notice(), /Published “Daily Orders”/);
});
test('Publish is disabled throughout a hosted mutation', async t => {
  const view = await mount(t, 'hosted', () => assert.fail('must not publish'), true); assert.equal(view.button().props.disabled, true);
});
for (const mode of ['local', 'demo']) test(`${mode} Publish retains honest device-local notices and never calls hosted APIs`, async t => {
  const view = await mount(t, mode, () => assert.fail('must not publish'));
  await act(() => view.button().props.onClick()); assert.match(view.notice(), /no publication destination/); assert.match(view.notice(), /Drafts are device-local, not synced or shared/); assert.match(view.notice(), /Nothing has been published/);
});
