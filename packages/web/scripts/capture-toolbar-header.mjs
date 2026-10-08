// Offline geometry capture. Output is ignored; never copy reference pixels into docs/images.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/parity-toolbar-header/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [], requests = [], measurements = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const measure = () => page.evaluate(() => {
  const rect = node => {
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, padding: s.padding, gap: s.gap, font: s.font, color: s.color, background: s.backgroundColor };
  };
  return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
    regions: Object.fromEntries(['.product-header', '.product-header .brand', '.section-nav', '.author-topbar', '.analysis-title', '.analysis-title input', '.author-menu', '.q-trigger', '.chrome-switch', '.author-tools', '.fixture-notice', '.author-layout'].map(s => [s, rect(document.querySelector(s))])),
    controls: [...document.querySelectorAll('.author-menu > details > summary, .author-menu > button, .chrome-switch select')].map(n => ({ label: n.textContent, ...rect(n) })),
    docks: [...document.querySelector('.author-layout').children].map(rect),
  };
});
async function capture(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: 'disabled' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
}
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  const toggle = page.getByLabel('NEW LOOK', { exact: true });
  for (const theme of ['light', 'dark']) {
    await toggle.selectOption(theme);
    await capture(`header-${theme}`);
    measurements.push({ name: `header-${theme}`, ...await measure() });
    for (const width of [1100, 760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await capture(`header-${theme}-${width}`);
      const measured = await measure();
      assert.equal(measured.scrollWidth, width, `no horizontal overflow: ${theme} ${width}`);
      measurements.push({ name: `header-${theme}-${width}`, ...measured });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await toggle.selectOption('light');
  for (const [name, height] of [['editor-author-classic', 935], ['editor-author-newlook', 807]]) {
    await page.setViewportSize({ width: 1440, height });
    await capture(name);
  }
  await navigate(page, 'sample');
  await page.setViewportSize({ width: 1440, height: 979 });
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await page.locator('#o-question').fill('revenue by region');
  await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor();
  await capture('home-q');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(resolve(output, 'geometry.json'), JSON.stringify({ measurements, pageErrors: errors, externalRequests: requests }, null, 2) + '\n');
  console.log(JSON.stringify({ output, measurements: measurements.length, pageErrors: errors.length, externalRequests: requests.length }));
} finally { await browser.close(); }
