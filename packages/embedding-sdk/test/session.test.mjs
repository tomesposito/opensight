import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
import { createSessionEmbeddingClient } from '../dist/index.js';
const origin = 'https://embed.example', parent = 'https://product.example';
function issued() { const id = randomBytes(24).toString('base64url'); return { sessionId: id, EmbedUrl: `${origin}/embed/sessions/${id}#bootstrap=key.${id}.${randomBytes(32).toString('base64url')}.${randomBytes(32).toString('base64url')}`, bootstrapExpiresAt: new Date(Date.now() + 300000).toISOString(), SessionLifetimeInMinutes: 600, configRevision: 1 }; }
function dom() {
  const listeners = new Map(), frameListeners = new Map(), messages = [], frames = [];
  const view = { location: { origin: parent }, crypto: webcrypto, addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: k => listeners.delete(k) };
  const container = { ownerDocument: { defaultView: view, createElement: () => ({ style: {}, contentWindow: { postMessage: (data, target) => messages.push({ data, target }) }, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener: (k, fn) => frameListeners.set(k, fn), removeEventListener: k => frameListeners.delete(k), remove() { frames.splice(frames.indexOf(this), 1); } }) }, appendChild(frame) { frames.push(frame); } };
  return { container, frames, messages, view, emit: e => listeners.get('message')?.(e), loaded: () => frameListeners.get('load')?.(), listeners };
}
test('H6 SDK checks origin, frame, version, session and refresh generation; sends only handshake metadata', async () => {
  const d = dom(); let ready = 0, expired = 0, revoked = 0;
  const client = createSessionEmbeddingClient({ allowedEmbedOrigins: [origin], getEmbedUrl: async () => issued() });
  const handle = await client.mount(d.container, { onReady: () => ready++, onSessionExpired: () => expired++, onAuthorizationRevoked: () => revoked++ });
  d.loaded(); const init = d.messages[0]; assert.equal(init.target, origin); assert.deepEqual(Object.keys(init.data).sort(), ['channelId', 'sessionId', 'type', 'version']);
  const data = { ...init.data, type: 'opensight:session', event: 'ready' }, event = { origin, source: handle.iframe.contentWindow, data };
  for (const forged of [{ ...event, origin: 'https://evil.example' }, { ...event, source: {} }, { ...event, data: { ...data, version: 1 } }, { ...event, data: { ...data, channelId: 'forged' } }, { ...event, data: { ...data, sessionId: 'forged' } }, { ...event, data: { ...data, credential: 'should never be forwarded' } }]) d.emit(forged);
  assert.equal(ready, 0); d.emit(event); assert.equal(ready, 1);
  d.emit({ ...event, data: { ...data, event: 'sessionExpired' } }); d.emit({ ...event, data: { ...data, event: 'authorizationRevoked' } }); assert.equal(expired, 1); assert.equal(revoked, 1);
  await handle.refresh(); d.loaded(); d.emit(event); assert.equal(ready, 1);
  d.emit({ ...event, data: { ...d.messages.at(-1).data, type: 'opensight:session', event: 'ready' } }); assert.equal(ready, 2);
  handle.destroy(); handle.destroy(); assert.equal(d.listeners.size, 0); assert.equal(d.frames.length, 0);
  await assert.rejects(handle.refresh(), { code: 'EMBED_DESTROYED' });
});
test('H6 SDK refuses untrusted URLs, same-origin frames, malformed/expired bootstraps and cleans failed mounts', async () => {
  for (const attack of [r => ({ ...r, EmbedUrl: r.EmbedUrl.replace(origin, 'https://evil.example') }), r => ({ ...r, EmbedUrl: r.EmbedUrl.replace('#', '?token=leak#') }), r => ({ ...r, sessionId: 'wrong' }), r => ({ ...r, bootstrapExpiresAt: '2000-01-01T00:00:00Z' }), r => ({ ...r, EmbedUrl: r.EmbedUrl.replace('#bootstrap=', '#token=') })]) {
    const d = dom(), client = createSessionEmbeddingClient({ allowedEmbedOrigins: [origin], getEmbedUrl: async () => attack(issued()) });
    await assert.rejects(client.mount(d.container), { code: 'INVALID_RESPONSE' }); assert.equal(d.listeners.size, 0);
  }
  const d = dom(); await assert.rejects(createSessionEmbeddingClient({ allowedEmbedOrigins: [parent], getEmbedUrl: async () => issued() }).mount(d.container), { code: 'PARENT_ORIGIN_MISMATCH' });
  assert.throws(() => createSessionEmbeddingClient({ allowedEmbedOrigins: ['https://*.example/path'], getEmbedUrl: async () => issued() }), { code: 'INVALID_ORIGIN' });
});
test('H6 SDK racing refresh completion cannot overwrite a newer frame or survive destroy', async () => {
  const d = dom(); const pending = []; let calls = 0;
  const client = createSessionEmbeddingClient({ allowedEmbedOrigins: [origin], getEmbedUrl: async () => ++calls === 1 ? issued() : new Promise(resolve => pending.push(resolve)) });
  const handle = await client.mount(d.container), first = handle.refresh(), second = handle.refresh(), newest = issued();
  pending[1](newest); await second; pending[0](issued()); await first; assert.equal(handle.iframe.src, newest.EmbedUrl);
  const last = handle.refresh(); handle.destroy(); pending[2](issued()); await last; assert.equal(d.frames.length, 0);
});
