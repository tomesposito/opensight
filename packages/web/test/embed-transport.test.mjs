import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startEmbedTransport } from '../build/test/embed-transport.js';
const id = randomBytes(24).toString('base64url'), credential = randomBytes(32).toString('base64url'), bootstrap = randomBytes(32).toString('base64url'), parentOrigin = 'https://product.example';
function browser() {
  const listeners = new Map(), docListeners = new Map(), timers = new Map(), intervals = new Map(), events = []; let next = 1;
  const parent = { postMessage: (data, target) => events.push({ data, target }) };
  const view = { parent, location: { origin: 'https://embed.example' }, document: { visibilityState: 'visible', addEventListener: (k, v) => docListeners.set(k, v), removeEventListener: k => docListeners.delete(k) },
    addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k),
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { const id = next++; intervals.set(id, { fn, ms }); return id; }, clearInterval: id => intervals.delete(id) };
  return { view, timers, intervals, events, listeners, emit: event => listeners.get('message')?.(event), visibility: value => { view.document.visibilityState = value; docListeners.get('visibilitychange')?.(); } };
}
const settle = () => new Promise(r => setImmediate(r));
const event = b => ({ source: b.view.parent, origin: parentOrigin, data: { type: 'opensight:initialize', version: 2, sessionId: id, channelId: randomBytes(24).toString('base64url') } });
test('H6 iframe rejects forged initialization and omits cookies; parent never receives credentials or content', async () => {
  const b = browser(), states = [], calls = [], expiresAt = Date.now() + 900000;
  const transport = startEmbedTransport({ sessionId: id, allowedDomains: [parentOrigin] }, bootstrap, s => states.push(s), async t => { await t.request('content'); t.ready(); }, b.view,
    async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(url.endsWith('/redeem') ? { credential, expiresAt } : { expiresAt }), { status: 200 }); });
  const valid = event(b);
  for (const forged of [{ ...valid, source: {} }, { ...valid, origin: 'https://evil.example' }, { ...valid, data: { ...valid.data, version: 1 } }, { ...valid, data: { ...valid.data, sessionId: 'other' } }, { ...valid, data: { ...valid.data, token: 'forged' } }]) b.emit(forged);
  await settle(); assert.equal(calls.length, 0); b.emit(valid); await settle();
  assert.deepEqual(states, ['ready']); assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.options.credentials === 'omit' && c.options.cache === 'no-store' && c.options.redirect === 'error'));
  assert.equal(calls[0].options.headers.Authorization, undefined); assert.equal(calls[1].options.headers.Authorization, `Embed ${credential}`);
  assert.ok(!JSON.stringify(b.events).includes(credential)); assert.ok(!JSON.stringify(b.events).includes(bootstrap));
  assert.equal(b.events[0].target, parentOrigin); assert.equal(b.events[0].data.event, 'ready');
  b.emit(valid); await settle(); assert.equal(calls.length, 3);
  transport.destroy(); assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0); assert.equal(b.intervals.size, 0);
});
test('H6 iframe revocation, status outage and expiry clear memory and view within the declared bound', async () => {
  for (const mode of ['revoked', 'outage', 'watchdog', 'expired']) {
    const b = browser(), states = [], expiresAt = Date.now() + 900000; let statusCalls = 0;
    const transport = startEmbedTransport({ sessionId: id, allowedDomains: [parentOrigin] }, bootstrap, s => states.push(s), async t => t.ready(), b.view, async url => {
      if (url.endsWith('/redeem')) return new Response(JSON.stringify({ credential, expiresAt }));
      if (++statusCalls > 1) {
        if (mode === 'outage') throw new Error('no network');
        return new Response(JSON.stringify({ errorCode: mode === 'expired' ? 'EMBED_SESSION_EXPIRED' : 'EMBED_SESSION_REVOKED' }), { status: 401 });
      }
      return new Response(JSON.stringify({ expiresAt }));
    });
    b.emit(event(b)); await settle(); assert.equal(states.at(-1), 'ready');
    if (mode === 'watchdog') [...b.timers.values()].find(t => t.ms <= 45000).fn();
    else [...b.intervals.values()][0].fn();
    await settle(); assert.equal(states.at(-1), mode === 'expired' ? 'expired' : mode === 'outage' ? 'error' : 'revoked');
    assert.equal(b.intervals.size, 0); await assert.rejects(transport.request('content')); assert.ok(!JSON.stringify(b.events).includes(credential));
    transport.destroy();
  }
});
test('H6 iframe hides on backgrounding and requires fresh status on resume; save ends session', async () => {
  const b = browser(), states = [], expiresAt = Date.now() + 900000; let calls = 0;
  const transport = startEmbedTransport({ sessionId: id, allowedDomains: [parentOrigin] }, bootstrap, s => states.push(s), async t => t.ready(), b.view, async url => { calls++; return new Response(JSON.stringify(url.endsWith('/redeem') ? { credential, expiresAt } : { expiresAt })); });
  b.emit(event(b)); await settle(); b.visibility('hidden'); assert.equal(states.at(-1), 'loading'); b.visibility('visible'); await settle(); assert.equal(states.at(-1), 'ready'); assert.equal(calls, 3);
  transport.saved(); assert.equal(states.at(-1), 'saved'); assert.equal(b.events.at(-1).data.event, 'saved'); await assert.rejects(transport.request('content')); transport.destroy();
});
