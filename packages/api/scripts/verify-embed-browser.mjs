// Real-stack H6 acceptance. Local HTTPS parent + iframe, live Postgres metadata,
// production hosted HTTP/auth/data code, Chromium, synthetic data only.
// Requires DATABASE_URL, OPENSIGHT_SCREENSHOT_TOOLS; no downloads or remote calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer as httpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { realEmbedFixture } from '../test/embed-real-fixture.mjs';
import { httpStack } from '../test/embed-http-helpers.mjs';
import { organizationApi } from '../test/organization-helpers.mjs';
import { activateEmbedKey } from '../dist/embed-sessions.js';
const require = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS, 'package.json'));
const { chromium } = require('playwright-core');
assert.ok(process.env.DATABASE_URL, 'Use the local live Postgres DATABASE_URL');
const output = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/h6-embed-browser'); await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'h6-browser-')), cleanup = [], t = { after: fn => cleanup.push(fn) };
const schema = `h6_browser_${randomUUID().replaceAll('-', '')}`;
let browser, page, apiServer, legacy, api, apiToken, scenario = 'registered', f;
const issued = [], credentials = [], messages = [], consoleOutput = [], errors = [];
const evidence = { stack: 'Chromium + HTTPS cross-site parent/iframe + hosted API + live PostgreSQL + contained query workers', checks: [] };
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=embed.opensight.test'], { stdio: 'ignore' });
  const tls = { key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) };
  const proxy = httpsServer(tls, (req, res) => {
    if (req.url === '/cookie-probe') { res.writeHead(200, { 'Set-Cookie': 'h6_probe=synthetic; SameSite=None; Secure; Path=/', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }); res.end(JSON.stringify({ cookie: req.headers.cookie ?? '' })); return; }
    if (req.url === '/sibling') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Sibling frame</title>'); return; }
    const isLegacy = /^\/(?:api\/)?dashboards\//.test(req.url) || req.url.startsWith('/embed/dashboards/');
    const port = isLegacy ? new URL(legacy.origin).port : apiServer.address().port;
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, result => { res.writeHead(result.statusCode, result.headers); result.pipe(res); });
    upstream.on('error', () => { res.writeHead(503); res.end(); }); req.pipe(upstream);
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => { proxy.close(r); proxy.closeAllConnections(); }));
  const embedOrigin = `https://localhost:${proxy.address().port}`;
  const parentServer = httpsServer(tls, (req, res) => { void (async () => {
    if (req.url === '/sdk/index.js' || req.url === '/sdk/session.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(new URL(`../../embedding-sdk/dist/${req.url.split('/').at(-1)}`, import.meta.url))); return; }
    if (req.url === '/embed-url' && req.method === 'POST') {
      let ExperienceConfiguration = { Dashboard: { InitialDashboardId: scenario === 'empty' ? 'empty' : 'dashboard' } };
      if (scenario === 'visual') ExperienceConfiguration = { DashboardVisual: { InitialDashboardVisualId: { DashboardId: 'dashboard', SheetId: 'sheet', VisualId: 'total' } } };
      if (scenario === 'q') ExperienceConfiguration = { QSearchBar: { InitialTopicId: 'dataset' } };
      if (scenario === 'author') ExperienceConfiguration = { QuickSightConsole: { InitialPath: '/start/analyses/analysis' } };
      const anonymous = scenario === 'anonymous';
      const body = anonymous ? { ExperienceConfiguration, Namespace: 'virtual-readers', AuthorizedResourceArns: [f.arn('dashboard', 'dashboard')], SessionTags: [{ Key: 'region', Value: 'west' }] }
        : { ExperienceConfiguration, UserArn: f.arn('user', scenario === 'author' ? f.identity.userId : f.reader.identity.userId) };
      const result = await api(`/api/embedding/GenerateEmbedUrlFor${anonymous ? 'Anonymous' : 'Registered'}User`, 'POST', body, `Bearer ${apiToken}`);
      assert.equal(result.status, 200, `Issuance failed: ${result.body.errorCode}`); issued.push(result.body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result.body)); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html><head><title>Embed browser acceptance</title><style>body{margin:0;font:14px system-ui;background:#edf2f7}header{padding:14px 22px;background:#122840;color:white}#content{height:900px;padding:16px}iframe{background:white}</style></head><body><header>Synthetic host application · hosted embed verification</header><div id="content"></div><script type="module">
      import { createSessionEmbeddingClient, createEmbeddingClient } from '/sdk/index.js';
      window.events=[];window.readyCount=0;window.expiredCount=0;window.revokedCount=0;window.savedCount=0;window.errorCount=0;
      addEventListener('message',e=>{if(e.data?.type==='opensight:session')window.events.push(e.data)});
      const callbacks={onReady:()=>window.readyCount++,onSessionExpired:()=>window.expiredCount++,onAuthorizationRevoked:()=>window.revokedCount++,onSaved:()=>window.savedCount++,onError:()=>window.errorCount++};
      window.start=async()=>{window.handle?.destroy();window.handle=await createSessionEmbeddingClient({allowedEmbedOrigins:[${JSON.stringify(embedOrigin)}],getEmbedUrl:async signal=>{const r=await fetch('/embed-url',{method:'POST',signal});if(!r.ok)throw Error('issuance');return r.json()}}).mount(document.querySelector('#content'),callbacks)};
      window.shared=async()=>{window.handle?.destroy();const signed=await(await fetch('/embed-url',{method:'POST'})).json();window.sharedUrl=signed.EmbedUrl;window.handles=await Promise.all([1,2].map(()=>createSessionEmbeddingClient({allowedEmbedOrigins:[${JSON.stringify(embedOrigin)}],getEmbedUrl:async()=>signed}).mount(document.querySelector('#content'),callbacks)))};
      window.v1=async()=>{window.handle?.destroy();window.handle=await createEmbeddingClient({apiOrigin:${JSON.stringify(embedOrigin)},getAuthorization:()=> 'Bearer test-default-alice'}).embedVisual(document.querySelector('#content'),{dashboardId:'sales-dashboard',visualId:'total-revenue',parentOrigin:location.origin}, {onReady:()=>window.readyCount++})};
      window.start();
    </script></body></html>`);
  })().catch(error => { errors.push(error.message); res.writeHead(500); res.end('Synthetic host failed'); }); });
  await new Promise(r => parentServer.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => { parentServer.close(r); parentServer.closeAllConnections(); }));
  const parentOrigin = `https://127.0.0.1:${parentServer.address().port}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, options: `-c search_path=${schema}` });
  await pool.query(`CREATE SCHEMA ${schema}`); t.after(async () => { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });
  f = await realEmbedFixture(new PostgresMetadataDatabase(pool), 'postgres', embedOrigin, parentOrigin); t.after(() => f.budgets.close());
  await f.metadata.put(await f.context(), { kind: 'dashboard', id: 'empty' }, { definition: { DashboardId: 'empty', Name: 'Empty dashboard', Definition: { DataSetIdentifierDeclarations: [], Sheets: [] } }, datasets: [], folderId: null });
  const stack = await httpStack(t, f); apiServer = stack.server; api = stack.call;
  apiToken = (await f.login()).token;
  process.env.OPENSIGHT_EMBED_SECRET = randomBytes(48).toString('base64'); t.after(() => { delete process.env.OPENSIGHT_EMBED_SECRET; });
  legacy = await organizationApi(t, { embedding: { origin: embedOrigin, allowedParentOrigins: [parentOrigin] } });
  await legacy.api('/api/datasets/sales/row-rules/east', 'PUT', { principals: [{ type: 'user', id: 'alice' }], predicate: { column: 'region', operator: 'eq', value: 'East' } });
  const profile = join(directory, 'profile'); await mkdir(join(profile, 'Default'), { recursive: true });
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({ profile: { block_third_party_cookies: true, cookie_controls_mode: 1 } }));
  browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', ignoreHTTPSErrors: true, viewport: { width: 1280, height: 960 },
    args: ['--no-sandbox', '--no-proxy-server', `--ip-address-space-overrides=127.0.0.1:${proxy.address().port}=public,127.0.0.1:${parentServer.address().port}=public`, '--disable-features=LocalNetworkAccessChecks,kLocalNetworkAccessChecks,kLocalNetworkAccessForNavigations,kLocalNetworkAccessForSubframeNavigations', '--test-third-party-cookie-phaseout', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await browser.grantPermissions(['local-network-access']);
  await browser.route('**/*', route => [embedOrigin, parentOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  page = await browser.newPage(); const cdp = await browser.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCookieControls', { enableThirdPartyCookieRestriction: true, disableThirdPartyCookieMetadata: true, disableThirdPartyCookieHeuristics: true });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => consoleOutput.push(m.text()));
  page.on('response', response => { if (/\/redeem$/.test(response.url())) void response.json().then(r => { if(r.credential)credentials.push(r.credential); }).catch(() => {}); });
  const waitReady = async before => page.waitForFunction(n => window.readyCount > n, before, { timeout: 30000 });
  const frame = () => page.frames().find(frame => frame.url().startsWith(`${embedOrigin}/embed/sessions/`));
  const screenshot = async name => {
    if (name === 'author') { await page.setViewportSize({width:1280,height:1250}); await page.locator('#content').evaluate(e=>{e.style.height='1180px';}); }
    await page.screenshot({ path: join(output, `${name}.png`) });
    if (name === 'author') { await page.setViewportSize({width:1280,height:960}); await page.locator('#content').evaluate(e=>{e.style.height='900px';}); }
  };
  await page.goto(parentOrigin); await waitReady(0);
  assert.match(await frame().locator('.visual-card svg').textContent(), /40/); assert.equal(new URL(frame().url()).hash, '');
  assert.ok([0, 'blocked'].includes(await frame().evaluate(() => { try { return localStorage.length + sessionStorage.length; } catch { return 'blocked'; } })));
  const probe = await frame().evaluate(async () => { await fetch('/cookie-probe', { credentials: 'include' }); return (await fetch('/cookie-probe', { credentials: 'include' })).json(); });
  assert.equal(probe.cookie, '', 'Third-party cookie probe must actually be blocked');
  assert.ok(!(await browser.cookies()).some(c => c.name === 'h6_probe')); evidence.checks.push('Registered RLS total 40 with proven blocked third-party cookies; empty browser storage and cleared fragment');
  await screenshot('registered');
  const current = issued.at(-1), priorEvents = await page.evaluate(() => ({ ready: readyCount, expired: expiredCount, revoked: revokedCount }));
  const handshake = await page.evaluate(() => events.find(e=>e.event==='ready'));
  // Actual postMessage from a same-origin sibling, plus wrong-origin parent and stale channel.
  const [sibling] = await Promise.all([page.waitForEvent('framenavigated', { predicate: f => f.url() === `${embedOrigin}/sibling` }), page.evaluate(origin => { const sibling = document.createElement('iframe'); sibling.id='sibling'; sibling.src=origin+'/sibling'; document.body.appendChild(sibling); }, embedOrigin)]);
  await sibling.evaluate(({ payload, target }) => parent.postMessage(payload,target), { payload: { ...handshake, event: 'sessionExpired' }, target: parentOrigin });
  await page.evaluate(({ payload, target }) => window.postMessage(payload,target), { payload: { ...handshake, event: 'authorizationRevoked' }, target: parentOrigin });
  await frame().evaluate(({ payload, target }) => parent.postMessage(payload,target), { payload: { ...handshake, channelId: 'forged-channel', event: 'ready' }, target: parentOrigin });
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(await page.evaluate(() => ({ ready: readyCount, expired: expiredCount, revoked: revokedCount })), priorEvents);
  await page.locator('#sibling').evaluate(e => e.remove()); evidence.checks.push('Actual forged postMessage attempts from parent, sibling, and stale channel ignored');
  const replay = await api(`/api/embed/sessions/${current.sessionId}/redeem`, 'POST', { bootstrap: new URL(current.EmbedUrl).hash.slice(11), parentOrigin, channelId: randomBytes(24).toString('base64url') }); assert.equal(replay.body.errorCode, 'EMBED_BOOTSTRAP_REPLAY');
  await page.evaluate(() => { window.handle.destroy(); });
  const counts = await page.evaluate(() => ({ ready: readyCount, error: errorCount })); await page.evaluate(() => window.shared());
  await page.waitForFunction(before => readyCount === before.ready + 1 && errorCount === before.error + 1, counts, { timeout: 30000 });
  await page.evaluate(() => handles.forEach(h=>h.destroy())); evidence.checks.push('Two real iframes race on one bootstrap: exactly one ready, one rejected; replay also rejected');
  for (const mode of ['anonymous','visual','q','empty','author']) {
    scenario = mode; const before = await page.evaluate(() => readyCount); await page.evaluate(() => start()); await waitReady(before);
    if (mode === 'anonymous') assert.match(await frame().locator('.visual-card svg').textContent(), /20/);
    if (mode === 'visual') assert.equal(await frame().locator('.visual-card').count(), 1);
    if (mode === 'q') { await frame().getByLabel('Question', { exact:true }).fill('total amount by region'); await frame().getByRole('button',{name:'Ask',exact:true}).click(); await frame().getByRole('cell',{name:'40',exact:true}).waitFor(); assert.ok(!(await frame().locator('body').innerText()).includes('private')); }
    if (mode === 'empty') await frame().getByRole('heading',{name:'No visuals in this dashboard'}).waitFor();
    await screenshot(mode);
  }
  evidence.checks.push('Anonymous tagged RLS total 20; visual-only rendering; Q result 40 with CLS; empty and authoring states');
  const original = await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' });
  await frame().getByLabel('Analysis name', { exact:true }).fill('Saved from embedded author'); await frame().getByRole('button',{name:'Save analysis',exact:true}).click();
  await page.waitForFunction(()=>savedCount===1); assert.equal((await f.metadata.get(await f.context(), { kind:'analysis',id:'analysis' })).body.definition.Name,'Saved from embedded author');
  assert.equal((await f.metadata.get(await f.context(), { kind:'analysis',id:'analysis' })).version, original.version + 1); await screenshot('saved');
  evidence.checks.push('Embedded author saved a real versioned analysis; frame cleared after revision invalidation');
  apiToken = (await f.login()).token;
  scenario = 'registered'; let before = await page.evaluate(() => readyCount); await page.evaluate(()=>start()); await waitReady(before);
  const revoked = issued.at(-1); const started = Date.now(); assert.equal((await api(`/api/embedding/sessions/${revoked.sessionId}`,'DELETE',{},`Bearer ${apiToken}`)).status,200);
  await page.waitForFunction(()=>revokedCount>=1,undefined,{timeout:55000}); const revocationMs = Date.now()-started; assert.ok(revocationMs < 60000); assert.equal(await frame().locator('.visual-card').count(),0); await screenshot('revoked');
  evidence.checks.push(`Revocation removed visible protected content in ${revocationMs} ms`);
  // Real expiry path: move only this synthetic session's authoritative deadline.
  before = await page.evaluate(()=>readyCount); await page.evaluate(()=>start()); await waitReady(before);
  await pool.query('UPDATE h6_sessions SET expires_at=$1 WHERE session_id=$2',[Date.now()-1,issued.at(-1).sessionId]);
  await page.waitForFunction(()=>expiredCount>=1,undefined,{timeout:55000}); assert.equal(await frame().locator('.visual-card').count(),0); await screenshot('expired'); evidence.checks.push('Authoritative session expiry cleared frame on status check');
  before = await page.evaluate(()=>readyCount); await page.evaluate(()=>start()); await waitReady(before);
  const tenant = await f.provisioning.operator.tenant(f.tenant.tenantId); await f.provisioning.transition('browser-suspend', f.tenant.tenantId, 'suspend', tenant.version);
  const revCount = await page.evaluate(()=>revokedCount); await page.waitForFunction(n=>revokedCount>n, revCount,{timeout:55000}); assert.equal(await frame().locator('.visual-card').count(),0);
  const suspended = await f.provisioning.operator.tenant(f.tenant.tenantId); await f.provisioning.transition('browser-resume',f.tenant.tenantId,'resume',suspended.version); evidence.checks.push('Tenant suspension cleared active frame; resuming does not restore its credential');
  apiToken = (await f.login()).token;
  before = await page.evaluate(()=>readyCount); await page.evaluate(()=>start()); await waitReady(before);
  const keyRevocations = await page.evaluate(()=>revokedCount);
  const keyIssued = await f.sessions.issue(await f.context(), { ExperienceConfiguration: { Dashboard: { InitialDashboardId:'dashboard' } } });
  await activateEmbedKey(f.db,{id:'browser-rotated',secret:randomBytes(32)});
  assert.equal((await api(`/api/embed/sessions/${keyIssued.sessionId}/redeem`,'POST',{bootstrap:new URL(keyIssued.EmbedUrl).hash.slice(11),parentOrigin,channelId:randomBytes(24).toString('base64url')})).body.errorCode,'EMBED_KEY_REVOKED'); evidence.checks.push('Key retirement rejected an unspent bootstrap');
  await page.waitForFunction(n=>revokedCount>n,keyRevocations,{timeout:55000}); assert.equal(await frame().locator('.visual-card').count(),0);
  evidence.checks.push('Key retirement also cleared an already active browser session');
  // Verify v1 in the same real browser without changing its 60–900 second model.
  before = await page.evaluate(()=>readyCount); await page.evaluate(()=>v1()); await waitReady(before);
  const oldFrame = page.frames().find(f=>f.url().includes('/embed/dashboards/')); assert.match(await oldFrame.locator('.visual-card svg').textContent(),/500/); await screenshot('v1'); evidence.checks.push('v1 signed visual URL and viewer RLS still render total 500');
  messages.push(...await page.evaluate(()=>events));
  const exposed = JSON.stringify({ messages, consoleOutput, errors, parentDom: await page.content() });
  for (const credential of credentials) assert.ok(!exposed.includes(credential), 'Frame credential escaped into parent or logs');
  assert.equal(errors.length,0); evidence.checks.push('No frame credentials in parent messages/DOM, console, errors, cookies or browser storage');
  evidence.screenshots = ['registered','anonymous','visual','q','empty','author','saved','revoked','expired','v1'].map(s=>`${s}.png`);
  await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2)); console.log(JSON.stringify(evidence,null,2));
} catch (error) {
  if (page) {
    await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});
    const state = await Promise.all(page.frames().map(async frame => ({ path: new URL(frame.url() || 'about:blank').pathname, text: (await frame.locator('body').innerText().catch(()=>'' )).slice(0,900) })));
    let diagnostic=JSON.stringify({diagnostic:state, errors, console:consoleOutput.slice(-12)},null,2);
    for(const value of credentials)diagnostic=diagnostic.replaceAll(value,'[redacted]');
    for(const value of issued)diagnostic=diagnostic.replaceAll(new URL(value.EmbedUrl).hash.slice(11),'[redacted]');
    console.log(diagnostic);
  }
  throw error;
} finally {
  await browser?.close();
  for (const fn of cleanup.reverse()) await fn();
  await rm(directory,{recursive:true,force:true});
}
