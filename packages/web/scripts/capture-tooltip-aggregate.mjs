// Offline parity-tooltip-aggregate acceptance captures against the rebuilt demo.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/tooltip-aggregate/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  for (const [kind, label] of [['treemap', 'Treemap'], ['wordCloud', 'Word cloud'], ['box', 'Box plot'], ['histogram', 'Histogram']]) {
    const remove = page.locator('.author-card-actions button[aria-label^="Remove "]');
    if (await remove.count()) await remove.click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
    await page.getByRole('button', { name: 'Assign region', exact: true }).click();
    if (kind === 'treemap' || kind === 'box') await page.getByRole('button', { name: 'Assign category', exact: true }).click();
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
    const chart = page.locator('.author-card .chart');
    await chart.locator('svg').waitFor();
    await page.getByRole('tab', { name: 'Interaction', exact: true }).click();
    await page.locator('.property-section', { has: page.locator('summary[data-author-control="tooltip-detail"]') }).getByRole('combobox').selectOption('detailed');
    assert.equal(await page.getByText('other visual types use basic tooltips', { exact: false }).count(), 0);
    for (const section of await page.locator('.properties-panel details.property-section:visible').all()) {
      if (await section.getAttribute('open') !== null && await section.locator('summary').first().textContent() !== 'Tooltip') await section.locator('summary').first().click();
    }
    await page.locator('.properties-panel').evaluate(node => { node.scrollTop = 0; });
    await page.evaluate(() => window.scrollTo(0, 0));
    // Hover actual SVG marks, requiring the detailed text before capturing.
    const expected = kind === 'box' ? 'revenue median:' : kind === 'histogram' ? 'Frequency:' : 'Sum of revenue:';
    let found = false;
    for (const mark of await chart.locator('svg path, svg text').all()) {
      const bounds = await mark.boundingBox();
      if (!bounds || bounds.width < 2 || bounds.height < 2) continue;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.waitForTimeout(120);
      if ((await chart.textContent()).includes(expected)) { found = true; break; }
    }
    assert.equal(found, true, `${kind}: detailed hover text`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${kind}: overflow`);
    await page.screenshot({ path: resolve(output, `${kind}.png`), fullPage: true });
    captures.push(kind);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ errors, external, captures }, null, 2));
  console.log(`Detailed hover captures: ${captures.join(', ')}; zero page errors or external requests.`);
} finally { await browser.close(); }
