// Issue #38 acceptance against the rebuilt static demo, with all HTTP(S) blocked.
// Optional OPENSIGHT_RADAR_BASELINE points to a saved pre-build demo for comparison.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigate, openPropertySection } from './app-navigation.mjs';
import { activeSheet, authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-38/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
async function open(url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.chart svg').first().waitFor();
  return page;
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  captures.push(name);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
}
async function bar(page, prefix) {
  await capture(page, `${prefix}-home`);
  await navigate(page, 'author');
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await capture(page, `${prefix}-author`);
}
try {
  if (process.env.OPENSIGHT_RADAR_BASELINE) {
    const page = await open(pathToFileURL(resolve(process.env.OPENSIGHT_RADAR_BASELINE)).href);
    await bar(page, 'baseline'); await page.context().close();
  }
  const page = await open(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await bar(page, 'current');
  await page.getByRole('button', { name: 'Remove Visual 1', exact: true }).click();
  await page.getByRole('button', { name: 'Radar', exact: true }).click();
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Analysis title', { exact: true }).fill('Radar analysis');
  assert.match(await page.locator('.fixture-notice').innerText(), /radar previews recompute pinned synthetic sales rows locally/);
  await page.getByLabel('Assign Category', { exact: true }).selectOption('order_date');
  await page.getByLabel('Title', { exact: true }).fill('Revenue by month');
  const chart = page.locator('.author-card .chart svg');
  await chart.waitFor();
  const handle = page.locator('.react-resizable-handle-se');
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 340, bounds.y + 120, { steps: 15 });
  await page.mouse.up();
  assert.match(await chart.textContent(), /2025/);
  await capture(page, 'radar-category');
  await page.getByLabel('Assign Color', { exact: true }).selectOption('region');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('profit');
  await page.getByLabel('Title', { exact: true }).fill('Revenue and profit by month and region');
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).check();
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Data label decimal places', { exact: true }).fill('0');
  await chart.waitFor();
  const legend = await chart.textContent();
  for (const name of ['East · revenue', 'East · profit', 'West · revenue', 'West · profit']) assert.ok(legend.includes(name), name);
  await capture(page, 'radar-labels');
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).uncheck();
  await capture(page, 'radar-color-measures');
  await openPropertySection(page, 'Legend');
  await page.getByLabel('Show legend', { exact: true }).uncheck();
  assert.ok(!(await chart.textContent()).includes('East · revenue'));
  await openPropertySection(page, 'Legend');
  await page.getByLabel('Show legend', { exact: true }).check();
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark');
  await capture(page, 'radar-dark');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Remove order_date from Category', exact: true }).click();
  await page.getByText(/RADAR_CATEGORY_REQUIRED/).first().waitFor();
  await capture(page, 'radar-missing-category');
  await page.getByLabel('Assign Category', { exact: true }).selectOption('order_date');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();

  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'radar' });
  activeSheet(draft).visuals[0].title = 'Unsupported radar shape';
  const resource = serializeDraft(draft);
  resource.definition.sheets[0].visuals[0].radarChartVisual.chartConfiguration.shape = 'CIRCLE';
  await page.getByText('Import bundle', { exact: true }).click();
  await page.getByLabel('Import .qs or bundle JSON', { exact: true }).setInputFiles({ name: 'radar-unsupported.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(resource)) });
  await page.getByRole('dialog', { name: 'Bundle import report', exact: true }).waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /CompileError.*shape.*unsupported property/);
  await capture(page, 'radar-import-report');
  await page.getByRole('button', { name: 'Close import report', exact: true }).click();
  assert.match(await page.locator('.bundle-placeholder').innerText(), /Unsupported features.*shape/);
  assert.equal(await page.locator('.author-card .chart svg').count(), 0);
  await capture(page, 'radar-import-blocked');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const summary = { captures, pageErrors: errors.length, externalRequests: external.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
