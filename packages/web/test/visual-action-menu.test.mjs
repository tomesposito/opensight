import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisualActionMenu } from '../build/test/VisualActionMenu.js';

const items = [
  { id: 'f1', name: 'Filter region', sourceField: 'region', targets: 'all', mappings: {}, activation: 'menu' },
  { id: 'u1', name: 'Open page', sourceField: 'region', urlTemplate: 'https://example.com/{region}', activation: 'menu' },
];
const selection = { values: { region: 'East' } };
const noop = () => {};

async function openMenu(t, props) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(VisualActionMenu, props)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const toggle = renderer.root.findByProps({ 'aria-label': 'Run action' });
  let stopped = false;
  await act(() => toggle.props.onClick({ stopPropagation() { stopped = true; } }));
  return { renderer, stopped };
}

test('closed menu exposes the menubutton a11y contract and no menu', () => {
  const html = renderToStaticMarkup(createElement(VisualActionMenu, { items, onInvoke: noop }));
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Run action"/);
  assert.doesNotMatch(html, /role="menu"/);
  assert.ok(html.includes('⋯'));
});

test('open menu without a selection disables every item with the first-selection title', async t => {
  const { renderer, stopped } = await openMenu(t, { items, onInvoke: noop });
  assert.equal(stopped, true);
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Run action' }).props['aria-expanded'], true);
  const menu = renderer.root.findByProps({ role: 'menu' });
  assert.equal(menu.children.length, 2);
  for (const item of renderer.root.findAllByProps({ role: 'menuitem' })) {
    assert.equal(item.props.disabled, true);
    assert.equal(item.props.title, 'Select a data point first');
  }
  assert.deepEqual(renderer.root.findAllByProps({ role: 'menuitem' }).map(i => i.children.join('')), ['Filter region', 'Open page']);
});

test('open menu with a selection enables items and drops the title', async t => {
  const { renderer } = await openMenu(t, { items, selection, onInvoke: noop });
  for (const item of renderer.root.findAllByProps({ role: 'menuitem' })) {
    assert.equal(item.props.disabled, false);
    assert.equal(item.props.title, undefined);
  }
});

test('invoking a menu item calls onInvoke with the action and closes the menu', async t => {
  let invoked;
  const { renderer } = await openMenu(t, { items, selection, onInvoke: action => { invoked = action; } });
  const [first] = renderer.root.findAllByProps({ role: 'menuitem' });
  let stopped = false;
  await act(() => first.props.onClick({ stopPropagation() { stopped = true; } }));
  assert.equal(stopped, true);
  assert.equal(invoked, items[0]);
  assert.equal(renderer.root.findAllByProps({ role: 'menu' }).length, 0);
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Run action' }).props['aria-expanded'], false);
});
