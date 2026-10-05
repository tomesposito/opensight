// Issue #40 acceptance on the rebuilt static demo. All HTTP(S) requests are blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseQsBundle } from '@opensight/bundle-parser';
import { navigate } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-40/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
async function open(url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.chart svg').first().waitFor();
  return page;
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  captures.push(name);
  console.log(`Captured ${name}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
}
async function baseline(page, prefix) {
  await capture(page, `${prefix}-home`);
  await navigate(page, 'author');
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await capture(page, `${prefix}-author`);
}
async function download(page, label, filename) {
  await page.locator('details[name="analysis-menu"]').filter({ has: page.locator('summary', { hasText: /^File$/ }) }).locator('summary').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const result = await pending;
  await result.saveAs(resolve(output, filename));
  await page.keyboard.press('Escape');
  // Native details do not close on Escape in every Chromium release.
  const openMenu = page.locator('details[name="analysis-menu"][open] > summary');
  if (await openMenu.count()) await openMenu.click();
  return resolve(output, filename);
}
let page;
try {
  if (process.env.OPENSIGHT_PIVOT_BASELINE) {
    const before = await open(pathToFileURL(resolve(process.env.OPENSIGHT_PIVOT_BASELINE)).href);
    await baseline(before, 'baseline'); await before.context().close();
  }
  page = await open(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await baseline(page, 'current');
  await page.getByRole('button', { name: 'Remove Visual 1', exact: true }).click();
  await page.getByRole('button', { name: 'Pivot', exact: true }).click();
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Rows', { exact: true }).selectOption('category');
  const properties = page.locator('.properties-panel:not([open]) > summary');
  if (await properties.count()) await properties.click();
  await page.getByLabel('Title', { exact: true }).fill('Revenue by region and category');
  await page.getByLabel('Analysis title', { exact: true }).fill('Pivot row groups');
  const subtotalSection = page.locator('details.property-section:not([open])').filter({ has: page.locator('summary', { hasText: /^Subtotal$/ }) });
  if (await subtotalSection.count()) await subtotalSection.locator('summary').click();
  await page.getByLabel('Show subtotals', { exact: true }).check();
  await page.locator('details.property-section').filter({ has: page.locator('summary', { hasText: /^Total$/ }) }).locator('summary').click();
  await page.getByLabel('Show totals', { exact: true }).check();
  const table = page.locator('.author-card table');
  const detailCount = await table.locator('tr.detail').count();
  assert.ok(detailCount >= 4);
  const eastDetails = await table.locator('tr.detail').filter({ has: page.locator('td:first-child', { hasText: /^East$/ }) }).count();
  const eastSubtotal = table.locator('tr.subtotal').filter({ has: page.getByRole('button', { name: /row group East$/ }) });
  const subtotalValue = await eastSubtotal.locator('td:last-child').innerText();
  await capture(page, 'pivot-expanded');

  let button = page.getByRole('button', { name: 'Collapse row group East', exact: true });
  await button.focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  assert.equal(await button.evaluate(el => el === document.activeElement), true);
  await button.press('Enter');
  button = page.getByRole('button', { name: 'Expand row group East', exact: true });
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  assert.equal(await button.evaluate(el => el === document.activeElement), true);
  assert.equal(await table.locator('tr.detail').count(), detailCount - eastDetails);
  assert.equal(await eastSubtotal.locator('td:last-child').innerText(), subtotalValue);
  assert.equal(await table.locator('tr.total').count(), 1);
  await capture(page, 'pivot-collapsed');
  await button.press('Space');
  assert.equal(await table.locator('tr.detail').count(), detailCount);
  await page.getByRole('button', { name: 'Collapse row group East', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse row group West', exact: true }).click();
  assert.equal(await table.locator('tr.detail').count(), 0);
  await page.getByRole('button', { name: 'Expand row group West', exact: true }).click();

  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const archive = await download(page, 'Download .qs', 'collapsed.qs');
  const bundle = await parseQsBundle(await readFile(archive));
  const body = bundle.members.find(m => m.resource.resourceType === 'analysis').resource.definition.sheets[0].visuals[0].pivotTableVisual;
  assert.deepEqual(body.opensightFormatting.pivot.collapsedRowGroups, [['East']]);
  await page.getByText('Import bundle', { exact: true }).click();
  await page.getByLabel('Import .qs or bundle JSON', { exact: true }).setInputFiles(archive);
  await page.getByRole('dialog', { name: 'Bundle import report', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close import report', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Expand row group East', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(await table.locator('tr.detail').count(), detailCount - eastDetails);
  await capture(page, 'pivot-imported');
  await page.getByRole('button', { name: 'Expand row group East', exact: true }).click();
  const json = JSON.parse(await readFile(await download(page, 'Export JSON', 'expanded.json'), 'utf8'));
  assert.deepEqual(json.definition.sheets[0].visuals[0].pivotTableVisual.opensightFormatting.pivot.collapsedRowGroups, []);

  await page.getByLabel('Show subtotals', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Collapse row group East', exact: true }).press('Space');
  assert.equal(await table.locator('tr.subtotal').count(), 0);
  assert.equal(await table.locator('tr.detail').count(), detailCount - eastDetails);
  assert.equal(await table.locator('tr.row-group').count(), 2);
  await capture(page, 'pivot-no-subtotals');
  await page.getByRole('button', { name: 'Expand row group East', exact: true }).press('Enter');
  assert.equal(await table.locator('tr.detail').count(), detailCount);
  console.log('Restored details without subtotals');
  await page.getByLabel('Show subtotals', { exact: true }).check();
  console.log('Restored subtotals');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('profit');
  console.log('Added profit');
  await page.locator('details.property-section').filter({ has: page.locator('summary', { hasText: /^Pivot options$/ }) }).locator('summary').click();
  console.log('Opened pivot options');
  await page.getByRole('combobox', { name: /^Metric placement/ }).selectOption('rows');
  console.log('Placed metrics on rows');
  assert.equal(await page.locator('.expand-toggle').count(), 2);
  await page.getByRole('button', { name: 'Collapse row group East', exact: true }).click();
  assert.equal(await table.locator('tr.subtotal').count(), 4);
  await capture(page, 'pivot-metric-rows');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark');
  await capture(page, 'pivot-dark');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const summary = { captures, pageErrors: errors.length, externalRequests: external.length, keyboard: ['Tab', 'Enter', 'Space'], bundleRoundTrip: true };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
