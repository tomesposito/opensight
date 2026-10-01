import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import App, { Application } from '../build/test/App.js';
import { AccessProvider } from '../build/test/access.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { compileVisual } from '../build/test/compiler.js';
import { ROLES, hasCapability } from '@opensight/query-engine/browser';

const fixtures = JSON.parse(readFileSync(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const sales = fixtures.find(f => f.id === 'renderable-sales');
const render = access => renderToStaticMarkup(access
  ? createElement(AccessProvider, { access }, createElement(Application))
  : createElement(Application));
const hosted = role => ({ mode: 'hosted', session: { id: 'u', namespaceId: 'n', name: 'User', role } });

test('first application render is the populated pinned sales dashboard for demo and every hosted role', () => {
  for (const access of [undefined, ...ROLES.map(hosted)]) {
    const html = render(access);
    assert.match(html, /<option value="sample" selected="">Sample dashboard<\/option>/);
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

test('all existing modes remain in the picker under their existing role gates', () => {
  for (const access of [undefined, ...ROLES.map(hosted)]) {
    const html = render(access);
    const options = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
    for (const mode of ['sample', 'api', 'security', 'organization', 'automation']) assert.ok(options.includes(mode), mode);
    for (const mode of ['fixtures', 'data-prep', 'data-sources', 'author']) {
      assert.equal(options.includes(mode), !access || hasCapability(access.session.role, 'build'), mode);
    }
    for (const mode of ['ai-settings', 'users']) {
      assert.equal(options.includes(mode), !!access && hasCapability(access.session.role, 'admin'), mode);
    }
  }
});

test('switching to definition fixtures and back restores the sales dashboard', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  let renderer;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    if (renderer) await act(() => renderer.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  await act(() => { renderer = create(createElement(Application)); });
  const picker = () => renderer.root.findByProps({ className: 'source-picker' }).findByType('select');
  assert.equal(picker().props.value, 'sample');
  assert.deepEqual(renderer.root.findByType(Dashboard).props.fixture, sales);
  await act(() => picker().props.onChange({ target: { value: 'fixtures' } }));
  assert.equal(picker().props.value, 'fixtures');
  assert.equal(picker().findAllByType('option').find(o => o.props.value === 'fixtures').props.children, 'Developer fixture preview');
  assert.equal(renderer.root.findByProps({ className: 'header-caption' }).props.children, 'Developer tools');
  assert.deepEqual(renderer.root.findByType(Dashboard).props.fixture, fixtures[0]);
  await act(() => picker().props.onChange({ target: { value: 'sample' } }));
  assert.equal(picker().props.value, 'sample');
  assert.deepEqual(renderer.root.findByType(Dashboard).props.fixture, sales);
});

test('hosted entry still resolves a session before exposing the application', t => {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { hash: '' } };
  t.after(() => { globalThis.window = oldWindow; });
  const html = renderToStaticMarkup(createElement(App));
  assert.match(html, /Resolving hosted session/);
  assert.doesNotMatch(html, /visual-card|Sample dashboard|source-picker/);
});


test('fixture definitions are explicitly a developer preview while the landing stays a sample dashboard', () => {
  const preview = renderToStaticMarkup(createElement(Dashboard, { fixture: fixtures[0] }));
  assert.match(preview, /Developer tool: inspect chart definitions and pinned sample results/);
  assert.match(preview, /class="phase-badge">Definition preview/);
  assert.match(preview, /Definition preview only/);
  assert.match(preview, /No query is run/);
  const landing = render();
  assert.match(landing, /Developer fixture preview/);
  assert.match(landing, /API definition preview/);
  assert.doesNotMatch(landing, /Developer tool:|Phase 0 preview|Definition preview only/);
});
