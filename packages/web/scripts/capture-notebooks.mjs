// #164: actual local API + browser, synthetic fixture data, no external requests.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer } from '../../api/dist/index.js';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? resolve(homedir(), 'workspace/tools/screenshots'), 'package.json'))('playwright-core');
const output = process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue164-captures';
await mkdir(output, { recursive: true });
let api, vite, browser;
const errors = [], external = [];
try {
  api = await createApiServer({ dataRoot: fileURLToPath(new URL('../../../fixtures/', import.meta.url)), localData: true });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  const created = await fetch(`${apiOrigin}/api/notebooks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: 'Regional revenue notebook', parameters: [{ name: 'minimum', type: 'number', default: 0 }], cells: [
      { id: 'notes', kind: 'markdown', text: '# Revenue by region\n\nSynthetic sales · Change the minimum revenue and run this app with your own data permissions.' },
      { id: 'sales', kind: 'sql', text: 'SELECT region, SUM(revenue) AS total FROM sales WHERE revenue >= $minimum GROUP BY region ORDER BY region', datasetRefs: ['sales'] },
      { id: 'chart', kind: 'visual', sourceCellId: 'sales', chart: { type: 'bar', dimension: 'region', measure: 'total', aggregation: 'SUM' } },
    ],
  }) });
  assert.equal(created.status, 201); const notebook = await created.json();
  const root = fileURLToPath(new URL('../', import.meta.url));
  vite = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const local = `http://127.0.0.1:${vite.httpServer.address().port}`, origin = 'https://opensight.test';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
    const target = url.pathname.startsWith('/api/') ? `${apiOrigin}${url.pathname.slice(4)}${url.search}` : `${local}${url.pathname}${url.search}`;
    const response = await fetch(target, { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
    const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const capture = async name => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow`); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); };
  await page.goto(`${origin}/#/notebooks/${notebook.id}`); await page.getByLabel('SQL', { exact: true }).waitFor({ timeout: 60000 }).catch(async error => { console.log(await page.locator('body').innerText()); console.log(errors, external); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); throw error; });
  await capture('notebooks-editor');
  await page.getByLabel('Publish as an app for this namespace').check(); await page.getByRole('button', { name: 'Save notebook', exact: true }).click();
  await page.getByText('Saved version 2', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Open run view' }).click();
  await page.getByRole('button', { name: 'Run all', exact: true }).click();
  await page.locator('.notebook-cell .chart svg').waitFor();
  assert.equal(await page.locator('textarea').count(), 0);
  assert.match(await page.locator('.notebook-result').innerText(), /East/);
  await page.getByRole('button', { name: 'Save result as dataset snapshot', exact: true }).click();
  await page.getByText(/Dataset snapshot snapshot-/).waitFor();
  await capture('notebooks');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('notebooks-mobile');
  const offline = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await offline.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  const demo = await offline.newPage(); demo.on('pageerror', e => errors.push(e.message));
  await demo.goto(new URL('../dist/opensight-demo.html', import.meta.url).href); await demo.locator('.chart svg').first().waitFor();
  for (const [hash, file, wait] of [['#/home', 'sample-dashboard', '.chart svg'], ['#/data', 'data-landing', '.data-page'], ['#/my-stuff', 'navigation-rail', '.my-stuff-page'], ['#/notebooks', 'notebooks-static', '.notebooks-notice']]) {
    await demo.evaluate(hash => { location.hash = hash; }, hash);
    if (file !== 'navigation-rail') await demo.locator(wait).first().waitFor();
    await demo.screenshot({ path: `${output}/${file}.png`, fullPage: true });
  }
  assert.match(await demo.locator('.notebooks-page').innerText(), /static demo cannot store or run notebooks/);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ captures: 7, errors, external, checks: 'real local SQL, publish, parameter app, compiler chart, snapshot, mobile, rebuilt static demo' }));
} finally {
  await browser?.close(); await vite?.close();
  if (api?.listening) { const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; }
}
