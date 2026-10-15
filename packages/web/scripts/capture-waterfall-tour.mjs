// Issue #47 acceptance against a rebuilt static demo. HTTP(S) stays blocked.
// OPENSIGHT_WATERFALL_BASELINE optionally selects the saved pre-build demo.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigate, openPropertySection } from './app-navigation.mjs';
import { activeSheet, authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-47/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], captures = [];
async function open(url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.chart svg').first().waitFor();
  return page;
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  captures.push(name);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
}
async function bar(page, prefix) {
  await capture(page, `${prefix}-home`);
  await navigate(page, 'author');
  await capture(page, `${prefix}-author-empty`);
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  // New visuals start empty (AutoGraph empty-state-first, issue #56); assign
  // the pinned sales fields so the chart builds.
  await page.getByRole('button', { name: 'Select GROUP/COLOR well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await page.getByRole('button', { name: 'Select VALUE well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await capture(page, `${prefix}-author`);
}
try {
  if (process.env.OPENSIGHT_WATERFALL_BASELINE) {
    const page = await open(pathToFileURL(resolve(process.env.OPENSIGHT_WATERFALL_BASELINE)).href);
    await bar(page, 'baseline'); await page.context().close();
  }
  const page = await open(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await bar(page, 'current');
  await page.getByRole('button', { name: 'Remove Visual 1', exact: true }).click();
  await page.getByRole('button', { name: 'Waterfall', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Analysis title', { exact: true }).fill('Waterfall analysis');
  assert.match(await page.locator('.fixture-notice').innerText(), /waterfall previews recompute pinned synthetic sales rows locally/);
  for (const well of ['Categories', 'Values']) await page.getByLabel(`Assign ${well}`, { exact: true }).waitFor();
  // New visuals start empty; assign the pinned sales fields so the chart builds.
  await page.getByRole('button', { name: 'Select CATEGORIES well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await page.getByRole('button', { name: 'Select VALUES well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  const properties = page.locator('.properties-panel:not([open]) > summary');
  if (await properties.count()) await properties.click();
  await page.getByLabel('Title', { exact: true }).fill('Revenue accumulation by region');
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).check();
  const chart = page.locator('.author-card .chart svg'); await chart.waitFor();
  assert.match(await chart.textContent(), /Total/);
  await capture(page, 'waterfall-revenue');
  // Breakdowns: assigning a breakdown field switches to the interleaved
  // layout — East subtotal 500, West breakdown deltas 350/50, West subtotal
  // 900. (The narrow card auto-hides some axis labels; the four bars' data
  // labels prove the interleaved layout, and no extra Total bar is appended.)
  await page.getByRole('button', { name: 'Select BREAKDOWN well', exact: true }).click();
  await page.getByRole('button', { name: 'Assign category', exact: true }).click();
  await chart.waitFor();
  const breakdownText = await chart.textContent();
  for (const value of ['500', '350', '50', '900']) assert.match(breakdownText, new RegExp(value));
  assert.ok(!breakdownText.includes('Total'));
  await capture(page, 'waterfall-breakdown-authored');
  await page.getByRole('button', { name: 'Remove category from Breakdown', exact: true }).click();
  await chart.waitFor();
  // A visible calculation on pinned sales creates a signed scenario, without
  // substituting fixture responses or pretending to query a hosted service.
  await page.getByRole('button', { name: '+ Calculated field', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Calculated field', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Adjustment');
  await dialog.getByLabel('Expression', { exact: true }).fill("ifelse({region} = 'East', {revenue}, -{revenue} * 2)");
  await dialog.getByRole('button', { name: 'Create field', exact: true }).click();
  await page.getByLabel('Assign Values', { exact: true }).selectOption('Adjustment');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic revenue adjustments');
  await chart.waitFor();
  assert.match(await chart.textContent(), /-800/);
  const fills = await chart.locator('path').evaluateAll(paths => paths.map(p => p.getAttribute('fill')));
  for (const color of ['#2e8b57', '#d64545', '#2673c9']) assert.ok(fills.includes(color), color);
  await capture(page, 'waterfall-signed');
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Data label decimal places', { exact: true }).fill('2');
  assert.match(await chart.textContent(), /-800.00/);
  await capture(page, 'waterfall-labels');
  await openPropertySection(page, 'Legend');
  await page.getByLabel('Show legend', { exact: true }).uncheck();
  assert.ok(!(await chart.textContent()).includes('Adjustment'));
  await openPropertySection(page, 'Legend');
  await page.getByLabel('Show legend', { exact: true }).check();
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark');
  await capture(page, 'waterfall-dark');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  for (const [field, well, error] of [['region', 'Categories', 'CATEGORY'], ['Adjustment', 'Values', 'VALUES']]) {
    await page.getByRole('button', { name: `Remove ${field} from ${well}`, exact: true }).click();
    await page.getByText(new RegExp(`WATERFALL_${error}_REQUIRED`)).first().waitFor();
    await capture(page, `waterfall-missing-${well.toLowerCase()}`);
    await page.getByLabel(`Assign ${well}`, { exact: true }).selectOption(field);
  }
  await chart.waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();

  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'waterfall' });
  activeSheet(draft).visuals[0].title = 'Waterfall with breakdowns';
  const resource = serializeDraft(draft);
  const wells = resource.definition.sheets[0].visuals[0].waterfallChartVisual.chartConfiguration.fieldWells.waterfallChartAggregatedFieldWells;
  wells.breakdowns = [{ categoricalDimensionField: { fieldId: 'category', column: { columnName: 'category', dataSetIdentifier: 'sales_data' } } }];
  await page.getByText('Import bundle', { exact: true }).click();
  await page.getByLabel('Import .qs or bundle JSON', { exact: true }).setInputFiles({ name: 'waterfall-breakdown.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(resource)) });
  await page.getByRole('dialog', { name: 'Bundle import report', exact: true }).waitFor();
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /CompileError/);
  await capture(page, 'waterfall-import-report');
  await page.getByRole('button', { name: 'Close import report', exact: true }).click();
  // The interleaved breakdown layout renders: the first category as a subtotal
  // from zero, later categories decomposed into per-breakdown floating delta
  // bars, each followed by its subtotal from zero.
  const importedChart = page.locator('.author-card .chart svg'); await importedChart.waitFor();
  // Interleaved breakdown layout: East subtotal 500, West breakdown deltas
  // 350/50, West subtotal 900. (Narrow-card axis auto-hides some labels; the
  // four bars' data labels prove the layout.)
  await openPropertySection(page, 'Data labels');
  await page.getByLabel('Show data labels', { exact: true }).check();
  await importedChart.waitFor();
  const importedText = await importedChart.textContent();
  for (const value of ['500', '350', '50', '900']) assert.match(importedText, new RegExp(value));
  assert.ok(!importedText.includes('Total'));
  await capture(page, 'waterfall-breakdown');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const summary = { captures, pageErrors: errors.length, externalRequests: external.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
