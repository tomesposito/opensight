// Real browsers and real local servers. The bridge changes transport only.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'vite';
export { navigate } from '../app-navigation.mjs';
export { default as assert } from 'node:assert/strict';
export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const webRoot = resolve(repo, 'packages/web');
export const output = resolve(process.env.OPENSIGHT_PERSONA_OUTPUT ?? resolve(repo, '.opensight/persona-journeys'));
export const origin = 'https://opensight.test';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
export const button = (page, name) => page.getByRole('button', { name, exact: true });
export async function temporaryRoot() {
  process.env.TMPDIR ??= resolve(homedir(), 'workspace/.tmp');
  await mkdir(process.env.TMPDIR, { recursive: true });
  return mkdtemp(resolve(process.env.TMPDIR, 'persona-'));
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (server?.listening) await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
// node:http preserves the synthetic Host header required by the hosted boundary.
function forward(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end(body);
  });
}
async function viteServer() {
  const vite = await createServer({ root: webRoot, configFile: resolve(webRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, ws: { host: new URL(origin).hostname, protocol: 'wss', clientPort: 443 } }, logLevel: 'error' });
  await vite.listen(); return vite;
}
export async function startLocalStack(dataRoot) {
  const { createApiServer } = await import('../../../api/dist/index.js');
  const stack = { origin, dataRoot };
  stack.start = async () => {
    stack.api = await createApiServer({ dataRoot, localData: true, prepStorePath: resolve(dataRoot, 'prep.json'), localUploadPath: resolve(dataRoot, 'uploads.duckdb'), analyticsStorePath: resolve(dataRoot, 'analytics.sqlite') });
    stack.apiTransport = await listen(stack.api);
    stack.vite = await viteServer();
    stack.transport = `http://127.0.0.1:${stack.vite.httpServer.address().port}`;
  };
  stack.stop = async () => { await stack.vite?.close(); await close(stack.api); };
  await stack.start(); return stack;
}
export async function startHostedStack() {
  await temporaryRoot().then(p => rm(p, { recursive: true })); // Set SQLite's disk-backed TMPDIR before importing fixtures.
  const [{ Pool }, { PostgresMetadataDatabase }, { realEmbedFixture }, { serverEnvironment }, hosted] = await Promise.all([
    import('pg'), import('../../../api/dist/metadata-db.js'), import('../../../api/test/embed-real-fixture.mjs'),
    import('../../../api/test/embed-http-helpers.mjs'), import('../../../api/dist/hosted-server.js'),
  ]);
  const schema = `persona_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5433/opensight', options: `-c search_path=${schema}` });
  const db = new PostgresMetadataDatabase(pool), stack = { origin, pool, db, schema };
  stack.stop = async () => {
    await stack.vite?.close(); await close(stack.api);
    if (stack.api) await hosted.drainHostedServer(stack.api);
    await stack.fixture?.budgets.shutdown();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
  };
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    stack.fixture = await realEmbedFixture(db, 'postgres', origin, 'https://product.example');
    stack.mail = stack.fixture.mail;
    stack.api = await hosted.createHostedApiServer({ membershipDatabase: db, tenantDatabase: db, builtinAuth: stack.fixture.auth,
      security: { authenticate: stack.fixture.auth.authenticate }, env: serverEnvironment(stack.fixture), mailTransport: stack.mail });
    stack.apiTransport = await listen(stack.api);
    stack.vite = await viteServer(); stack.transport = `http://127.0.0.1:${stack.vite.httpServer.address().port}`;
    stack.tokens = { admin: (await stack.fixture.login()).token, reader: (await stack.fixture.reader.login()).token };
    stack.request = async (path, method = 'GET', body, authorization = `Bearer ${stack.tokens.admin}`) => {
      const response = await forward(stack.apiTransport + path, method, { host: new URL(origin).host,
        ...(!path.startsWith('/api/auth/') && authorization ? { authorization } : {}),
        'content-type': 'application/json', 'idempotency-key': randomUUID() }, body === undefined ? undefined : JSON.stringify(body));
      return { status: response.status, body: JSON.parse(response.body) };
    };
    return stack;
  } catch (error) { await stack.stop(); throw error; }
}
export async function startStaticSite({ embed = false } = {}) {
  const demo = resolve(webRoot, 'dist/opensight-demo.html'), preview = resolve(webRoot, 'dist/opensight-embed-preview.html');
  try { await access(embed ? preview : demo); } catch {
    if (embed) execFileSync(process.execPath, ['scripts/build-embed.mjs'], { cwd: webRoot, stdio: 'inherit' });
    else {
      execFileSync('npm', ['run', 'build:demo'], { cwd: webRoot, stdio: 'inherit' });
      execFileSync(process.execPath, [resolve(homedir(), 'workspace/goals/opensight/hidden_files/build-demo-shim.mjs')], { cwd: repo, stdio: 'inherit' });
    }
  }
  const types = { '.html': 'text/html', '.txt': 'text/plain', '.xml': 'application/xml', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
  const server = httpServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      const root = resolve(repo, 'site');
      let path = pathname === '/demo/' || pathname === '/demo' ? demo : pathname === '/embed/' ? preview : resolve(root, `.${pathname}`);
      if (path !== demo && path !== preview && path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); res.end(await readFile(path));
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); }
  });
  return { origin, transport: await listen(server), stop: () => close(server) };
}
export async function routeBridge(context, stack, journey) {
  context.on('page', page => page.on('pageerror', error => journey.pageerrors.push(error.message)));
  await context.routeWebSocket('**/*', socket => {
    // Vite HMR is not required for an acceptance run. Check its origin anyway.
    if (new URL(socket.url()).host !== new URL(stack.origin).host) journey.external.push(socket.url());
    // Leave an inert same-origin socket open: closing before Vite receives its
    // handshake can itself cause a pageerror in recent Vite clients.
  });
  await context.route(/^https?:/, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== stack.origin) { journey.external.push(url.href); await route.abort(); return; }
    try {
      const api = stack.apiTransport && url.pathname.startsWith('/api/');
      const headers = { ...req.headers() }; delete headers.host; delete headers['content-length'];
      if (api) headers.host = new URL(stack.origin).host;
      const response = await forward((api ? stack.apiTransport : stack.transport) + (api ? url.pathname.replace(/^\/api/, '') : url.pathname) + url.search,
        req.method(), headers, req.postDataBuffer() ?? undefined);
      const body = response.body, responseHeaders = response.headers;
      delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
      if (api) journey.requests.push({ path: url.pathname, method: req.method(), status: response.status,
        ...(url.pathname.endsWith('/query') ? { body: JSON.parse(body) } : {}) });
      await route.fulfill({ status: response.status, headers: responseHeaders, body });
    } catch (error) { journey.transportErrors.push(error.message); await route.abort(); }
  });
}
export async function launchBrowser(journey) {
  const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  journey.cleanup(() => browser.close());
  return { browser, async page(stack, token) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', serviceWorkers: 'block',
      ...(token ? { extraHTTPHeaders: { Authorization: `Bearer ${token}` } } : {}) });
    context.setDefaultTimeout(15000); await routeBridge(context, stack, journey);
    return context.newPage();
  } };
}
export async function capture(journey, page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
  const filename = `${journey.journey}-${name}.png`;
  await page.screenshot({ path: resolve(output, filename), fullPage: true, animations: 'disabled' });
  journey.screenshots.push(filename);
}
export async function writeResults(journey) {
  const { persona, steps, screenshots } = journey;
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${journey.journey}.json`), JSON.stringify({ journey: journey.journey, persona, steps, screenshots }, null, 2) + '\n');
}
export async function runJourney(name, persona, run) {
  await mkdir(output, { recursive: true });
  const cleanup = [], j = { journey: name, persona, steps: [], screenshots: [], pageerrors: [], external: [], transportErrors: [], requests: [],
    cleanup: fn => cleanup.push(fn),
    gap(name, expected, actual) { this.steps.push({ name, status: 'gap', detail: { expected, actual } }); console.log(`GAP ${name}: ${actual}`); },
    async step(name, page, fn) {
      try { const detail = await fn(); if (page) await capture(this, page, name); this.steps.push({ name, status: 'pass', detail: detail ?? 'Assertions passed.' }); console.log(`PASS ${name}`); }
      catch (error) { this.steps.push({ name, status: 'fail', detail: error.stack }); throw error; }
    },
  };
  try { await run(j); } catch (error) {
    if (!j.steps.some(s => s.status === 'fail')) j.steps.push({ name: 'setup-or-journey', status: 'fail', detail: error.stack });
    console.error(error);
  } finally {
    for (const fn of cleanup.reverse()) { try { await fn(); } catch (error) { j.steps.push({ name: 'cleanup', status: 'fail', detail: error.stack }); } }
    await j.step('browser-health', null, () => {
      assert.deepEqual(j.pageerrors, [], 'pageerrors'); assert.deepEqual(j.external, [], 'external requests'); assert.deepEqual(j.transportErrors, [], 'transport errors');
      return 'No pageerrors, external requests, or transport errors in any browser context.';
    }).catch(error => console.error(error.message));
    await writeResults(j);
  }
  if (j.steps.some(s => s.status === 'fail')) process.exitCode = 1;
}
// Enrollment fallback for the shipped API-only enrollment flow. Journeys must
// record the missing UI as a gap before using this helper; this is not UI coverage.
export async function enrollViaApi(stack, invitation, email) {
  const { decode32 } = await import('../../../api/test/hosted-helpers.mjs');
  const { totp } = await import('../../../api/dist/auth-crypto.js');
  const password = randomBytes(24).toString('base64');
  const enrollment = await stack.request('/api/auth/enroll', 'POST', { invitationToken: invitation, password });
  assert.equal(enrollment.status, 200);
  const secret = decode32(enrollment.body.secret), step = Math.floor(Date.now() / 30000);
  const accepted = await stack.request('/api/auth/accept', 'POST', { invitationToken: invitation, password, code: totp(secret, step) });
  assert.equal(accepted.status, 200);
  let lastStep = step;
  return { email, password, async code() {
    // TOTP replay protection accepts only one code per time step. Wait for a
    // fresh window when needed instead of changing the server clock/database.
    while (lastStep + 1 > Math.floor(Date.now() / 30000) + 1) await new Promise(r => setTimeout(r, 500));
    lastStep = Math.max(lastStep + 1, Math.floor(Date.now() / 30000)); return totp(secret, lastStep);
  } };
}
export const invitationFrom = stack => { const token = stack.mail.messages.at(-1)?.html.match(/<code>([^<]+)<\/code>/)?.[1]; assert.ok(token, 'Mail stub must contain invitation'); return token; };
export async function signIn(page, stack, account) {
  await page.goto(stack.origin);
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await button(page, 'Continue').click();
  await page.getByLabel('Authenticator code', { exact: true }).fill(await account.code());
  await button(page, 'Sign in').click();
}
