// Forecast tour (issue #235): drives the rebuilt static demo's author to a
// line chart on the date dimension, enables the Forecast section, and
// captures the rendered forecast (dashed continuation + interval band) so
// the build update shows the visual delta. External requests stay blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/forecast/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); captures.push(name);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: overflow`);
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await page.locator('.chart svg').first().waitFor();
  await navigate(page, 'author');
  // Start from an empty sheet, then add a line visual (defaults to the date
  // dimension + revenue on the local sales data).
  const remove = page.getByRole('button', { name: 'Remove Visual 1', exact: true });
  if (await remove.count()) await remove.click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
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
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  assert.deepEqual(external, [], `external requests: ${external.join('; ')}`);
  console.log(`forecast tour captures: ${captures.join(', ')}`);
} finally {
  await browser.close();
}
