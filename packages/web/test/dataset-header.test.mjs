import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatasetHeader } from '../build/test/DatasetHeader.js';
import { createApiClient } from '../build/test/api-client.js';
import sales from '../src/sales.generated.json' with { type: 'json' };

const status = (changes = {}) => ({ datasetId: 'sales', state: 'ready', lastGood: '2026-09-28T09:30:00.000Z', error: null, ...changes });
const rows = value => ({ columns: [{ name: 'row_count', type: 'number' }], rows: [{ row_count: value }] });
async function mount(t, client) {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(DatasetHeader, { client })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { text: () => JSON.stringify(renderer.toJSON()), update: async client => act(() => renderer.update(createElement(DatasetHeader, { client }))) };
}

test('offline header uses the full sample row count and explicitly requires a hosted API for refresh', () => {
  const html = renderToStaticMarkup(createElement(DatasetHeader));
  assert.match(html, /Local sales dataset/);
  assert.match(html, />BLAZE</);
  assert.ok(html.includes(`${sales.rows.length} sample rows · offline demo`));
  assert.match(html, /Refresh info needs hosted API/);
  assert.doesNotMatch(html, /<time|Last successful refresh|DIRECT QUERY/);
});

test('live header requests secured unfiltered counts and actual refresh metadata with the same cancellable signal', async t => {
  const calls = [];
  const client = createApiClient('/prefix/', async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('refresh-status') ? status() : rows(81));
  });
  const ui = await mount(t, client);
  assert.match(ui.text(), /DIRECT QUERY/);
  assert.match(ui.text(), /81 rows · live query/);
  assert.match(ui.text(), /2026-09-28 09:30:00/);
  assert.doesNotMatch(ui.text(), /sample rows|offline demo|BLAZE/);
  assert.deepEqual(calls.map(c => c.url), ['/prefix/api/datasets/sales/query', '/prefix/api/datasets/sales/refresh-status']);
  assert.deepEqual(JSON.parse(calls[0].options.body), { dimensions: [], measures: [{ fieldId: 'row_count', columnName: 'order_id', aggregation: 'COUNT' }], filters: [] });
  assert.equal(calls[0].options.signal, calls[1].options.signal);
  assert.deepEqual(calls[1].options.headers, { Accept: 'application/json' });
});

test('zero visible rows and no refresh history remain honest', async t => {
  const ui = await mount(t, { queryDataset: async () => rows(0), getDatasetRefreshStatus: async () => status({ state: 'never', lastGood: null }) });
  assert.match(ui.text(), /0 rows · live query/);
  assert.doesNotMatch(ui.text(), /No successful refresh recorded|Last successful refresh/);
  assert.doesNotMatch(ui.text(), /dateTime|sample rows/);
});

test('refresh failures and running refreshes keep the last success explicitly labeled', async t => {
  const client = { queryDataset: async () => rows(12), getDatasetRefreshStatus: async () => status({ state: 'error', error: { code: 'SOURCE_UNREACHABLE', message: 'Source unavailable' } }) };
  const ui = await mount(t, client);
  assert.match(ui.text(), /Last successful refresh/);
  assert.match(ui.text(), /SOURCE_UNREACHABLE/);
  await ui.update({ ...client, getDatasetRefreshStatus: async () => status({ state: 'running' }) });
  assert.match(ui.text(), /Last successful refresh/);
  assert.match(ui.text(), /Refresh running/);
});

test('count and refresh failures are independent and never fall back to sample metadata', async t => {
  const fail = async () => { throw new Error('Denied'); };
  const ui = await mount(t, { queryDataset: fail, getDatasetRefreshStatus: async () => status() });
  assert.match(ui.text(), /Row count unavailable/);
  assert.match(ui.text(), /Last successful refresh/);
  await ui.update({ queryDataset: async () => rows(9), getDatasetRefreshStatus: fail });
  assert.match(ui.text(), /9 rows · live query/);
  assert.match(ui.text(), /Refresh info unavailable from hosted API/);
  assert.doesNotMatch(ui.text(), /dateTime|sample rows/);
  for (const value of [-1, 1.5, null, '8', Number.MAX_SAFE_INTEGER + 1]) {
    await ui.update({ queryDataset: async () => rows(value) });
    assert.match(ui.text(), /Row count unavailable/);
    assert.match(ui.text(), /Refresh info needs hosted API/);
  }
});

test('client changes and switching offline cancel requests and discard late successes or failures', async t => {
  const pending = [], signals = [];
  const client = {
    queryDataset: (_, __, signal) => { signals.push(signal); return new Promise(resolve => pending.push(() => resolve(rows(999)))); },
    getDatasetRefreshStatus: (_, signal) => { signals.push(signal); return new Promise((_, reject) => pending.push(() => reject(new Error('Late failure')))); },
  };
  const ui = await mount(t, client);
  assert.match(ui.text(), /Loading row count/);
  assert.match(ui.text(), /Loading refresh info/);
  await ui.update({ queryDataset: async () => rows(22), getDatasetRefreshStatus: async () => status() });
  assert.ok(signals.every(s => s.aborted));
  await act(async () => pending.forEach(finish => finish()));
  assert.match(ui.text(), /22 rows/);
  assert.doesNotMatch(ui.text(), /999|unavailable/);
  await ui.update(undefined);
  assert.match(ui.text(), /sample rows · offline demo/);
  assert.doesNotMatch(ui.text(), /dateTime|22 rows/);
});

test('refresh client rejects malformed, mismatched and inconsistent responses', async () => {
  for (const raw of [null, {}, status({ datasetId: 'other' }), status({ lastGood: 'yesterday' }), status({ lastGood: '2026-02-30T09:30:00.000Z' }), status({ state: 'ready', lastGood: null }), status({ state: 'unknown' }), status({ state: 'never' }), status({ state: 'error' }), status({ error: { code: 123 } })]) {
    await assert.rejects(createApiClient('/', async () => Response.json(raw)).getDatasetRefreshStatus('sales'));
  }
});

test('refresh client rejects HTTP errors, invalid JSON and invalid IDs and propagates aborts', async () => {
  for (const response of [new Response('No binding', { status: 404 }), Response.json({}, { status: 403 }), new Response('<html>')]) {
    await assert.rejects(createApiClient('/', async () => response).getDatasetRefreshStatus('sales'), /HTTP|invalid JSON/);
  }
  const abort = new DOMException('Aborted', 'AbortError');
  await assert.rejects(createApiClient('/', async () => { throw abort; }).getDatasetRefreshStatus('sales'), e => e === abort);
  let calls = 0;
  const client = createApiClient('/', async () => { calls++; return Response.json(status()); });
  for (const id of ['', '../sales', 'sales?x=1', 'x'.repeat(513)]) await assert.rejects(client.getDatasetRefreshStatus(id), /Invalid dataset ID/);
  assert.equal(calls, 0);
});


test('Issue #35: refresh activity and failures remain visible without a prior success', async t => {
  const ui = await mount(t, { queryDataset: async () => rows(8), getDatasetRefreshStatus: async () => status({ state: 'running', lastGood: null }) });
  assert.match(ui.text(), /Refresh running/);
  await ui.update({ queryDataset: async () => rows(8), getDatasetRefreshStatus: async () => status({ state: 'error', lastGood: null, error: { code: 'SOURCE_UNREACHABLE' } }) });
  assert.match(ui.text(), /Refresh failed:.*SOURCE_UNREACHABLE/);
  assert.doesNotMatch(ui.text(), /No successful refresh recorded|Last successful refresh/);
});
