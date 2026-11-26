// Local D-99 acceptance: real auth/SQLite and browser cookie handling, stubbed wake.
// Run after API build. No AWS or external network; screenshots use synthetic users.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { authFixture } from '../../api/test/hosted-helpers.mjs';
import { createHostedApiServer } from '../../api/dist/hosted-server.js';
import { dispatchRuntimeRequest } from '../../api/dist/runtime-http-bridge.js';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-282/hosted');
await mkdir(output, { recursive: true });
const cleanup = [], f = await authFixture({ after: cb => cleanup.push(cb) }), c = f.config;
const env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
  OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
  OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds) };
let api, vite, browser, sleeping = false, wakePending;
const requests = [], errors = [], external = [];
try {
  api = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, builtinAuth: f.auth, env, clock: f.clock, mailTransport: f.mail });
  vite = await createServer({ root: resolve('packages/web'), configFile: false,
    define: { 'import.meta.env.VITE_OPENSIGHT_SERVERLESS': '"true"' },
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false } });
  await vite.listen();
  const transport = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== c.origin) { external.push(url.href); return route.abort(); }
    if (url.pathname.startsWith('/api/api/')) {
      const headers = await req.allHeaders();
      requests.push(url.pathname);
      if (url.pathname === '/api/api/startup') {
        assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined);
        if (sleeping) await new Promise(resolve => { wakePending = resolve; });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"state":"ready"}' });
      }
      const raw = await dispatchRuntimeRequest(api, { path: url.pathname.slice(4), method: req.method(), headers: { ...headers, host: new URL(c.origin).host },
        body: req.postDataBuffer() ?? Buffer.alloc(0), peer: '127.0.0.1', requestTime: f.clock() }, new AbortController().signal);
      return route.fulfill({ status: raw.statusCode, headers: { ...raw.headers, ...(raw.cookies ? { 'set-cookie': raw.cookies.join('\n') } : {}) },
        body: Buffer.from(raw.body, raw.isBase64Encoded ? 'base64' : 'utf8') });
    }
    const response = await fetch(transport + url.pathname + url.search);
    const headers = Object.fromEntries(response.headers); delete headers['content-length']; delete headers['content-encoding'];
    return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__gatesSeen = [];
    const watch = () => {
      for (const selector of ['#connect-title', '#sign-in-title']) {
        const title = document.querySelector(selector)?.textContent;
        if (title && !window.__gatesSeen.includes(title)) window.__gatesSeen.push(title);
      }
    };
    new MutationObserver(watch).observe(document, { subtree: true, childList: true });
  });
  const capture = async name => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); };
  await page.goto(c.origin);
  await page.getByRole('heading', { name: 'Connect to OpenSight', exact: true }).waitFor();
  assert.deepEqual(requests.slice(0, 2), ['/api/api/startup', '/api/api/auth/restore']);
  await capture('workspace-connect');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.locator('#signin-email').fill(f.email); await page.locator('#signin-password').fill(f.password);
  await capture('sign-in');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('#signin-code').fill(f.code()); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.hosted-account').waitFor();
  const original = (await context.cookies()).find(c => c.name === 'opensight_refresh');
  assert.ok(original.httpOnly && original.secure && original.sameSite === 'Lax'); assert.equal(original.path, '/api');
  assert.ok(!(await page.evaluate(() => document.cookie)).includes(original.value));
  requests.length = 0;
  await page.reload(); await page.locator('.hosted-account').waitFor();
  assert.deepEqual(requests.slice(0, 3), ['/api/api/startup', '/api/api/auth/restore', '/api/api/session']);
  assert.deepEqual(await page.evaluate(() => window.__gatesSeen), []);
  const rotated = (await context.cookies()).find(c => c.name === 'opensight_refresh'); assert.notEqual(rotated.value, original.value);
  assert.ok(!(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, document.cookie]))).includes(rotated.value));
  await capture('restored-workspace');
  sleeping = true; requests.length = 0;
  await page.reload(); await page.getByText('Connecting to your workspace…', { exact: true }).waitFor();
  await capture('workspace-waking');
  assert.deepEqual(requests, ['/api/api/startup']); assert.deepEqual(await page.evaluate(() => window.__gatesSeen), []);
  sleeping = false; wakePending();
  await page.locator('.hosted-account').waitFor(); assert.deepEqual(await page.evaluate(() => window.__gatesSeen), []);
  await page.getByLabel('Account', { exact: true }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.locator('#signin-email').waitFor();
  assert.equal((await context.cookies()).some(c => c.name === 'opensight_refresh'), false);
  await page.reload(); await page.getByRole('heading', { name: 'Connect to OpenSight', exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ checks: ['wake-before-restore', 'HttpOnly/Secure/SameSite cookie', 'awake-reload', 'rotation', 'sleeping-reload', 'no-access-gate-flash', 'logout-and-reload'], pageErrors: errors, externalRequests: external }, null, 2));
  console.log('Hosted browser restore passed: awake/sleeping reload, cookie rotation, logout; 0 page errors / 0 external requests.');
} finally {
  wakePending?.(); await browser?.close(); await vite?.close(); api?.close();
  for (const cb of cleanup.reverse()) await cb();
}
