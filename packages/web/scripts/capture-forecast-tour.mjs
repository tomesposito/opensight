// Forecast tour (issue #235): drives the rebuilt static demo's author to a
// line/area chart on the date dimension, enables the Forecast section, and
// captures the honest minimum-history note (the pinned demo has three date
// buckets). Synthetic render tests cover the overlay. External requests stay blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/forecast/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
async function capture(page, name) {
  for (const details of await page.locator('.properties-panel details.property-section').all()) {
    if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== 'Forecast') await details.locator('summary').first().click();
  }
  await page.locator('.properties-panel').evaluate(node => { node.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); captures.push(name);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: overflow`);
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await page.locator('.chart svg').first().waitFor();
  await navigate(page, 'author');
  // Start from an empty sheet, then assign the date dimension and revenue.
  const remove = page.getByRole('button', { name: 'Remove Visual 1', exact: true });
  if (await remove.count()) await remove.click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Assign order_date', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  const chart = page.locator('.author-card .chart');
  await chart.locator('svg').waitFor();
  // Open the Forecast section (only present for date-dimension line charts)
  // and switch the forecast on.
  const summary = page.locator('summary[data-author-control="forecast"]');
  await summary.waitFor();
  await summary.click();
  const section = page.locator('details.property-section', { has: summary });
  await section.getByLabel('Show forecast', { exact: true }).check();
  await page.waitForTimeout(600);
  await capture(page, 'forecast-author');
  await page.locator('.change-type select').selectOption('area');
  assert.equal(await section.getByLabel('Show forecast', { exact: true }).isChecked(), true);
  assert.match(await page.locator('.author-card .forecast-note').textContent(), /Not enough history to forecast/);
  await capture(page, 'forecast-area');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark');
  await capture(page, 'forecast-area-dark');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Select SMALL MULTIPLES well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await chart.locator('svg').waitFor();
  await capture(page, 'forecast-area-facets');
  await page.getByRole('button', { name: 'Remove region from Small multiples', exact: true }).click();
  await page.getByLabel('Assign Category', { exact: true }).selectOption('region');
  assert.equal(await summary.count(), 0, 'non-date area hides Forecast');
  await capture(page, 'forecast-area-non-date');
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  assert.deepEqual(external, [], `external requests: ${external.join('; ')}`);
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ errors, external, captures }, null, 2));
  console.log(`forecast tour captures: ${captures.join(', ')}`);
} finally {
  await browser.close();
}
