// Real local API + Vite + Chromium acceptance for Issue #33. No response mocks.
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
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-33/browser');
await mkdir(output, { recursive: true });
const store = await mkdtemp(resolve(tmpdir(), 'opensight-o-answer-'));
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
  const ask = async question => {
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
  const sales = [{ region: 'East', 'O sum revenue': 500 }, { region: 'West', 'O sum revenue': 400 }];
  page = await localPage();
  await navigate(page, 'author');
  await ask('revenue by region');
  await chart('.o-result', [['East', '500'], ['West', '400']]);
  assert.equal(queries.at(-1).path, '/api/datasets/sales/query');
  assert.equal(queries.at(-1).status, 200); assert.deepEqual(queries.at(-1).body.rows, sales);
  assert.equal(await page.locator('.o-source').innerText(), 'Local sales API query.');
  await capture('o-sales');
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await chart('.author-card', [['East', '500'], ['West', '400']]);
  assert.deepEqual(queries.at(-1).body.rows, sales);
  console.log('PASS: local sales O chart and ADD TO ANALYSIS: East 500, West 400, real HTTP 200 dataset queries');
  await page.context().close();

  const uploadedStart = queries.length;
  page = await localPage();
  await navigate(page, 'data-sources');
  await page.getByRole('button', { name: /Upload a file/ }).click();
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'teams.csv', mimeType: 'text/csv', buffer: Buffer.from('team,amount,day\nNorth,2,2026-01-01\nSouth,3,2026-01-02\nNorth,4,2026-01-03\n') });
  await page.getByRole('button', { name: 'Upload to staging', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload staged', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Prepare this upload', exact: true }).click();
  await page.getByText(/3 rows shown/).waitFor();
  await page.getByLabel('Dataset name', { exact: true }).fill('Team totals');
  await page.getByRole('button', { name: 'Save pipeline', exact: true }).click();
  await page.getByText(/Dataset pipeline saved/).waitFor();
  await page.getByRole('button', { name: 'Build a chart', exact: true }).click();
  await page.getByRole('button', { name: 'Assign amount', exact: true }).waitFor();
  await page.getByLabel('Analysis title', { exact: true }).fill('Team totals');
  await ask('amount by team');
  await chart('.o-result', [['North', '6'], ['South', '3']]);
  const preparedPath = queries.at(-1).path;
  assert.match(preparedPath, /^\/api\/datasets\/prepared-[^/]+\/query$/);
  const teams = [{ team: 'North', 'O sum amount': 6 }, { team: 'South', 'O sum amount': 3 }];
  assert.equal(queries.at(-1).status, 200); assert.deepEqual(queries.at(-1).body.rows, teams);
  assert.equal(await page.locator('.o-source').innerText(), 'Team totals API query.');
  await capture('o-uploaded', false);
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await chart('.author-card', [['North', '6'], ['South', '3']]);
  assert.equal(queries.at(-1).path, preparedPath); assert.deepEqual(queries.at(-1).body.rows, teams);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  await capture('local-data');
  await page.locator('.local-drafts summary').click();
  await capture('local-drafts');
  await page.locator('.local-drafts summary').click();
  await ask('sum amount by day monthly');
  await chart('.o-result', [['2026-01', '9']]);
  assert.deepEqual(queries.at(-1).request.dimensions, [{ fieldId: 'day', columnName: 'day', granularity: 'MONTH' }]);
  console.log('PASS: uploaded CSV O chart, ADD TO ANALYSIS and dates: North 6, South 3; January 9');

  // Restart loses staged upload rows while keeping actual prepared metadata.
  await stop(); await start();
  await ask('amount by team');
  await page.locator('.o-result').getByText(/Source data expired or is unavailable — re-upload the file/).waitFor();
  assert.equal(await page.locator('.o-result .chart').count(), 0);
  assert.equal(queries.at(-1).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  assert.equal(queries.at(-1).path, preparedPath);
  assert.equal(queries.slice(uploadedStart).some(q => q.path === '/api/datasets/sales/query'), false);
  await capture('o-expired');
  await page.reload();
  await page.getByRole('complementary', { name: 'Draft source data' }).getByText(/Source data expired or is unavailable — re-upload the file/).waitFor();
  await capture('expired-draft');
  console.log('PASS: real API restart surfaces source recovery in the O answer and reopened draft');
  await page.context().close();

  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await demoContext.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  page = await demoContext.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await ask('revenue by region');
  await chart('.o-result', [['East', '500'], ['West', '400']]);
  assert.match(await page.locator('.o-source').innerText(), /^Offline demo: recomputed synthetic sales rows/);
  await capture('o-demo');
  await navigate(page, 'author');
  await page.getByLabel('Analysis title', { exact: true }).fill('Sales by region');
  await ask('revenue by region');
  await page.locator('.o-result .chart svg').waitFor();
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await chart('.author-card', [['East', '500'], ['West', '400']]);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  await capture('author');
  assert.equal(queries.some(q => q.path === '/api/o/query'), false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ checked: 'sales, uploaded CSV, add, dates, source expiry, offline demo', actualQueries: queries.length, pageErrors: errors.length, externalRequests: external.length, hostedORequests: 0 }));
} catch (error) {
  if (page && !page.isClosed()) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  throw error;
} finally { await browser?.close(); await vite?.close(); await stop(); await rm(store, { recursive: true, force: true }); }
