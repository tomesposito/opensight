// Issue #74: browser acceptance against real hosted handlers and synthetic data,
// plus static-demo README captures. No external HTTP or hosted deployment.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { hostedDataFixture } from '../test/hosted-data-helpers.mjs';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve('.opensight/issue-74/browser');
mkdirSync(out, { recursive: true });
const cleanup = [], f = await hostedDataFixture({ after: fn => cleanup.push(fn) });
const server = await createServer({ root: resolve('packages/web'), configFile: resolve('packages/web/vite.config.ts'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const transport = server.resolvedUrls.local[0], origin = 'https://opensight.test/';
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], external = [], checks = [];
const check = label => { checks.push(label); console.log(label); };
const button = (page, name) => page.getByRole('button', { name, exact: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.routeWebSocket('**/*', socket => socket.close());
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/^https?:/, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(origin).origin) { external.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) {
      // The browser's local-network checks prohibit direct loopback navigation.
      // Keep the established capture transport: Node fetches only our local Vite.
      const response = await fetch(new URL(url.pathname + url.search, transport));
      const headers = Object.fromEntries(response.headers);
      delete headers['content-encoding']; delete headers['content-length'];
      return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    }
    const path = url.pathname.replace(/^\/api(?=\/api\/)/, '');
    const response = path === '/api/session' ? Response.json({ id: 'admin', name: 'Synthetic owner', namespaceId: 'one', tenantId: 'tenant-one', role: 'administrator' })
      : await f.fetcher(path, { method: request.method(), ...(request.postData() ? { body: request.postData() } : {}) });
    return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  await page.goto(`${origin}#/data`);
  await button(page, 'Orders').waitFor();
  await page.getByRole('searchbox').fill('ORD');
  assert.equal(await button(page, 'Orders').count(), 1);
  await page.screenshot({ path: resolve(out, 'hosted-landing.png') }); check('Nonempty hosted landing renders and searches');
  await button(page, 'Orders').click();
  await page.getByRole('cell', { name: 'revenue', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'hosted-detail.png') }); check('Hosted detail shows transformed columns');
  await button(page, 'Generate analysis').click();
  await page.locator('.author-menu').waitFor();
  await page.waitForFunction(() => !document.body.textContent.includes('Checking source data…'));
  assert.equal(await page.locator('.draft-source-recovery').count(), 0);
  check('Generate analysis reaches author with its prepared source');
  await page.goto(`${origin}#/data/datasets/orders`);
  await page.getByRole('heading', { name: 'Orders', exact: true }).waitFor();
  await page.getByLabel('Dataset actions', { exact: true }).click(); await button(page, 'Duplicate').click();
  await page.getByLabel('Dataset name', { exact: true }).fill('Orders copy'); await button(page, 'Duplicate dataset').click();
  await page.getByRole('heading', { name: 'Orders copy', exact: true }).waitFor(); check('Duplicate persists a new hosted recipe');
  await button(page, 'Edit dataset').click();
  await page.getByLabel('Dataset name', { exact: true }).fill('Orders edited copy'); await button(page, 'Save pipeline').click();
  await page.getByRole('heading', { name: 'Orders edited copy', exact: true }).waitFor(); check('Edit saves using its loaded version');
  await page.getByText('Storage settings', { exact: true }).click();
  await page.getByLabel('Execution mode', { exact: true }).selectOption('BLAZE');
  await page.getByText('BLAZE · Cached', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Refresh', exact: true }).click();
  await button(page, 'Add new schedule').click(); await page.getByLabel('Occurrence (minutes)', { exact: true }).fill('15'); await button(page, 'Save schedule').click();
  await page.getByRole('cell', { name: 'Every 15 minutes', exact: true }).waitFor();
  await button(page, 'Edit').click(); await page.getByLabel('Occurrence (minutes)', { exact: true }).fill('30'); await button(page, 'Save schedule').click();
  await page.getByRole('cell', { name: 'Every 30 minutes', exact: true }).waitFor(); check('Hosted refresh schedule adds and edits');
  await button(page, 'Refresh now').click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(node => node.textContent === 'Refresh now')?.disabled);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.screenshot({ path: resolve(out, 'hosted-refresh.png') }); check('Real hosted refresh completes with honest missing telemetry');
  await button(page, 'Remove').click(); await page.getByRole('cell', { name: 'No schedules.', exact: true }).waitFor();
  await page.getByLabel('Dataset actions', { exact: true }).click(); await button(page, 'Delete').click(); await button(page, 'Delete dataset').click();
  await button(page, 'Orders').waitFor(); assert.equal(await button(page, 'Orders edited copy').count(), 0); check('Schedule removal and versioned delete compose');

  const demo = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  demo.on('pageerror', error => errors.push(String(error)));
  await demo.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await demo.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await demo.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link', { name: 'Data', exact: true }).click();
  await demo.getByText('No datasets yet', { exact: true }).waitFor();
  await demo.screenshot({ path: resolve('docs/images/data-landing.png'), animations: 'disabled' });
  await demo.getByRole('tab', { name: 'Data sources', exact: true }).click();
  await demo.locator('.data-tools').getByRole('button', { name: 'Create data source', exact: true }).click();
  await demo.locator('dialog.data-dialog').waitFor();
  await demo.screenshot({ path: resolve('docs/images/data-sources.png'), animations: 'disabled' });
  await demo.keyboard.press('Escape'); await navigate(demo, 'data-prep');
  await demo.locator('.prep-document-bar').waitFor();
  await demo.screenshot({ path: resolve('docs/images/data-prep.png'), animations: 'disabled' }); check('Rebuilt static demo screenshots refreshed');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ checks, errors, external }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors: errors.length, external: external.length }));
} finally {
  await browser.close(); await server.close();
  for (const fn of cleanup.reverse()) await fn();
}
