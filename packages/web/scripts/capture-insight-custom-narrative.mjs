// Offline acceptance for #333 against the freshly rebuilt static demo.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-333/custom');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const chart = page.locator('.author-card .chart');
async function capture(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.properties-panel').evaluate(panel => {
    const control = panel.querySelector('[aria-label="Narrative computation"]');
    panel.scrollTop += control.getBoundingClientRect().top - panel.getBoundingClientRect().top - 100;
  });
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  await page.getByRole('button', { name: 'Insight', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByLabel('Assign Category', { exact: true }).selectOption('region');
  await page.getByLabel('Assign Values', { exact: true }).selectOption('revenue');
  const closed = page.locator('.properties-panel:not([open]) > summary'); if (await closed.count()) await closed.click();
  await page.getByLabel('Title', { exact: true }).fill('Revenue summary');
  await page.getByLabel('Narrative computation', { exact: true }).selectOption('totalAggregation');
  await chart.locator('svg').waitFor();
  const textarea = page.getByLabel('Custom narrative template', { exact: true });
  await textarea.fill('Revenue: ');
  await page.getByLabel('Placeholder format', { exact: true }).selectOption('decimals:2');
  await page.getByLabel('Insert placeholder', { exact: true }).selectOption('totalAggregation.value');
  assert.equal(await textarea.inputValue(), 'Revenue: {totalAggregation.value|decimals:2}');
  assert.match(await chart.getAttribute('aria-label'), /Revenue: 900.00/);
  // Insertion replaces the selected text and restores the caret to the textarea.
  await textarea.fill('Revenue: replace\n\nBound sum: {field.revenue}');
  await textarea.evaluate(el => { el.focus(); el.setSelectionRange(9, 16); });
  await page.getByLabel('Insert placeholder', { exact: true }).selectOption('totalAggregation.value');
  const template = 'Revenue: {totalAggregation.value|decimals:2}\n\nBound sum: {field.revenue}';
  assert.equal(await textarea.inputValue(), template);
  assert.equal(await textarea.evaluate(el => el === document.activeElement && el.selectionStart === 44), true);
  assert.match(await chart.getAttribute('aria-label'), /Bound sum: 900/);
  assert.ok(await chart.locator('text').evaluateAll(nodes => nodes.some(n => getComputedStyle(n).fontWeight === '700')));
  await capture('custom-narrative-light');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark'); await capture('custom-narrative-dark');
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('light');
  await textarea.fill('{field.missing}'); await page.getByText(/INSIGHT_CUSTOM_NARRATIVE_REFERENCE/).first().waitFor(); await capture('custom-reference-error');
  await textarea.fill('{if totalAggregation.value}'); await page.getByText(/INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED/).first().waitFor();
  await textarea.fill('x'.repeat(1001)); await page.getByText(/INSIGHT_CUSTOM_NARRATIVE_TOO_LARGE/).first().waitFor();
  await textarea.fill(''); await chart.locator('svg').waitFor(); assert.match(await chart.getAttribute('aria-label'), /Total revenue: 900/);
  await textarea.fill(template); await chart.locator('svg').waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Custom narrative template', { exact: true }).inputValue(), template);
  assert.match(await chart.getAttribute('aria-label'), /Revenue: 900.00/);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(resolve(output, 'summary.json'), JSON.stringify({ pageErrors: errors, externalRequests: requests, template, checks: ['insert format', 'replace selection/caret', 'numeric emphasis', 'light/dark', 'reference error', 'unsupported syntax', 'size limit', 'clear to computed', 'save/reload'] }, null, 2));
  console.log('Custom narrative browser acceptance passed: no page errors or external requests.');
} finally { await browser.close(); }
