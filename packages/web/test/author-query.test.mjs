import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient, QueryError } from '../build/test/api-client.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { buildAuthorQuery, loadAuthorRows } from '../build/test/author-query.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { Author, AuthorCanvas } from '../build/test/Author.js';

const draft = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const visual = kind => activeSheet(draft(kind)).visuals[0];
const render = (item, data, props = {}) => renderToStaticMarkup(createElement(VisualCard, { visual: { ...buildAuthorVisual(item), rows: data.rows }, dataMessage: data.message, ...props }));
const controller = () => new AbortController();

test('assignments produce the query projection for all kinds, dates and multiple measures without the fixture East filter', () => {
  for (const kind of ['bar', 'line', 'pie', 'kpi', 'table']) {
    const item = visual(kind);
    assert.deepEqual(buildAuthorQuery(item), {
      dimensions: kind === 'kpi' ? [] : [{ fieldId: item.dimension, columnName: item.dimension, ...(kind === 'line' ? { granularity: 'MONTH' } : {}) }],
      measures: [{ fieldId: 'revenue', columnName: 'revenue', aggregation: 'SUM' }], filters: [],
    });
  }
  assert.deepEqual(buildAuthorQuery({ ...visual('bar'), measures: ['revenue', 'profit'] }).measures,
    ['revenue', 'profit'].map(name => ({ fieldId: name, columnName: name, aggregation: 'SUM' })));
  assert.equal(buildAuthorQuery({ ...visual('bar'), measures: [] }), null);
  assert.equal(buildAuthorQuery({ ...visual('bar'), dimension: null }), null);
});

test('live Author POST uses the definition client base, JSON headers and cancellation, then renders returned rows', async () => {
  const item = { ...visual('table'), measures: ['revenue', 'profit'] };
  const request = buildAuthorQuery(item);
  const abort = controller();
  const calls = [];
  const client = createApiClient('http://localhost:3000/prefix///', async (...args) => {
    calls.push(args);
    return Response.json({ columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }, { name: 'profit', type: 'number' }],
      rows: [{ region: 'East', revenue: 500, profit: 65 }, { region: 'West', revenue: 400, profit: 70 }] });
  });
  const data = await loadAuthorRows(client, request, abort.signal);
  assert.deepEqual(calls, [['http://localhost:3000/prefix/api/datasets/sales/query', {
    method: 'POST', signal: abort.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }]]);
  const html = render(item, data);
  assert.match(html, /<td>East<\/td><td>500<\/td><td>65<\/td>/);
  assert.match(html, /<td>West<\/td><td>400<\/td><td>70<\/td>/);
  assert.doesNotMatch(html, /Data unavailable/);
});

test('default, blank, origin and root API bases route queries through the same mount as definitions', async () => {
  for (const [base, expected] of [[undefined, '/api/api'], [' ', '/api/api'], ['/', '/api'], ['http://localhost:3000/', 'http://localhost:3000/api']]) {
    let url;
    const client = createApiClient(base, async input => { url = input; return Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 900 }] }); });
    await client.queryDataset('sales', buildAuthorQuery(visual('kpi')));
    assert.equal(url, `${expected}/datasets/sales/query`);
  }
});

test('MONTH results bind the engine month alias; zero rows show No results', async () => {
  const item = visual('line');
  for (const rows of [[{ month: '2025-01', revenue: 600 }, { month: '2025-03', revenue: 50 }], []]) {
    const client = createApiClient('/', async () => Response.json({ columns: [{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }], rows }));
    const data = await loadAuthorRows(client, buildAuthorQuery(item), controller().signal);
    const compiled = compileVisual({ ...buildAuthorVisual(item), rows: data.rows });
    assert.equal(compiled.state, rows.length ? 'ready' : 'empty');
    assert.deepEqual(compiled.table.rows, rows.map(row => [row.month, row.revenue]));
    if (!rows.length) assert.match(render(item, data), /No results/);
  }
});

test('422 preserves engine details and reuses Data unavailable with the engine message, never fixture rows', async () => {
  const item = visual('bar');
  const error = { errorCode: 'UNSUPPORTED_FEATURE', message: 'Unsupported aggregation <MEDIAN>', path: '$.analysis.Definition.Sheets' };
  const client = createApiClient('/', async () => Response.json(error, { status: 422 }));
  const request = buildAuthorQuery(item);
  await assert.rejects(client.queryDataset('sales', request), e => e instanceof QueryError && e.status === 422 && e.message === error.message && e.errorCode === error.errorCode && e.path === error.path);
  const data = await loadAuthorRows(client, request, controller().signal);
  assert.deepEqual(data, { rows: null, message: error.message });
  const html = render(item, data);
  assert.match(html, /Data unavailable/);
  assert.match(html, /Unsupported aggregation &lt;MEDIAN&gt;/);
  assert.doesNotMatch(html, /View data|No matching precomputed|<MEDIAN>/);
});

test('network, HTTP and malformed successes leave live data unavailable', async () => {
  const item = visual('kpi');
  for (const fetcher of [
    async () => { throw new Error('Offline'); },
    async () => Response.json({ Message: 'No binding' }, { status: 404 }),
    async () => new Response('Bad gateway', { status: 502 }),
    async () => Response.json({ columns: [], rows: [] }),
    async () => Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 'wrong type' }] }),
    async () => Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{}] }),
  ]) {
    const data = await loadAuthorRows(createApiClient('/', fetcher), buildAuthorQuery(item), controller().signal);
    assert.equal(data.rows, null);
    assert.ok(data.message);
    assert.match(render(item, data), /Data unavailable/);
    assert.doesNotMatch(render(item, data), /View data/);
  }
});

test('cancelled requests cannot publish success or errors even when the transport ignores abort', async () => {
  for (const fails of [false, true]) {
    let finish;
    const client = { queryDataset: () => new Promise((resolve, reject) => { finish = () => fails ? reject(new Error('late error')) : resolve({ columns: [], rows: [{ revenue: 999 }] }); }) };
    const abort = controller();
    const pending = loadAuthorRows(client, buildAuthorQuery(visual('kpi')), abort.signal);
    abort.abort(); finish();
    await assert.rejects(pending, { name: 'AbortError' });
  }
});

test('live canvas initially shows loading without fixture data; offline Author retains its disclosed fixture boundary', () => {
  const client = { queryDataset() { throw new Error('SSR must not query'); } };
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: draft('bar'), dispatch() {}, client }));
  assert.match(html, /Loading data/);
  assert.doesNotMatch(html, /View data|No matching precomputed/);
  const live = renderToStaticMarkup(createElement(Author, { client }));
  assert.match(live, /Live local sales data/);
  assert.doesNotMatch(live, /region = East/);
  const offline = renderToStaticMarkup(createElement(Author));
  assert.match(offline, /Offline demo/);
  assert.match(offline, /region = East/);
  assert.match(offline, /No live queries run/);
});
