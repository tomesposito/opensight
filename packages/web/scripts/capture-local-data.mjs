import { navigate } from './app-navigation.mjs';
// Real local CSV -> prep -> chart acceptance; synthetic data only, no external I/O.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer } from '../../api/dist/index.js';
const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-29/browser');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
let api, vite, browser, page;
const errors = [], external = [], queries = [];
try {
  api = await createApiServer({ dataRoot, localData: true });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}` } } } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`, connected = 'https://opensight.test';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  // Installed Chromium blocks direct loopback navigation. Bridge a synthetic
  // origin to real local HTTP responses using Node, as in capture-first-run.
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== connected) { external.push(url.href); return route.abort(); }
    const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
    const response = await fetch(transport + url.pathname + url.search, { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
    const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    if (url.pathname.endsWith('/query')) queries.push({ path: url.pathname, request: req.postDataJSON(), status: response.status, body: JSON.parse(body) });
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const capture = async name => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' overflow'); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); console.log('Captured', name); };
  const mode = value => navigate(page, value);
  await page.goto(connected);
  await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  await mode('data-sources');
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'local.csv', mimeType: 'application/octet-stream', buffer: Buffer.from('team;amount;day\nNorth;2;2026-01-01\nSouth;3;2026-01-02\nNorth;4;2026-01-03\n') });
  await page.getByLabel('Delimiter').selectOption(';');
  await page.getByRole('button', { name: 'Upload to staging', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload staged', exact: true }).waitFor();
  assert.match(await page.locator('.upload-result').innerText(), /3 rows · 3 columns/);
  assert.match(await page.locator('.upload-result').innerText(), /INTEGER/);
  assert.match(await page.locator('.upload-result').innerText(), /Expires/);
  await capture('local-upload');
  await page.getByRole('button', { name: 'Prepare this upload', exact: true }).click();
  await page.getByText(/3 rows shown/).waitFor();
  await page.getByLabel('Dataset name', { exact: true }).fill('Local team totals');
  await page.getByRole('button', { name: '＋ Rename column', exact: true }).click();
  await page.getByLabel(/^Column/).selectOption('amount');
  await page.getByLabel('New name', { exact: true }).fill('units');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByRole('columnheader', { name: /units/ }).waitFor();
  await page.getByRole('button', { name: '＋ Add calculated column', exact: true }).click();
  await page.getByLabel('Column name', { exact: true }).fill('doubled');
  await page.getByLabel('Expression', { exact: true }).fill('{units} * 2');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByRole('columnheader', { name: /doubled/ }).waitFor();
  await page.getByRole('button', { name: '＋ Filter', exact: true }).click();
  await page.getByLabel(/^Column/).selectOption('team');
  await page.getByLabel('Values (one per line)', { exact: true }).fill('North');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByText(/2 rows shown/).waitFor();
  assert.deepEqual(await page.locator('.prep-table-scroll tbody tr').allTextContents(), ['North22026-01-01T00:00:00.000Z4', 'North42026-01-03T00:00:00.000Z8']);
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByText(/Dataset pipeline saved/).waitFor();
  await capture('local-prep');
  await page.getByRole('button', { name: 'Build a chart', exact: true }).click();
  await page.getByRole('button', { name: 'Assign doubled', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Assign doubled', exact: true }).click();
  await page.locator('.author-card summary').filter({ hasText: 'View data' }).click();
  await page.getByRole('cell', { name: 'North', exact: true }).waitFor();
  assert.ok(queries.some(q => q.path.includes('/prepared-') && q.status === 200 && q.body.rows.some(r => r.team === 'North' && r.doubled === 12)));
  assert.equal(queries.some(q => q.path.includes('/sales/query')), false, 'Uploaded charts must never query fixture sales');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  await capture('local-author');
  await page.reload();
  await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  await mode('author');
  await page.getByRole('button', { name: 'Assign doubled', exact: true }).waitFor();
  await mode('data-sources');
  await page.locator('.connector-card').filter({ hasText: 'MySQL' }).click();
  assert.equal(await page.getByRole('button', { name: 'Validate configuration', exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.connector-card').filter({ hasText: 'Upload a file' }).click();
  await capture('local-upload-mobile');
  // Review the freshly rebuilt single-file demo independently of the local API.
  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await demoContext.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  const demo = await demoContext.newPage(); demo.on('pageerror', e => errors.push(e.message));
  await demo.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  const demoCapture = async name => { assert.equal(await demo.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await demo.screenshot({ path: `${output}/${name}.png`, fullPage: true }); console.log('Captured', name); };
  await navigate(demo, 'data-sources');
  assert.equal(await demo.getByRole('button', { name: 'Upload to staging', exact: true }).isDisabled(), true);
  await demoCapture('demo-data-sources');
  await demo.evaluate(() => localStorage.setItem('opensight-prep-draft', JSON.stringify({
    resourceType: 'dataset', dataSetId: 'sample-prep', name: 'Sales · summary and detail', importMode: 'DIRECT_QUERY', physicalTableMap: {},
    opensightPrep: { version: 1, input: 'demo-sales', output: 'summary', steps: [
      { id: 'clean', name: 'Clean sales', kind: 'select', config: { columns: ['region', 'category', 'revenue', 'order_date'] } },
      { id: 'summary', name: 'Revenue summary', kind: 'aggregate', config: { groupBy: ['region'], measures: [{ column: 'revenue', name: 'total', aggregation: 'SUM' }] } },
      { id: 'detail', name: 'Sales detail', kind: 'select', from: 'clean', config: { columns: ['region', 'category', 'revenue', 'order_date'] } },
    ] },
  })));
  await navigate(demo, 'data-prep');
  await demo.getByRole('button', { name: /Sales detail.*Configure/ }).click();
  assert.equal(await demo.getByRole('button', { name: 'Save pipeline', exact: true }).isDisabled(), true);
  await demoCapture('demo-data-prep');
  await navigate(demo, 'author');
  await demo.getByRole('button', { name: 'Add visual', exact: true }).click();
  await demoCapture('demo-author');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ errors, external, preparedQueries: queries.length, flow: 'upload -> rename -> calculate -> filter -> save -> live chart -> reload' }));
} catch (error) {
  if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  throw error;
} finally {
  await browser?.close(); await vite?.close();
  if (api) { const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; }
}
