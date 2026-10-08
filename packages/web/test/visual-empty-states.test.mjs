import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fixtures from '../build/test/fixtures.generated.json' with { type: 'json' };
import { VisualCard } from '../build/test/VisualCard.js';
import { VisualSkeleton, skeletonVariant } from '../build/test/VisualSkeleton.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';
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


test('Issue #35: settled missing, empty, failed and definition states have no loading indicator', () => {
  const visual = sales.sheets[0].visuals[0];
  for (const [rows, props] of [[null, {}], [[], {}], [null, { dataMessage: 'Query failed' }], [null, { definitionPreview: true }]]) {
    const html = card({ ...visual, rows }, props);
    assert.match(html, /aria-busy="false"/);
    assert.doesNotMatch(html, /empty-symbol|◌|Loading data|visual-skeleton/);
  }
  assert.match(card({ ...visual, rows: null }, { loading: true }), /class="visual-skeleton /);
});


test('Issue #35: definition previews never invite questions about unavailable data', () => {
  for (const access of [demoAccess, { mode: 'local' }, { mode: 'hosted', session: { role: 'author_ai' } }]) {
    for (const fixture of fixtures) {
      const html = renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(Dashboard, { fixture })));
      assert.doesNotMatch(html, /class="q-trigger"|id="o-question"|class="o-result"/);
      assert.match(html, /Questions are unavailable for definition previews/);
      assert.match(html, /href="#\/home">Open Home to explore sample sales data/);
    }
  }
  const sample = renderToStaticMarkup(createElement(Dashboard, { fixture: sales, sample: true }));
  assert.match(sample, /class="q-trigger"/);
  assert.doesNotMatch(sample, /Questions are unavailable/);
  const hosted = renderToStaticMarkup(createElement(AccessProvider, { access: { mode: 'hosted', session: { role: 'author_ai' } } }, createElement(Dashboard, { fixture: sales, hosted: true, dashboardId: 'published' })));
  assert.match(hosted, /class="q-trigger"/);
  assert.doesNotMatch(hosted, /Questions are unavailable/);
});


test('Issue #49: loading skeletons roughly match the visual shape', () => {
  const byVariant = variant => sales.sheets[0].visuals.find(v => v.definition[variant]);
  for (const [variant, shape] of [['BarChartVisual', 'skeleton-bars'], ['LineChartVisual', 'skeleton-bars'], ['PieChartVisual', 'skeleton-pie'], ['TableVisual', 'skeleton-rows'], ['KPIVisual', 'skeleton-kpi']]) {
    const html = card({ ...byVariant(variant), rows: null }, { loading: true });
    assert.match(html, /aria-busy="true"/);
    assert.match(html, new RegExp(`class="visual-skeleton ${shape}"`));
    assert.match(html, /role="status" aria-label="Loading data"/);
    assert.doesNotMatch(html, /class="chart"|<table|View data|Needs data/);
  }
});

test('Issue #49: every visual kind maps to a skeleton variant', () => {
  assert.equal(skeletonVariant('bar'), 'bars');
  assert.equal(skeletonVariant('line'), 'bars');
  assert.equal(skeletonVariant('bar100'), 'bars');
  assert.equal(skeletonVariant('combo'), 'bars');
  assert.equal(skeletonVariant('waterfall'), 'bars');
  assert.equal(skeletonVariant('histogram'), 'bars');
  assert.equal(skeletonVariant('area'), 'bars');
  assert.equal(skeletonVariant('funnel'), 'bars');
  assert.equal(skeletonVariant('pie'), 'pie');
  assert.equal(skeletonVariant('gauge'), 'pie');
  assert.equal(skeletonVariant('table'), 'rows');
  assert.equal(skeletonVariant('pivot'), 'rows');
  assert.equal(skeletonVariant('kpi'), 'kpi');
  assert.equal(skeletonVariant('insight'), 'block');
  assert.equal(skeletonVariant('sankey'), 'block');
  assert.equal(skeletonVariant('radar'), 'block');
  assert.equal(skeletonVariant('treemap'), 'block');
  assert.equal(skeletonVariant('filledMap'), 'block');
  assert.equal(renderToStaticMarkup(createElement(VisualSkeleton, { kind: 'insight' })), '<div class="visual-skeleton skeleton-block" role="status" aria-label="Loading data"><span class="sr-only">Waiting for query results. No data is shown until the query completes.</span><div class="skeleton-block" aria-hidden="true"><span class="skeleton-shape skeleton-fill"></span></div></div>');
});

test('Issue #49: skeletons never get stuck on screen after load and never mask errors', () => {
  const visual = sales.sheets[0].visuals[0];
  // Settled visuals: no skeleton, no stuck loading state.
  assert.doesNotMatch(card({ ...visual }), /visual-skeleton/);
  assert.doesNotMatch(card({ ...visual, rows: [] }), /visual-skeleton/);
  // Loading flag with ready data: the pending visual clears for the skeleton only when no results are current.
  const loading = card({ ...visual, rows: null }, { loading: true });
  assert.doesNotMatch(loading, /class="chart"/);
  assert.match(loading, /visual-skeleton/);
  const ready = card({ ...visual });
  assert.match(ready, /class="chart"/);
  assert.doesNotMatch(ready, /visual-skeleton/);
  // Compile errors win over loading: the error alert renders, not the skeleton.
  const broken = card({ ...visual, definition: { BogusVisual: {} } }, { loading: true });
  assert.match(broken, /role="alert"|Unable to render/);
  assert.doesNotMatch(broken, /visual-skeleton/);
  // Loading still announces itself and hides stale failure copy.
  const pending = card({ ...visual, rows: null }, { loading: true, dataMessage: 'Previous failure' });
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /visual-skeleton/);
  assert.doesNotMatch(pending, /Previous failure/);
});

test('Issue #49: shimmer motion is static under prefers-reduced-motion', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes skeleton-shimmer/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /\.skeleton-shape \{ animation: none; background: #e6edf0; \}/);
});
