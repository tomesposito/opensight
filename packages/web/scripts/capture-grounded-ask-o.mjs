// Issue #158: verify the rebuilt static demo with networking blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue158-captures');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], external = [], geometry = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
const panel = page.getByRole('dialog', { name: 'ASK O', exact: true });
const ask = async question => {
  await panel.getByRole('searchbox').fill(question);
  await panel.getByRole('searchbox').press('Enter');
  await panel.locator('.o-grounding').first().waitFor();
};
const capture = async name => {
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
  const box = await panel.boundingBox();
  assert.equal(Math.round(box.x + box.width), page.viewportSize().width);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await panel.evaluate(n => n.scrollWidth <= n.clientWidth));
  assert.equal(await panel.getByLabel('Aggregation step').evaluate(n => getComputedStyle(n).fontSize), '12px');
  geometry.push({ name, viewport: page.viewportSize(), panel: box });
};
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await ask('sum sales by region');
  assert.match(await panel.innerText(), /Grounded in: revenue, region/);
  assert.match(await panel.innerText(), /‘sales’ → revenue/);
  await panel.locator('.chart svg').waitFor();
  await capture('home-grounded');
  await page.keyboard.press('Escape');

  await navigate(page, 'author');
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await ask('sum sales by region for category Hardware top 2');
  await panel.getByLabel('Aggregation step').selectOption('AVG');
  assert.match(await panel.locator('.o-explanation').innerText(), /Showing avg/);
  await panel.getByRole('button', { name: 'Remove filter category', exact: true }).click();
  assert.doesNotMatch(await panel.locator('.o-explanation').innerText(), /category/);
  await panel.locator('.chart svg').waitFor();
  await capture('author-grounded-light');
  await panel.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.author-card .chart svg').waitFor();
  assert.match(await page.locator('.author-card').innerText(), /avg of revenue/);

  await page.getByRole('combobox', { name: 'NEW LOOK', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await ask('sum sales by order_date yearly blargh');
  assert.match(await panel.innerText(), /Not understood: blargh/);
  await panel.getByLabel('Granularity step').selectOption('QUARTER');
  await panel.locator('.chart svg').waitFor();
  await capture('author-grounded-dark');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'NEW LOOK', exact: true }).selectOption('light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await ask('sum sales by region');
  await capture('author-grounded-mobile');
  await panel.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).scrollIntoViewIfNeeded();
  const close = await panel.getByRole('button', { name: 'Close Ask O', exact: true }).boundingBox();
  assert.ok(close.y >= 0 && close.y + close.height <= 844);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ errors, external, geometry }, null, 2) + '\n');
  console.log(JSON.stringify({ errors, external, geometry }));
} catch (e) {
  await page.screenshot({ path: resolve(output, 'failure.png') }); throw e;
} finally { await browser.close(); }
