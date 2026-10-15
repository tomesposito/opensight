import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { marketingFiles, frontendMetadata } from '../ops/serverless/frontend-policy.mjs';
import { frontendFiles } from '../ops/serverless/release-safety.mjs';
import { packageSites } from '../ops/serverless/package-sites.mjs';
import { smokeStartup } from '../ops/serverless/release-smoke-request.mjs';
const code = readFileSync(new URL('../ops/serverless/edge-static.js', import.meta.url), 'utf8')
  .replace('__OPENSIGHT_APP_HOST__', '"app.opensight.example"').replace('__OPENSIGHT_MARKETING_HOST__', '"opensight.example"');
const context = vm.createContext({}); vm.runInContext(code, context);
const request = (host, uri, method = 'GET') => context.handler({ request: { headers: { host: { value: host } }, uri, method } });

test('D-77 shared edge separates object/cache paths, canonicalizes demo and refuses cross-host routing', () => {
  const apex = 'opensight.example', app = 'app.' + apex;
  for (const [path, mapped] of [['/', '/marketing/index.html'], ['/index.html', '/marketing/index.html'], ['/demo/', '/marketing/demo/index.html'], ['/demo/index.html', '/marketing/demo/index.html'], ['/assets/hero.mp4', '/marketing/assets/hero.mp4']]) {
    assert.equal(request(apex, path).uri, mapped); assert.equal(request(apex, path, 'HEAD').uri, mapped);
  }
  assert.equal(request(apex, '/demo').headers.location.value, '/demo/');
  assert.equal(request(app, '/').uri, '/index.html');
  assert.equal(request(app, '/assets/app-abcdefgh.js').uri, '/assets/app-abcdefgh.js');
  for (const path of ['/marketing/index.html', '/api/api/session', '/embed/sessions/x', '/../index.html', '/assets/../index.html', '/%2e%2e/index.html', '//index.html', '/assets/a%2fb.js', '/manifest.json'])
    for (const host of [apex, app]) assert.equal(request(host, path).statusCode, 404);
  for (const path of ['/opensight-embed.html', '/opensight-embed-session.html']) {
    assert.equal(request(app, path).uri, path); assert.equal(request(apex, path).statusCode, 404);
  }
  assert.equal(request(app, '/demo/').statusCode, 404);
  for (const host of ['attacker.example', app + ':443', app.toUpperCase(), app + '.']) assert.equal(request(host, '/').statusCode, 404);
  assert.equal(request(apex, '/', 'POST').statusCode, 404);
  assert.equal(context.handler({ request: { method: 'GET', uri: '/', headers: { host: { value: app, multiValue: [{ value: apex }] } } } }).statusCode, 404);
});

test('D-77 marketing assets have accurate media types and cannot inherit immutable caching', () => {
  assert.equal(frontendMetadata('marketing/assets/hero.mp4').ContentType, 'video/mp4');
  assert.equal(frontendMetadata('marketing/assets/hero.webm').ContentType, 'video/webm');
  assert.equal(frontendMetadata('marketing/assets/hero-poster.jpg').ContentType, 'image/jpeg');
  assert.equal(frontendMetadata('marketing/assets/opensight-tour.gif').ContentType, 'image/gif');
  assert.equal(frontendMetadata('marketing/assets/blaze.png').CacheControl, 'public,max-age=300');
  assert.equal(frontendMetadata('marketing/demo/index.html').CacheControl, 'no-store');
  assert.equal(frontendMetadata('assets/app-abcdefgh.js').CacheControl, 'public,max-age=31536000,immutable');
});

