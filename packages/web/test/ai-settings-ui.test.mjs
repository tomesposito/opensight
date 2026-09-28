import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AISettings } from '../build/test/AISettings.js';
import { AccessProvider } from '../build/test/access.js';
import { createApiClient } from '../build/test/api-client.js';
const access = role => ({ mode: 'hosted', session: { id: 'u', namespaceId: 'default', name: 'User', role } });
const initial = { provider: null, model: '', configured: false, state: 'not-configured', hasKey: false, keyStorage: 'encrypted-file', canSaveKey: true, compatibleBaseUrls: [] };

test('settings page gates all non-admin roles and static demo before fetching configuration', () => {
  let calls = 0;
  const client = { getAIConfig() { calls++; } };
  for (const role of ['author', 'author_ai', 'reader', 'reader_ai', undefined]) {
    const html = renderToStaticMarkup(createElement(AccessProvider, { access: access(role) }, createElement(AISettings, { client })));
    assert.match(html, /SECURITY_ADMIN_REQUIRED/); assert.doesNotMatch(html, /password|Test connection/);
  }
  assert.match(renderToStaticMarkup(createElement(AISettings, { client })), /Hosted administrator/);
  assert.equal(calls, 0);
});
test('admin settings save provider/model, clear key entry, test connection and show Bedrock approval state', async t => {
  const before = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, config = initial; const calls = [];
  const client = { async getAIConfig() { return config; }, async saveAIConfig(value) { calls.push(value); return config = { ...config, ...value }; }, async saveAIKey(key) { calls.push({ key }); return config = { ...config, hasKey: true, configured: true, state: 'configured' }; }, async testAIConnection() { calls.push('test'); } };
  await act(() => { renderer = create(createElement(AccessProvider, { access: access('administrator') }, createElement(AISettings, { client }))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = before; });
  await act(() => renderer.root.findAllByType('input').find(i => i.props.maxLength === 256).props.onChange({ target: { value: 'selected-model' } }));
  await act(() => renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[0], { provider: 'openai', model: 'selected-model' });
  await act(() => renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'synthetic-ui-secret' } }));
  await act(() => renderer.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }));
  assert.equal(renderer.root.findByProps({ type: 'password' }).props.value, '');
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('synthetic-ui-secret'));
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'Test connection').props.onClick());
  assert.equal(calls.at(-1), 'test');
  await act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'bedrock' } }));
  assert.match(JSON.stringify(renderer.toJSON()), /AI_BEDROCK_APPROVAL_REQUIRED/);
  assert.equal(renderer.root.findByProps({ type: 'password' }).props.disabled, true);
});
test('client sends keys only to the write-only route and surfaces named failures', async () => {
  const calls = [];
  const client = createApiClient('/mount', async (url, init) => { calls.push({ url, init }); return Response.json({ errorCode: 'AI_AUTH_FAILED', Message: 'Connection failed' }, { status: 502 }); });
  await assert.rejects(client.saveAIKey('synthetic-ui-secret'), /AI_AUTH_FAILED/);
  assert.equal(calls[0].url, '/mount/api/admin/ai/key');
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].init.body), { key: 'synthetic-ui-secret' });
});
