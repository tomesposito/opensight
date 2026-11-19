// Offline acceptance and comparison captures for parity-pivot-field-sort; build:demo first.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/parity-pivot-field-sort/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], requests = [], geometry = [], orders = {};
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const section = page.locator('.property-section').filter({ has: page.locator('summary', { hasText: /^Field sort$/ }) });
const sort = field => section.getByLabel(`Sort ${field}`, { exact: true });
const table = page.locator('.author-card table');
const order = async () => ({
  columns: await table.locator('thead th').allTextContents(),
  rows: await table.locator('tbody tr.detail').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))),
});
async function openSort() {
  for (const details of await page.locator('.properties-panel details.property-section').all()) {
    if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== 'Field sort') await details.locator('summary').first().click();
  }
  await openPropertySection(page, 'Field sort');
  await page.locator('.properties-panel').evaluate(node => { node.scrollTop = 0; });
}
async function capture(name) {
  await page.mouse.move(1438, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
}
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  await page.getByRole('button', { name: 'Pivot', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Rows', { exact: true }).selectOption('region');
  await page.getByLabel('Assign Columns', { exact: true }).selectOption('category');
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await table.waitFor();
  await openSort();
  assert.equal(await sort('region').inputValue(), '');
  assert.equal(await sort('category').inputValue(), '');
  orders.none = await order();
  await capture('pivot-none');
  await sort('region').selectOption('DESC');
  orders.rowDescending = await order();
  assert.deepEqual(orders.rowDescending.rows.map(row => row[0]), ['West', 'East']);
  assert.deepEqual(orders.rowDescending.columns, orders.none.columns);
  await sort('category').selectOption('DESC');
  orders.bothDescending = await order();
  assert.match(orders.bothDescending.columns[1], /Software/);
  assert.match(orders.bothDescending.columns[2], /Hardware/);
  assert.deepEqual(orders.bothDescending.rows.map(row => row[0]), ['West', 'East']);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    await capture(`pivot-descending-${theme}`);
    const measured = await sort('region').evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
    assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
    geometry.push({ theme, ...measured });
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await openSort();
  assert.equal(await sort('region').inputValue(), 'DESC');
  assert.equal(await sort('category').inputValue(), 'DESC');
  assert.deepEqual(await order(), orders.bothDescending);
  await sort('region').selectOption('ASC');
  assert.deepEqual((await order()).rows.map(row => row[0]), ['East', 'West']);
  await sort('region').selectOption('');
  await sort('category').selectOption('');
  assert.deepEqual(await order(), orders.none);
  await sort('region').selectOption('DESC');
  await sort('category').selectOption('DESC');
  await page.getByRole('button', { name: 'Remove category from Columns', exact: true }).click();
  assert.equal(await sort('category').count(), 0);
  assert.equal(await sort('region').inputValue(), 'DESC');
  // Refresh the existing README pivot screenshot while retaining its collapse example.
  await page.getByLabel('Assign Rows', { exact: true }).selectOption('category');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await sort('region').selectOption('ASC');
  await openPropertySection(page, 'Subtotal');
  await page.getByLabel('Show subtotals', { exact: true }).check();
  await page.getByRole('button', { name: 'Collapse row group East', exact: true }).click();
  await openSort();
  await capture('pivot-readme');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const acceptance = { errors, requests, geometry, orders, saveReload: true, staleCleanup: true, collapsedGroup: 'East' };
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n');
  console.log(JSON.stringify(acceptance));
} catch (error) {
  await capture('failure'); throw error;
} finally { await browser.close(); }
