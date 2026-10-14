import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenSightClient } from '../dist/index.js';
import { OpenSightApiError } from '../dist/errors.js';

/** Records calls and returns canned responses. */
function mockFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return new Response(JSON.stringify(route.body ?? null), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(route.headers ?? {}) },
    });
  };
  impl.calls = calls;
  return impl;
}

const jsonOk = (body, headers) => ({ status: 200, body, headers });

describe('OpenSightClient transport conventions', () => {
  it('strips trailing slashes from baseUrl and sends bearer auth', async () => {
    const fetchImpl = mockFetch({ 'GET /api/v1/datasets': jsonOk({ items: [], nextCursor: null }) });
    const client = new OpenSightClient({ baseUrl: 'https://host/api///', getToken: 'tok-1', fetch: fetchImpl });
    const page = await client.listDatasets();
    assert.deepEqual(page, { items: [], nextCursor: null });
    const call = fetchImpl.calls[0];
    assert.equal(call.url, 'https://host/api/v1/datasets');
    assert.equal(call.headers.Authorization, 'Bearer tok-1');
  });

  it('supports an async getToken (refresh-token flow)', async () => {
    const fetchImpl = mockFetch({ 'GET /api/v1/sources': jsonOk({ items: [], nextCursor: null }) });
    const client = new OpenSightClient({
      baseUrl: 'https://host/api',
      getToken: async () => 'tok-2',
      fetch: fetchImpl,
    });
    await client.listSources();
    assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer tok-2');
  });

  it('requires a baseUrl', () => {
    assert.throws(() => new OpenSightClient({ getToken: 'x' }), TypeError);
  });
});

describe('pagination headers (no query strings — the hosted plane rejects them)', () => {
  it('sends Limit/Cursor headers when provided, omits them otherwise', async () => {
    const fetchImpl = mockFetch({ 'GET /api/v1/datasets': jsonOk({ items: [], nextCursor: 'abc' }) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    await client.listDatasets({ limit: 50, cursor: 'prev' });
    assert.equal(fetchImpl.calls[0].headers.Limit, '50');
    assert.equal(fetchImpl.calls[0].headers.Cursor, 'prev');

    const fetchImpl2 = mockFetch({ 'GET /api/v1/datasets': jsonOk({ items: [], nextCursor: null }) });
    const client2 = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl2 });
    await client2.listDatasets();
    assert.ok(!('Limit' in fetchImpl2.calls[0].headers));
    assert.ok(!('Cursor' in fetchImpl2.calls[0].headers));
  });
});