test('D-77 package binds the exact approved site and rejects missing files, links and partial rollbacks', () => {
  const root = mkdtempSync(join(tmpdir(), 'opensight-sites-'));
  try {
    const site = join(root, 'site'), target = join(root, 'target'), demo = join(root, 'demo.html');
    mkdirSync(site); mkdirSync(target);
    const manifest = { version: 1, kind: 'frontend', files: { 'index.html': 'a'.repeat(64) } };
    writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(demo, '<html>Offline demo</html>');
    for (const name of marketingFiles.filter(n => !n.includes('/demo/'))) {
      const path = join(site, name.slice(10)); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'public content');
    }
    rmSync(join(site, 'styles.css'));
    assert.throws(() => packageSites(site, demo, target)); assert.equal(existsSync(join(target, 'marketing')), false);
    symlinkSync(demo, join(site, 'styles.css'));
    assert.throws(() => packageSites(site, demo, target), /MARKETING_SOURCE_UNSAFE/);
    rmSync(join(site, 'styles.css')); writeFileSync(join(site, 'styles.css'), 'body{}');
    packageSites(site, demo, target);
    const packaged = JSON.parse(readFileSync(join(target, 'manifest.json')));
    assert.equal(Object.keys(packaged.files).length, marketingFiles.length + 1);
    assert.equal(readFileSync(join(target, 'marketing/demo/index.html'), 'utf8'), '<html>Offline demo</html>');
    frontendFiles(packaged, true);
    delete packaged.files['marketing/styles.css'];
    assert.throws(() => frontendFiles(packaged), /MARKETING_BUNDLE_REQUIRED/);
    assert.throws(() => frontendFiles(manifest, true), /MARKETING_BUNDLE_REQUIRED/);
    frontendFiles(manifest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('D-77 explicit startup wake retries bounded transient 503s, never denials or arbitrary failures', async () => {
  let tries = 0; const waits = [];
  await smokeStartup(async () => ++tries === 1 ? { status: 503, body: { message: 'Service Unavailable' } }
    : tries === 2 ? { status: 503, body: { errorCode: 'WORKSPACE_STARTING' } } : { status: 200, body: { state: 'ready' } }, async ms => waits.push(ms));
  assert.equal(tries, 3); assert.deepEqual(waits, [10000, 10000]);
  for (const response of [{ status: 403, body: {} }, { status: 503, body: { errorCode: 'ACCESS_DENIED' } }, { status: 503, body: { message: 'Service Unavailable', errorCode: 'DENIED' } }, { status: 200, body: { state: 'blocked' } }, { status: 500, body: {} }]) {
    tries = 0; await assert.rejects(smokeStartup(async () => { tries++; return response; }, async () => assert.fail()), /SMOKE_STARTUP_FAILED/); assert.equal(tries, 1);
  }
  tries = 0; await assert.rejects(smokeStartup(async () => { tries++; return { status: 503, body: { errorCode: 'WORKSPACE_STARTING' } }; }, async () => {}), /SMOKE_STARTUP_TIMEOUT/); assert.equal(tries, 6);
});

test('D-81 explicit startup wake retries exact generic 500 and requires eventual readiness', async () => {
  let tries = 0; const waits = [];
  await smokeStartup(async () => ++tries === 1 ? { status: 500, body: { message: 'Internal Server Error' } }
    : { status: 200, body: { state: 'ready' } }, async ms => waits.push(ms));
  assert.equal(tries, 2); assert.deepEqual(waits, [10000]);
  tries = 0; waits.length = 0;
  await assert.rejects(smokeStartup(async () => { tries++; return { status: 500, body: { message: 'Internal Server Error' } }; }, async ms => waits.push(ms)), /SMOKE_STARTUP_TIMEOUT/);
  assert.equal(tries, 6); assert.deepEqual(waits, Array(5).fill(10000));
});

test('D-81 non-generic 500 bodies and wrong statuses remain terminal', async () => {
  for (const response of [
    { status: 500, body: { message: 'Internal Server Error', errorCode: 'DENIED' } },
    { status: 500, body: { message: 'Internal server error' } },
    { status: 500, body: { errorCode: 'WORKSPACE_STARTING' } },
    { status: 500, body: { message: 'Service Unavailable' } },
    { status: 403, body: { message: 'Internal Server Error' } },
    { status: 503, body: { message: 'Internal Server Error' } },
    { status: 500, body: null },
  ]) {
    let tries = 0;
    await assert.rejects(smokeStartup(async () => { tries++; return response; }, async () => assert.fail()), /SMOKE_STARTUP_FAILED/);
    assert.equal(tries, 1);
  }
});

test('D-77 composite cutover retains deployed runtime and app bytes, rejects image/configuration drift', async () => {
  const { cutoverRelease, originPatch } = await import('../ops/serverless/marketing-cutover-policy.mjs');
  const { configurationFingerprint } = await import('../ops/serverless/release-safety.mjs');
  const cfg = { RevisionId: 'old', Environment: { Variables: { OPENSIGHT_PUBLIC_ORIGIN: 'https://opensight.example', AUTH_KEY: 'synthetic-reference' } }, MemorySize: 2048 };
  const names = ['synthetic-request', 'synthetic-work', 'synthetic-recovery', 'synthetic-ingress'];
  const before = Object.fromEntries(names.map(n => [n, { image: 'old-image', config: cfg }]));
  const after = Object.fromEntries(names.map(n => [n, { image: 'old-image', config: { ...cfg, ...originPatch(cfg, 'https://opensight.example', 'https://app.opensight.example') } }]));
  const current = { id: 'old', source: 'a'.repeat(40), imageUri: 'old-image', compatibility: 'b'.repeat(64), requestVersion: '1',
    files: { 'index.html': 'c'.repeat(64) }, configuration: Object.fromEntries(names.map(n => [n, configurationFingerprint(cfg)])) };
  const frontend = { version: 1, kind: 'frontend', files: { 'index.html': 'e'.repeat(64), ...Object.fromEntries(marketingFiles.map(n => [n, 'd'.repeat(64)])) } };
  const manifest = { source: 'f'.repeat(40), compatibility: 'new-runtime-not-approved' };
  const next = cutoverRelease(current, manifest, 'e'.repeat(64), frontend, before, after, { requestVersion: '2', completedAt: 1000 });
  assert.equal(next.requestVersion, '2');
  assert.throws(() => cutoverRelease(current, manifest, 'e'.repeat(64), frontend, before, after, { requestVersion: '1', completedAt: 1000 }), /CUTOVER_RECORD_INVALID/);
  assert.equal(next.source, current.source); assert.equal(next.compatibility, current.compatibility); assert.equal(next.imageUri, current.imageUri);
  assert.equal(next.files['index.html'], current.files['index.html']); assert.equal(next.marketing.source, manifest.source);
  assert.notEqual(next.configuration[names[0]], current.configuration[names[0]]);
  assert.throws(() => cutoverRelease(next, manifest, 'e'.repeat(64), frontend, before, after, { requestVersion: '3', completedAt: 1001 }), /CUTOVER_RECORD_INVALID/);
  for (const patch of [{ image: 'new-image' }, { config: { ...after[names[0]].config, MemorySize: 4096 } }])
    assert.throws(() => cutoverRelease(current, manifest, 'e'.repeat(64), frontend, before, { ...after, [names[0]]: { ...after[names[0]], ...patch } }, { requestVersion: '2', completedAt: 1000 }), /CUTOVER_RUNTIME_DRIFT/);
  assert.throws(() => originPatch(cfg, 'https://other.example', 'https://app.other.example'), /CUTOVER_ORIGIN_DRIFT/);
});

test('D-77 live-site acceptance detects wrong content and cross-host API exposure', async () => {
  const { verifySites } = await import('../ops/serverless/site-smoke.mjs');
  const { digest } = await import('../ops/serverless/release-manifest.mjs');
  const config = { origin: 'https://app.opensight.example', marketingOrigin: 'https://opensight.example' };
  const files = { 'index.html': digest('OpenSight app'), 'marketing/index.html': digest('OpenSight site'), 'marketing/demo/index.html': digest('OpenSight demo') };
  const fake = async url => {
    const u = new URL(url);
    if (u.pathname === '/demo') return new Response(null, { status: 308, headers: { location: '/demo/' } });
    if (u.pathname === '/') return new Response(u.host.startsWith('app.') ? 'OpenSight app' : 'OpenSight site', { headers: { 'content-type': 'text/html' } });
    if (u.pathname === '/demo/') return new Response('OpenSight demo', { headers: { 'content-type': 'text/html' } });
    return new Response(null, { status: 404 });
  };
  await verifySites(config, files, fake);
  await assert.rejects(verifySites(config, { ...files, 'marketing/index.html': files['index.html'] }, fake), /SMOKE_FRONTEND_FAILED/);
  await assert.rejects(verifySites(config, files, async url => url.endsWith('/api/api/session') ? new Response('{}') : fake(url)), /SMOKE_HOST_ISOLATION_FAILED/);
});

test('D-77 initial cutover plan rejects destructive, unrelated and non-origin runtime changes', async () => {
  const { checkCutoverPlan } = await import('../ops/serverless/marketing-cutover-policy.mjs');
  const changes = [
    ['aws_cloudfront_distribution.application', 'update'], ['aws_cloudfront_function.static[0]', 'create'],
    ['aws_cloudfront_function.viewer', 'update'], ['aws_lambda_function.authorizer', 'update'],
    ['aws_route53_record.app["A"]', 'create'], ['aws_route53_record.app["AAAA"]', 'create'],
  ].map(([address, action]) => ({ mode: 'managed', address, change: { actions: [action] } }));
  changes[3].change = { actions: ['update'], before: { memory_size: 256, environment: [{ variables: { OPENSIGHT_PUBLIC_ORIGIN: 'https://opensight.example' } }] },
    after: { memory_size: 256, environment: [{ variables: { OPENSIGHT_PUBLIC_ORIGIN: 'https://app.opensight.example' } }] }, after_unknown: {} };
  assert.equal(checkCutoverPlan({ resource_changes: changes }).deletions, 0);
  for (const mutate of [c => { c[0].change.actions = ['delete', 'create']; }, c => { c.push({ ...c[0], address: 'aws_iam_role.admin' }); },
    c => { c[3].change.after.memory_size = 1024; }, c => { c[3].change.after.environment[0].variables.OTHER = 'changed'; }, c => { c[3].change.after_unknown.environment = true; }]) {
    const c = structuredClone(changes); mutate(c); assert.throws(() => checkCutoverPlan({ resource_changes: c }), /CUTOVER_PLAN_/);
  }
});
