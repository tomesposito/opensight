// Issue #34: Chromium + real local API/Vite, plus the rebuilt offline demo.
// Build the API and static demo first. Uses existing external browser tools.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer, StubMailTransport } from '../../api/dist/index.js';
import { navigate } from './app-navigation.mjs';

const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-34/browser');
await mkdir(output, { recursive: true });
const store = await mkdtemp(resolve(tmpdir(), 'opensight-connectors-'));
const root = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const errors = [], external = [], queries = [], uploads = [];
let api, vite, browser, page;
try {
  api = await createApiServer({ dataRoot, localData: true, prepStorePath: resolve(store, 'prep.json'), mailTransport: new StubMailTransport() });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}` } } } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    // Installed Chromium blocks loopback; Node forwards unchanged requests to
    // the actual stack at the actual origin. No responses or rows are mocked.
    const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
    const response = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
    const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    if (url.pathname.endsWith('/query')) queries.push({ path: url.pathname.replace(/^\/api/, ''), status: response.status, body: JSON.parse(body) });
    if (url.pathname.endsWith('/uploads') && req.method() === 'POST') uploads.push({ status: response.status, body: JSON.parse(body) });
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const capture = async name => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  };
  const names = () => page.locator('.connector-name').allTextContents();
  const checkGallery = async mode => {
    await navigate(page, 'data-sources');
    const toggle = page.getByRole('checkbox', { name: 'Show unavailable connectors', exact: true });
    assert.equal(await toggle.isChecked(), false);
    assert.deepEqual(await names(), ['Upload a file']);
    assert.equal(await page.getByRole('region', { name: 'Not yet available', exact: true }).count(), 0);
    assert.equal(await page.getByLabel('File', { exact: true }).isEnabled(), mode === 'local');
    if (mode === 'static') assert.match(await page.locator('.connector-details').innerText(), /Uploads are unavailable in the static demo/);
    else assert.match(await page.locator('.connector-featured').innerText(), /Upload now, prepare your data, then build a chart/);
    await capture(`${mode}-default`);
    await page.getByRole('searchbox', { name: 'Find a data source' }).fill('mysql');
    assert.deepEqual(await names(), []);
    await toggle.check(); assert.deepEqual(await names(), ['MySQL']);
    await page.getByRole('searchbox', { name: 'Find a data source' }).fill('');
    assert.equal((await names()).length, 23);
    const group = page.getByRole('region', { name: 'Not yet available', exact: true });
    assert.equal(await group.locator('.connector-card').count(), 22);
    await group.getByRole('button', { name: /MySQL/ }).click();
    assert.equal(await page.locator('.connector-availability').innerText(), 'Not yet implemented');
    assert.equal(await page.getByRole('button', { name: 'Validate configuration', exact: true }).isEnabled(), false);
    await group.getByRole('button', { name: /PostgreSQL/ }).click();
    assert.match(await page.locator('.connector-availability').innerText(), /operator-configured connection/);
    if (mode === 'local') assert.match(await page.locator('.connector-details').innerText(), /Connection setup is unavailable in this local workspace/);
    assert.doesNotMatch(await page.locator('.data-sources').innerText(), /Needs hosted API \/ not configured/);
    await capture(`${mode}-unavailable`);
    await toggle.uncheck();
    assert.deepEqual(await names(), ['Upload a file']);
    assert.equal(await page.getByRole('complementary', { name: 'PostgreSQL setup' }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(`${mode}-mobile`);
    await toggle.check(); assert.equal((await names()).length, 23);
    await capture(`${mode}-mobile-unavailable`);
    await toggle.uncheck();
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log(`PASS: ${mode} default upload, toggle grouping/removal, search, state copy and mobile layout`);
  };
  await page.goto(origin);
  await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  await checkGallery('local');
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'teams.csv', mimeType: 'text/csv', buffer: Buffer.from('team,amount\nNorth,2\nSouth,3\nNorth,4\n') });
  await page.getByRole('button', { name: 'Upload to staging', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload staged', exact: true }).waitFor();
  assert.equal(uploads.length, 1); assert.equal(uploads[0].status, 201); assert.equal(uploads[0].body.rowCount, 3);
  await page.getByRole('button', { name: 'Prepare this upload', exact: true }).click();
  await page.getByText(/3 rows shown/).waitFor();
  await page.getByLabel('Dataset name', { exact: true }).fill('Team totals');
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByText(/Dataset pipeline saved/).waitFor();
  await page.getByRole('button', { name: 'Build a chart', exact: true }).click();
  await page.getByRole('button', { name: 'Assign amount', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await page.locator('#o-question').fill('amount by team'); await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor();
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await page.locator('.author-card summary').filter({ hasText: 'View data' }).click();
  assert.deepEqual(await page.locator('.author-card tbody tr').evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('td')].map(cell => cell.textContent))), [['North', '6'], ['South', '3']]);
  assert.match(queries.at(-1).path, /^\/api\/datasets\/prepared-[^/]+\/query$/);
  assert.equal(queries.at(-1).status, 200);
  assert.deepEqual(queries.at(-1).body.rows, [{ team: 'North', 'O sum amount': 6 }, { team: 'South', 'O sum amount': 3 }]);
  await capture('upload-to-chart');
  console.log('PASS: real CSV upload → prep → chart; North 6 and South 3 in API rows and rendered chart table');
  await context.close();

  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await demoContext.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  page = await demoContext.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await checkGallery('static');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ actualUploads: uploads.length, actualQueries: queries.length, pageErrors: errors.length, externalRequests: external.length }));
} catch (error) {
  if (page && !page.isClosed()) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  throw error;
} finally {
  await browser?.close(); await vite?.close();
  if (api) { const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; }
  await rm(store, { recursive: true, force: true });
}
