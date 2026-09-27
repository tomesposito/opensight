import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingClient, ssoNotConfigured } from '@opensight/embedding-sdk';
const apiOrigin = 'https://api.example.com', parentOrigin = 'https://app.example.com';
const request = { dashboardId: 'dashboard', parentOrigin };
const signed = { url: `${apiOrigin}/embed/dashboards/dashboard?token=payload.${'A'.repeat(43)}`, expiresAt: new Date(Date.now() + 300000).toISOString() };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function dom() {
  const listeners = new Set(), frameListeners = new Map(), frames = [];
  const view = { location: { origin: parentOrigin }, addEventListener: (name, fn) => { if (name === 'message') listeners.add(fn); }, removeEventListener: (_, fn) => listeners.delete(fn) };
  const container = { ownerDocument: { defaultView: view, createElement: () => ({ style: {}, contentWindow: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener: (k, fn) => frameListeners.set(k, fn), removeEventListener: k => frameListeners.delete(k), remove() { frames.splice(frames.indexOf(this), 1); } }) }, appendChild(frame) { frames.push(frame); } };
  return { container, frames, listeners, emit: event => { for (const fn of listeners) fn(event); } };
}
test('SDK issues authenticated requests and retries once through the host SSO hook without sending principal assertions', async () => {
  const calls = []; let signedIn = false, hooks = 0;
  const client = createEmbeddingClient({ apiOrigin, getAuthorization: () => signedIn ? 'Bearer synthetic-test' : undefined,
    onAuthenticationRequired: async () => { hooks++; signedIn = true; }, fetch: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? json({}, 401) : json(signed); } });
  assert.deepEqual(await client.generateEmbedUrl(request), signed);
  assert.equal(hooks, 1); assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-test');
  assert.deepEqual(JSON.parse(calls[1].options.body), { parentOrigin });
  assert.equal(calls[1].options.redirect, 'error'); assert.equal(calls[1].options.cache, 'no-store');
  await assert.rejects(ssoNotConfigured(), { code: 'SSO_NOT_CONFIGURED' });
});
test('SDK fails closed on invalid origins, IDs, expiry, API errors and hostile response URLs', async () => {
  for (const value of ['https://api.example.com/path', 'http://remote.example.com', 'javascript:alert(1)', 'https://api.example.com/']) assert.throws(() => createEmbeddingClient({ apiOrigin: value }));
  let calls = 0; const client = createEmbeddingClient({ apiOrigin, fetch: async () => { calls++; return json(signed); } });
  await assert.rejects(client.generateEmbedUrl({ ...request, dashboardId: '../x' }), { code: 'INVALID_RESOURCE_ID' });
  await assert.rejects(client.generateEmbedUrl({ ...request, expiresInSeconds: 901 }), { code: 'INVALID_EXPIRY' });
  assert.equal(calls, 0);
  for (const url of [signed.url.replace(apiOrigin, 'https://evil.example'), `${signed.url}&extra=1`, signed.url.replace('/dashboard?', '/other?'), 'javascript:alert(1)', `${signed.url}#fragment`]) {
    await assert.rejects(createEmbeddingClient({ apiOrigin, fetch: async () => json({ ...signed, url }) }).generateEmbedUrl(request), { code: 'INVALID_RESPONSE' });
  }
  await assert.rejects(createEmbeddingClient({ apiOrigin, fetch: async () => json({}, 403) }).generateEmbedUrl(request), { code: 'HTTP_403' });
  await assert.rejects(createEmbeddingClient({ apiOrigin, fetch: async () => json({ ...signed, expiresAt: 'invalid' }) }).generateEmbedUrl(request), { code: 'INVALID_RESPONSE' });
});
test('dashboard and visual mounts verify message source/origin/scope, refresh URLs and clean up their frame/listeners', async () => {
  for (const visualId of [undefined, 'visual']) {
    const d = dom(); let ready = 0, expired = 0, requests = 0;
    const client = createEmbeddingClient({ apiOrigin, fetch: async (_, options) => { requests++; assert.equal(JSON.parse(options.body).visualId, visualId); return json(signed); } });
    const callbacks = { onReady: () => ready++, onExpired: () => expired++ };
    const handle = await (visualId ? client.embedVisual(d.container, { ...request, visualId }, callbacks) : client.embedDashboard(d.container, request, callbacks));
    assert.equal(d.frames.length, 1); assert.equal(handle.iframe.src, signed.url);
    assert.equal(handle.iframe.referrerPolicy, 'no-referrer'); assert.equal(handle.iframe.attributes.sandbox, 'allow-scripts allow-same-origin');
    const event = { origin: apiOrigin, source: handle.iframe.contentWindow, data: { type: 'opensight:ready', dashboardId: request.dashboardId, visualId } };
    d.emit({ ...event, origin: 'https://evil.example' }); d.emit({ ...event, source: {} }); d.emit({ ...event, data: { ...event.data, dashboardId: 'other' } }); assert.equal(ready, 0);
    d.emit(event); assert.equal(ready, 1);
    d.emit({ ...event, data: { ...event.data, type: 'opensight:expired' } }); assert.equal(expired, 1);
    await handle.refresh(); assert.equal(requests, 2);
    handle.destroy(); handle.destroy(); assert.equal(d.frames.length, 0); assert.equal(d.listeners.size, 0);
    await assert.rejects(handle.refresh(), { code: 'EMBED_DESTROYED' });
  }
});
test('failed mounts clean up and mismatched parent origin never makes a request', async () => {
  const d = dom(); let calls = 0;
  const client = createEmbeddingClient({ apiOrigin, fetch: async () => { calls++; return json({}, 401); } });
  await assert.rejects(client.embedDashboard(d.container, { ...request, parentOrigin: 'https://other.example' }), { code: 'PARENT_ORIGIN_MISMATCH' });
  assert.equal(calls, 0);
  await assert.rejects(client.embedDashboard(d.container, request), { code: 'HTTP_401' });
  assert.equal(d.listeners.size, 0); assert.equal(d.frames.length, 0);
});
