// Local full-app acceptance: existing Chromium, real hosted API, synthetic metadata.
// All browser HTTP requests are intercepted; only the loopback fixture does I/O.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, prepared, input, request } from '../test/embed-full-app-helpers.mjs';
import { HostedAISettings } from '../dist/hosted-ai-settings.js';

const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'));
const { chromium } = require('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue336-browser');
await mkdir(output, { recursive: true });
const cleanups = [], checks = [], requests = [], errors = [];
let browser, page;
try {
  const f = await fixture({ mock, after: fn => cleanups.unshift(fn) });
  mock.timers.reset();
  await prepared(f);
  const initial = input();
  initial.definition.sheets[0].visuals = [{ kpiVisual: { visualId: 'total', title: { visibility: 'VISIBLE', formatText: { plainText: 'Total amount' } },
    chartConfiguration: { fieldWells: { values: [{ numericalMeasureField: { fieldId: 'amount', column: { dataSetIdentifier: 'data', columnName: 'amount' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }] } } } }];
  const token = async () => `Bearer ${(await f.login()).token}`;
  assert.equal((await f.call('/api/v1/analyses', 'POST', initial, await token())).status, 201);
  const published = await f.call('/api/v1/analyses/working/publish', 'POST', {}, await token()); assert.equal(published.status, 201);
  const settings = new HostedAISettings(f.metadata, f.hostedConfig.encryptionKey.toString('base64'), {});
  await settings.save(await f.context(), { provider: 'openai', model: 'synthetic-model' });
  await settings.saveKey(await f.context(), { key: 'synthetic-test-only-not-a-credential' });
  let backendAuthorization = await token();
  let issued, landing, surface;
  const host = 'https://product.example', embed = f.hostedConfig.origin;
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    try {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === host && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Full-app embed acceptance</title><style>body{margin:0}#app{height:100vh}iframe{border:0}</style></head><body><div id="app"></div><script type="module">
      import { createSessionEmbeddingClient } from '/sdk/index.js'; window.events=[];
      window.handle=await createSessionEmbeddingClient({allowedEmbedOrigins:[${JSON.stringify(embed)}],getEmbedUrl:async(signal,surface)=>{
        const response=await fetch('/issue',{method:'POST',body:JSON.stringify({surface}),signal});
        if(!response.ok)throw Error('Issuance failed');return response.json();
      }}).mount(document.querySelector('#app'),{surface:${JSON.stringify(surface)},onReady:()=>events.push('ready'),onSaved:()=>events.push('saved'),onAuthorizationRevoked:()=>events.push('revoked')});
      </script></body></html>` });
    if (url.origin === host && url.pathname === '/issue' && req.method() === 'POST') {
      const body = req.postDataJSON();
      const result = await f.call('/api/embedding/sessions', 'POST', { ...request(landing), Surface: body.surface }, backendAuthorization);
      issued = result.body;
      return route.fulfill({ status: result.status, json: result.body });
    }
    if (url.origin === host && /^\/sdk\/(index|session|surface)\.js$/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../../embedding-sdk/dist/${url.pathname.split('/').at(-1)}`, import.meta.url), 'utf8') });
    if (url.origin !== embed) { errors.push(`Unexpected external request: ${url.origin}`); return route.abort(); }
    requests.push(url.pathname);
    const headers = await req.allHeaders(), body = req.postData();
    const result = await f.call(url.pathname + url.search, req.method(), body ? JSON.parse(body) : undefined, headers.authorization, {
      ...(headers.origin ? { origin: headers.origin } : {}), ...(headers['if-match'] ? { 'if-match': headers['if-match'] } : {}),
    });
    const responseHeaders = Object.fromEntries(Object.entries(result.headers).filter(([key]) => !['content-length', 'connection', 'keep-alive', 'transfer-encoding'].includes(key)));
    return route.fulfill({ status: result.status, headers: responseHeaders, body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
    } catch (error) { errors.push(error.message); await route.abort().catch(() => {}); }
  });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const mount = async (path, declaration) => {
    landing = path; surface = declaration;
    await page.goto(host); await page.waitForFunction(() => window.events?.includes('ready'));
    return page.frames().find(frame => frame.url().startsWith(embed));
  };
  let frame = await mount('/analyses/author/working');
  await frame.getByLabel('Analysis title', { exact: true }).waitFor();
  await frame.locator('.visual-card svg').first().waitFor();
  assert.match(await frame.locator('.visual-card svg').first().textContent(), /60/);
  for (const title of ['First browser edit', 'Second browser edit']) {
    await frame.getByLabel('Analysis title', { exact: true }).fill(title);
    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/api/v1/analyses/working'));
    await frame.getByRole('button', { name: 'Save analysis', exact: true }).first().click(); assert.equal((await saved).status(), 200);
    await frame.getByText('Analysis saved to this hosted workspace.', { exact: true }).first().waitFor();
  }
  assert.equal(requests.filter(path => path === `/api/embed/sessions/${issued.sessionId}/redeem`).length, 1);
  assert.deepEqual(await page.evaluate(() => events), ['ready']);
  assert.equal(await frame.getByLabel('Analysis title', { exact: true }).inputValue(), 'Second browser edit');
  assert.equal(await frame.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.screenshot({ path: `${output}/author.png` }); checks.push('Real editor reopens a bound analysis, renders a visual, saves twice, keeps one redeemed session and no browser storage');
  await frame.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await frame.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link', { name: 'Data', exact: true }).click();
  await frame.getByRole('heading', { name: 'Data', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/data.png` });
  assert.equal(requests.filter(path => path === `/api/embed/sessions/${issued.sessionId}/redeem`).length, 1); checks.push('App navigation reaches Data without a new bootstrap');
  for (const path of ['/dashboards', `/dashboards/${published.body.DashboardId}`, '/data', '/analyses/author', '/data/preparation', '/ask-o']) {
    frame = await mount(path);
    if (path === '/analyses/author') await frame.getByLabel('Analysis title', { exact: true }).waitFor();
    else await frame.getByRole('heading', { name: path === '/dashboards' ? 'Dashboards' : path.startsWith('/dashboards/') ? 'Original'
      : path === '/data' ? 'Data' : path === '/data/preparation' ? 'Transformation pipeline' : 'Ask O', exact: true }).waitFor();
    const body = await frame.locator('body').innerText(); assert.ok(!body.includes('EMBED_SCOPE_DENIED'), body);
    await page.screenshot({ path: `${output}/${path.replaceAll('/', '-').slice(1)}.png` });
    checks.push(`Allowed landing ${path}`);
  }
  for (const authoring of ['hidden', 'disabled', 'visible']) {
    frame = await mount('/dashboards', { actions: { authoring }, menus: { account: 'hidden' } });
    await frame.getByText('Original', { exact: true }).waitFor();
    const rail = frame.getByRole('navigation', { name: 'Product' });
    const analyses = rail.getByRole('link', { name: 'Analyses' });
    assert.equal(await analyses.count(), authoring === 'hidden' ? 0 : 1);
    if (authoring !== 'hidden') assert.equal(await analyses.isEnabled(), authoring === 'visible');
    assert.equal(await frame.getByLabel('Account', { exact: true }).count(), 0);
    // Let the cross-origin compositor present the checked dashboard before capture.
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${output}/authoring-${authoring}.png`, animations: 'disabled' });
    checks.push(`Same tenant mounts ${authoring} authoring with no account menu`);
  }
  const tokens = { surface: '#fffaf1', text: '#302b25', accent: '#814527', chartPaletteSeed: '#ae633b', fontFamily: 'serif', radius: 10, density: 'compact' };
  await f.embedding.put(await f.context(), { ...f.config, appearance: { ...f.config.appearance, tokens } }, 1);
  backendAuthorization = await token();
  frame = await mount(`/dashboards/${published.body.DashboardId}`, { menus: { account: 'hidden' } });
  const kpi = frame.locator(`.visual-card svg text[fill="${tokens.chartPaletteSeed}"]`).filter({ hasText: '60' });
  await kpi.waitFor();
  const card = frame.locator('.visual-card').first();
  assert.deepEqual(await card.evaluate(el => {
    const css = getComputedStyle(el);
    return [css.backgroundColor, css.color, css.fontFamily, css.borderRadius];
  }), ['rgb(255, 250, 241)', 'rgb(48, 43, 37)', 'Georgia, serif', '10px']);
  assert.equal(await frame.locator('.product-header').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(129, 69, 39)');
  assert.equal(await frame.getByLabel('Account', { exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/design-tokens.png`, animations: 'disabled' });
  checks.push('Tenant tokens style the hosted shell, card and compiled KPI; account remains hidden');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/evidence.json`, JSON.stringify({ checks, externalRequests: 0, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, failed: 0, output }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
    await writeFile(`${output}/failure.txt`, (await Promise.all(page.frames().map(f => f.locator('body').innerText().catch(() => '')))).join('\n'));
  }
  console.error('Browser acceptance failed:', error.message, JSON.stringify({ checks, errors, lastPaths: requests.slice(-8) }));
  throw error;
} finally {
  await browser?.close();
  for (const cleanup of cleanups) await cleanup();
}
