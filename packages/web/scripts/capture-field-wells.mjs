// Issue #43: offline keyboard/assignment acceptance and private parity captures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-43');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], requests = [], geometry = [];
const demo = new URL('../dist/opensight-demo.html', import.meta.url).href;
async function open(width, height, author = true) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  await page.goto(demo, { waitUntil: 'networkidle' });
  if (author) await navigate(page, 'author');
  return page;
}
async function capture(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1438, 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, `${name}.png`), animations: 'disabled' });
}
try {
  for (const [name, height] of [['editor-author-classic', 935], ['editor-author-newlook', 807]]) {
    const page = await open(1440, height);
    assert.deepEqual(await page.locator('.field-wells legend').allTextContents(), ['ROWS', 'COLUMNS', 'VALUES']);
    await capture(page, name);
    await page.close();
  }
  const home = await open(1440, 979, false);
  await capture(home, 'home-q'); await home.close();
  const page = await open(1440, 900);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    await capture(page, `empty-${theme}`);
    const dimensions = await page.evaluate(() => {
      const wells = document.querySelector('.field-wells').getBoundingClientRect();
      const panel = document.querySelector('.build-panel');
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight,
        wellsBottom: wells.bottom, panelScrollHeight: panel.scrollHeight, panelClientHeight: panel.clientHeight,
        font: getComputedStyle(document.querySelector('.well-placeholder')).fontFamily,
        controlSize: getComputedStyle(document.querySelector('.well-placeholder')).fontSize };
    });
    geometry.push({ theme, ...dimensions });
    assert.equal(dimensions.pageWidth, 1440);
    assert.ok(dimensions.wellsBottom <= 900, 'all empty wells fit the viewport');
    assert.ok(dimensions.panelScrollHeight <= dimensions.panelClientHeight + 1, 'empty wells need no dock scroll');
    assert.match(dimensions.font, /Arial/); assert.equal(dimensions.controlSize, '12px');
    const columns = page.getByRole('button', { name: 'Select COLUMNS well', exact: true });
    await columns.focus();
    await columns.press('Enter');
    assert.equal(await columns.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.fields-panel .field-hint').first().innerText(), /COLUMNS/);
    await columns.press('Escape');
    assert.equal(await page.locator('.author-card').count(), 0);
    assert.equal(await columns.evaluate(n => n === document.activeElement), true);
    await page.getByRole('button', { name: 'Assign category', exact: true }).press('Space');
    await page.locator('.author-card').waitFor();
    assert.equal(await page.locator('.author-card').count(), 1);
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).press('Enter');
    await page.locator('.author-card .chart svg').waitFor();
    const chip = page.getByRole('button', { name: 'Remove category from Category', exact: true });
    await chip.focus(); await chip.press('Escape'); assert.equal(await chip.count(), 1);
    await chip.press('Space'); await chip.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Assign region', exact: true }).press('Enter');
    assert.equal(await page.locator('.author-card').count(), 1);
    await page.locator('.author-card .chart svg').waitFor();
    await capture(page, `author-${theme}`);
    await page.locator('.change-type select').selectOption('pivot');
    await page.getByLabel('Assign Columns', { exact: true }).focus();
    await page.getByRole('button', { name: 'Assign category', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Remove category from Columns', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Remove category from Columns', exact: true }).count(), 1);
    await page.getByLabel('Title', { exact: true }).fill('Revenue by region and category');
    await capture(page, `assigned-${theme}`);
    await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
    assert.equal(await page.locator('.well-placeholder').count(), 3);
    await page.getByRole('button', { name: 'Select VALUES well', exact: true }).press('Space');
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).press('Enter');
    assert.equal(await page.getByRole('button', { name: 'Remove revenue from Values', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: /Remove .* from Category/ }).count(), 0);
    await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  }
  await page.close();
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(resolve(out, 'acceptance.json'), JSON.stringify({ errors, requests, geometry }, null, 2));
  console.log(JSON.stringify({ errors, requests, geometry }, null, 2));
} finally { await browser.close(); }
