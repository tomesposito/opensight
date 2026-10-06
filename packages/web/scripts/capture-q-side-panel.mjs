// Issue #45: real-browser keyboard/focus checks and private parity captures.
// Run against the rebuilt static demo with the existing Chromium installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/opensight-q-panel');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], geometry = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 979 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
const trigger = page.getByRole('button', { name: /^Ask a question about / });
const panel = page.getByRole('dialog', { name: 'ASK Q', exact: true });
const question = page.getByRole('searchbox', { name: 'Ask a question', exact: true });
const focused = locator => locator.evaluate(node => node === document.activeElement);
const screenshot = async name => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
};
const open = async key => {
  await trigger.focus(); await trigger.press(key);
  await panel.waitFor(); assert.ok(await focused(question));
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
};
const close = async key => {
  if (key) await page.keyboard.press(key);
  else await panel.getByRole('button', { name: 'Close Ask Q', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  assert.ok(await focused(trigger));
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
};
const ask = async () => {
  await question.fill('revenue by region'); await question.press('Enter');
  await panel.locator('.chart svg').waitFor();
  assert.match(await panel.innerText(), /Local deterministic interpreter · No AI/);
  assert.match(await panel.innerText(), /Interpreted question/);
  assert.match(await panel.innerText(), /grammar match/);
  assert.match(await panel.innerText(), /Did you mean/);
  await page.waitForTimeout(500);
};
const checkGeometry = async label => {
  const box = await panel.boundingBox(), viewport = page.viewportSize();
  assert.equal(Math.round(box.x + box.width), viewport.width, 'right dock');
  assert.equal(box.y, 0); assert.equal(box.height, viewport.height);
  assert.ok(box.width <= viewport.width);
  assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'no panel overflow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no page overflow');
  assert.equal(await question.evaluate(node => getComputedStyle(node).fontSize), '12px');
  assert.match(await question.evaluate(node => getComputedStyle(node).fontFamily), /^Arial/);
  geometry.push({ label, viewport, panel: box });
};
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await page.locator('.dashboard-grid .chart svg').first().waitFor();
  await screenshot('sample-dashboard');
  await open('Enter'); await ask(); await checkGeometry('Home desktop');
  assert.equal(await panel.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).count(), 0);
  await screenshot('home-q');
  await question.focus(); await close('Escape');
  await open('Space'); await close();

  await navigate(page, 'author');
  for (const [name, height] of [['editor-author-classic', 935], ['editor-author-newlook', 807]]) {
    await page.setViewportSize({ width: 1440, height });
    assert.equal(await page.locator('.author-card').count(), 0);
    await screenshot(name);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await screenshot('author-empty');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'NEW LOOK', exact: true }).selectOption(theme);
    await open('Space'); await ask(); await checkGeometry(`Author ${theme}`);
    assert.equal(await panel.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).isEnabled(), true);
    await screenshot(`author-q-${theme}`);
    await panel.getByRole('button', { name: 'Close answer', exact: true }).click();
    assert.equal(await panel.locator('.o-answer').count(), 0);
    await close('Escape');
  }
  await page.getByRole('combobox', { name: 'NEW LOOK', exact: true }).selectOption('light');
  await open('Enter'); await ask();
  await panel.locator('.o-alternatives button').filter({ hasText: 'Showing avg' }).click();
  await panel.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  assert.match(await panel.innerText(), /Added to the active analysis sheet/);
  await close();
  assert.match(await page.locator('.author-card').innerText(), /avg revenue/);
  await screenshot('author');

  for (const surface of ['Home', 'Author']) {
    if (surface === 'Home') await navigate(page, 'sample');
    else await navigate(page, 'author');
    await page.setViewportSize({ width: 390, height: 844 });
    await open('Enter'); await ask(); await checkGeometry(`${surface} mobile`);
    await panel.locator('.o-alternatives button').last().scrollIntoViewIfNeeded();
    const closeBox = await panel.getByRole('button', { name: 'Close Ask Q', exact: true }).boundingBox();
    assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= 844, 'Close stays visible while answers scroll');
    await screenshot(`${surface.toLowerCase()}-q-mobile`);
    await question.focus(); await close('Escape');
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { pageErrors: errors, externalRequests: external, geometry };
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  await screenshot('failure'); throw error;
} finally { await browser.close(); }
