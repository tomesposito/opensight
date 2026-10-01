// Offline browser acceptance and screenshots. Uses the loop's existing tool install;
// no browser download, package dependency, remote service or network access.
// Run: node packages/web/scripts/capture-embed-preview.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/h5-embed-preview');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1140 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [], network = [];
page.on('pageerror', e => errors.push(e.message));
await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
const demo = pathToFileURL(fileURLToPath(new URL('../dist/opensight-embed-preview.html', import.meta.url))).href;
let captures = 0;
try {
  await page.goto(demo); await page.getByRole('heading', { name: 'Embed appearance preview' }).waitFor();
  assert.match(await page.locator('body').innerText(), /Offline fixture/i);
  assert.match(await page.locator('body').innerText(), /no active session/);
  for (const brand of ['opensight', 'atlas']) {
    await page.getByLabel('Branding', { exact: true }).selectOption(brand);
    const product = brand === 'atlas' ? 'Atlas Analytics' : 'OpenSight';
    for (const state of ['loading', 'empty', 'error', 'expired']) {
      const host = page.locator(`[data-preview-state="${state}"] iframe`), frame = host.contentFrame();
      await frame.locator('.embed-brand > span').first().filter({ hasText: product }).waitFor();
      const frameTitle = await host.getAttribute('title'); assert.ok(frameTitle.startsWith(brand === 'atlas' ? 'Atlas analytics dashboard' : 'OpenSight dashboard'));
      const status = frame.getByRole(state === 'error' ? 'alert' : 'status'); await status.waitFor();
      const text = await status.innerText();
      assert.match(text, { loading: /Loading dashboard/, empty: /No visuals/, error: /Data access was denied/, expired: /Embed URL expired/ }[state]);
      assert.equal(await frame.locator('.embed-notices').innerText(), 'OpenSight · Apache-2.0\nData access permissions apply');
      assert.equal(await frame.locator('.embed-brand img').count(), brand === 'atlas' ? 1 : 0);
      if (brand === 'atlas') {
        const src = await frame.locator('.embed-brand img').getAttribute('src'); assert.match(src, /^data:image\/png;base64,/);
        assert.match(await frame.locator('link[rel="icon"]').getAttribute('href'), /^data:image\/png;base64,/);
        assert.ok(await frame.locator('.embed-frame').evaluate(el => el.classList.contains('embed-compact') && el.classList.contains('embed-sans')));
        assert.equal(await frame.locator('.embed-brand img').evaluate(img => img.complete && img.naturalWidth === 32), true);
      }
      assert.equal(await frame.locator('button, input, a').count(), 0);
      assert.equal(await frame.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth), true);
      await host.screenshot({ path: `${output}/${brand}-${state}.png` }); captures++;
    }
    await page.screenshot({ path: `${output}/${brand}-all-states.png`, fullPage: true }); captures++;
  }
  await page.getByLabel('Palette', { exact: true }).selectOption('plum');
  for (const state of ['loading', 'empty', 'error', 'expired']) await page.locator(`[data-preview-state="${state}"] iframe`).contentFrame().locator('.embed-plum').waitFor();
  await page.screenshot({ path: `${output}/atlas-plum.png`, fullPage: true }); captures++;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth), true);
  // Chromium can omit offscreen iframe surfaces in a tall screenshot. Paint the full mobile-width document.
  await page.setViewportSize({ width: 390, height: await page.locator('body').evaluate(el => el.scrollHeight) });
  for (const state of ['loading', 'empty', 'error', 'expired']) await page.locator(`[data-preview-state="${state}"] iframe`).contentFrame().locator('.embed-plum').waitFor();
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true }); captures++;
  assert.deepEqual(network, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ assertions: 'passed', captures, output, externalRequests: network.length, pageErrors: errors.length }));
} finally { await browser.close(); }
