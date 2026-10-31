// Real local API + Vite + Chromium acceptance for Issue #160. No response mocks.
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
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue160-captures');
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
  await page.getByRole('button', { name: '＋ Formula column', exact: true }).click();
  await page.getByLabel('Column name', { exact: true }).fill('Doubled');
  await page.getByLabel('Expression', { exact: true }).fill('{amount} * 2');
  await page.getByRole('button', { name: 'Apply step', exact: true }).click();
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic team sales', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await page.getByRole('button', { name: 'Promote Doubled', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Promote calculation', exact: true });
  assert.equal(await dialog.getByLabel(/^Expression/).inputValue(), '{amount} * 2');
  await dialog.getByLabel('Name', { exact: true }).fill('Governed double');
  await capture('calculation-promotion');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('calculation-promotion-mobile');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft awaiting approval', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Publish Governed double', exact: true }).click();
  await page.getByText('Published', { exact: true }).waitFor();
  await capture('promoted-metric');
  await navigate(page, 'data-prep');
  await page.getByLabel(/^Saved datasets/).selectOption({ label: 'Synthetic team sales' });
  await page.getByRole('button', { name: 'Promote recipe', exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('Double team amounts');
  await page.getByRole('button', { name: 'Save template draft', exact: true }).click();
  await page.getByText('Review Double team amounts', { exact: true }).click();
  await capture('recipe-template-review');
  await page.getByRole('button', { name: 'Publish Double team amounts', exact: true }).click();
  await page.getByRole('button', { name: 'Start from Double team amounts', exact: true }).click();
  await page.getByLabel('New dataset name', { exact: true }).fill('Copied team recipe');
  const input = page.getByLabel(/^Bind input/);
  const value = await input.locator('option').nth(1).getAttribute('value'); await input.selectOption(value);
  await capture('recipe-template-start');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('recipe-template-start-mobile');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Create prepared dataset', exact: true }).click();
  await page.getByText('Prepared dataset created from a published template. Its steps are independently editable.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Dataset name', { exact: true }).inputValue(), 'Copied team recipe');
  await capture('template-created-dataset');
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await navigate(page, 'data-prep');
  await page.getByRole('button', { name: 'Shared templates', exact: true }).click();
  assert.match(await page.getByRole('dialog').innerText(), /Needs a local or hosted API/);
  assert.equal(await page.getByRole('button', { name: 'Create prepared dataset', exact: true }).count(), 0);
  await capture('static-template-requirement');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('static-template-requirement-mobile');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ errors, external, queries: queries.length }));
} catch (error) { if (page) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); console.error((await page.locator('body').innerText()).slice(-9000)); } throw error; } finally { await browser?.close(); await vite?.close(); await stop(); await rm(store, { recursive: true, force: true }); }
