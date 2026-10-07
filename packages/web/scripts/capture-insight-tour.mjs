// Insight acceptance against the rebuilt static demo. External requests stay blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigate } from './app-navigation.mjs';
import { activeSheet, authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/insight/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
async function open(url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(url, { waitUntil: 'networkidle' }); await page.locator('.chart svg').first().waitFor(); return page;
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); captures.push(name);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: overflow`);
}
async function baseline(page, prefix) {
  await capture(page, `${prefix}-home`); await navigate(page, 'author'); await capture(page, `${prefix}-author-empty`);
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor(); await capture(page, `${prefix}-author`);
}
try {
  if (process.env.OPENSIGHT_INSIGHT_BASELINE) {
    const page = await open(pathToFileURL(resolve(process.env.OPENSIGHT_INSIGHT_BASELINE)).href);
    await baseline(page, 'baseline'); await page.context().close();
  }
  const page = await open(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await baseline(page, 'current');
  await page.getByRole('button', { name: 'Remove Visual 1', exact: true }).click();
  await page.getByRole('button', { name: 'Insight', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Analysis title', { exact: true }).fill('Insight analysis');
  assert.match(await page.locator('.fixture-notice').innerText(), /insight narratives recompute pinned synthetic sales/);
  const closed = page.locator('.properties-panel:not([open]) > summary'); if (await closed.count()) await closed.click();
  await page.getByLabel('Title', { exact: true }).fill('Revenue contributors by region');
  const chart = page.locator('.author-card .chart');
  await chart.locator('svg').waitFor(); assert.match(await chart.getAttribute('aria-label'), /Total revenue: 900/);
  assert.ok(await chart.locator('text[font-weight="700"]').count());
  await capture(page, 'insight-summary');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('profit');
  assert.match(await chart.getAttribute('aria-label'), /revenue vs profit/);
  await capture(page, 'insight-comparison');
  await page.getByLabel('Narrative computation', { exact: true }).selectOption('topBottomRanked');
  await page.getByLabel('Ranked categories', { exact: true }).fill('2');
  assert.match(await chart.getAttribute('aria-label'), /Top 2 revenue/);
  await capture(page, 'insight-ranked');
  await page.getByLabel('Narrative computation', { exact: true }).selectOption('growthRate');
  await page.getByText(/INSIGHT_TIME_REQUIRED/).first().waitFor(); await capture(page, 'insight-time-required');
  await page.getByLabel('Assign Category', { exact: true }).selectOption('order_date');
  await chart.locator('svg').waitFor(); assert.match(await chart.getAttribute('aria-label'), /Growth rate for revenue/);
  await page.getByLabel('Title', { exact: true }).fill('Latest monthly revenue change');
  await page.getByLabel('Narrative decimal places', { exact: true }).fill('2');
  await capture(page, 'insight-period');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark'); await capture(page, 'insight-dark');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await page.getByLabel('Narrative computation', { exact: true }).selectOption('summary');
  await page.getByRole('button', { name: 'Remove order_date from Category', exact: true }).click();
  await page.getByText(/INSIGHT_CATEGORY_REQUIRED/).first().waitFor(); await capture(page, 'insight-category-required');
  await page.getByLabel('Assign Category', { exact: true }).selectOption('region');
  for (const measure of ['revenue', 'profit']) await page.getByRole('button', { name: `Remove ${measure} from Values`, exact: true }).click();
  await page.getByText(/INSIGHT_VALUES_REQUIRED/).first().waitFor(); await capture(page, 'insight-values-required');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('revenue');
  await chart.locator('svg').waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'insight' });
  activeSheet(draft).visuals[0].title = 'Unsupported forecast computation';
  const resource = serializeDraft(draft);
  resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration = { computations: [{ forecast: { computationId: 'forecast' } }] };
  await page.getByText('Import bundle', { exact: true }).click();
  await page.getByLabel('Import .qs or bundle JSON', { exact: true }).setInputFiles({ name: 'insight-unsupported.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(resource)) });
  const report = page.getByRole('dialog', { name: 'Bundle import report', exact: true }); await report.waitFor();
  assert.match(await report.innerText(), /CompileError.*INSIGHT_FORECAST_UNSUPPORTED/); await capture(page, 'insight-import-report');
  await page.getByRole('button', { name: 'Close import report', exact: true }).click();
  assert.match(await page.locator('.bundle-placeholder').innerText(), /INSIGHT_FORECAST_UNSUPPORTED/);
  assert.equal(await page.locator('.author-card .chart svg').count(), 0); await capture(page, 'insight-import-blocked');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const summary = { captures, pageErrors: errors.length, externalRequests: external.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} finally { await browser.close(); }
