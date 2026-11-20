// Offline source-component harness. Does not build or modify the static demo.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/opensight-kpi-trend-aggregation-sort-captures');
const root = fileURLToPath(new URL('../', import.meta.url));
const entry = resolve(root, 'scripts/kpi-trend-aggregation-sort.virtual.js');
const source = name => JSON.stringify(resolve(root, 'src', name));
const result = await build({ configFile: false, root, logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{ name: 'kpi-trend-aggregation-capture', resolveId(id) { if (id === entry) return id; }, load(id) { if (id === entry) return `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Author } from ${source('Author.tsx')};
    import { authorReducer, emptyDraft, activeSheet } from ${source('authoring.ts')};
    import { createDraftStore, browserDraftStorage } from ${source('local-drafts.ts')};
    import 'react-grid-layout/css/styles.css';
    import 'react-resizable/css/styles.css';
    import ${source('style.css')};
    import ${source('app-chrome.css')};
    const store = createDraftStore(browserDraftStorage, { mode: 'demo' });
    if (!store.restore()) {
      let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' });
      draft = authorReducer(draft, { type: 'assign', well: 'trend', field: 'order_date' });
      draft = authorReducer(draft, { type: 'assign', well: 'target', field: 'profit' });
      draft = authorReducer(draft, { type: 'title', title: 'Revenue by month · measure-sorted trend' });
      draft.title = 'KPI trend aggregation sort';
      activeSheet(draft).visuals[0].kpiOptions = { comparison: { comparisonMethod: 'DIFFERENCE' }, trendArrows: {}, progressBar: {}, sparkline: { type: 'AREA' } };
      store.save(draft);
    }
    createRoot(document.getElementById('root')).render(React.createElement(Author));
  `; } }],
  build: { write: false, minify: false, lib: { entry, name: 'KpiTrendAggregationCapture', formats: ['iife'] } },
});
const assets = (Array.isArray(result) ? result[0] : result).output;
const code = assets.find(item => item.type === 'chunk').code;
const css = assets.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n');
await mkdir(output, { recursive: true });
const shell = resolve(output, 'capture-shell.html');
await writeFile(shell, '<!doctype html><meta charset="utf-8"><title>Offline KPI source acceptance</title><main class="author-main"><div id="root"></div></main>');
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] });
const errors = [], requests = [], geometry = [], hashes = {}, orders = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
  const mount = async () => {
    await page.goto(pathToFileURL(shell).href, { waitUntil: 'load' });
    await page.addStyleTag({ content: css });
    await page.evaluate(code => (0, eval)(code), code);
    await page.locator('.author-card.is-selected .chart svg').waitFor();
    while (await page.locator('.properties-panel details[open]').count()) await page.locator('.properties-panel details[open]').first().locator('summary').first().click();
    await openPropertySection(page, 'Trend sort');
  };
  await mount();
  const section = page.locator('.property-section').filter({ has: page.locator('summary', { hasText: /^Trend sort$/ }) });
  const card = page.locator('.author-card.is-selected');
  const order = () => card.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
  orders.field = await order(); assert.ok(orders.field.length > 2);
  await section.getByLabel('Trend sort mode', { exact: true }).selectOption('measure');
  assert.equal(await section.getByLabel('Trend sort measure', { exact: true }).inputValue(), 'revenue');
  orders.ascending = await order();
  const amount = row => Number(row[1].replaceAll(',', ''));
  assert.deepEqual(orders.ascending, [...orders.field].sort((a, b) => amount(a) - amount(b)));
  await section.getByLabel('Trend sort descending', { exact: true }).click();
  orders.descending = await order();
  assert.deepEqual(orders.descending, [...orders.field].sort((a, b) => amount(b) - amount(a)));
  assert.notDeepEqual(orders.descending, orders.field);
  await section.getByLabel('Trend sort aggregation', { exact: true }).selectOption('AVERAGE');
  assert.deepEqual(await order(), orders.descending);
  assert.equal(await card.locator('[role=progressbar]').count(), 1);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    await page.mouse.move(1438, 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const bytes = await page.screenshot({ path: resolve(output, `kpi-trend-aggregation-sort-${theme}.png`), animations: 'disabled' });
    hashes[theme] = createHash('sha256').update(bytes).digest('hex');
    const measured = await section.getByLabel('Trend sort mode', { exact: true }).evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
    assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
    const directionColors = await section.locator('[aria-label="Trend sort direction"] button[aria-pressed]').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
    assert.notEqual(directionColors[0], directionColors[1]);
    geometry.push({ theme, ...measured, directionColors });
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await mount(); assert.deepEqual(await order(), orders.descending);
  assert.equal(await section.getByLabel('Trend sort aggregation', { exact: true }).inputValue(), 'AVERAGE');
  await section.getByRole('button', { name: 'Reset trend sort', exact: true }).click();
  assert.deepEqual(await order(), orders.field);
  assert.equal(await section.getByLabel('Trend sort mode', { exact: true }).inputValue(), 'field');
  await section.getByLabel('Trend sort mode', { exact: true }).selectOption('measure');
  await page.getByRole('button', { name: 'Remove revenue from Values', exact: true }).click();
  assert.equal(await section.getByLabel('Trend sort mode', { exact: true }).inputValue(), 'field');
  assert.equal(await section.getByLabel('Trend sort aggregation', { exact: true }).count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const evidence = { harness: 'Author source component; in-memory build; static demo unchanged', errors, externalRequests: requests, hashes, geometry, orders, saveReload: true, reset: true, staleMeasureCleanup: true };
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
