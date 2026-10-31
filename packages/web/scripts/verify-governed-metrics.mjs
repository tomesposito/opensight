// Real local API + Vite + Chromium acceptance for Issue #157. No response mocks.
// Uses the existing external browser tools; build the API and static demo first.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer, StubMailTransport } from '../../api/dist/index.js';
import { navigate } from './app-navigation.mjs';

const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue157-captures');
await mkdir(output, { recursive: true });
const store = await mkdtemp(resolve(tmpdir(), 'opensight-governed-metrics-'));
const root = fileURLToPath(new URL('../', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const dataRoot = resolve(store, 'fixtures');
const errors = [], external = [], queries = [];
let api, apiPort = 0, vite, browser, page;
const start = async () => {
  api = await createApiServer({ dataRoot, localData: true, prepStorePath: resolve(store, 'prep.json'), mailTransport: new StubMailTransport() });
  api.listen(apiPort, '127.0.0.1'); await once(api, 'listening'); apiPort = api.address().port;
};
const stop = async () => {
  if (!api) return;
  const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; api = undefined;
};
try {
  // Local assets persist beside the input definitions. Keep acceptance writes
  // and lock files in the disposable workspace, never in checked-in fixtures.
  await cp(fixturesRoot, dataRoot, { recursive: true, filter: path => !basename(path).startsWith('.opensight-') && !path.endsWith('.h1-write-lock') });
  await start();
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const localPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route(/^https?:/, async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      // Installed Chromium blocks loopback. Forward unchanged browser requests
      // through Node to the real stack, preserving the actual local origin.
      const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
      const response = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
      const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
      delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
      // Vite removes its /api transport prefix before forwarding to the API.
      if (url.pathname.endsWith('/query')) queries.push({ path: url.pathname.replace(/^\/api/, ''), browserPath: url.pathname, request: req.postDataJSON(), status: response.status, body: JSON.parse(body) });
      await route.fulfill({ status: response.status, headers: responseHeaders, body });
    });
    const next = await context.newPage(); next.on('pageerror', e => errors.push(e.message));
    await next.goto(origin);
    await next.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
    return next;
  };
  const capture = async (name, fullPage = true) => {
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 20).map(e => [e.tagName, e.className, e.getBoundingClientRect().right]) }));
    assert.equal(overflow.scroll <= overflow.width, true, `${name}: horizontal overflow ${JSON.stringify(overflow)}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage });
  };
  const ask = async question => {
    if (!await page.locator('.q-side-panel').count()) await page.getByRole('button', { name: /^Ask a question about / }).click();
    await page.locator('#o-question').fill(question);
    await page.locator('#o-question').press('Enter');
  };
  const chart = async (selector, rows) => {
    const card = page.locator(selector);
    await card.locator('.chart svg').waitFor();
    assert.doesNotMatch(await card.innerText(), /Data unavailable|Unable to load data|SECURITY_NOT_CONFIGURED/);
    await card.locator('summary').filter({ hasText: 'View data' }).click();
    assert.deepEqual(await card.locator('tbody tr').evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('td')].map(cell => cell.textContent))), rows);
  };

  page = await localPage();
  await navigate(page, 'data-sources');
  await page.getByRole('button', { name: 'Create data source', exact: true }).click();
  await page.getByRole('radio', { name: 'Upload a file', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'teams.csv', mimeType: 'text/csv', buffer: Buffer.from('team,amount\nNorth,2\nSouth,3\nNorth,4\n') });
  await page.getByRole('button', { name: 'Upload to staging', exact: true }).click();
  await page.getByRole('heading', { name: 'Transformation pipeline', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByText(/3 rows shown/).waitFor();
  await page.getByLabel('Dataset name', { exact: true }).fill('Synthetic team sales');
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic team sales', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await page.getByRole('button', { name: 'Create metric', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create governed metric', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Governed sales');
  await dialog.getByLabel('Expression', { exact: true }).fill('{amount} * 2');
  await dialog.getByLabel('Format', { exact: true }).selectOption('currency');
  await dialog.getByLabel('Description', { exact: true }).fill('Synthetic team amounts doubled, shared across analyses and dashboards.');
  await dialog.getByLabel('Synonyms (one per line)', { exact: true }).fill('turnover');
  await capture('governed-metric-form', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('governed-metric-form-mobile', false);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('Draft awaiting approval', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Publish Governed sales', exact: true }).click();
  await page.getByRole('cell', { name: 'Published', exact: true }).waitFor();
  await capture('governed-metrics', false);
  await page.getByRole('button', { name: 'History of Governed sales', exact: true }).click();
  await page.getByRole('dialog', { name: 'Version history: Governed sales', exact: true }).locator('details').last().locator('summary').click();
  await capture('governed-metric-history', false);
  await page.getByRole('button', { name: 'Close history', exact: true }).click();
  await page.getByRole('button', { name: 'Generate analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Assign Governed sales', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Assign Governed sales', exact: true }).click();
  await page.getByRole('button', { name: 'Assign team', exact: true }).click();
  assert.match(await page.getByRole('button', { name: 'Remove Governed sales from Value', exact: true }).innerText(), /SUM\(Governed sales\)/);
  await chart('.author-card', [['North', '$12.00'], ['South', '$6.00']]);
  await capture('governed-metric-author', false);
  await ask('turnover by team');
  await chart('.o-result', [['North', '$12.00'], ['South', '$6.00']]);
  assert.match(await page.locator('.o-answer').innerText(), /Governed sales.*version 2/s);
  await capture('governed-metric-o', false);
  await page.context().close();

  const offline = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await offline.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  page = await offline.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await navigate(page, 'data');
  await capture('data-landing', false);
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await page.getByText(/Needs a local or hosted API/).waitFor();
  await capture('governed-metrics-offline', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('governed-metrics-mobile', true);
  await offline.close();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ checks: 'real upload, draft, publication, history, Author and Ask O currency results, offline and mobile states', queries: queries.length, errors, external }));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser?.close(); await vite?.close(); await stop(); await rm(store, { recursive: true, force: true });
}
