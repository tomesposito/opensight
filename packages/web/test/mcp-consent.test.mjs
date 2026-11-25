import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessProvider } from '../build/test/access.js';
import { McpConsent } from '../build/test/McpConsent.js';
import { mcpAuthorization, consentRedirect, mcpRead, mcpWrite } from '../build/test/mcp-oauth.js';
const access = { mode: 'hosted', session: { id: 'member', tenantId: 'workspace', namespaceId: 'workspace', role: 'reader', name: 'Synthetic member' } };
const interaction = { id: 'interaction', clientName: '<script>Untrusted client</script>', workspaceName: 'Synthetic workspace', redirectUri: 'https://connector.example/callback', scopes: [mcpRead, mcpWrite] };
const authorization = { params: { client_id: 'client' } };
async function mount(t, client) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let tree; const redirects = [];
  await act(async () => { tree = create(createElement(AccessProvider, { access }, createElement(McpConsent, { client, authorization, redirect: url => redirects.push(url) }))); });
  t.after(async () => { await act(async () => tree.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  return { tree, redirects };
}
test('authorization query rejects duplicates and unknown claims; redirects remain bound to consent destination', () => {
  assert.equal(mcpAuthorization(''), undefined);
  assert.deepEqual(mcpAuthorization('?mcp_oauth=1&client_id=client'), { params: { client_id: 'client' } });
  for (const search of ['?mcp_oauth=1&client_id=x&client_id=y', '?mcp_oauth=1&userId=admin', '?mcp_oauth=0']) assert.ok(mcpAuthorization(search).error);
  assert.equal(consentRedirect('https://connector.example/callback?code=example', interaction.redirectUri), 'https://connector.example/callback?code=example');
  for (const url of ['https://evil.example/callback', 'javascript:alert(1)', 'https://connector.example/different', 'https://connector.example/callback#token']) assert.throws(() => consentRedirect(url, interaction.redirectUri));
});
test('consent shows member/workspace/client and allows the user to choose read-only before approving', async t => {
  const calls = [];
  const { tree, redirects } = await mount(t, { mcpInteraction: async () => interaction, mcpAuthorize: async (...args) => { calls.push(args); return { redirect: 'https://connector.example/callback?code=example' }; } });
  const text = JSON.stringify(tree.toJSON()); assert.match(text, /Synthetic workspace/); assert.match(text, /Synthetic member/); assert.match(text, /existing workspace permissions/);
  const checkbox = tree.root.findAllByType('input')[1]; await act(async () => checkbox.props.onChange({ target: { checked: false } }));
  await act(async () => tree.root.findAllByType('button').find(b => b.props.children === 'Approve connection').props.onClick());
  assert.deepEqual(calls, [['interaction', 'approve', mcpRead]]); assert.equal(redirects.length, 1);
});
test('deny returns to the connector; failed requests show an error and never redirect', async t => {
  const calls = [];
  const f = await mount(t, { mcpInteraction: async () => interaction, mcpAuthorize: async (...args) => { calls.push(args); throw Error('synthetic'); } });
  await act(async () => f.tree.root.findAllByType('button')[0].props.onClick());
  assert.equal(calls[0][1], 'deny'); assert.equal(f.redirects.length, 0); assert.equal(f.tree.root.findByProps({ role: 'alert' }).props.children, 'The connection could not be completed. Start again from your connector.');
});
test('offline/demo consent is an honest hosted-API notice with no approval action', () => {
  const html = renderToStaticMarkup(createElement(AccessProvider, { access: { mode: 'demo' } }, createElement(McpConsent, { client: {}, authorization })));
  assert.match(html, /need a hosted API/); assert.doesNotMatch(html, /Approve connection/);
});
