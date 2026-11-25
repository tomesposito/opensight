// Local-only browser acceptance: real hosted auth/OAuth with synthetic members.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { mcpFixture, allScopes } from '../../api/test/mcp-helpers.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const root = resolve(import.meta.dirname, '..'), output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/issue-332-browser');
await mkdir(output, { recursive: true });
const cleanup = [], f = await mcpFixture({ after: fn => cleanup.push(fn) });
const vite = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' }); await vite.listen();
const local = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
let browserToken;
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== f.config.origin) { external.push(url.origin); await route.abort(); return; }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) {
    const path = url.pathname.startsWith('/api/api/') ? url.pathname.slice(4) : url.pathname;
    const headers = { ...request.headers(), host: new URL(f.config.origin).host }; delete headers['content-length'];
    const response = await f.http(path, { method: request.method(), headers, rawBody: request.postData() ?? undefined });
    if (path === '/api/auth/login' && response.body.token) browserToken = response.body.token;
    const responseHeaders = { ...response.headers }; delete responseHeaders['content-length']; delete responseHeaders['transfer-encoding'];
    await route.fulfill({ status: response.status, headers: responseHeaders, body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body) });
  } else {
    const response = await route.fetch({ url: `${local}${url.pathname}${url.search}` }); await route.fulfill({ response });
  }
});
async function signIn() {
  await page.getByLabel('Email address', { exact: true }).fill(f.email);
  await page.getByLabel('Password', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Authenticator code', { exact: true }).fill(f.code());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
try {
  const client = await f.register(), verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ mcp_oauth: '1', client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', state: 'synthetic-state', scope: allScopes,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${f.config.origin}/api/mcp` });
  await page.goto(`${f.config.origin}/?${params}`); await signIn();
  await page.getByRole('button', { name: 'Approve connection', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.location.search), '');
  await page.screenshot({ path: `${output}/mcp-consent.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${output}/mcp-consent-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('checkbox', { name: /Create and change/ }).uncheck();
  // Capture the redirect without contacting the outside connector.
  let callback;
  await page.route('https://connector.example/**', async route => { callback = new URL(route.request().url()); await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Local connector callback received.</p>' }); });
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
  await page.waitForURL('https://connector.example/**'); assert.equal(callback.searchParams.get('state'), 'synthetic-state');
  const tokens = await f.form('/api/mcp/oauth/token', { grant_type: 'authorization_code', client_id: client.client_id, code: callback.searchParams.get('code'), redirect_uri: client.redirect_uris[0], code_verifier: verifier });
  assert.equal(tokens.status, 200); assert.equal(tokens.body.scope, 'opensight/mcp.read');
  assert.equal((await f.call(tokens.body.access_token, 'list_datasets')).isError, undefined);
  f.advance();
  await page.goto(`${f.config.origin}/#/account/connections`); await signIn();
  await page.getByRole('button', { name: 'Revoke access for Synthetic connector', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/mcp-connections.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${output}/mcp-connections-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Revoke access for Synthetic connector', exact: true }).click();
  await page.getByText('Access revoked for Synthetic connector.', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/mcp-revoked.png` });
  assert.equal((await f.rpc(tokens.body.access_token, 'tools/list')).status, 401);
  assert.equal((await f.form('/api/mcp/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.body.refresh_token })).body.error, 'invalid_grant');
  assert.ok(browserToken); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Browser acceptance passed: sign-in, narrowed consent, PKCE, read, account revoke, failed access/refresh; zero external requests.');
} finally { await browser.close(); await vite.close(); for (const close of cleanup.reverse()) await close(); }
