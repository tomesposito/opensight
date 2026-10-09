import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { chromiumPage } from './chromium.mjs';

const css = (await Promise.all(['style.css', 'app-chrome.css'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

test('navigation opens, closes with Escape, and closes after route changes', async t => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, focuses = 0;
  const props = { route: { page: 'home' }, navigate() {} };
  await act(() => { renderer = create(h(AppNavigation, props), { createNodeMock: node => node.props.className === 'navigation-toggle' ? { focus() { focuses++; } } : null }); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const toggle = () => renderer.root.findByProps({ className: 'navigation-toggle' });
  const panel = () => renderer.root.findByProps({ id: 'product-navigation' });
  assert.equal(toggle().props['aria-expanded'], false);
  await act(() => toggle().props.onClick());
  assert.equal(panel().props['data-open'], true);
  let prevented = false;
  await act(() => panel().props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } }));
  assert.equal(prevented, true); assert.equal(focuses, 1);
  assert.equal(toggle().props['aria-expanded'], false);
  await act(() => toggle().props.onClick());
  await act(() => renderer.update(h(AppNavigation, { ...props, route: { page: 'analyses' } })));
  assert.equal(panel().props['data-open'], false);
  await act(() => toggle().props.onClick());
  await act(() => renderer.root.findByProps({ className: 'navigation-scrim' }).props.onClick());
  assert.equal(panel().props['data-open'], false); assert.equal(focuses, 2);
});

describe('application shell geometry in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });
  for (const width of [1920, 1440, 1100, 760, 390]) for (const route of ['home', 'analyses', 'data-prep', 'author']) {
    test(`${route} at ${width}px keeps navigation and content within the viewport`, async () => {
      await page.setViewportSize({ width, height: 900 });
      const html = renderToStaticMarkup(h('div', { className: 'app-shell', 'data-page': route },
        h(AppNavigation, { route: { page: route }, navigate() {} }),
        h('main', { className: route === 'author' ? 'author-main' : undefined }, h('h1', {}, 'Workspace'))));
      await page.setContent(`<style>${css}\nhtml { scrollbar-width: none; }</style>${html}`);
      const actual = await page.evaluate(() => {
        const rect = selector => { const { x, y, width, height, right } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, right }; };
        const nav = document.querySelector('.product-navigation');
        const result = { header: rect('.product-header'), main: rect('main'), nav: rect('.product-navigation'), toggle: rect('.navigation-toggle'), width: document.documentElement.scrollWidth };
        nav.dataset.open = 'true';
        return { ...result, open: rect('.product-navigation') };
      });
      assert.equal(actual.header.height, 48);
      assert.equal(actual.header.x, 0); assert.equal(actual.header.width, width);
      assert.equal(actual.width, width);
      assert.ok(actual.main.right <= width);
      if (width <= 760 || route === 'author') {
        assert.equal(actual.nav.width, 0); assert.equal(actual.main.x, 0);
        assert.equal(actual.toggle.height, 32); assert.equal(actual.open.width, 224);
      } else {
        assert.equal(actual.nav.width, width <= 1100 ? 168 : 192);
        assert.ok(actual.nav.right <= actual.main.x);
        assert.equal(actual.nav.y, actual.header.height);
        assert.equal(actual.toggle.width, 0);
      }
    });
  }
});

describe('collection card responsiveness', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });
  for (const width of [1440, 1100, 760, 390]) test(`collection cards and long draft names fit at ${width}px`, async () => {
    const { CollectionPage } = await import('../build/test/CollectionPage.js');
    const { LocalDrafts } = await import('../build/test/LocalDrafts.js');
    const { Dashboards } = await import('../build/test/Dashboards.js');
    const { AccessProvider } = await import('../build/test/access.js');
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['analyses', 'dashboards']) {
      const content = name === 'dashboards' ? h(Dashboards, { navigate() {} }) : h(CollectionPage, { title: 'Analyses', introduction: 'Create analyses', description: 'Save drafts on this device.' }, h(LocalDrafts, { expanded: true, entries: [{ id: 'long', name: 'LongAnalysis'.repeat(30), updatedAt: '2026-01-01T12:00:00Z' }], onOpen() {}, onRename() {}, onDelete() {}, onRefresh() {} }));
      const html = renderToStaticMarkup(h(AccessProvider, { access: { mode: 'local' } }, h('div', { className: 'app-shell', 'data-page': name }, h(AppNavigation, { route: { page: name }, navigate() {} }), h('main', {}, content))));
      await page.setContent(`<style>${css}\nhtml { scrollbar-width: none; }</style>${html}`);
      const actual = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, cardRight: document.querySelector('.collection-card').getBoundingClientRect().right, tableScroll: document.querySelector('.collection-table-scroll') && getComputedStyle(document.querySelector('.collection-table-scroll')).overflowX }));
      assert.equal(actual.width, width); assert.ok(actual.cardRight <= width);
      if (name === 'analyses') assert.equal(actual.tableScroll, 'auto');
    }
  });
});
