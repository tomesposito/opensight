import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessProvider } from '../build/test/access.js';
import { McpConnections } from '../build/test/McpConnections.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
const access = { mode: 'hosted', session: { id: 'member', tenantId: 'workspace', role: 'reader', name: 'Member', workspaceName: 'Synthetic workspace' } };
const rows = [{ id: 'one', clientName: 'Synthetic connector', scopes: ['opensight/mcp.read'], createdAt: 1000, expiresAt: Date.now() + 100000, revoked: false }];
async function mount(t, client) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true; let tree;
  await act(async () => { tree = create(createElement(AccessProvider, { access }, createElement(McpConnections, { client }))); });
  t.after(async () => { await act(async () => tree.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; }); return tree;
}
test('every member has an account connections link and can revoke their listed grant', async t => {
  assert.match(renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(AppNavigation, { route: { page: 'home' }, navigate() {} }))), /href="#\/account\/connections"/);
  const revoked = [], tree = await mount(t, { mcpConnections: async () => ({ connections: rows }), revokeMcpConnection: async id => revoked.push(id) });
  assert.match(JSON.stringify(tree.toJSON()), /Synthetic connector/);
  await act(async () => tree.root.findByProps({ 'aria-label': 'Revoke access for Synthetic connector' }).props.onClick());
  assert.deepEqual(revoked, ['one']); assert.equal(tree.root.findByProps({ 'aria-label': 'Revoke access for Synthetic connector' }).props.disabled, true);
  assert.match(JSON.stringify(tree.toJSON()), /Access revoked/);
});
test('a revoke failure leaves the connection active and retryable', async t => {
  const tree = await mount(t, { mcpConnections: async () => ({ connections: rows }), revokeMcpConnection: async () => { throw Error(); } });
  await act(async () => tree.root.findByType('button').props.onClick());
  assert.match(tree.root.findByProps({ role: 'alert' }).props.children.join(''), /could not be revoked/); assert.equal(tree.root.findByType('button').props.disabled, false);
});
test('empty and demo states do not invent connections', async t => {
  const tree = await mount(t, { mcpConnections: async () => ({ connections: [] }) }); assert.match(JSON.stringify(tree.toJSON()), /No connected apps yet/);
  const html = renderToStaticMarkup(createElement(AccessProvider, { access: { mode: 'demo' } }, createElement(McpConnections, { client: {} })));
  assert.match(html, /Needs hosted API/); assert.doesNotMatch(html, /Revoke/);
});
