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

describe('analyses', () => {
  const envelope = { AnalysisId: 'a', Name: 'Analysis', Definition: { Sheets: [] }, Errors: [] };
  const opts = { ifMatch: '"2"', idempotencyKey: 'retry-key' };
  it('lists with pagination headers and exposes describe ETags separately from the wire envelope', async () => {
    const page = { items: [{ kind: 'analysis', id: 'a', name: 'Analysis' }], nextCursor: 'next' };
    const fetchImpl = mockFetch({
      'GET /api/v1/analyses': jsonOk(page),
      'GET /api/v1/analyses/a': jsonOk(envelope, { ETag: '"2"' }),
    });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    assert.deepEqual(await client.listAnalyses({ limit: 2, cursor: 'cursor' }), page);
    assert.equal(fetchImpl.calls[0].headers.Limit, '2');
    assert.equal(fetchImpl.calls[0].headers.Cursor, 'cursor');
    assert.equal(new URL(fetchImpl.calls[0].url).search, '');
    assert.deepEqual(await client.getAnalysis('a'), { value: envelope, etag: '"2"' });
  });

  it('sends every approved mutation body, retry key and required precondition, preserving returned ETags', async () => {
    const update = { name: 'Analysis', definition: { dataSetIdentifierDeclarations: [], sheets: [] }, datasetBindings: {} };
    const create = { analysisId: 'a', ...update };
    const visual = { barChartVisual: { visualId: 'v' } };
    const group = { filterGroupId: 'g', filters: [] };
    const cases = [
      ['POST', '/analyses', 'createAnalysis', [create, opts], create],
      ['PUT', '/analyses/a', 'updateAnalysis', ['a', update, opts], update],
      ['POST', '/analyses/a/sheets/s/visuals', 'addVisual', ['a', 's', visual, opts], visual],
      ['PUT', '/analyses/a/sheets/s/visuals/v', 'updateVisual', ['a', 's', 'v', visual, opts], visual],
      ['DELETE', '/analyses/a/sheets/s/visuals/v', 'removeVisual', ['a', 's', 'v', opts]],
      ['PUT', '/analyses/a/sheets/s/layouts', 'setLayouts', ['a', 's', [], opts], []],
      ['POST', '/analyses/a/filter-groups', 'addFilterGroup', ['a', group, opts], group],
      ['PUT', '/analyses/a/filter-groups/g', 'updateFilterGroup', ['a', 'g', group, opts], group],
      ['DELETE', '/analyses/a/filter-groups/g', 'removeFilterGroup', ['a', 'g', opts]],
      ['PUT', '/analyses/a/calculated-fields', 'setCalculatedFields', ['a', [], opts], []],
      ['DELETE', '/analyses/a', 'deleteAnalysis', ['a', opts]],
    ];
    for (const [method, path, member, args, body] of cases) {
      const removed = { id: 'a', removed: true };
      const fetchImpl = mockFetch({ [`${method} /api/v1${path}`]: jsonOk(member === 'deleteAnalysis' ? removed : envelope, { ETag: '"3"' }) });
      const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
      assert.deepEqual(await client[member](...args), member === 'deleteAnalysis' ? removed : { value: envelope, etag: '"3"' }, member);
      const call = fetchImpl.calls[0];
      assert.equal(call.headers['Idempotency-Key'], 'retry-key', member);
      assert.equal(call.headers['If-Match'], member === 'createAnalysis' ? undefined : '"2"', member);
      assert.equal(call.headers.Authorization, 'Bearer t', member);
      assert.deepEqual(call.body === undefined ? undefined : JSON.parse(call.body), body, member);
      assert.equal(call.headers['Content-Type'], body === undefined ? undefined : 'application/json', member);
    }
  });

  it('encodes each path identity without creating query parameters or nested paths', async () => {
    const fetchImpl = mockFetch({
      'PUT /api/v1/analyses/a%3F/sheets/s%2F/visuals/v%23': jsonOk(envelope, { ETag: '"3"' }),
      'DELETE /api/v1/analyses/a%3F/filter-groups/g%2F': jsonOk(envelope, { ETag: '"4"' }),
    });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    await client.updateVisual('a?', 's/', 'v#', { barChartVisual: { visualId: 'v#' } }, opts);
    await client.removeFilterGroup('a?', 'g/', opts);
    assert.ok(fetchImpl.calls.every(call => new URL(call.url).search === ''));
  });

  it('retains named analysis validation errors and field paths through versioned transport', async () => {
    const body = { errorCode: 'CALCULATED_FIELD_INVALID', message: 'Invalid expression', path: '$.definition.calculatedFields[0].expression' };
    const fetchImpl = mockFetch({ 'PUT /api/v1/analyses/a/calculated-fields': { status: 400, body } });
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 't', fetch: fetchImpl });
    await assert.rejects(client.setCalculatedFields('a', [], opts), error => {
      assert.ok(error instanceof OpenSightApiError);
      assert.equal(error.status, 400);
      assert.equal(error.errorCode, body.errorCode);
      assert.deepEqual(error.body, body);
      return true;
    });
  });
});