describe('datasets', () => {
  it('getDataset hits the describe route and returns the composed view', async () => {
    const body = {
      id: 'd1', name: 'Sales', version: 3,
      execution: { mode: 'BLAZE', intervalMinutes: 60 },
      schema: { columns: [{ name: 'region', type: 'STRING' }] },
      lineage: { sources: [{ id: 's1' }], datasets: [], steps: 1 },
      refresh: { supported: true, mode: 'BLAZE', intervalMinutes: 60 },
    };
    const fetchImpl = mockFetch({ 'GET /api/v1/datasets/d1': jsonOk(body) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    assert.deepEqual(await client.getDataset('d1'), body);
    assert.equal(fetchImpl.calls[0].method, 'GET');
  });

  it('saveDataset PUTs the body with Idempotency-Key', async () => {
    const fetchImpl = mockFetch({ 'PUT /api/v1/datasets/d1': jsonOk({ id: 'd1', name: 'S', version: 4, execution: { mode: 'DIRECT_QUERY' } }) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    const body = { name: 'S', pipeline: { version: 1, steps: [] }, expectedVersion: 3 };
    const out = await client.saveDataset('d1', body, { idempotencyKey: 'key-1' });
    const call = fetchImpl.calls[0];
    assert.equal(call.method, 'PUT');
    assert.equal(call.headers['Idempotency-Key'], 'key-1');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(call.body), body);
    assert.equal(out.version, 4);
  });

  it('deleteDataset sends If-Match and parses the removed flag', async () => {
    const fetchImpl = mockFetch({ 'DELETE /api/v1/datasets/d1': jsonOk({ id: 'd1', removed: true }) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    const out = await client.deleteDataset('d1', '"3"');
    assert.deepEqual(out, { id: 'd1', removed: true });
    assert.equal(fetchImpl.calls[0].headers['If-Match'], '"3"');
  });

  it('getDatasetLineage returns the full lineage view', async () => {
    const body = {
      dataset: { id: 'd1', name: 'Sales', version: 3 },
      steps: [{ id: 'st1', kind: 'select', name: null, from: null }],
      sources: [{ id: 's1', available: true }],
      datasets: [],
      refresh: { mode: 'BLAZE', intervalMinutes: 60, supported: true },
    };
    const fetchImpl = mockFetch({ 'GET /api/v1/datasets/d1/lineage': jsonOk(body) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    assert.deepEqual(await client.getDatasetLineage('d1'), body);
  });

  it('refreshDataset posts an empty body with Idempotency-Key', async () => {
    const fetchImpl = mockFetch({ 'POST /api/v1/datasets/d1/refresh': jsonOk({ datasetId: 'd1', refreshed: true, mode: 'BLAZE', state: 'READY' }) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    const out = await client.refreshDataset('d1', { idempotencyKey: 'r1' });
    const call = fetchImpl.calls[0];
    assert.equal(call.method, 'POST');
    assert.deepEqual(JSON.parse(call.body), {});
    assert.equal(call.headers['Idempotency-Key'], 'r1');
    assert.equal(out.refreshed, true);
  });

  it('getRefreshStatus returns the refresh state', async () => {
    const body = { datasetId: 'd1', version: 3, mode: 'BLAZE', intervalMinutes: 60, supported: true };
    const fetchImpl = mockFetch({ 'GET /api/v1/datasets/d1/refresh-status': jsonOk(body) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    assert.deepEqual(await client.getRefreshStatus('d1'), body);
  });
});

describe('querying', () => {
  it('queryDataset posts the InteractiveQuery with Idempotency-Key and returns the stable result shape', async () => {
    const result = {
      columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }],
      rows: [{ region: 'east', total: 40 }],
      execution: { mode: 'BLAZE', cached: true },
    };
    const fetchImpl = mockFetch({ 'POST /api/v1/datasets/d1/query': jsonOk(result) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    const query = {
      dimensions: [{ fieldId: 'region', columnName: 'region' }],
      measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }],
      filters: [{ columnName: 'region', parameterName: 'Region' }],
      parameterDeclarations: [{ name: 'Region', type: 'string', multiple: false }],
      parameterBindings: { Region: ['east'] },
    };
    const out = await client.queryDataset('d1', query, { idempotencyKey: 'q1' });
    const call = fetchImpl.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url, 'https://h/api/v1/datasets/d1/query');
    assert.equal(call.headers['Idempotency-Key'], 'q1');
    assert.deepEqual(JSON.parse(call.body), query);
    assert.deepEqual(out, result);
  });
});

describe('sources', () => {
  it('listSources and getSource', async () => {
    const list = { items: [{ id: 's1', available: true }], nextCursor: null };
    const one = { id: 's1', version: 2, connectorId: 'postgres', columns: [{ name: 'id', type: 'INTEGER' }] };
    const fetchImpl = mockFetch({
      'GET /api/v1/sources': jsonOk(list),
      'GET /api/v1/sources/s1': jsonOk(one),
    });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    assert.deepEqual(await client.listSources(), list);
    assert.deepEqual(await client.getSource('s1'), one);
  });

  it('deleteSource sends If-Match and parses retired', async () => {
    const fetchImpl = mockFetch({ 'DELETE /api/v1/sources/s1': jsonOk({ id: 's1', retired: true, version: 2 }) });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    const out = await client.deleteSource('s1', '"2"');
    assert.deepEqual(out, { id: 's1', retired: true, version: 2 });
    assert.equal(fetchImpl.calls[0].headers['If-Match'], '"2"');
  });
});

describe('named errors', () => {
  it('surfaces errorCode, status, and retryAfter from 429', async () => {
    const fetchImpl = mockFetch({
      'GET /api/v1/datasets': {
        status: 429,
        body: { errorCode: 'RATE_LIMIT_EXCEEDED', message: 'slow down' },
        headers: { 'Retry-After': '7' },
      },
    });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    let err;
    try { await client.listDatasets(); assert.fail('expected OpenSightApiError'); }
    catch (e) { assert.ok(e instanceof OpenSightApiError); err = e; }
    assert.equal(err.errorCode, 'RATE_LIMIT_EXCEEDED');
    assert.equal(err.status, 429);
    assert.equal(err.retryAfter, 7);
    assert.equal(err.message, 'slow down');
  });

  it('surfaces fail-closed codes like SOURCE_DELETE_BLOCKED_BY_DATASET', async () => {
    const fetchImpl = mockFetch({
      'DELETE /api/v1/sources/s1': {
        status: 409,
        body: { errorCode: 'SOURCE_DELETE_BLOCKED_BY_DATASET', message: 'still referenced' },
      },
    });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    let err;
    try { await client.deleteSource('s1', '"2"'); assert.fail('expected OpenSightApiError'); }
    catch (e) { assert.ok(e instanceof OpenSightApiError); err = e; }
    assert.equal(err.errorCode, 'SOURCE_DELETE_BLOCKED_BY_DATASET');
    assert.equal(err.status, 409);
    assert.equal(err.retryAfter, undefined);
  });

  it('falls back to HTTP_<status> when the body is not JSON', async () => {
    const fetchImpl = async (url) => {
      fetchImpl.calls.push(url);
      return new Response('not json', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    };
    fetchImpl.calls = [];
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    let err;
    try { await client.getDataset('d1'); assert.fail('expected OpenSightApiError'); }
    catch (e) { assert.ok(e instanceof OpenSightApiError); err = e; }
    assert.equal(err.errorCode, 'HTTP_500');
    assert.equal(err.status, 500);
  });
});
