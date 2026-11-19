// Offline acceptance and reference captures for parity-table-row-sort; build:demo first.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/parity-table-row-sort/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], requests = [], geometry = [], rowOrders = {};
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const section = page.locator('.property-section').filter({ has: page.locator('summary', { hasText: /^Row sort$/ }) });
const sort = () => section.getByLabel('Sort rows by', { exact: true });
const ascending = () => section.getByRole('button', { name: 'Sort rows ascending', exact: true });
const descending = () => section.getByRole('button', { name: 'Sort rows descending', exact: true });
const table = page.locator('.author-card table');
const order = async () => table.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
async function openSort() {
  for (const details of await page.locator('.properties-panel details.property-section').all()) {
    if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== 'Row sort') await details.locator('summary').first().click();
  }
  await openPropertySection(page, 'Row sort');
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
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Assign category', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await table.waitFor();
  await openSort();
  assert.equal(await page.locator('.properties-panel summary').filter({ hasText: /^Group\/Color$/ }).count(), 0);
  assert.equal(await sort().inputValue(), '');
  rowOrders.none = await order();
  assert.ok(rowOrders.none.length >= 2);
  await capture('table-none');
  await sort().selectOption('category');
  assert.equal(await ascending().getAttribute('aria-pressed'), 'true');
  rowOrders.ascending = await order();
  assert.deepEqual(rowOrders.ascending.map(row => row[0]), ['Hardware', 'Software']);
  await descending().click();
  rowOrders.descending = await order();
  assert.deepEqual(rowOrders.descending.map(row => row[0]), ['Software', 'Hardware']);
  assert.notDeepEqual(rowOrders.ascending, rowOrders.descending);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    await capture(`table-descending-${theme}`);
    const measured = await sort().evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
    assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
    geometry.push({ theme, ...measured });
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await openSort();
  assert.equal(await sort().inputValue(), 'category');
  assert.equal(await descending().getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await order(), rowOrders.descending);
  await sort().selectOption('revenue');
  assert.equal(await descending().getAttribute('aria-pressed'), 'true');
  const measures = (await order()).map(row => Number(row[1].replaceAll(',', '')));
  assert.ok(measures.every((value, i) => i === 0 || measures[i - 1] >= value));
  await sort().selectOption('');
  assert.equal(await descending().count(), 0);
  assert.deepEqual(await order(), rowOrders.none);
  await sort().selectOption('category');
  await page.getByRole('button', { name: 'Remove category from Group-by', exact: true }).click();
  assert.equal(await sort().inputValue(), '');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const acceptance = { errors, requests, geometry, rowOrders };
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n');
  console.log(JSON.stringify(acceptance));
} catch (error) {
  await capture('failure'); throw error;
} finally { await browser.close(); }