describe('dashboard operations', () => {
  it('maps publication, version, share and query verbs with ETags and request headers', async () => {
    const calls = [];
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 'token', fetch: async (url, init) => { calls.push({ url, ...init }); return new Response(JSON.stringify({ ok: true }), { headers: { ETag: '"3"' } }); } });
    const mutation = { idempotencyKey: 'retry', ifMatch: '"3"' }, principal = { type: 'group', id: 'team' };
    assert.equal((await client.publishAnalysis('a', { dashboardId: 'd' }, mutation)).etag, '"3"');
    await client.listDashboards({ limit: 2, cursor: 'page' }); await client.getDashboard('d'); await client.listDashboardVersions('d', { limit: 1 }); await client.getDashboardVersion('d', 2);
    await client.deleteDashboard('d', mutation); await client.deleteDashboardVersion('d', 2, mutation);
    await client.getDashboardShare('d', principal); await client.setDashboardShare('d', principal, { role: 'viewer' }, mutation); await client.deleteDashboardShare('d', principal, mutation);
    await client.queryDashboardVisual('d', 2, 'v', { controlValues: { scale: [2] } }, mutation);
    assert.deepEqual(calls.map(c => [c.method, new URL(c.url).pathname]), [
      ['POST', '/api/v1/analyses/a/publish'], ['GET', '/api/v1/dashboards'], ['GET', '/api/v1/dashboards/d'], ['GET', '/api/v1/dashboards/d/versions'], ['GET', '/api/v1/dashboards/d/versions/2'], ['DELETE', '/api/v1/dashboards/d'], ['DELETE', '/api/v1/dashboards/d/versions/2'], ['GET', '/api/v1/dashboards/d/shares/group/team'], ['PUT', '/api/v1/dashboards/d/shares/group/team'], ['DELETE', '/api/v1/dashboards/d/shares/group/team'], ['POST', '/api/v1/dashboards/d/versions/2/visuals/v/query'],
    ]);
    assert.equal(calls[1].headers.Limit, '2'); assert.equal(calls[1].headers.Cursor, 'page');
    for (const c of calls.filter(c => c.method !== 'GET')) assert.equal(c.headers['Idempotency-Key'], 'retry');
    for (const c of calls.slice(5, 7)) assert.equal(c.headers['If-Match'], '"3"');
    assert.deepEqual(JSON.parse(calls.at(-1).body), { controlValues: { scale: [2] } });
    assert.throws(() => client.getDashboardVersion('d', 1.5), TypeError);
  });
  it('returns binary export bytes and preserves named API errors with diagnostics and retryAfter', async () => {
    let calls = 0;
    const client = new OpenSightClient({ baseUrl: 'https://h/api', getToken: 'token', fetch: async (url, init) => {
      assert.equal(new URL(url).pathname, '/api/v1/dashboards/d/exports'); assert.equal(init.headers['Idempotency-Key'], 'export');
      if (++calls === 1) return new Response('%PDF-test', { headers: { 'Content-Type': 'application/pdf', ETag: '"2"', 'Content-Disposition': 'attachment; filename="d.pdf"' } });
      return new Response(JSON.stringify({ errorCode: 'RATE_LIMIT_EXCEEDED', Errors: [{ errorCode: 'x', path: '$', message: 'diagnostic' }] }), { status: 429, headers: { 'Retry-After': '4' } });
    } });
    const artifact = await client.createDashboardExport('d', { version: 2, format: 'pdf' }, { idempotencyKey: 'export' });
    assert.equal(new TextDecoder().decode(artifact.bytes), '%PDF-test'); assert.equal(artifact.etag, '"2"'); assert.equal(artifact.contentType, 'application/pdf');
    await assert.rejects(client.createDashboardExport('d', { format: 'csv' }, { idempotencyKey: 'export' }), e => e instanceof OpenSightApiError && e.errorCode === 'RATE_LIMIT_EXCEEDED' && e.status === 429 && e.retryAfter === 4 && e.body.Errors.length === 1);
  });
});

