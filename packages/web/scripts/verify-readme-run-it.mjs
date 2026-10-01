// Run against the actual two-terminal README commands in a clean checkout.
// Uses the existing external screenshot tools; no package dependencies added.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';

const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
const runIt = readme.split('## Run it\n')[1].split(/^## /m)[0];
const origin = runIt.match(/\[http:\/\/[^\]]+\]\((http:\/\/[^)]+)\)/)[1];
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-30/browser');
await mkdir(output, { recursive: true });
const bridge = process.env.OPENSIGHT_BROWSER_BRIDGE === 'true';
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], queries = [], responses = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route(/^https?:/, async route => {
    const req = route.request();
    if (new URL(req.url()).origin !== origin) { external.push(req.url()); return route.abort(); }
    if (!bridge) return route.continue();
    // Installed Chromium can block loopback. Keep the documented browser URL
    // and forward unchanged requests/responses through Node to the real servers.
    const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
    const response = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
    const responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) });
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/query')) responses.push((async () => {
      queries.push({ path: new URL(response.url()).pathname, status: response.status(), body: await response.json() });
    })());
  });
  const capture = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  await page.goto(origin);
  assert.equal(new URL(page.url()).origin, origin);
  await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  await page.getByRole('heading', { name: 'Renderable Sales (Synthetic)', exact: true }).waitFor();
  await page.locator('.dashboard-grid .chart svg').first().waitFor();
  assert.match(await page.locator('.fixture-notice').innerText(), /No live query is run/);
  assert.equal(await page.locator('.dashboard-grid .visual-card').count(), 5);
  assert.equal(queries.length, 0, 'Home must use pinned sample results');
  await capture('home');
  console.log('PASS: exact README URL opens Local workspace and the pinned five-visual Home');

  await navigate(page, 'data-sources');
  await page.getByRole('button', { name: /Upload a file/ }).click();
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'teams.csv', mimeType: 'text/csv', buffer: Buffer.from('team,amount\nNorth,2\nSouth,3\nNorth,4\n') });
  await page.getByRole('button', { name: 'Upload to staging', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload staged', exact: true }).waitFor();
  assert.match(await page.locator('.upload-result').innerText(), /3 rows · 2 columns/);
  await page.getByRole('button', { name: 'Prepare this upload', exact: true }).click();
  await page.getByText(/3 rows shown/).waitFor();
  await page.getByLabel('Dataset name', { exact: true }).fill('Run it team totals');
  await page.getByRole('button', { name: '＋ Add calculated column', exact: true }).click();
  await page.getByLabel('Column name', { exact: true }).fill('doubled');
  await page.getByLabel('Expression', { exact: true }).fill('{amount} * 2');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByRole('columnheader', { name: /doubled/ }).waitFor();
  await page.getByRole('button', { name: '＋ Filter', exact: true }).click();
  await page.getByLabel(/^Column/).selectOption('team');
  await page.getByLabel('Values (one per line)', { exact: true }).fill('North');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByText(/2 rows shown/).waitFor();
  assert.deepEqual(await page.locator('.prep-table-scroll tbody tr').allTextContents(), ['North24', 'North48']);
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByText(/Dataset pipeline saved/).waitFor();
  await capture('prepared-csv');
  console.log('PASS: CSV upload, inferred schema, calculated column, filter, preview and Save pipeline');

  await page.getByRole('button', { name: 'Build a chart', exact: true }).click();
  await page.getByRole('button', { name: 'Assign doubled', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Assign doubled', exact: true }).click();
  await page.locator('.author-card summary').filter({ hasText: 'View data' }).click();
  await page.getByRole('cell', { name: 'North', exact: true }).waitFor();
  await page.locator('.author-card .chart svg').waitFor();
  await Promise.all(responses);
  assert.ok(queries.some(q => q.path.includes('/prepared-') && q.status === 200 && q.body.rows.some(r => r.team === 'North' && r.doubled === 12)));
  await page.getByLabel('Analysis title', { exact: true }).fill('Run it saved chart');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  const savedUrl = page.url();
  await capture('saved-chart');
  await navigate(page, 'analyses');
  await page.getByRole('heading', { name: 'My analyses', exact: true }).waitFor();
  await page.reload();
  const row = page.locator('.local-drafts li').filter({ has: page.getByText('Run it saved chart', { exact: true }) });
  await row.getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  assert.equal(page.url(), savedUrl);
  assert.equal(await page.getByLabel('Analysis title', { exact: true }).inputValue(), 'Run it saved chart');
  await Promise.all(responses);
  assert.equal(queries.some(q => q.path.includes('/sales/query')), false, 'Uploaded charts must never substitute sales fixture queries');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: live prepared chart (North = 12), Save draft, reload My analyses and Reopen');
  console.log(JSON.stringify({ origin, transport: bridge ? 'Node loopback bridge, unchanged browser origin' : 'direct browser HTTP', preparedQueries: queries.length, pageErrors: errors.length, externalRequests: external.length }));
} catch (error) {
  if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  throw error;
} finally {
  await browser.close();
}
