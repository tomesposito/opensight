// Issue #162: real hosted SQLite/auth/API/worker acceptance; no API response mocks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { authFixture } from '../../api/test/hosted-helpers.mjs';
import { serving } from '../../api/test/v1-helpers.mjs';
import { upload } from '../../api/test/source-helpers.mjs';
import { digestPeriods } from '../../api/dist/digest-computation.js';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue162-captures'; await mkdir(output, { recursive: true });
const teardown = [], t = { after(fn) { teardown.push(fn); } }, errors = [], external = [];
let vite, browser, page;
try {
  const f = await authFixture(t), call = await serving(t, f), origin = f.config.origin;
  let token = (await f.login()).token;
  const request = async (path, method = 'GET', body) => {
    const result = await call(path, { token, method, body }); assert.ok(result.status < 300, JSON.stringify(result.body)); return result.body;
  };
  const periods = digestPeriods('weekly', new Date());
  const csv = `day,region,amount\n${periods.previous.start.slice(0,10)},East,100\n${periods.previous.start.slice(0,10)},West,200\n${periods.current.start.slice(0,10)},East,300\n${periods.current.start.slice(0,10)},West,150\n`;
  const source = await request('/api/uploads', 'POST', { ...upload(), base64: Buffer.from(csv).toString('base64') }); token = (await f.login()).token;
  const identity = await f.auth.verify(token);
  await request('/api/datasets/sales/prep', 'PUT', { name: 'Synthetic regional sales', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
  await request('/api/v1/metrics', 'POST', { id: 'revenue', dataset: { kind: 'prepared-dataset', id: 'sales', ownerId: identity.userId }, definition: { name: 'Governed revenue', expression: 'sum({amount})', defaultAggregation: 'SUM', format: { style: 'currency', decimalPlaces: 2, currency: 'USD' }, description: 'Synthetic regional sales, using the published governed definition.', synonyms: [] } });
  const published = await call('/api/v1/metrics/revenue/publish', { token, method: 'POST', body: {}, headers: { 'If-Match': '"1"' } }); assert.equal(published.status, 200);
  const root = fileURLToPath(new URL('../', import.meta.url));
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } }); await vite.listen();
  const local = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  await context.routeWebSocket('**/*', s => s.close());
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const headers = { ...req.headers() }; delete headers.host; delete headers.authorization; delete headers['content-length'];
      const result = await call(url.pathname.slice(4), { token, method: req.method(), rawBody: req.postDataBuffer() ?? undefined, headers });
      const responseHeaders = { ...result.headers }; delete responseHeaders['content-length'];
      await route.fulfill({ status: result.status, headers: responseHeaders, body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
    } else {
      const response = await fetch(`${local}${url.pathname}${url.search}`), headers = Object.fromEntries(response.headers); delete headers['content-length']; delete headers['content-encoding'];
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    }
  });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const capture = async name => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); };
  await page.goto(origin); await page.locator('#product-navigation').waitFor(); await navigate(page, 'data'); await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await page.getByRole('button', { name: 'Subscribe to Governed revenue', exact: true }).click();
  await page.getByText('No active subscriptions.', { exact: true }).waitFor();
  await page.getByLabel('Driver dimensions (one field per line)').fill('region');
  await capture('metric-digest-subscribe');
  await page.getByRole('button', { name: 'Subscribe to email digest', exact: true }).click(); await page.getByRole('button', { name: 'View digest', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close subscriptions', exact: true }).click();
  await page.goto(`${origin}/#/metrics/revenue`); await page.getByRole('button', { name: 'View digest', exact: true }).click();
  await page.getByRole('region', { name: 'Digest preview', exact: true }).waitFor();
  assert.match(await page.getByRole('region', { name: 'Digest preview' }).innerText(), /450.00/); await capture('metric-digest-preview');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('metric-digest-mobile');
  await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click(); await page.getByText('No active subscriptions.', { exact: true }).waitFor();
  assert.deepEqual((await request('/api/v1/metrics/revenue/subscriptions')).items, []);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ checks: 'hosted subscribe, weekly default, deterministic preview, drill-back, mobile and unsubscribe', errors, external }));
} catch (e) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); throw e; }
finally { await browser?.close(); await vite?.close(); for (const fn of teardown.reverse()) await fn(); }
