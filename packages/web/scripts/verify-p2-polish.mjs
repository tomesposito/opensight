// Real local API + Vite + Chromium acceptance for Issue #35. No response mocks.
// Uses the existing external browser tools; build the API and static demo first.
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
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-35/browser');
await mkdir(output, { recursive: true });
const store = await mkdtemp(resolve(tmpdir(), 'opensight-p2-polish-'));
const root = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
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
  await start();
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } } });
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage });
  };
  const exports = async label => {
    await navigate(page, 'author');
    assert.equal(await page.locator('.header-caption').innerText(), 'Author');
    assert.match(await page.locator('.product-header .brand').innerText(), /OpenSight/);
    assert.doesNotMatch(await page.locator('.product-header').innerText(), /Definition explorer/);
    if (label === 'local') await page.getByText(/rows · live query/).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /No successful refresh recorded|saved draft could not be restored|Saved analyses on this device could not be read/);
    const file = page.locator('.author-menu summary').filter({ hasText: /^File$/ });
    for (const [action, filename] of [['Export JSON', 'opensight-analysis.json'], ['Download .qs', 'opensight-analysis.qs']]) {
      // Count DOM nodes, including closed menus, then verify the actual download.
      assert.equal(await page.locator('button').filter({ hasText: action }).count(), 1, `${label}: ${action}`);
      await file.click();
      const button = page.getByRole('button', { name: action, exact: true });
      assert.equal(await button.isVisible(), true);
      const download = page.waitForEvent('download');
      await button.click();
      assert.equal((await download).suggestedFilename(), filename);
    }
    await file.click();
    await capture(`${label}-exports`);
    await file.click();
    console.log(`PASS: ${label}: exactly one JSON and .qs export, both download from File`);
  };
  const settled = async label => {
    await navigate(page, 'fixtures');
    await page.getByLabel('Definition example').selectOption({ label: 'TotalDeathByCountry' });
    const card = page.locator('.visual-card');
    await card.getByText('Definition only', { exact: true }).waitFor();
    assert.equal(await card.getAttribute('aria-busy'), 'false');
    assert.equal(await card.locator('.empty-symbol').count(), 0);
    assert.equal(await card.evaluate(node => node.getAnimations({ subtree: true }).length), 0);
    assert.equal(await card.locator('.chart').count(), 0);
    assert.equal(await page.locator('#o-question').count(), 0);
    await page.getByText('Questions are unavailable for definition previews.', { exact: false }).waitFor();
    await capture(`${label}-definition`);
    await page.getByRole('link', { name: 'Open Home to explore sample sales data.' }).click();
    await page.locator('.dashboard-heading h1').filter({ hasText: 'Renderable Sales' }).waitFor();
    await page.locator('.dashboard-grid .chart svg').first().waitFor();
    if (label === 'demo') {
      await page.locator('#o-question').fill('revenue by region');
      await page.locator('#o-question').press('Enter');
      await page.locator('.o-result .chart svg').waitFor();
      await page.locator('.o-result summary').filter({ hasText: 'View data' }).click();
      assert.deepEqual(await page.locator('.o-result tbody tr').evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('td')].map(cell => cell.textContent))), [['East', '500'], ['West', '400']]);
      assert.match(await page.locator('.o-source').innerText(), /^Offline demo:/);
      await page.locator('#o-question').fill('sum revenue by region in 2024');
      await page.locator('#o-question').press('Enter');
      await page.locator('.o-result').getByText('No results', { exact: true }).waitFor();
      assert.equal(await page.locator('.o-result .empty-symbol').count(), 0);
      assert.equal(await page.locator('.o-result').evaluate(node => node.getAnimations({ subtree: true }).length), 0);
    }
    console.log(`PASS: ${label}: settled definition preview has no spinner or animation`);
  };
  page = await localPage();
  await exports('local');
  await settled('local');
  // Exercise an actual expired-source query and the #32 draft recovery controls.
  await navigate(page, 'data-sources');
  await page.getByRole('button', { name: /Upload a file/ }).click();
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'teams.csv', mimeType: 'text/csv', buffer: Buffer.from('team,amount\nNorth,2\nSouth,3\nNorth,4\n') });
  await page.getByRole('button', { name: 'Upload to staging', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload staged', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Prepare this upload', exact: true }).click();
  await page.getByText(/3 rows shown/).waitFor();
  await page.getByLabel('Dataset name', { exact: true }).fill('Team totals');
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByText(/Dataset pipeline saved/).waitFor();
  await page.getByRole('button', { name: 'Build a chart', exact: true }).click();
  const ask = async () => {
    await page.locator('#o-question').fill('amount by team');
    await page.locator('#o-question').press('Enter');
  };
  await ask(); await page.locator('.o-result .chart svg').waitFor();
  assert.deepEqual(queries.at(-1).body.rows, [{ team: 'North', 'O sum amount': 6 }, { team: 'South', 'O sum amount': 3 }]);
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  await stop(); await start();
  await ask();
  const failed = page.locator('.o-result .visual-card');
  await failed.getByText('Unable to load data', { exact: true }).waitFor();
  assert.equal(queries.at(-1).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  assert.equal(await failed.getAttribute('aria-busy'), 'false');
  assert.equal(await failed.locator('.empty-symbol, .chart').count(), 0);
  assert.equal(await failed.evaluate(node => node.getAnimations({ subtree: true }).length), 0);
  await capture('local-query-error');
  await page.reload();
  const recovery = page.getByRole('complementary', { name: 'Draft source data' });
  await recovery.getByText(/Source data expired/).waitFor();
  for (const name of ['Retry source data', 'Re-upload file', 'Reconnect draft']) assert.equal(await recovery.getByRole('button', { name, exact: true }).isVisible(), true);
  await recovery.getByRole('button', { name: 'Retry source data', exact: true }).click();
  await recovery.getByText(/Source data expired/).waitFor();
  await capture('local-recovery');
  console.log('PASS: actual expired query has no spinner; draft retry/re-upload/reconnect remain visible');

  // Old single-draft storage must never leak parser diagnostics into Author.
  page = await localPage();
  await page.evaluate(() => localStorage.setItem('local.opensight.author.v0', '{'));
  await navigate(page, 'author');
  await page.getByText(/Saved analyses on this device could not be read/).waitFor();
  assert.match(await page.locator('.author-save').innerText(), /Reload to retry, or import an exported .qs or JSON copy/);
  assert.doesNotMatch(await page.locator('main').innerText(), /SyntaxError|Unexpected|Invalid or unsupported author draft|could not be restored/);
  await capture('local-unreadable-draft');
  const demo = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await demo.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  page = await demo.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await exports('demo');
  await settled('demo');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ pageErrors: errors.length, externalRequests: external.length, actualQueries: queries.length }));
} finally { await browser?.close(); await vite?.close(); await stop(); await rm(store, { recursive: true, force: true }); }
