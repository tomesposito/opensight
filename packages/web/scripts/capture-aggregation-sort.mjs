// Offline acceptance and reference captures for parity-aggregation-sort; build:demo first.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/parity-aggregation-sort/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], requests = [], geometry = [], orders = {};
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const control = label => page.getByLabel(label, { exact: true });
const dataRows = () => page.locator('.author-card tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
const amount = row => Number(row[1].replace(/[^0-9.-]/g, ''));
async function openControls() {
  for (const details of await page.locator('.properties-panel details.property-section').all()) {
    if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== 'Group/Color') await details.locator('summary').first().click();
  }
  await openPropertySection(page, 'Group/Color');
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
  await page.getByRole('button', { name: 'Pie / donut', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await control('Assign Group/Color').selectOption('category');
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.change-type select').selectOption('bar');
  await openControls();
  await page.locator('.author-card .chart svg').waitFor();
  orders.default = await dataRows();
  assert.ok(orders.default.length > 1);
  assert.equal(await control('Category sort mode').inputValue(), 'field');
  await capture('bar-default');
  await control('Category sort mode').selectOption('measure');
  assert.equal(await control('Sort measure').inputValue(), 'revenue');
  assert.equal(await control('Sort aggregation').inputValue(), 'SUM');
  assert.equal(await control('Sort descending').getAttribute('aria-pressed'), 'true');
  orders.descending = await dataRows();
  assert.deepEqual(orders.descending, [...orders.default].sort((a, b) => amount(b) - amount(a)));
  await control('Sort ascending').click();
  orders.ascending = await dataRows();
  assert.deepEqual(orders.ascending, [...orders.default].sort((a, b) => amount(a) - amount(b)));
  await control('Sort descending').click();
  await page.locator('.author-card summary').filter({ hasText: /^View data/ }).click();
  for (const theme of ['light', 'dark']) {
    await control('NEW LOOK').selectOption(theme);
    await capture(`bar-measure-${theme}`);
    const measured = await control('Sort aggregation').evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
    assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
    geometry.push({ theme, ...measured });
  }
  await control('Number of categories displayed').fill('1');
  await control('Group the rest as Other').uncheck();
  orders.topOne = await dataRows();
  assert.deepEqual(orders.topOne, [orders.descending[0]]);
  await capture('bar-top-one');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload(); await openControls();
  assert.equal(await control('Category sort mode').inputValue(), 'measure');
  assert.equal(await control('Sort aggregation').inputValue(), 'SUM');
  assert.deepEqual(await dataRows(), orders.topOne);
  await control('Number of categories displayed').fill('');
  assert.deepEqual(await dataRows(), orders.descending);
  for (const aggregation of ['AVERAGE', 'MIN', 'MAX', 'COUNT', 'DISTINCT_COUNT', 'SUM']) {
    await control('Sort aggregation').selectOption(aggregation);
    assert.equal(await control('Sort aggregation').inputValue(), aggregation);
  }
  await control('Category sort mode').selectOption('field');
  assert.equal(await control('Sort slices by').inputValue(), 'category');
  await control('Sort slices by').selectOption('');
  assert.deepEqual(await dataRows(), orders.default);
  // Refresh the README Group/Color example; its surface now exposes Sort mode.
  await control('NEW LOOK').selectOption('light');
  await control('Number of categories displayed').fill('1');
  await control('Group the rest as Other').check();
  await capture('bar-readme');
  await control('Number of categories displayed').fill('');
  await control('Category sort mode').selectOption('measure');
  await page.getByRole('button', { name: 'Remove revenue from Value', exact: true }).click();
  assert.equal(await control('Category sort mode').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const acceptance = { errors, requests, geometry, orders, saveReload: true, staleCleanup: true, aggregations: ['SUM','AVERAGE','MIN','MAX','COUNT','DISTINCT_COUNT'] };
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n');
  console.log(JSON.stringify(acceptance));
} catch (error) { await capture('failure'); throw error; }
finally { await browser.close(); }
