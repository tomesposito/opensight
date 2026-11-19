// Offline browser acceptance; build:demo first. Captures stay outside the repo.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigate, openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/home/hatch/workspace/goals/opensight/hidden_files/issue-parity-pivot-column-sort');
const baseline = process.argv.includes('--baseline');
const demo = process.env.OPENSIGHT_DEMO ? pathToFileURL(resolve(process.env.OPENSIGHT_DEMO)).href : new URL('../dist/opensight-demo.html', import.meta.url).href;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], requests = [], comparison = {}, orders = {}, geometry = [];
const makePage = async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(demo, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  return page;
};
const capture = async (page, name) => {
  await page.mouse.move(1438, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const bytes = await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
  return createHash('sha256').update(bytes).digest('hex');
};
try {
  for (const kind of ['Bar', 'Line', 'Table', 'Pie']) {
    const page = await makePage();
    await page.getByRole('button', { name: kind === 'Pie' ? 'Pie / donut' : kind, exact: true }).click();
    await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
    await page.getByRole('button', { name: 'Assign region', exact: true }).click();
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
    // Autosave changes visible chrome after two seconds; compare settled states.
    await page.getByText('Draft auto-saved on this device.', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    for (const theme of ['light','dark']) {
      await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
      const key = `${kind.toLowerCase()}-${theme}`;
      comparison[key] = await capture(page, `${baseline ? 'before' : 'after'}-${key}`);
    }
    await page.close();
  }
  if (baseline) {
    await writeFile(resolve(output, 'baseline.json'), JSON.stringify({ comparison, errors, requests }, null, 2) + '\n');
  } else {
    const before = JSON.parse(await readFile(resolve(output, 'baseline.json'), 'utf8'));
    assert.deepEqual(comparison, before.comparison, 'other visual modes must match pre-slice pixels');
    const page = await makePage();
    const section = page.locator('.property-section').filter({ has: page.locator('summary', { hasText: /^Column sort$/ }) });
    const measure = () => section.getByLabel('Column sort measure', { exact: true });
    const aggregation = () => section.getByLabel('Column sort aggregation', { exact: true });
    const table = page.locator('.author-card table');
    const order = async () => ({ columns: await table.locator('thead th').allTextContents(),
      rows: await table.locator('tbody tr.detail').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))) });
    const openSort = async () => {
      for (const details of await page.locator('.properties-panel details.property-section').all()) {
        if (await details.getAttribute('open') !== null && await details.locator('summary').first().textContent() !== 'Column sort') await details.locator('summary').first().click();
      }
      await openPropertySection(page, 'Column sort');
      await page.locator('.properties-panel').evaluate(node => { node.scrollTop = 0; });
    };
    await page.getByRole('button', { name: 'Pivot', exact: true }).click();
    await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
    await page.getByLabel('Assign Rows', { exact: true }).selectOption('region');
    await page.getByLabel('Assign Columns', { exact: true }).selectOption('category');
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
    await table.waitFor(); await openSort();
    orders.none = await order(); assert.equal(await measure().inputValue(), '');
    await capture(page, 'pivot-default');
    await measure().selectOption('revenue');
    assert.equal(await aggregation().inputValue(), 'SUM');
    assert.equal(await section.getByLabel('Column sort descending', { exact: true }).getAttribute('aria-pressed'), 'true');
    orders.descending = await order();
    assert.match(orders.descending.columns[1], /Hardware/); assert.match(orders.descending.columns[2], /Software/);
    assert.deepEqual(orders.descending.rows.map(row => row.slice(1)), [['200','300'],['350','50']]);
    assert.deepEqual(orders.descending.rows.map(row => row[0]), orders.none.rows.map(row => row[0]));
    await section.getByLabel('Column sort ascending', { exact: true }).click();
    orders.ascending = await order();
    assert.match(orders.ascending.columns[1], /Software/); assert.match(orders.ascending.columns[2], /Hardware/);
    assert.deepEqual(orders.ascending.rows, orders.none.rows.map(([region, hardware, software]) => [region, software, hardware]));
    for (const theme of ['light','dark']) {
      await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
      await capture(page, `pivot-column-sort-${theme}`);
      const measured = await measure().evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
      assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
      const directionColors = await section.locator('[aria-label="Column sort direction"] button').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
      assert.notEqual(directionColors[0], directionColors[1], 'selected direction must be visible in both themes');
      geometry.push({ theme, ...measured, directionColors });
    }
    for (const value of ['AVERAGE','MIN','MAX','COUNT','DISTINCT_COUNT','SUM']) { await aggregation().selectOption(value); assert.equal(await aggregation().inputValue(), value); }
    await section.getByLabel('Column sort descending', { exact: true }).click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' }); await openSort();
    assert.equal(await measure().inputValue(), 'revenue'); assert.equal(await aggregation().inputValue(), 'SUM');
    assert.deepEqual(await order(), orders.descending);
    await measure().selectOption(''); assert.deepEqual(await order(), orders.none);
    await measure().selectOption('revenue');
    await page.getByRole('button', { name: 'Remove revenue from Values', exact: true }).click();
    assert.equal(await measure().inputValue(), '');
    await page.close();
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ errors, requests, comparison, geometry, orders, saveReload: true, staleCleanup: true }, null, 2) + '\n');
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log(JSON.stringify({ baseline, comparison, geometry, orders, errors, requests }));
} finally { await browser.close(); }
