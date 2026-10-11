import test from 'node:test';
import assert from 'node:assert/strict';
import { startEmbedTransport } from '../build/test/embed-transport.js';
const id = 's'.repeat(32), credential = 'c'.repeat(43), origin = 'https://parent.example';
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture(t, handler, lifetime = 900000) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const document = new EventTarget(), view = new EventTarget(), frames = new Map(), states = [], messages = [], calls = []; let next = 0;
  document.visibilityState = 'visible';
  Object.assign(view, { document, parent: { postMessage: (value, target) => messages.push({ value, target }) }, location: { origin: 'https://embed.example' },
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; }, cancelAnimationFrame: id => frames.delete(id) });
  const expiresAt = Date.now() + lifetime;
  const transport = startEmbedTransport({ sessionId: id, allowedDomains: [origin], idleReconnect: true }, 'private-bootstrap', state => states.push(state), async current => { await current.request('content'); current.ready(); }, view, async (url, options) => {
    calls.push({ url, options });
    if (handler) { const response = await handler(url, options); if (response !== undefined) return response; }
    return Response.json(url.endsWith('/startup') ? { state: 'ready' } : url.endsWith('/redeem') ? { credential, expiresAt } : { expiresAt });
  });
  const initialize = (overrides = {}) => {
    const event = new Event('message'); Object.assign(event, { source: view.parent, origin, data: { version: 2, type: 'opensight:initialize', sessionId: id, channelId: 'h'.repeat(32) }, ...overrides }); view.dispatchEvent(event);
  };
  t.after(() => transport.destroy());
  return { transport, view, document, frames, calls, states, messages, initialize, hidden: value => { document.visibilityState = value ? 'hidden' : 'visible'; document.dispatchEvent(new Event('visibilitychange')); } };
}
test('idle embed requires a valid handshake and Connect, then hides at 45 seconds without idle requests', async t => {
  const f = fixture(t);
  f.initialize({ source: {} }); f.initialize({ origin: 'https://evil.example' }); await settle(); assert.equal(f.calls.length, 0); assert.equal(f.states.length, 0);
  f.initialize(); assert.equal(f.states.at(-1), 'idle'); assert.equal(f.messages.at(-1).value.event, 'connectionRequired');
  await f.transport.connect(); assert.equal(f.states.at(-1), 'ready'); assert.equal(f.calls.length, 4);
  assert.equal(f.calls[0].options.headers.Authorization, undefined); assert.equal(f.calls[1].options.headers.Authorization, undefined); assert.equal(f.calls[2].options.headers.Authorization, `Embed ${credential}`);
  t.mock.timers.tick(44999); await settle(); assert.equal(f.states.at(-1), 'ready');
  t.mock.timers.tick(1); await settle(); assert.equal(f.states.at(-1), 'idle'); assert.equal(f.frames.size, 0); assert.equal(f.calls.length, 4);
  await assert.rejects(f.transport.request('question', { Question: 'test' })); assert.equal(f.calls.length, 4);
  await f.transport.connect(); assert.equal(f.states.at(-1), 'ready'); assert.equal(f.calls.length, 7); assert.equal(f.calls.filter(c => c.url.endsWith('/redeem')).length, 1);
  assert.ok(!JSON.stringify(f.messages).includes(credential)); assert.ok(!JSON.stringify(f.messages).includes('private-bootstrap'));
});
test('hidden/frozen embeds stay hidden on resume and late content cannot restore a protected view', async t => {
  let resolve, held = false;
  const f = fixture(t, url => held && url.endsWith('/content') ? new Promise(r => { resolve = r; }) : undefined);
  f.initialize(); await f.transport.connect(); f.hidden(true); assert.equal(f.states.at(-1), 'idle');
  const count = f.calls.length; f.hidden(false); f.view.dispatchEvent(new Event('focus')); f.view.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(f.calls.length, count);
  held = true; const pending = f.transport.connect(); await settle(); assert.ok(resolve);
  f.document.dispatchEvent(new Event('freeze')); resolve(Response.json({ secret: 'late rows' })); await pending; assert.equal(f.states.at(-1), 'idle');
  assert.equal(f.frames.size, 0);
});
test('wall-clock guard hides a resumed view even if expiry timers did not run', async t => {
  const f = fixture(t); f.initialize(); await f.transport.connect();
  t.mock.timers.setTime(150000); [...f.frames.values()][0](); assert.equal(f.states.at(-1), 'idle'); assert.equal(f.calls.length, 4);
});
test('original session expiry wins over display lease and is not extended by reconnect', async t => {
  const f = fixture(t, undefined, 30000); f.initialize(); await f.transport.connect(); t.mock.timers.tick(30000); await settle();
  assert.equal(f.states.at(-1), 'expired'); await assert.rejects(f.transport.connect()); assert.equal(f.calls.length, 4);
});
test('status outage is recoverable, definitive revocation is terminal, and mutations are never replayed', async t => {
  let mode = 'ok';
  const f = fixture(t, url => url.endsWith('/status') && mode !== 'ok' ? mode === 'outage' ? new Response('', { status: 504 }) : Response.json({ errorCode: 'EMBED_SESSION_REVOKED' }, { status: 401 }) : undefined);
  f.initialize(); await f.transport.connect(); f.hidden(true); f.hidden(false);
  mode = 'outage'; await f.transport.connect(); assert.equal(f.states.at(-1), 'unavailable');
  mode = 'ok'; await f.transport.connect(); assert.equal(f.states.at(-1), 'ready');
  await f.transport.request('question', { Question: 'one explicit question' }); f.hidden(true); f.hidden(false); await f.transport.connect();
  assert.equal(f.calls.filter(c => c.url.endsWith('/question')).length, 1);
  mode = 'revoked'; f.hidden(true); f.hidden(false); await f.transport.connect(); assert.equal(f.states.at(-1), 'revoked'); await assert.rejects(f.transport.connect());
  assert.equal(f.calls.filter(c => c.url.endsWith('/redeem')).length, 1);
});
test('ambiguous redemption is terminal and a new Connect never reuses its bootstrap', async t => {
  const f = fixture(t, url => url.endsWith('/redeem') ? new Promise(() => {}) : undefined); f.initialize();
  const pending = f.transport.connect(); await settle(); t.mock.timers.tick(8000); await pending;
  assert.equal(f.states.at(-1), 'error'); await assert.rejects(f.transport.connect()); assert.equal(f.calls.filter(c => c.url.endsWith('/redeem')).length, 1);
});
test('successful authority reads renew conservatively from request start; local input does not renew', async t => {
  const f = fixture(t); f.initialize(); await f.transport.connect(); t.mock.timers.tick(30000); await f.transport.request('content');
  t.mock.timers.tick(30000); f.document.dispatchEvent(new Event('pointerdown')); assert.equal(f.states.at(-1), 'ready');
  t.mock.timers.tick(15000); await settle(); assert.equal(f.states.at(-1), 'idle'); assert.equal(f.calls.length, 5);
});
