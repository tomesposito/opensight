// Issue #57: offline controls, persistence, accessibility and reference-review captures.
// Captures synthetic OpenSight content only; all external requests are blocked.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-57/browser');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], requests = [], geometry = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const panel = page.locator('.properties-panel');
const section = name => panel.locator('details.property-section').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
async function openSection(name) {
  for (const node of await panel.locator('details.property-section[open]').all()) {
    if (await node.locator('summary').first().textContent() !== name) await node.locator('summary').first().click();
  }
  const target = section(name);
  if (await target.getAttribute('open') === null) await target.locator('summary').click();
  await panel.evaluate(node => { node.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function capture(name) {
  await page.mouse.move(1000, 5);
  await page.screenshot({ path: resolve(out, `${name}.png`), animations: 'disabled' });
}
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  assert.equal(await page.locator('.author-card').count(), 0);
  await page.getByRole('button', { name: 'Pie / donut', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  assert.equal(await page.locator('.author-visual-empty p').innerText(), 'Add 1 or more fields to build a visual.');
  await openSection('Group/Color');
  assert.equal(await page.getByLabel('Group/Color field name', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await page.getByLabel('Group/Color field name', { exact: true }).fill('Territory');
  assert.match(await page.locator('.author-card h3').innerText(), /Territory/);
  await openSection('Display settings');
  await page.getByLabel('Title', { exact: true }).fill('Revenue by territory');
  await page.getByLabel('Subtitle', { exact: true }).fill('Synthetic sales sample');
  await page.getByLabel('Title font size', { exact: true }).fill('18');
  assert.equal(await page.locator('.author-card .card-subtitle').innerText(), 'Synthetic sales sample');
  await openSection('Legend');
  await page.getByLabel('Legend position', { exact: true }).selectOption('RIGHT');
  await page.getByLabel('Show legend', { exact: true }).uncheck();
  await page.getByLabel('Show legend', { exact: true }).check();
  await openSection('Data labels');
  await page.getByLabel('Show data labels', { exact: true }).check();
  await page.getByLabel('Data label decimal places', { exact: true }).fill('2');
  assert.match(await page.locator('.author-card .chart svg').textContent(), /100.00%/);
  // Disabled controls inherit native fieldset disabling and expose the reason.
  for (const fieldset of await panel.locator('fieldset.property-unavailable').all()) {
    const description = await fieldset.getAttribute('aria-describedby');
    assert.ok(description); assert.match(await page.locator(`[id="${description}"]`).textContent(), /not supported/);
    for (const control of await fieldset.locator('input, select, textarea, button').all()) assert.equal(await control.isDisabled(), true);
  }
  await page.locator('.author-utilities').getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await openSection('Display settings');
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Revenue by territory');
  assert.equal(await page.getByLabel('Subtitle', { exact: true }).inputValue(), 'Synthetic sales sample');
  await openSection('Legend'); assert.equal(await page.getByLabel('Legend position', { exact: true }).inputValue(), 'RIGHT');
  await openSection('Data labels'); assert.equal(await page.getByLabel('Data label decimal places', { exact: true }).inputValue(), '2');
  await openSection('Group/Color'); assert.equal(await page.getByLabel('Group/Color field name', { exact: true }).inputValue(), 'Territory');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    for (const name of ['Display settings', 'Multiples Options', 'Group/Color', 'Legend', 'Data labels']) {
      await openSection(name);
      await capture(`${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${theme}`);
      const measured = await panel.evaluate(node => {
        const control = node.querySelector('input');
        const style = getComputedStyle(control);
        return { pageWidth: document.documentElement.scrollWidth, panelWidth: node.clientWidth, panelScrollWidth: node.scrollWidth, font: style.fontFamily, fontSize: style.fontSize };
      });
      assert.equal(measured.pageWidth, 1440); assert.equal(measured.panelWidth, measured.panelScrollWidth);
      assert.match(measured.font, /Arial/); assert.equal(measured.fontSize, '12px');
      geometry.push({ theme, section: name, ...measured });
    }
  }
  await page.getByRole('button', { name: 'Select SMALL MULTIPLES well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign category', exact: true }).click();
  assert.match(await page.locator('.author-card').innerText(), /SMALL_MULTIPLES_UNSUPPORTED/);
  await page.getByRole('button', { name: 'Remove category from Small multiples', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await panel.getAttribute('open') === null) await panel.locator(':scope > summary').click();
  await openSection('Legend');
  await panel.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(resolve(out, 'acceptance.json'), JSON.stringify({ errors, requests, geometry }, null, 2));
  console.log(JSON.stringify({ errors, requests, geometry }, null, 2));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); }
