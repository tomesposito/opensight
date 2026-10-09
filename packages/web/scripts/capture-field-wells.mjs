// Issue #56: offline keyboard/drag acceptance and local reference-review captures.
// Only synthetic OpenSight output is captured; QuickSight references stay external.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-56');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], requests = [], geometry = [];
const demo = new URL('../dist/opensight-demo.html', import.meta.url).href;
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
const capture = async name => {
  await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(1438, 2);
  await page.screenshot({ path: resolve(out, `${name}.png`), animations: 'disabled' });
};
const legends = () => page.locator('.field-wells legend').allTextContents();
const well = name => page.locator('.field-wells fieldset').filter({ has: page.locator('legend', { hasText: new RegExp(`^${name}$`) }) });
try {
  await page.goto(demo, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    assert.deepEqual(await legends(), ['GROUP/COLOR', 'VALUE', 'SMALL MULTIPLES']);
    await capture(`canvas-empty-${theme}`);
    await page.getByRole('button', { name: 'Pie / donut', exact: true }).click();
    await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
    assert.deepEqual(await legends(), ['GROUP/COLOR', 'VALUE', 'SMALL MULTIPLES']);
    assert.equal(await page.locator('.author-visual-empty h3').innerText(), 'Pie chart');
    assert.equal(await page.locator('.author-visual-empty p').innerText(), 'Add 1 or more fields to build a visual.');
    assert.equal(await page.getByRole('button', { name: 'Select VALUE well', exact: true }).innerText(), 'Add a measure');
    await capture(`visual-empty-${theme}`);
    const dimensions = await page.evaluate(() => {
      const button = document.querySelector('[aria-label="Select VALUE well"]');
      const style = getComputedStyle(button), wells = document.querySelector('.field-wells').getBoundingClientRect();
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, wellsBottom: wells.bottom, border: style.borderStyle, font: style.fontFamily, size: style.fontSize };
    });
    geometry.push({ theme, ...dimensions });
    assert.equal(dimensions.pageWidth, 1440); assert.equal(dimensions.border, 'dashed');
    assert.match(dimensions.font, /Arial/); assert.equal(dimensions.size, '12px');
    await page.getByRole('button', { name: 'Select GROUP/COLOR well', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Assign order_date', exact: true }).press('Space');
    assert.equal(await well('GROUP/COLOR').getByRole('img', { name: 'Date and time', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).dragTo(well('VALUE'));
    assert.equal(await well('VALUE').getByRole('img', { name: 'Decimal', exact: true }).innerText(), '#');
    assert.equal(await page.getByRole('button', { name: 'Select VALUE well', exact: true }).count(), 0);
    await page.locator('.author-card .chart svg').waitFor();
    await capture(`typed-pills-${theme}`);
    await page.getByRole('button', { name: 'Remove revenue from Value', exact: true }).press('Space');
    assert.equal(await page.getByRole('button', { name: 'Select VALUE well', exact: true }).count(), 1);
    await page.getByLabel('Assign Group/Color', { exact: true }).selectOption('region');
    await page.getByRole('button', { name: 'Select SMALL MULTIPLES well', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Assign category', exact: true }).press('Space');
    assert.equal(await page.getByRole('button', { name: 'Remove category from Small multiples', exact: true }).count(), 1);
    assert.match(await page.locator('.author-card').innerText(), /SMALL_MULTIPLES_UNSUPPORTED/);
    await capture(`pie-small-multiples-${theme}`);
    await page.locator('.author-utilities').getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.reload();
    assert.equal(await page.getByRole('button', { name: 'Remove category from Small multiples', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Remove category from Small multiples', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).press('Enter');
    await page.locator('.author-card .chart svg').waitFor();
    await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  }
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.build-panel > summary').click();
  await page.getByRole('button', { name: 'Select VALUE well', exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(resolve(out, 'acceptance.json'), JSON.stringify({ errors, requests, geometry }, null, 2));
  console.log(JSON.stringify({ errors, requests, geometry }, null, 2));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); }
