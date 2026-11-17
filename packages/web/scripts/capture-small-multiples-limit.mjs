// Offline acceptance and reference captures for parity-sm-limit.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/parity-sm-limit/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], requests = [], geometry = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const section = page.locator('.property-section').filter({ has: page.locator('summary', { hasText: /^Multiples Options$/ }) });
const count = () => section.getByLabel('Number of panels displayed', { exact: true });
const other = () => section.getByLabel('Group the rest as Other', { exact: true });
const chart = page.locator('.author-card .chart svg');
async function openMultiples() {
  for (const details of await page.locator('.properties-panel details.property-section').all()) {
    if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== 'Multiples Options') await details.locator('summary').first().click();
  }
  await openPropertySection(page, 'Multiples Options');
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
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).uncheck();
  await openMultiples();
  assert.equal(await count().count(), 0);
  await page.getByRole('button', { name: 'Select SMALL MULTIPLES well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await chart.waitFor();
  assert.equal(await count().inputValue(), '');
  assert.equal(await other().count(), 0);
  await count().fill('1');
  assert.equal(await other().isChecked(), true);
  assert.match(await chart.textContent(), /Other/);
  for (const invalid of ['0', '101', '1.5']) {
    await count().fill(invalid);
    assert.equal(await count().inputValue(), '1');
  }
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    await capture(`pie-include-${theme}`);
    const measured = await count().evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
    assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
    geometry.push({ theme, ...measured });
  }
  await other().uncheck();
  assert.doesNotMatch(await chart.textContent(), /Other/);
  await capture('pie-exclude');
  await other().check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await openMultiples();
  assert.equal(await count().inputValue(), '1');
  assert.equal(await other().isChecked(), true);
  assert.match(await chart.textContent(), /Other/);
  await page.locator('.change-type select').selectOption('bar');
  assert.match(await chart.textContent(), /Other/);
  await capture('bar-include');
  await count().fill('');
  assert.equal(await other().count(), 0);
  assert.doesNotMatch(await chart.textContent(), /Other/);
  await count().fill('1');
  await page.getByRole('button', { name: 'Remove region from Small multiples', exact: true }).click();
  assert.equal(await count().count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ errors, requests, geometry }, null, 2));
  console.log(JSON.stringify({ errors, requests, geometry }));
} catch (error) {
  await capture('failure'); throw error;
} finally { await browser.close(); }
