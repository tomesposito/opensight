import { navigate } from './app-navigation.mjs';
// Local browser acceptance. Run after the API and demo builds; uses existing
// screenshot tools and Chromium, without installing or contacting anything.
// Uses ephemeral loopback ports. No server is deployed by this script.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createApiServer, emptySecurityState } from '../../api/dist/index.js';

const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue-27-browser');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const errors = [], external = [], requests = [];
let api, vite, browser;
let apiPort = 0;
const stopApi = async () => { const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; };
const startApi = async security => {
  api = await createApiServer({ dataRoot, ...(security ? { security } : {}) });
  api.listen(apiPort, '127.0.0.1'); await once(api, 'listening');
  apiPort = api.address().port;
};
try {
  await startApi();
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const connected = 'https://opensight.test';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  // The installed browser blocks loopback navigation. Bridge this synthetic
  // document origin to the real local stack through Node; all other URLs fail.
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route(/^https?:/, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== connected) { external.push(url.href); return route.abort(); }
    if (url.pathname.startsWith('/api/')) requests.push(url.pathname);
    const headers = { ...route.request().headers() };
    delete headers.host; delete headers['content-length'];
    const response = await fetch(transport + url.pathname + url.search, { method: route.request().method(), headers, body: route.request().postDataBuffer() ?? undefined });
    const responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    return route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.log('Page error:', error.message); });
  const setup = () => page.getByRole('heading', { name: 'Authentication is not configured', exact: true }).waitFor();
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const capture = async name => { await noOverflow(); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); console.log('Captured:', name); };
  const mode = value => navigate(page, value);
  await page.goto(connected); await setup();
  assert.match(await page.locator('main').innerText(), /SECURITY_NOT_CONFIGURED/);
  await capture('first-run');
  await page.getByText('Required API environment variables', { exact: true }).click();
  await capture('first-run-config');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('first-run-mobile');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await page.getByRole('complementary', { name: 'Fixture demo' }).waitFor();
  assert.match(await page.locator('body').innerText(), /Renderable Sales/);
  const demoRequests = requests.length;
  await capture('fixture-demo');
  await mode('security');
  assert.equal(await page.getByText('API definition preview · Needs hosted API', { exact: true }).getAttribute('aria-disabled'), 'true');
  await mode('sample');
  await page.locator('#o-question').fill('revenue by region');
  await page.locator('#o-question').press('Enter');
  await page.locator('.o-answer').waitFor();
  await mode('author');
  assert.match(await page.locator('body').innerText(), /Fixtures · Offline/);
  await mode('data-prep');
  assert.equal(await page.getByRole('button', { name: 'Save pipeline', exact: true }).isDisabled(), true);
  await mode('data-sources');
  assert.match(await page.locator('body').innerText(), /No data is uploaded or connections made here/);
  for (const value of ['security', 'organization', 'automation', 'fixtures']) await mode(value);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(requests.length, demoRequests, 'demo must make no API requests');
  await page.getByRole('button', { name: 'Return to setup' }).click(); await setup();
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await page.reload(); await setup(); // Opt-in never persists across reloads.

  // Test transport failure and malformed responses without an external service.
  for (const response of ['offline', 'html', 'unauthorized']) {
    await page.route('**/api/api/session', route => response === 'offline' ? route.abort() : route.fulfill(response === 'html'
      ? { status: 502, contentType: 'text/html', body: '<h1>Proxy unavailable</h1>' }
      : { status: 401, contentType: 'application/json', body: '{"errorCode":"PRINCIPAL_REQUIRED"}' }));
    await page.reload();
    await page.getByRole('heading', { name: response === 'unauthorized' ? 'A verified session is required' : 'Unable to connect to your workspace', exact: true }).waitFor();
    await capture(`first-run-${response}`);
    await page.unroute('**/api/api/session');
  }
  await page.getByRole('button', { name: 'Retry connection' }).click(); await setup();

  // Use an actual configured server and its registered principal. The test
  // transport supplies a synthetic bearer credential; product code adds none.
  await stopApi();
  const initialState = emptySecurityState();
  initialState.users = [{ id: 'browser-test', namespaceId: 'default', name: 'Browser test', role: 'author' }];
  await startApi({ initialState, authenticate: request => request.headers.authorization === 'Bearer browser-test'
    ? { namespaceId: 'default', userId: 'browser-test' } : undefined });
  await context.setExtraHTTPHeaders({ Authorization: 'Bearer browser-test' });
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.first-run, .fixture-demo-banner').count(), 0);
  await mode('author');
  assert.match(await page.locator('body').innerText(), /API · Local sales/);
  await context.setExtraHTTPHeaders({});
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading', { name: 'A verified session is required', exact: true }).waitFor();
  assert.equal(await page.locator('.app-shell').count(), 0);

  // Rebuilt static demo and README feature images affected by the demo caption.
  await page.goto(pathToFileURL(resolve(root, 'dist/opensight-demo.html')).href);
  await page.locator('.app-shell').waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mode('author'); await capture('static-author');
  await page.evaluate(() => localStorage.setItem('opensight-prep-draft', JSON.stringify({
    resourceType: 'dataset', dataSetId: 'sample-prep', name: 'Sales · summary and detail', importMode: 'DIRECT_QUERY', physicalTableMap: {},
    opensightPrep: { version: 1, input: 'demo-sales', output: 'summary', steps: [
      { id: 'clean', name: 'Clean sales', kind: 'select', config: { columns: ['region', 'category', 'revenue', 'order_date'] } },
      { id: 'summary', name: 'Revenue summary', kind: 'aggregate', config: { groupBy: ['region'], measures: [{ column: 'revenue', name: 'total', aggregation: 'SUM' }] } },
      { id: 'detail', name: 'Sales detail', kind: 'select', from: 'clean', config: { columns: ['region', 'category', 'revenue', 'order_date'] } },
    ] },
  })));
  await mode('data-prep');
  await page.getByRole('button', { name: /Sales detail.*Configure/ }).click();
  await capture('data-prep');
  await mode('data-sources'); await capture('data-sources');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ assertions: 'passed', output, pageErrors: errors.length, externalRequests: external.length }));
} finally {
  await browser?.close();
  await vite?.close();
  if (api?.listening) await stopApi();
}
