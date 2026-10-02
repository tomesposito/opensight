// Issue #36 browser acceptance: real PostgreSQL, built-in auth, hosted API,
// query workers and Vite. Mail is the explicit stub; API responses are real.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer as socketServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createServer } from 'vite';
import { PostgresMetadataDatabase } from '../../api/dist/metadata-db.js';
import { createHostedApiServer, drainHostedServer } from '../../api/dist/hosted-server.js';
import { realEmbedFixture } from '../../api/test/embed-real-fixture.mjs';
import { serverEnvironment } from '../../api/test/embed-http-helpers.mjs';
import { decode32 } from '../../api/test/hosted-helpers.mjs';
import { totp } from '../../api/dist/auth-crypto.js';
import { navigate } from './app-navigation.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-36/browser'); await mkdir(output, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), 'opensight-job-browser-'));
const schema = `h7_browser_${randomUUID().replaceAll('-', '')}`, pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const db = new PostgresMetadataDatabase(pool), root = fileURLToPath(new URL('../', import.meta.url));
let vite, api, browser, f;
const errors = [], external = [], checked = [];
const schedule = { kind: 'interval', minutes: 525600, timeZone: 'UTC' };
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  const reserve = socketServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); const apiPort = reserve.address().port; await new Promise(r => reserve.close(r));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', resolve(temporary, 'key.pem'), '-out', resolve(temporary, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const tls = { key: await readFile(resolve(temporary, 'key.pem')), cert: await readFile(resolve(temporary, 'cert.pem')) };
  vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, https: tls, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } } });
  await vite.listen(); const origin = `https://localhost:${vite.httpServer.address().port}`;
  const forward = (url, method, headers, body) => new Promise((resolve, reject) => {
    const parsed = new URL(url); assert.equal(parsed.origin, origin);
    const request = httpsRequest({ hostname: '127.0.0.1', port: parsed.port, path: parsed.pathname + parsed.search, method, headers: { ...headers, host: parsed.host, ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }) }, rejectUnauthorized: false }, response => {
      const chunks = []; response.on('data', b => chunks.push(b)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }); request.on('error', error => reject(new Error(`Local HTTPS forwarding failed: ${method} ${parsed.pathname}: ${error.code}`))); request.end(body);
  });
  console.log('Ready: local HTTPS Vite');
  f = await realEmbedFixture(db, 'postgres', origin, 'https://product.example');
  await f.metadata.put(await f.context(), { kind: 'user', id: f.reader.identity.userId }, { name: 'Schedule author', role: 'author' }, 1);
  const otherTenant = await f.provisioning.provision('jobs-other-tenant', { name: 'Other tenant', administrator: { email: 'other-tenant@example.test', name: 'Other tenant admin' } });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
  const enrollment = await f.auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret), step = Math.floor(Date.now() / 30000);
  await f.auth.accept(invitation, password, totp(secret, step), 'local');
  const otherToken = (await f.auth.login('other-tenant@example.test', password, totp(secret, step + 1), otherTenant.tenantId, 'local')).token;
  console.log('Ready: synthetic tenants and memberships');
  const ownerToken = (await f.login()).token, authorToken = (await f.reader.login()).token;
  api = await createHostedApiServer({ membershipDatabase: db, tenantDatabase: db, builtinAuth: f.auth, security: { authenticate: f.auth.authenticate }, env: serverEnvironment(f), mailTransport: f.mail });
  api.listen(apiPort, '127.0.0.1'); await once(api, 'listening');
  console.log('Ready: hosted API and built-in sessions');
  const request = async (path, method = 'GET', body, token = ownerToken) => {
    const response = await forward(`${origin}/api${path}`, method, { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body ? JSON.stringify(body) : undefined);
    return { status: response.status, body: JSON.parse(response.body.toString()) };
  };
  const report = { kind: 'report', dashboardId: 'dashboard', enabled: true, schedule, recipients: [f.reader.identity.userId] };
  assert.equal((await request('/api/jobs/weekly-report', 'PUT', { expectedVersion: 0, spec: report })).status, 200);
  assert.equal((await request('/api/jobs/transfer-report', 'PUT', { expectedVersion: 0, spec: { ...report, recipients: [f.identity.userId] } }, authorToken)).status, 200);
  f.mail.messages.length = 0;
  browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pageFor = async token => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce', ...(token ? { extraHTTPHeaders: { Authorization: `Bearer ${token}` } } : {}) });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route(/^https?:/, async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      // Chromium's loopback restriction is handled by forwarding unchanged
      // requests through Node. This is transport, not an API or data mock.
      const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
      const response = await forward(req.url(), req.method(), headers, req.postDataBuffer() ?? undefined);
      const bytes = response.body, responseHeaders = response.headers;
      delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
      if (url.pathname.includes('/jobs') || url.pathname.includes('/job-recipients') || url.pathname.includes('/host/')) checked.push({ path: url.pathname, method: req.method(), status: response.status });
      await route.fulfill({ status: response.status, headers: responseHeaders, body: bytes });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); return page;
  };
  const capture = async (page, name) => {
    await page.getByRole('status').filter({ hasText: 'Loading…' }).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: overflow`);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  };
  const tenantPage = await pageFor(ownerToken); await tenantPage.goto(origin); await navigate(tenantPage, 'automation');
  await tenantPage.getByRole('heading', { name: 'Tenant recipients' }).waitFor();
  await tenantPage.getByText(/embed-reader@example.test/).waitFor();
  assert.match(await tenantPage.locator('main').innerText(), /embed-reader@example.test/); assert.doesNotMatch(await tenantPage.locator('main').innerText(), /other-tenant@example.test/);
  await tenantPage.getByRole('button', { name: 'Run weekly-report', exact: true }).click();
  for (let n = 0; n < 40; n++) {
    await tenantPage.getByRole('button', { name: 'Refresh jobs and history' }).click();
    await tenantPage.getByRole('button', { name: 'Refresh jobs and history' }).waitFor({ state: 'visible' });
    if ((await tenantPage.locator('main').innerText()).includes('succeeded')) break;
    await tenantPage.waitForTimeout(1000);
  }
  await tenantPage.getByRole('cell', { name: 'succeeded', exact: true }).waitFor(); await tenantPage.getByRole('cell', { name: 'sent', exact: true }).waitFor();
  assert.equal(f.mail.messages.length, 1); assert.match(f.mail.messages[0].html, />40</); assert.doesNotMatch(f.mail.messages[0].html, />60</);
  await capture(tenantPage, 'tenant-job-history'); console.log('PASS: real report, recipient RLS total 40, durable sent history');
  const foreignPage = await pageFor(otherToken); await foreignPage.goto(origin); await navigate(foreignPage, 'automation');
  await foreignPage.getByRole('heading', { name: 'Tenant recipients' }).waitFor();
  await foreignPage.getByText(/other-tenant@example.test/).waitFor();
  assert.match(await foreignPage.locator('main').innerText(), /other-tenant@example.test/); assert.doesNotMatch(await foreignPage.locator('main').innerText(), /embed-reader@example.test|weekly-report/);
  const denied = await foreignPage.evaluate(async () => { const r = await fetch('/api/api/jobs/weekly-report/runs'); return { status: r.status, body: await r.json() }; });
  assert.equal(denied.status, 404); assert.equal(denied.body.errorCode, 'RESOURCE_NOT_FOUND');
  await capture(foreignPage, 'other-tenant'); console.log('PASS: browser tenant recipients and histories stay isolated');
  const operatorPage = await pageFor(); await operatorPage.goto(`${origin}/#operator-users`);
  await operatorPage.getByLabel('Tenant ID', { exact: true }).fill(f.tenant.tenantId);
  await operatorPage.getByLabel('Operator credential', { exact: true }).fill(f.hostedConfig.operatorKey.toString('base64url'));
  await operatorPage.getByRole('button', { name: 'Load tenant users' }).click();
  await operatorPage.getByRole('button', { name: 'Remove Schedule author', exact: true }).click();
  const prompt = operatorPage.getByRole('dialog'); await prompt.waitFor();
  assert.equal(await prompt.getByRole('button', { name: 'Remove user and stop schedules', exact: true }).isDisabled(), true);
  await capture(operatorPage, 'user-removal-choice');
  await prompt.getByLabel('Transfer schedules to another user', { exact: true }).check();
  await prompt.getByLabel('New schedule owner', { exact: true }).selectOption(f.identity.userId);
  await capture(operatorPage, 'user-removal-transfer');
  await prompt.getByRole('button', { name: 'Remove user and transfer schedules', exact: true }).click();
  await operatorPage.waitForFunction(() => document.querySelector('[role="alert"]') || document.body.innerText.includes('Schedules transferred'));
  assert.equal(await operatorPage.getByRole('alert').count(), 0, await operatorPage.locator('main').innerText());
  await operatorPage.getByRole('status').filter({ hasText: 'Schedules transferred' }).waitFor();
  const transferred = await db.transaction(c => c.query("SELECT owner_id, stopped FROM h7_jobs WHERE tenant_id = ? AND job_id = 'transfer-report'", [f.tenant.tenantId]));
  assert.equal(transferred[0].owner_id, f.identity.userId); assert.equal(transferred[0].stopped, 0);
  await operatorPage.getByRole('button', { name: 'Remove Embed administrator', exact: true }).click();
  await operatorPage.getByRole('dialog').getByLabel('Stop schedules', { exact: true }).check();
  await capture(operatorPage, 'user-removal-stop');
  await operatorPage.getByRole('button', { name: 'Remove user and stop schedules', exact: true }).click();
  await operatorPage.getByRole('status').filter({ hasText: 'Schedules stopped' }).waitFor();
  const stopped = await db.transaction(c => c.query('SELECT stopped FROM h7_jobs WHERE tenant_id = ?', [f.tenant.tenantId])); assert.equal(stopped.length, 2); assert.ok(stopped.every(j => j.stopped === 1));
  console.log('PASS: explicit transfer and stop prompts persist ownership/removal in PostgreSQL');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ browserRequests: checked.length, pageErrors: errors.length, externalRequests: external.length, mail: f.mail.messages.length, database: 'PostgreSQL', result: 'passed' }));
} finally {
  await browser?.close();
  if (api) { await new Promise(r => { api.close(r); api.closeAllConnections(); }); await drainHostedServer(api); }
  await vite?.close(); await f?.budgets.shutdown();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
  await rm(temporary, { recursive: true, force: true });
}
