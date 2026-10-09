import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../build/test/App.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AccessProvider } from '../build/test/access.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { compileVisual } from '../build/test/compiler.js';
import { createApiClient } from '../build/test/api-client.js';
import { ROLES } from '@opensight/query-engine/browser';
import generated from '../build/test/fixtures.generated.json' with { type: 'json' };

const fixtures = JSON.parse(readFileSync(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const sales = fixtures.find(f => f.id === 'renderable-sales');
const api = createApiClient('');
const app = () => createElement(Application, { api, fixtures: generated });
const render = access => renderToStaticMarkup(access
  ? createElement(AccessProvider, { access }, app())
  : app());
const hosted = role => ({ mode: 'hosted', session: { id: 'u', namespaceId: 'n', name: 'User', role } });

test('first application render is the populated pinned sales dashboard for demo and every hosted role', () => {
  for (const access of [undefined, ...ROLES.map(hosted)]) {
    const html = render(access);
    assert.match(html, /href="#\/home" aria-current="page">Home<\/a>/);
    assert.doesNotMatch(html, /value="fixtures" selected|Data unavailable|empty-state|visual-error|TotalDeathByCountry/);
    assert.equal((html.match(/class="visual-card"/g) ?? []).length, 5);
    assert.equal((html.match(/class="chart"/g) ?? []).length, 4);
    assert.match(html, /<td>East<\/td><td>500<\/td><td>450<\/td>/);
    assert.match(html, /Pinned synthetic sales data\. No live query is run\./);
    assert.match(html, /region = East/);
    assert.match(html, /Values are precomputed; filters are fixed\./);
    assert.match(html, /visual fidelity not measured/);
    assert.doesNotMatch(html, /class="fixture-picker"/);
  }
  assert.deepEqual(sales.sheets[0].visuals.map(v => compileVisual(v).state), Array(5).fill('ready'));
  assert.equal(compileVisual(sales.sheets[0].visuals.find(v => v.definition.KPIVisual)).option.graphic[0].style.text, '500');
});

test('switching to definition fixtures and back restores the sales dashboard', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  let renderer;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    if (renderer) await act(() => renderer.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  await act(() => { renderer = create(createElement(AccessProvider, { access: hosted('author') }, app())); });
  const choose = page => act(() => renderer.root.findByType(AppNavigation).props.navigate({ page }));
  assert.deepEqual(renderer.root.findByType(Dashboard).props.fixture, sales);
  await choose('fixtures');
  assert.equal(renderer.root.findByProps({ className: 'header-caption' }).props.children, 'Developer fixture preview');
  assert.deepEqual(renderer.root.findByType(Dashboard).props.fixture, fixtures[0]);
  await choose('home');
  assert.deepEqual(renderer.root.findByType(Dashboard).props.fixture, sales);
});

test('hosted entry shows the first-run gate while the session resolves, before exposing the application', t => {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { hash: '' } };
  t.after(() => { globalThis.window = oldWindow; });
  const html = renderToStaticMarkup(createElement(App));
  assert.match(html, /Checking your workspace|Resolving your authenticated session/);
  assert.doesNotMatch(html, /visual-card|Sample dashboard|source-picker/);
});

test('a build without the pinned sample gives recovery guidance without falling back to an empty chart', () => {
  const saved = [...generated];
  try {
    generated.splice(0, generated.length, ...saved.filter(f => f.id !== 'renderable-sales'));
    const html = render(hosted('reader'));
    assert.match(html, /The sample dashboard is not included in this build/);
    assert.match(html, /Ask the operator to restore the pinned sales sample/);
    assert.doesNotMatch(html, /visual-card|Choose Author/);
  } finally { generated.splice(0, generated.length, ...saved); }
});

test('a build without definition examples explains how to load a hosted definition', async t => {
  const saved = [...generated], oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  let renderer;
  generated.splice(0, generated.length);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    if (renderer) await act(() => renderer.unmount());
    generated.splice(0, generated.length, ...saved);
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  await act(() => { renderer = create(app()); });
  await act(() => renderer.root.findByType(AppNavigation).props.navigate({ page: 'fixtures' }));
  assert.ok(renderer.root.findAllByType('p').some(p => p.props.role === 'status' && p.props.children === 'No definition examples are included in this build. Use API definition preview to load a definition from a hosted API.'));
  assert.equal(renderer.root.findAllByType(Dashboard).length, 0);
});


test('fixture definitions are explicitly a developer preview while the landing stays a sample dashboard', () => {
  const preview = renderToStaticMarkup(createElement(Dashboard, { fixture: fixtures[0] }));
  assert.match(preview, /Developer tool: inspect chart definitions and pinned sample results/);
  assert.match(preview, /class="phase-badge">Definition preview/);
  assert.match(preview, /Definition preview only/);
  assert.match(preview, /No query is run/);
  const landing = render();
  const more = /<div id="more-navigation" hidden="">[\s\S]*?<\/div>/;
  assert.match(landing.match(more)?.[0] ?? '', /Developer fixture preview|API definition preview/);
  assert.doesNotMatch(landing.replace(more, ''), /Developer fixture preview|API definition preview/);
  assert.doesNotMatch(landing, /Developer tool:|Phase 0 preview|Definition preview only/);
  const hostedLanding = render(hosted('author'));
  assert.match(hostedLanding, more);
  assert.doesNotMatch(hostedLanding.replace(more, ''), /API definition preview/);
});
