// Issue #137: actual built UI + local API/settings store, synthetic administrator.
// No external requests or vendor calls. This is a local capture, not a deployment.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApiServer, emptySecurityState } from '../../api/dist/index.js';
import { Analytics } from '../../api/dist/analytics.js';
import { AnalyticsStore, initializeAnalytics } from '../../api/dist/analytics-store.js';
import { SqliteMetadataDatabase } from '../../api/dist/metadata-db.js';
import { initializeMetadata } from '../../api/dist/metadata-schema.js';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-137/browser'); await mkdir(out, { recursive: true });
const db = new SqliteMetadataDatabase(':memory:'); await initializeMetadata(db); await initializeAnalytics(db);
const scope = { tenantId: randomUUID(), namespaceId: 'default' };
await db.transaction(async c => {
  await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES (?,'active',1)", [scope.tenantId]);
  await c.query("INSERT INTO h1_namespaces VALUES ('default',?,'Synthetic workspace')", [scope.tenantId]);
});
const analytics = new Analytics(new AnalyticsStore(db), { enabled: true, vendorKey: 'synthetic-capture-only', localScopes: new Map([['default', scope]]), transport: async () => ({ ok: true }) });
const state = emptySecurityState(); state.users = [{ id: 'admin', namespaceId: 'default', name: 'Synthetic administrator', role: 'administrator' }];
const server = await createApiServer({ dataRoot: new URL('../../../fixtures/', import.meta.url).pathname, analytics,
  security: { initialState: state, authenticate: async () => ({ namespaceId: 'default', userId: 'admin' }) } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], unexpected = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'https://opensight.test') { unexpected.push(url.href); return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const headers = { ...request.headers() }; delete headers.host; delete headers['content-length'];
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url.pathname.replace(/^\/api/, '')}`, { method: request.method(), headers, ...(request.postData() ? { body: request.postData() } : {}) });
      const body = await response.text();
      return route.fulfill({ status: response.status, contentType: 'application/json', body });
    }
    const file = url.pathname.startsWith('/assets/') ? new URL(`../dist${url.pathname}`, import.meta.url) : new URL('../dist/index.html', import.meta.url);
    return route.fulfill({ contentType: extname(file.pathname) === '.js' ? 'text/javascript' : extname(file.pathname) === '.css' ? 'text/css' : 'text/html', body: await readFile(file) });
  });
  await page.goto('https://opensight.test/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'More', exact: true }).waitFor();
  await navigate(page, 'ai-settings');
  const toggle = page.getByRole('checkbox', { name: 'Enable usage tracking for this tenant' });
  await toggle.waitFor(); await page.getByText('Usage tracking is on.', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'analytics-on.png'), fullPage: true });
  await toggle.click(); await page.getByText('Usage tracking is off.', { exact: true }).waitFor();
  assert.equal((await analytics.settings(scope)).override, false);
  await page.screenshot({ path: resolve(out, 'analytics-settings.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'analytics-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ errors, unexpected, overflow, offSwitchSaved: true, output: out }));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); console.log({ errors, unexpected }); throw error; } finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); await analytics.close(); await db.close();
}
