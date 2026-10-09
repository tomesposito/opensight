// Issue #64 visual sanity check against a real local API + Vite. No external
// requests, hosted credentials, or committed reference screenshots.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer } from '../../api/dist/index.js';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-64/browser');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('../', import.meta.url));
let api, vite, browser, captures = 0;
const errors = [], external = [];
try {
  api = await createApiServer({ dataRoot: fileURLToPath(new URL('../../../fixtures/', import.meta.url)), localData: true });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}`, rewrite: path => path.replace(/^\/api/, '') } } } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`, origin = 'https://opensight.test';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  // Chromium's loopback policy requires forwarding through Node. Only the
  // synthetic origin below is fulfilled, exclusively from the local stack.
  await context.route(/^https?:/, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    const headers = { ...request.headers() }; delete headers.host; delete headers['content-length'];
    const response = await fetch(transport + url.pathname + url.search, { method: request.method(), headers, body: request.postDataBuffer() ?? undefined });
    const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const capture = async name => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: viewport overflow`);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    captures++;
  };
  const rail = page.locator('#product-navigation');
  await page.goto(origin); await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  assert.deepEqual(await page.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link').allTextContents(), ['My stuff', 'Analyses', 'Dashboards', 'Data', 'My folders', 'Shared folders']);
  await capture('home');
  await navigate(page, 'my-stuff'); await page.getByRole('heading', { name: 'My stuff', exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('navigation', { name: 'Recent pages', exact: true }).getByRole('link').allTextContents(), ['Home']);
  await capture('my-stuff');
  for (const destination of ['my-folders', 'shared-folders']) {
    await navigate(page, destination);
    await page.getByRole('heading', { name: 'Folder browsing is not available here yet' }).waitFor();
    await capture(destination);
  }
  await page.getByRole('button', { name: 'Search navigation and commands', exact: true }).click();
  await page.getByRole('combobox').fill('Go to My stuff');
  await page.getByRole('combobox').press('Enter');
  await page.getByRole('heading', { name: 'My stuff', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await navigate(page, 'security');
  assert.equal(await page.getByRole('button', { name: 'More', exact: true }).getAttribute('aria-expanded'), 'true');
  await capture('more');
  await navigate(page, 'author');
  await page.getByLabel('Analysis title', { exact: true }).waitFor();
  assert.equal(await rail.isVisible(), false);
  await capture('author');
  await navigate(page, 'my-stuff');
  await page.locator('.account-menu summary').click();
  await capture('account');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.account-menu').getAttribute('open'), null);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await rail.isVisible(), false);
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await capture('mobile-rail');
  await rail.getByRole('link', { name: 'Shared folders', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Shared folders', exact: true }).waitFor();
  await rail.waitFor({ state: 'hidden' });
  await capture('mobile-shared-folders');
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Toggle navigation', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.goBack(); await page.getByRole('heading', { name: 'My stuff', exact: true }).waitFor();
  await page.goForward(); await page.getByRole('heading', { name: 'Shared folders', exact: true }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: 'Shared folders', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await rail.getByText('No recent pages yet.', { exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ captures, errors, external, checks: 'real local API, rail routes, Search, More, account, Author, mobile collapse, focus, Back/Forward, reload' }));
} finally {
  await browser?.close(); await vite?.close();
  if (api?.listening) { const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; }
}
