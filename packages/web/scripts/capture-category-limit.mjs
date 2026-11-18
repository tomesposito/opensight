// Offline acceptance and captures for parity-category-limit; build:demo first.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/parity-category-limit/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], requests = [], geometry = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const count = () => page.getByLabel('Number of categories displayed', { exact: true });
const other = () => page.getByLabel('Group the rest as Other', { exact: true });
const chart = page.locator('.author-card .chart svg');
const dataRows = () => page.locator('.author-card tbody tr').allTextContents();
async function openControls(name = 'Group/Color') {
  for (const details of await page.locator('.properties-panel details.property-section').all()) {
    if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== name) await details.locator('summary').first().click();
  }
  await openPropertySection(page, name);
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
  await page.getByLabel('Assign Group/Color', { exact: true }).selectOption('category');
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.change-type select').selectOption('bar');
  await openControls();
  await chart.waitFor();
  const originalRows = await dataRows();
  assert.ok(originalRows.length > 1);
  assert.equal(await count().inputValue(), '');
  assert.equal(await other().count(), 0);
  await capture('bar-unlimited');
  await count().fill('1');
  assert.equal(await other().isChecked(), true);
  assert.match(await chart.textContent(), /Other/);
  const includedRows = await dataRows();
  assert.equal(includedRows.length, 2);
  assert.match(includedRows[1], /^Other/);
  for (const invalid of ['0', '101', '1.5']) {
    await count().fill(invalid);
    assert.equal(await count().inputValue(), '1');
    assert.deepEqual(await dataRows(), includedRows);
  }
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    await capture(`bar-include-${theme}`);
    const measured = await count().evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
    assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
    geometry.push({ theme, ...measured });
  }
  await other().uncheck();
  assert.doesNotMatch(await chart.textContent(), /Other/);
  assert.deepEqual(await dataRows(), [originalRows[0]]);
  await capture('bar-exclude');
  await other().check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await openControls();
  assert.equal(await count().inputValue(), '1');
  assert.equal(await other().isChecked(), true);
  assert.deepEqual(await dataRows(), includedRows);
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await page.locator('.author-card summary').filter({ hasText: /^View data/ }).click();
  await capture('bar-view-data');
  await count().fill('');
  assert.equal(await other().count(), 0);
  assert.deepEqual(await dataRows(), originalRows);
  await count().fill('1');
  for (const kind of ['line', 'area', 'combo', 'bar100']) {
    await page.locator('.change-type select').selectOption(kind);
    // Combo requires two measures; the synthetic dataset supplies profit.
    if (kind === 'combo') await page.getByRole('button', { name: 'Assign profit', exact: true }).click();
    await openControls(kind === 'bar100' ? 'Group/Color' : 'Category limit');
    assert.equal(await count().inputValue(), '1');
    assert.match(await chart.textContent(), /Other/);
    await capture(`${kind}-include`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const result = { errors, requests, geometry, originalRows, includedRows };
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await capture('failure'); throw error;
} finally { await browser.close(); }
