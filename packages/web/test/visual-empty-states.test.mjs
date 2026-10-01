import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fixtures from '../build/test/fixtures.generated.json' with { type: 'json' };
import { VisualCard } from '../build/test/VisualCard.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { Author } from '../build/test/Author.js';

const sales = fixtures.find(f => f.id === 'renderable-sales');
const card = (visual, props) => renderToStaticMarkup(createElement(VisualCard, { visual, ...props }));

for (const kind of ['BarChartVisual', 'KPIVisual', 'TableVisual']) {
  const visual = sales.sheets[0].visuals.find(v => v.definition[kind]);
  test(`${kind} missing data names the required data source without claiming execution`, () => {
    const html = card({ ...visual, rows: null });
    assert.match(html, /role="status"/);
    assert.match(html, /<strong>Needs data<\/strong>/);
    assert.match(html, /No data is attached to this visual/);
    assert.match(html, /Choose a supported sample, or query a configured dataset through a hosted API/);
    assert.doesNotMatch(html, /Data unavailable|class="chart"|<table|View data|<svg/);
  });
  test(`${kind} empty results give filter guidance and never draw invented values`, () => {
    const html = card({ ...visual, rows: [] });
    assert.match(html, /<strong>No results<\/strong>/);
    assert.match(html, /The result set contains no rows\. Review the filters and source data for matching records/);
    assert.doesNotMatch(html, /class="chart"|<table|View data|Needs data|Unable to load data/);
  });
}

test('definition-only preview explicitly discloses no query and the hosted data requirements', () => {
  const html = renderToStaticMarkup(createElement(Dashboard, { fixture: fixtures[0] }));
  assert.match(html, /<strong>Definition only<\/strong>/);
  assert.match(html, /This preview has no sample results/);
  assert.match(html, /Live data requires a hosted API with a configured source and access permissions/);
  assert.match(html, /No query runs in this preview/);
  assert.doesNotMatch(html, /Data unavailable|class="chart"|<table|View data/);
});

test('pending queries show neutral loading copy and hide stale messages and result placeholders', () => {
  const html = card({ ...sales.sheets[0].visuals[0], rows: null }, { loading: true, dataMessage: 'Previous failure' });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Waiting for query results\. No data is shown until the query completes/);
  assert.doesNotMatch(html, /Previous failure|local sales data|class="chart"|View data|Needs data/);
});

test('query failures retain escaped diagnostics alongside recovery guidance', () => {
  const html = card({ ...sales.sheets[0].visuals[0], rows: null }, { dataMessage: 'SECURITY_DENIED: <private field>' });
  assert.match(html, /<strong>Unable to load data<\/strong>/);
  assert.match(html, /check the selected fields and data access, then retry/);
  assert.match(html, /SECURITY_DENIED: &lt;private field&gt;/);
  assert.doesNotMatch(html, /<private field>|No query runs|sample results|View data|class="chart"/);
});

test('empty definitions and sheets describe how to add content', () => {
  const render = sheets => renderToStaticMarkup(createElement(Dashboard, { fixture: { ...sales, sheets } }));
  assert.match(render([]), /role="status">This definition has no sheets\. Load a definition with at least one sheet and visual/);
  assert.match(render([{ id: 'empty', name: 'Empty', visuals: [] }]), /role="status">This sheet has no visuals\. Choose another sheet or ask the dashboard author to add a visual/);
});

test('author notices distinguish unsupported samples from hosted query errors', () => {
  const offline = renderToStaticMarkup(createElement(Author));
  assert.match(offline, /Other manual selections need a supported sample or a hosted API/);
  assert.match(offline, /No live queries run/);
  const hosted = renderToStaticMarkup(createElement(Author, { client: { queryDataset() { throw new Error('SSR must not query'); } } }));
  assert.match(hosted, /unsupported queries show their error details and guidance/);
  assert.doesNotMatch(offline + hosted, /Data unavailable/);
});


test('Issue #35: settled missing, empty, failed and definition states have no loading symbol', () => {
  const visual = sales.sheets[0].visuals[0];
  for (const [rows, props] of [[null, {}], [[], {}], [null, { dataMessage: 'Query failed' }], [null, { definitionPreview: true }]]) {
    const html = card({ ...visual, rows }, props);
    assert.match(html, /aria-busy="false"/);
    assert.doesNotMatch(html, /empty-symbol|◌|Loading data/);
  }
  assert.match(card({ ...visual, rows: null }, { loading: true }), /class="empty-symbol"/);
});
