// Captures an animated GIF storyboard for the repo README hero.
// Adapted from ~/workspace/tools/screenshots/readme-gif-44.mjs.
// Drives the rebuilt file:// demo through Home, O, Author, Analyses, Data, Admin.
// Frames land in OPENSIGHT_SCREENSHOT_OUTPUT/frames;
// assemble with: ffmpeg -framerate 10 -i .opensight/issue-58/gif/frames/f%03d.png ...
// (see the bottom of this file for the exact assembly command).
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
import { mkdirSync } from 'fs';

const DEMO = new URL('../dist/opensight-demo.html', import.meta.url).href;
const FRAMES = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-58/gif', 'frames');
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [], external = [];
page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 120)));
await page.route(/^https?:/, r => { external.push(r.request().url()); return r.abort(); });

let n = 0;
const snap = async () => {
  await page.screenshot({ path: `${FRAMES}/f${String(n++).padStart(3, '0')}.png` });
};
// Hold for ms, snapping roughly every 200ms (screenshot time included).
const hold = async ms => {
  for (let i = 0; i < Math.ceil(ms / 200); i++) await snap();
};
const setMode = mode => navigate(page, mode);

try {
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await hold(1500); // 1. dashboard with charts
  // Issue #52: return from the real long sample dashboard through the new control.
  await page.evaluate(() => window.scrollTo(0, 680));
  await page.getByRole('button', { name: 'Back to top', exact: true }).waitFor();
  await hold(1800);
  await page.getByRole('button', { name: 'Back to top', exact: true }).click();
  for (let i = 0; i < 6; i++) await snap();
  await page.waitForFunction(() => window.scrollY === 0);
  await hold(600);

  // 2. Ask the O bar a question, typing visibly.
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await page.click('#o-question');
  await hold(400);
  for (const ch of 'revenue by region') {
    await page.press('#o-question', ch === ' ' ? ' ' : ch);
    if (n % 2 === 0) await snap();
    await page.waitForTimeout(70);
  }
  await hold(500);
  await page.press('#o-question', 'Enter'); // 3. answer renders
  await page.locator('.o-result .chart svg').waitFor();
  assert.match(await page.locator('.o-source').innerText(), /^Offline demo:/);
  await hold(2800);
  await hold(1200);

  // Author and its Analyses home share the same device-local store.
  await setMode('author');
  // Issue #43: show empty wells, then create a visual by assigning its fields.
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await hold(1600);
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await hold(1400);
  await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await page.locator('#o-question').fill('revenue by region');
  await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor();
  await hold(1400);
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Analysis title', { exact: true }).fill('Revenue analysis');
  // Issue #54: keep the new saved indicator and recovery notice in the tour.
  await page.waitForFunction(() => /^Saved · /.test(document.querySelector('.save-indicator')?.textContent ?? ''));
  await hold(1400); await page.reload(); await page.locator('.draft-recovery').waitFor();
  await hold(2000); await page.locator('.draft-recovery').getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).focus();
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Shift+?');
  await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).waitFor();
  await hold(2000);
  await page.keyboard.press('Escape');
  // Issue #53: search real Author commands, save, then return to the canvas.
  await page.getByRole('button', { name: 'Save draft', exact: true }).focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.waitFor(); await hold(1800);
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('save draft');
  await hold(1000); await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'detached' });
  await page.locator('.author-card .chart svg').waitFor();
  await hold(1200);
  // Phase 2d radar: build through the gallery and recompute synthetic rows.
  await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  await page.getByRole('button', { name: 'Radar', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Values', { exact: true }).selectOption('revenue');
  await page.getByLabel('Assign Category', { exact: true }).selectOption('order_date');
  await page.getByLabel('Assign Color', { exact: true }).selectOption('region');
  const properties = page.locator('.properties-panel:not([open]) > summary');
  if (await properties.count()) await properties.click();
  await page.getByLabel('Title', { exact: true }).fill('Revenue by month and region');
  await page.locator('.author-card .chart svg').waitFor();
  await page.locator('.author-card').scrollIntoViewIfNeeded();
  await hold(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(FRAMES, '../radar.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  // Issue #46: shared-node flow diagram through Source / Destination / Weight.
  await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  await page.getByRole('button', { name: 'Sankey', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Source', { exact: true }).selectOption('region');
  await page.getByLabel('Assign Destination', { exact: true }).selectOption('category');
  await page.getByLabel('Assign Weight', { exact: true }).selectOption('revenue');
  await page.getByLabel('Title', { exact: true }).fill('Revenue from region to category');
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).check();
  await page.locator('.author-card .chart svg').waitFor();
  assert.match(await page.locator('.author-card .chart svg').textContent(), /East/);
  await page.locator('.author-card').scrollIntoViewIfNeeded();
  await hold(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(FRAMES, '../sankey.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  // Issue #47: calculate signed synthetic adjustments, then accumulate from zero.
  await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  await page.getByRole('button', { name: 'Waterfall', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Categories', { exact: true }).selectOption('region');
  await page.getByRole('button', { name: '+ Calculated field', exact: true }).click();
  const calculation = page.getByRole('dialog', { name: 'Calculated field', exact: true });
  await calculation.getByLabel('Name', { exact: true }).fill('Adjustment');
  await calculation.getByLabel('Expression', { exact: true }).fill("ifelse({region} = 'East', {revenue}, -{revenue} * 2)");
  await calculation.getByRole('button', { name: 'Create field', exact: true }).click();
  await page.getByLabel('Assign Values', { exact: true }).selectOption('Adjustment');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic revenue adjustments');
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).check();
  await page.locator('.author-card .chart svg').waitFor();
  assert.match(await page.locator('.author-card .chart svg').textContent(), /-800/);
  await page.locator('.author-card').scrollIntoViewIfNeeded();
  await hold(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(FRAMES, '../waterfall.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  // Insight uses the same pinned rows and text-graphic pipeline as the compiler.
  await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  await page.getByRole('button', { name: 'Insight', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Category', { exact: true }).selectOption('region');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('revenue');
  await page.getByLabel('Title', { exact: true }).fill('Revenue contributors by region');
  await page.locator('.author-card .chart svg').waitFor();
  assert.match(await page.locator('.author-card .chart').getAttribute('aria-label'), /Total revenue: 900/);
  await page.locator('.author-card').scrollIntoViewIfNeeded();
  await hold(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(FRAMES, '../insight.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  // Issue #40: row groups run against local synthetic data and save in the bundle.
  await page.locator('.author-card-actions button[aria-label^="Remove "]').click();
  await page.getByRole('button', { name: 'Pivot', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Rows', { exact: true }).selectOption('region');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('revenue');
  await page.getByLabel('Assign Rows', { exact: true }).selectOption('category');
  await page.getByLabel('Title', { exact: true }).fill('Revenue by region and category');
  await page.locator('details.property-section').filter({ has: page.locator('summary', { hasText: /^Subtotal$/ }) }).locator('summary').click();
  await page.getByLabel('Show subtotals', { exact: true }).check();
  await page.locator('.author-card').scrollIntoViewIfNeeded();
  await hold(1000);
  await page.getByRole('button', { name: 'Collapse row group East', exact: true }).click();
  await hold(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(FRAMES, '../pivot.png'), fullPage: true });
  await page.getByRole('button', { name: 'Expand row group East', exact: true }).press('Space');
  await hold(800);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await setMode('analyses');
  await hold(1800);

  // 4. Data preparation: type conversion, second input and bottom join editor.
  await setMode('data-prep');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Dataset name', { exact: true }).fill('Regional sales preparation');
  await page.getByRole('button', { name: '＋ Add data', exact: true }).click();
  await page.getByLabel('Stage a source', { exact: true }).selectOption(JSON.stringify('demo-regions'));
  await page.getByRole('button', { name: 'Stage input', exact: true }).click();
  await page.getByRole('button', { name: '＋ Change data type', exact: true }).click();
  await page.getByLabel('Column', { exact: true }).selectOption('revenue');
  await page.getByLabel('New type', { exact: true }).selectOption('INTEGER');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByRole('button', { name: '＋ Join', exact: true }).click();
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByRole('button', { name: 'Configure step', exact: true }).click();
  await page.locator('.prep-workspace').scrollIntoViewIfNeeded();
  await hold(2200);

  // 5. Data source connector gallery. End.
  await setMode('data-sources');
  await page.waitForTimeout(900);
  assert.deepEqual(await page.locator('.connector-name').allTextContents(), ['Upload a file']);
  assert.equal(await page.getByRole('checkbox', { name: 'Show unavailable connectors', exact: true }).isChecked(), false);
  await hold(1600);

  await setMode('security'); await hold(1400);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('frames:', n, 'errors:', JSON.stringify(errors.slice(0, 4)));
} catch (error) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(FRAMES, '../failure.png'), fullPage: true });
  throw error;
} finally {
  await browser.close();
}

// Assembly (run after):
// ffmpeg -y -framerate 10 -i .opensight/issue-58/gif/frames/f%03d.png -vf "scale=960:-1:flags=lanczos,palettegen" .opensight/issue-58/gif/palette.png
// ffmpeg -y -framerate 10 -i .opensight/issue-58/gif/frames/f%03d.png -i .opensight/issue-58/gif/palette.png -lavfi "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" .opensight/issue-58/gif/opensight-tour.gif
