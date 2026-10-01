// Real loopback API + Vite + Chromium acceptance for issue #31. Synthetic data
// and test principals only; no deployment, external requests or new dependency.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer, emptySecurityState } from '../../api/dist/index.js';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-31/browser');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
let api, vite, browser, page, apiPort = 0;
const errors = [], external = [], queries = [], documents = [];
const stop = async () => { if (api?.listening) { const closed = once(api, 'close'); api.close(); api.closeAllConnections(); await closed; } };
const start = async options => { api = await createApiServer({ dataRoot, ...options }); api.listen(apiPort, '127.0.0.1'); await once(api, 'listening'); apiPort = api.address().port; };
try {
  await start({ localData: true });
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`, connected = 'https://opensight.test';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  // Installed Chromium blocks loopback navigation; Node forwards this synthetic
  // origin to the actual local stack. This is only the test transport.
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== connected) { external.push(url.href); return route.abort(); }
    if (req.isNavigationRequest() && req.resourceType() === 'document') documents.push(url.pathname);
    const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
    const response = await fetch(transport + url.pathname + url.search, { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
    const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    if (url.pathname.endsWith('/query')) queries.push({ status: response.status, body: JSON.parse(body) });
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const product = () => page.getByRole('navigation', { name: 'Product', exact: true });
  const capture = async name => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' overflow'); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); console.log('Captured', name); };
  const active = async label => assert.equal(await product().locator('[aria-current="page"]').innerText(), label);
  const direct = async hash => { await page.evaluate(hash => { location.hash = hash; }, hash); };
  await page.goto(connected); await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  assert.deepEqual(await product().getByRole('link').allTextContents(), ['Home', 'Analyses', 'Data', 'Admin']);
  await active('Home'); await capture('local-home');
  const initialDocuments = documents.length;
  for (const label of ['Analyses', 'Data', 'Admin']) { await product().getByRole('link', { name: label, exact: true }).click(); await active(label); }
  assert.equal(documents.length, initialDocuments, 'Section switches must not reload the page');
  assert.equal(await page.getByRole('link', { name: 'AI provider settings', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Users and invitations', exact: true }).count(), 0);
  await capture('local-admin');
  await page.goBack(); await active('Data'); await page.goBack(); await active('Analyses'); await page.goForward(); await active('Data');
  await navigate(page, 'analyses');
  await page.getByRole('link', { name: 'New analysis', exact: true }).click();
  await page.getByLabel('Analysis title', { exact: true }).fill('Navigation sales analysis');
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  assert.ok(queries.some(q => q.status === 200 && q.body.rows.length));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  const savedUrl = page.url(); assert.match(savedUrl, /#\/analyses\/drafts\//);
  await navigate(page, 'analyses');
  const row = name => page.locator('.local-drafts li').filter({ has: page.getByText(name, { exact: true }) });
  assert.equal(await row('Navigation sales analysis').locator('time').count(), 1);
  await row('Navigation sales analysis').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Draft name', { exact: true }).fill('My saved sales');
  await page.getByRole('button', { name: 'Save draft name', exact: true }).click();
  await capture('local-analyses');
  await row('My saved sales').getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  assert.equal(await page.getByLabel('Analysis title', { exact: true }).inputValue(), 'My saved sales');
  assert.equal(page.url(), savedUrl);
  await page.goBack(); await active('Analyses'); await page.getByRole('heading', { name: 'My analyses', exact: true }).waitFor();
  await page.goForward(); await page.locator('.author-card .chart svg').waitFor();
  await page.reload(); await page.locator('.author-card .chart svg').waitFor();
  assert.equal(await page.getByLabel('Analysis title', { exact: true }).inputValue(), 'My saved sales');
  await navigate(page, 'analyses');
  await page.getByRole('link', { name: 'New analysis', exact: true }).click();
  assert.equal(await page.locator('.author-card').count(), 0);
  await page.getByLabel('Analysis title', { exact: true }).fill('Delete this draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  const deletedUrl = page.url();
  await navigate(page, 'analyses'); await row('Delete this draft').getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await page.locator('.local-drafts li').count(), 1);
  await direct(new URL(deletedUrl).hash); await page.getByRole('heading', { name: 'Unable to open analysis', exact: true }).waitFor();
  assert.equal(await page.locator('.author-card').count(), 0);
  await navigate(page, 'analyses'); await page.setViewportSize({ width: 390, height: 844 }); await capture('local-analyses-mobile');
  await navigate(page, 'security'); await capture('local-admin-mobile');
  await page.setViewportSize({ width: 1440, height: 1100 });

  await stop();
  const initialState = emptySecurityState();
  const roles = ['reader', 'reader_ai', 'author', 'author_ai', 'administrator'];
  initialState.users = roles.map(role => ({ id: `browser-${role}`, namespaceId: 'default', name: `Browser ${role}`, role }));
  await start({ security: { initialState, authenticate: request => {
    const user = initialState.users.find(user => request.headers.authorization === `Bearer ${user.id}`);
    return user ? { namespaceId: 'default', userId: user.id } : undefined;
  } } });
  for (const role of roles) {
    await context.setExtraHTTPHeaders({ Authorization: `Bearer browser-${role}` });
    await page.goto(connected); await product().waitFor();
    const build = !role.startsWith('reader'), admin = role === 'administrator';
    assert.deepEqual(await product().getByRole('link').allTextContents(), build ? ['Home', 'Analyses', 'Data', 'Admin'] : ['Home', 'Admin']);
    await navigate(page, 'security');
    for (const name of ['AI provider settings', 'Users and invitations']) assert.equal(await page.getByRole('link', { name, exact: true }).count(), admin ? 1 : 0);
    assert.equal(await page.getByRole('link', { name: 'Developer fixture preview', exact: true }).count(), build ? 1 : 0);
    if (!admin) {
      await direct('#/admin/ai-settings'); await page.getByRole('alert').filter({ hasText: 'SECURITY_ADMIN_REQUIRED' }).waitFor();
      await direct('#/admin/users'); await page.getByRole('alert').filter({ hasText: 'SECURITY_ADMIN_REQUIRED' }).waitFor();
    } else {
      await navigate(page, 'ai-settings'); await page.getByRole('heading', { name: 'AI provider settings', exact: true }).waitFor();
      await navigate(page, 'users'); await page.getByRole('heading', { name: 'Users and invitations', exact: true }).waitFor();
    }
    if (!build) {
      for (const hash of ['#/analyses', '#/analyses/author', '#/data/sources', '#/admin/developer/fixtures']) {
        await direct(hash); await page.getByRole('alert').filter({ hasText: 'SECURITY_BUILD_REQUIRED' }).waitFor();
      }
    }
    await navigate(page, 'security'); await capture(`hosted-${role}`);
  }
  // Independent static demo with all HTTP blocked. Same IA and draft integration.
  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await demoContext.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  page = await demoContext.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await page.locator('.chart svg').first().waitFor(); await capture('sample-dashboard');
  await navigate(page, 'analyses'); await page.getByRole('link', { name: 'New analysis', exact: true }).click();
  await page.getByLabel('Analysis title', { exact: true }).fill('Sales by region');
  await page.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
  await page.locator('.author-card .chart svg').waitFor(); await capture('author');
  await navigate(page, 'analyses'); await capture('analyses');
  await page.getByRole('button', { name: 'Reopen', exact: true }).click(); await page.locator('.author-card .chart svg').waitFor();
  await navigate(page, 'security'); await capture('admin');
  assert.equal(await page.getByText('API definition preview · Needs hosted API', { exact: true }).getAttribute('aria-disabled'), 'true');
  await navigate(page, 'fixtures'); await capture('definition-preview');
  assert.doesNotMatch(await page.locator('.product-header').innerText(), /Definition explorer/);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ errors, external, actualQueries: queries.length, checked: 'local, demo, all five hosted roles; Home -> Analyses -> Data -> Admin; drafts, reload, back/forward, denied URLs, mobile' }));
} catch (error) {
  if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  throw error;
} finally { await browser?.close(); await vite?.close(); await stop(); }
