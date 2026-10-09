// Issue #59: real local upload/preparation/query flow plus the rebuilt static demo.
// Uses the installed screenshot harness; all data is synthetic and HTTP stays local.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApiServer } from '../../api/dist/index.js';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-59/browser');
await mkdir(out, { recursive: true });
let api, vite, browser, page;
const errors = [], external = [], queries = [], geometry = [];
try {
  api = await createApiServer({ dataRoot: fileURLToPath(new URL('../../../fixtures/', import.meta.url)), localData: true });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const root = fileURLToPath(new URL('../', import.meta.url));
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}` } } } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`, origin = 'https://opensight.test';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  // Chromium's loopback restriction requires the existing Node-fetch bridge.
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
    const response = await fetch(transport + url.pathname + url.search, { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
    const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    if (url.pathname.endsWith('/query')) queries.push({ path: url.pathname, status: response.status, body: JSON.parse(body) });
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const dialog = () => page.getByRole('dialog', { name: 'Create Analysis', exact: true });
  const open = async () => { await page.getByRole('link', { name: 'New analysis', exact: true }).click(); await dialog().waitFor(); };
  const capture = async name => {
    await page.mouse.move(5, 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name);
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  };
  await page.goto(origin); await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  await navigate(page, 'analyses'); await open();
  await page.getByText('No datasets yet. Create a dataset to get started.').waitFor();
  assert.equal(await button('Select').isDisabled(), true);
  assert.equal(await page.getByRole('tab', { name: 'Topics' }).isDisabled(), true);
  assert.equal(await page.getByLabel('Search datasets by name').evaluate(node => node === document.activeElement), true);
  // Native dialog traps keyboard navigation and makes the product links inert.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    // Native dialogs may hand focus to browser chrome between tab cycles;
    // document.body then reports as active, but no background control can focus.
    assert.ok(await page.evaluate(() => !!document.querySelector('dialog:modal') && (document.activeElement === document.body || !!document.activeElement.closest('dialog'))));
  }
  await capture('local-picker-empty');
  await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('link', { name: 'New analysis', exact: true }).evaluate(node => node === document.activeElement), true);
  await open(); await button('Create dataset').click(); await page.locator('.data-prep').waitFor();
  await navigate(page, 'data-sources');
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'revenue.csv', mimeType: 'text/csv', buffer: Buffer.from('team,amount\nNorth,2\nSouth,3\nNorth,4\n') });
  await button('Upload to staging').click(); await page.getByRole('heading', { name: 'Upload staged', exact: true }).waitFor();
  await button('Prepare this upload').click();
  await page.getByLabel('Dataset name', { exact: true }).fill('Uploaded team revenue');
  await button('Save pipeline').click(); await page.getByText(/Dataset pipeline saved/).waitFor();
  await navigate(page, 'analyses'); await open();
  await page.getByRole('radio', { name: 'Uploaded team revenue', exact: true }).waitFor();
  assert.equal(await button('Select').isDisabled(), true);
  await capture('local-picker');
  await page.getByLabel('Search datasets by name').fill('nothing matches');
  await page.getByText('No datasets match your search.').waitFor();
  await page.getByLabel('Search datasets by name').fill(' TEAM ');
  await page.getByRole('radio', { name: 'Uploaded team revenue', exact: true }).check();
  await button('Select').click(); await page.getByRole('button', { name: 'Assign amount', exact: true }).waitFor();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await button('Assign team').click(); await button('Assign amount').click();
  await page.locator('.author-card .chart svg').waitFor();
  assert.ok(queries.some(query => query.path.includes('/prepared-') && query.status === 200 && query.body.rows.some(row => row.team === 'North' && Object.values(row).includes(6))));
  assert.equal(queries.some(query => query.path.includes('/sales/query')), false);
  await page.getByLabel('Analysis title', { exact: true }).fill('Keep uploaded analysis');
  await button('New analysis').click(); await dialog().waitFor();
  await button('Cancel').click();
  assert.equal(await page.getByLabel('Analysis title', { exact: true }).inputValue(), 'Keep uploaded analysis');
  assert.equal(await button('New analysis').evaluate(node => node === document.activeElement), true);
  await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark');
  await button('New analysis').click(); await dialog().waitFor();
  await capture('author-picker-dark'); await page.keyboard.press('Escape');
  await navigate(page, 'sample'); await button('Try sample data').click();
  await navigate(page, 'analyses'); await open();
  await page.getByRole('radio', { name: 'Sample sales data', exact: true }).waitFor();
  await capture('local-picker-with-sample');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('local-picker-mobile');
  geometry.push(await dialog().evaluate(node => ({ viewport: innerWidth, width: node.getBoundingClientRect().width, left: node.getBoundingClientRect().left, font: getComputedStyle(node).fontFamily })));
  assert.ok(geometry[0].left >= 0 && geometry[0].width <= 390);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('radio', { name: 'Sample sales data', exact: true }).check();
  const sampleQuery = page.waitForResponse(response => response.url().includes('/sales/query') && response.status() === 200);
  await button('Select').click(); await sampleQuery;
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).waitFor();
  assert.ok(queries.some(query => query.path.includes('/sales/query') && query.status === 200));
  // The single-file demo is an independent local artifact, never a deployed API.
  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await demoContext.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  const demo = await demoContext.newPage(); demo.on('pageerror', error => errors.push(error.message));
  await demo.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await navigate(demo, 'analyses'); await demo.getByRole('link', { name: 'New analysis', exact: true }).click();
  await demo.getByRole('dialog', { name: 'Create Analysis' }).waitFor();
  assert.equal(await demo.getByRole('button', { name: 'Create dataset', exact: true }).isDisabled(), true);
  await demo.screenshot({ path: resolve(out, 'demo-picker.png') });
  await demo.getByRole('radio', { name: 'Sample sales data', exact: true }).check();
  await demo.getByRole('button', { name: 'Select', exact: true }).click();
  await demo.getByRole('button', { name: 'Assign revenue', exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { passed: true, errors, external, geometry, preparedQueries: queries.filter(q => q.path.includes('/prepared-')).length, sampleQueries: queries.filter(q => q.path.includes('/sales/query')).length };
  await writeFile(resolve(out, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) { if (page) await page.screenshot({ path: resolve(out, 'failure.png') }); throw error; }
finally { await browser?.close(); await vite?.close(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); } }