describe('assets and folders', () => {
  it('maps every asset verb, casing, ETags, pagination and retry headers', async () => {
    const calls=[];
    const client=new OpenSightClient({baseUrl:'https://h/api',getToken:'token',fetch:async(url,init)=>{calls.push({url,...init}); return new Response(JSON.stringify({Id:'id'}),{headers:{ETag:'"4"'}});}});
    const page={limit:2,cursor:'page'}, update={ifMatch:'"3"',idempotencyKey:'retry'}, principal={type:'user',id:'member'};
    await client.listAssets(page); await client.listAnalysesSummary(page); await client.listDashboardsSummary(page); await client.listDatasetsSummary(page);
    await client.searchAssets({query:'Sales',kinds:['analyses']},page);
    assert.equal((await client.moveAsset('analyses','id',{folderId:null},update)).etag,'"4"');
    await client.copyAsset('dashboards','id',{newId:'copy'},update);
    await client.getAssetShare('analyses','id',principal); await client.setAssetShare('analyses','id',principal,{role:'viewer'},update); await client.deleteAssetShare('analyses','id',principal,update);
    await client.deleteAsset('datasets','id',update); await client.renameFolder('f',{name:'Name'},update); await client.deleteFolder('f',update);
    await client.listFolders(page); await client.getFolder('f'); await client.listFolderAssets('f',page); await client.getFolderPermissions('f'); await client.setFolderPermissions('f',{grants:[{principal,role:'co-owner'}]},update);
    assert.deepEqual(calls.map(c=>[c.method,new URL(c.url).pathname]),[
      ['GET','/api/v1/assets'],['GET','/api/v1/assets/analyses'],['GET','/api/v1/assets/dashboards'],['GET','/api/v1/assets/datasets'],['POST','/api/v1/assets/search'],
      ['POST','/api/v1/assets/analyses/id/move'],['POST','/api/v1/assets/dashboards/id/copy'],
      ['GET','/api/v1/analyses/id/shares/user/member'],['PUT','/api/v1/analyses/id/shares/user/member'],['DELETE','/api/v1/analyses/id/shares/user/member'],
      ['DELETE','/api/v1/datasets/id'],['PUT','/api/v1/folders/f'],['DELETE','/api/v1/folders/f'],['GET','/api/v1/folders'],['GET','/api/v1/folders/f'],['GET','/api/v1/folders/f/assets'],['GET','/api/v1/folders/f/permissions'],['PUT','/api/v1/folders/f/permissions'],
    ]);
    for(const i of [0,1,2,3,4,13,15]) { assert.equal(calls[i].headers.Limit,'2'); assert.equal(calls[i].headers.Cursor,'page'); }
    for(const i of [5,6,8,9,10,11,12,17]) assert.equal(calls[i].headers['Idempotency-Key'],'retry');
    for(const i of [8,10,11,17]) assert.equal(calls[i].headers['If-Match'],'"3"');
    assert.deepEqual(JSON.parse(calls[8].body),{role:'viewer'});
    assert.deepEqual(JSON.parse(calls[17].body),{grants:[{principal,role:'co-owner'}]});
  });
});
