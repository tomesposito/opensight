// Issue #178: synthetic local hosted API + offline demo. No external requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { h8Fixture, serveH8 } from '../../api/test/h8-helpers.mjs';
import { submitIdea, transitionIdea } from '../../api/dist/ideas.js';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue-178-screenshots');
await mkdir(output, { recursive: true });
const cleanup = [], t = { after: action => cleanup.push(action) }, errors = [], external = [];
let browser, vite;
try {
  const f = await h8Fixture(t), serving = await serveH8(t, f, { security: { authenticate: async () => ({ namespaceId: 'one', userId: 'admin' }) } });
  const scope = { tenantId: 'tenant-one', namespaceId: 'one', userId: 'admin', authorizationRevision: 1 };
  for (const [title, status, detail] of [
    ['Show more context when a dataset is empty', 'received', {}],
    ['Add a public voting board', 'declined', { declineCategory: 'not-aligned', declineNote: 'Private suggestions keep the review focused on the product vision.' }],
    ['Keep the workspace name visible', 'shipped', { shippedReference: 'https://example.test/releases/workspace-names' }],
  ]) {
    const idea = await submitIdea(f.db, scope, { title, description: 'A synthetic suggestion used only for this local documentation capture.', surface: 'ideas' });
    if (status !== 'received') { await transitionIdea(f.db, idea.id, { status: 'under_review' }); await transitionIdea(f.db, idea.id, { status, ...detail }); }
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`, origin = 'https://opensight.example';
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const headers = { ...req.headers() }; delete headers['content-length']; delete headers.host;
      const result = await serving.request(url.pathname.replace(/^\/api/, ''), { method: req.method(), headers, ...(req.postData() ? { body: req.postDataJSON() } : {}) });
      return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
    }
    const response = await fetch(transport + url.pathname + url.search);
    const headers = Object.fromEntries(response.headers); delete headers['content-length']; delete headers['content-encoding'];
    await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const capture = async name => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`); await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); };
  await page.goto(`${origin}/#/data`); await page.getByRole('heading', { name: 'No datasets yet' }).waitFor();
  await capture('hosted-data-empty');
  await page.getByRole('button', { name: 'Suggest an idea', exact: true }).click();
  await page.getByRole('heading', { name: 'My ideas', exact: true }).waitFor();
  await page.getByLabel('Title', { exact: true }).fill('Explain an empty dataset in context');
  await page.getByLabel('Description', { exact: true }).fill('Help me understand which data source to connect when I start a new workspace.');
  await capture('ideas');
  await page.getByRole('button', { name: 'Submit idea', exact: true }).click();
  await page.getByText('Idea received. You can follow its status below.').waitFor();
  assert.equal((await serving.request('/api/ideas')).body.ideas[0].surface, 'data-empty');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('ideas-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/#operator-ideas`);
  await page.getByLabel('Operator credential').fill(serving.operator.authorization.slice(9));
  await page.getByRole('button', { name: 'Load ideas', exact: true }).click();
  await page.getByRole('heading', { name: 'Explain an empty dataset in context', exact: true }).waitFor();
  await capture('operator-ideas');
  const review = page.getByRole('form', { name: 'Review Explain an empty dataset in context', exact: true });
  await review.getByRole('button', { name: 'Update status' }).click();
  await page.getByText('Idea status updated.').waitFor();
  await review.getByLabel('Next status').selectOption('declined');
  await review.getByLabel('Decline category').selectOption('later');
  await review.getByLabel('Decline note').fill('Review again after the data onboarding work.');
  await capture('operator-decline');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('operator-mobile');
  await context.close();

  const offline = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await offline.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  const demo = await offline.newPage(); demo.on('pageerror', e => errors.push(e.message));
  await demo.goto(new URL('../dist/opensight-demo.html', import.meta.url).href);
  await demo.locator('.dashboard-grid').first().waitFor();
  await demo.screenshot({ path: resolve(output, 'sample-dashboard.png'), fullPage: true });
  await demo.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link', { name: 'Ideas', exact: true }).click();
  await demo.getByRole('heading', { name: 'Ideas need a hosted workspace' }).waitFor();
  assert.equal(await demo.getByRole('button', { name: 'Submit idea' }).count(), 0);
  await demo.screenshot({ path: resolve(output, 'ideas-demo.png'), fullPage: true });
  await demo.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link', { name: 'Data', exact: true }).click();
  await demo.getByRole('heading', { name: 'No datasets yet' }).waitFor();
  assert.equal(await demo.getByRole('button', { name: 'Suggest an idea' }).count(), 0);
  await demo.screenshot({ path: resolve(output, 'data-landing.png'), fullPage: true });
  await demo.getByRole('button', { name: 'Create dataset', exact: true }).first().click();
  await demo.getByRole('dialog').waitFor();
  await demo.getByRole('dialog').getByRole('button', { name: 'Create data source', exact: true }).click();
  await demo.getByRole('radio', { name: 'MySQL', exact: true }).waitFor();
  await demo.screenshot({ path: resolve(output, 'data-sources.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Ideas browser checks passed: hosted submit/review, desktop/mobile, offline notice; zero external requests or page errors.');
} finally {
  await browser?.close(); await vite?.close();
  for (const close of cleanup.reverse()) await close();
}
