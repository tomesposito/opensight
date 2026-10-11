import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStartup } from '../build/test/workspace-startup.js';
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function browser() {
  const document = new EventTarget(); document.visibilityState = 'visible';
  return { document, setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) };
}
const ready = () => new Response('{"state":"ready"}');
const starting = () => new Response('{"errorCode":"WORKSPACE_STARTING"}', { status: 503 });
for (const seconds of [15, 35]) test(`startup connects after ${seconds}s with a credential-free, single-flight finite request sequence`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const view = browser(), calls = [];
  const startup = createWorkspaceStartup(async (url, options) => { calls.push({ url, options }); return Date.now() >= 100000 + seconds * 1000 ? ready() : starting(); }, view, () => 1);
  const first = startup.connect(); assert.equal(startup.connect(), first); await settle();
  for (const delay of [5000, 10000, ...(seconds === 35 ? [20000] : [])]) { t.mock.timers.tick(delay); await settle(); }
  await first; assert.equal(calls.length, seconds === 15 ? 3 : 4);
  for (const { url, options } of calls) { assert.equal(url, '/api/api/startup'); assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined); assert.equal(options.body, '{}'); assert.equal(options.cache, 'no-store'); }
  t.mock.timers.tick(300000); await settle(); assert.equal(calls.length, seconds === 15 ? 3 : 4);
});
test('startup stops after six attempts and honors a plain gateway Retry-After response', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  let calls = 0;
  const startup = createWorkspaceStartup(async () => { calls++; return new Response('rate limited', { status: 429, headers: { 'Retry-After': '7' } }); }, browser(), () => 0);
  const failure = assert.rejects(startup.connect(), e => e.errorCode === 'WORKSPACE_START_RATE_LIMITED'); await settle();
  for (const delay of [7000, 7000, 10000, 15000, 15000]) { t.mock.timers.tick(delay - 1); await settle(); const before = calls; t.mock.timers.tick(1); await settle(); assert.equal(calls, before + 1); }
  await failure; assert.equal(calls, 6);
});
test('startup rejects never-ready, oversized Retry-After, malformed success and unknown failures without replay', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  for (const response of [new Response('{"state":"ready","extra":true}'), new Response('broken'), new Response('{}', { status: 500 }), new Response('{"errorCode":"WORKSPACE_MAINTENANCE"}', { status: 503 }), new Response('', { status: 429, headers: { 'Retry-After': '120' } })]) {
    let calls = 0; const startup = createWorkspaceStartup(async () => { calls++; return response; }, browser());
    await assert.rejects(startup.connect()); assert.equal(calls, 1);
  }
  let calls = 0; const startup = createWorkspaceStartup(async () => { calls++; return starting(); }, browser(), () => 1);
  const failed = assert.rejects(startup.connect()); await settle();
  for (const delay of [5000, 10000, 20000, 30000, 30000]) { t.mock.timers.tick(delay); await settle(); }
  await failed; assert.equal(calls, 6);
});
test('hung fetch has a 25-second bound and cannot publish late success', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  let resolve, signal; const startup = createWorkspaceStartup((_url, options) => { signal = options.signal; return new Promise(r => { resolve = r; }); }, browser());
  const failed = assert.rejects(startup.connect(), e => e.errorCode === 'WORKSPACE_STARTUP_TIMEOUT');
  t.mock.timers.tick(25000); await failed; assert.equal(signal.aborted, true); resolve(ready()); await settle();
});
test('hidden page aborts requests and retry waits; no resume request occurs', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  for (const hung of [false, true]) {
    const view = browser(); let calls = 0, signal;
    const startup = createWorkspaceStartup(async (_url, options) => { calls++; signal = options.signal; return hung ? new Promise(() => {}) : starting(); }, view);
    const failure = assert.rejects(startup.connect(), e => e.errorCode === 'WORKSPACE_CONNECT_CANCELLED'); await settle();
    view.document.visibilityState = 'hidden'; view.document.dispatchEvent(new Event('visibilitychange')); await failure;
    if (hung) assert.equal(signal.aborted, true);
    view.document.visibilityState = 'visible'; view.document.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(180000); await settle(); assert.equal(calls, 1);
  }
});
