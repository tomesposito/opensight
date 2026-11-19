// Offline browser acceptance; build:demo first. Captures stay outside the repo.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigate, openPropertySection } from './app-navigation.mjs';

const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/opensight-kpi-targets-captures');
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
    const section = page.locator('.property-section').filter({ has: page.locator('summary', { hasText: /^Trend sort$/ }) });
    await page.getByRole('button', { name: 'KPI', exact: true }).click();
    await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
    await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
    await page.getByLabel('Assign Trend group', { exact: true }).selectOption('order_date');
    await page.getByLabel('Assign Target value', { exact: true }).selectOption('profit');
    await page.locator('.author-card.is-selected .chart svg').waitFor();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    // Exercise imported option semantics without inventing a new authoring options UI.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('opensight.author.drafts.v1.'));
      const collection = JSON.parse(localStorage.getItem(key));
      const draft = collection.entries.find(e => e.id === collection.activeId).draft;
      const visual = draft.sheets.flatMap(s => s.visuals).find(v => v.kind === 'kpi');
      visual.kpiOptions = { progressBar: {}, trendArrows: {}, comparison: { comparisonMethod: 'DIFFERENCE' } };
      localStorage.setItem(key, JSON.stringify(collection));
    });
    await page.reload({ waitUntil: 'networkidle' });
    const card = page.locator('.author-card.is-selected');
    const order = () => card.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
    const openSort = async () => {
      while (await page.locator('.properties-panel details[open]').count()) await page.locator('.properties-panel details[open]').first().locator('summary').first().click();
      await openPropertySection(page, 'Trend sort');
    };
    await openSort();
    await card.locator('.chart svg').waitFor();
    orders.ascending = await order();
    assert.equal(await card.locator('[role=progressbar]').count(), 1);
    assert.match(await card.locator('.chart').getAttribute('aria-label'), /Target:.*of target.*Trend (up|down)/);
    assert.equal(await card.locator('th').last().textContent(), 'Target: profit');
    assert.ok(orders.ascending.length >= 2);
    assert.equal(await section.getByLabel('Trend sort ascending', { exact: true }).getAttribute('aria-pressed'), 'true');
    await section.getByLabel('Trend sort descending', { exact: true }).click();
    orders.descending = await order();
    assert.deepEqual(orders.descending, [...orders.ascending].reverse());
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
      await capture(page, `kpi-targets-${theme}`);
      const measured = await section.getByLabel('Trend sort ascending', { exact: true }).evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, pageWidth: document.documentElement.scrollWidth }));
      assert.match(measured.font, /Arial/); assert.equal(measured.size, '12px'); assert.equal(measured.pageWidth, 1440);
      const directionColors = await section.locator('[aria-label="Trend sort direction"] button').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
      assert.notEqual(directionColors[0], directionColors[1]);
      geometry.push({ theme, ...measured, directionColors });
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' }); await openSort();
    assert.deepEqual(await order(), orders.descending);
    await section.getByRole('button', { name: 'Reset trend sort', exact: true }).click();
    assert.deepEqual(await order(), orders.ascending);
    await page.getByRole('button', { name: 'Remove profit from Target value', exact: true }).click();
    assert.equal(await card.locator('[role=progressbar]').count(), 0);
    await card.locator('.chart svg').waitFor();
    assert.match(await card.locator('.render-notes').textContent(), /targetValues/);
    assert.equal(await card.locator('th').count(), 2);
    await page.getByRole('button', { name: 'Remove order_date from Trend group', exact: true }).click();
    assert.equal(await section.count(), 0);
    assert.equal((await order()).length, 1);
    await page.close();
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ errors, requests, comparison, geometry, orders, saveReload: true, staleCleanup: true }, null, 2) + '\n');
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log(JSON.stringify({ baseline, comparison, geometry, orders, errors, requests }));
} finally { await browser.close(); }
