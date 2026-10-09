import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiClient, ApiError, SHORT_SESSION_MS, MAX_SESSION_MS } from '../build/test/api-client.js';

const input = () => ({ email: 'invited@example.test', password: randomBytes(24).toString('base64'), code: '123456', tenantId: 'workspace' });
const identity = { id: 'user', namespaceId: 'namespace', name: 'Invited user', role: 'author', tenantId: 'workspace' };
const token = () => randomBytes(32).toString('base64url');

test('Issue #63: one credential-free login establishes a verified session, every API path shares its bearer, logout clears it', async () => {
  const bearer = token(), credentials = input(), calls = [];
  const client = createApiClient('/', async (url, options) => {
    calls.push({url, options});
    if (url === '/api/auth/login') {
      assert.equal(options.credentials, 'omit');
      assert.equal(new Headers(options.headers).get('authorization'), null);
      assert.equal(new Headers(options.headers).get('cookie'), null);
      assert.deepEqual(JSON.parse(options.body), credentials);
      return Response.json({ token: bearer, tenantId: 'workspace', expiresAt: Date.now() + 3_600_000 });
    }
    if (calls.length > 2 && url === '/api/session' && !new Headers(options.headers).get('authorization')) return Response.json(identity);
    assert.equal(options.credentials, 'omit');
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${bearer}`);
    if (url === '/api/session') return Response.json(identity);
    if (url.endsWith('/logout')) return Response.json({loggedOut: true});
    if (url.endsWith('/query')) return Response.json({ columns: [], rows: [] });
    if (url.endsWith('/definition')) return Response.json({ AnalysisId: 'sample', Definition: { DataSetIdentifierDeclarations: [], Sheets: [] } });
    if (url.endsWith('/refresh-status')) return Response.json({ datasetId: 'sample', lastGood: null, state: 'never', error: null });
    return Response.json([]);
  });
  const result = await client.login(credentials, true);
  assert.deepEqual(result.session, identity);
  assert.equal('token' in result, false);
  await client.listUsers();
  await client.queryDataset('sample', { dimensions: [], measures: [] });
  await client.getAnalysisDefinition('sample');
  await client.getDatasetRefreshStatus('sample');
  await client.logout();
  await client.getSession();
  assert.equal(calls.filter(c => c.url === '/api/auth/login').length, 1);
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
});

for (const code of ['AUTHENTICATION_FAILED','AUTH_RATE_LIMITED','AUTH_KEY_REVOKED','BUILTIN_AUTH_UNAVAILABLE','HOSTED_REQUEST_INVALID','UNTRUSTED_ORIGIN','FORGED_PRINCIPAL','EMAIL_INVALID','PASSWORD_INVALID','METADATA_INVALID','PRINCIPAL_REQUIRED','UNKNOWN_PRINCIPAL','TENANT_UNAVAILABLE','AUTHORIZATION_REVISED']) {
  test(`Issue #63: preserves ${code} without exposing raw response text`, async () => {
    const client = createApiClient('/', async () => Response.json({errorCode: code, Message: 'private details'}, {status: 403}));
    await assert.rejects(client.login(input(), false), e => e instanceof ApiError && e.errorCode === code && !e.message.includes('private details'));
  });
}

test('Issue #63: remember-me uses a bounded deadline, never renews or persists a credential', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  for (const [remember, serverMs, expectedMs] of [[false, MAX_SESSION_MS, SHORT_SESSION_MS], [true, 3_600_000, 3_600_000], [true, MAX_SESSION_MS * 2, MAX_SESSION_MS]]) {
    let seen;
    const start = Date.now();
    const client = createApiClient('/', async (url, options) => {
      seen = options;
      return Response.json(url.endsWith('/login') ? { token: token(), tenantId: 'workspace', expiresAt: start + serverMs } : identity);
    });
    const result = await client.login(input(), remember);
    assert.equal(result.expiresAt, start + expectedMs);
    t.mock.timers.tick(expectedMs - 1);
    await client.getSession();
    assert.ok(seen.headers.Authorization);
    t.mock.timers.tick(1);
    await assert.rejects(client.getSession(), { errorCode: 'SESSION_EXPIRED' });
    await client.getSession();
    assert.equal(seen.headers.Authorization, undefined);
    const reloaded = createApiClient('/', async (_url, options) => { assert.equal(options.headers.Authorization, undefined); return Response.json(identity); });
    await reloaded.getSession();
  }
});

test('Issue #63: malformed responses and failed session verification cannot establish access', async () => {
  for (const body of [{}, null, { token: 'bad token', expiresAt: Date.now()+900000, tenantId:'workspace' }, { token: token(), expiresAt: Date.now()-1, tenantId:'workspace' }, { token:token(), expiresAt:Date.now()+900000, tenantId:'other' }]) {
    const client = createApiClient('/', async () => Response.json(body));
    await assert.rejects(client.login(input(), false), { errorCode:'AUTH_RESPONSE_INVALID' });
  }
  for (const result of [Response.json({...identity, tenantId:'other'}), Response.json({errorCode:'AUTHENTICATION_FAILED'}, {status:401}), new Response('proxy failure', {status:502})]) {
    let seen;
    const client = createApiClient('/', async (url, options) => {
      seen = options;
      return url.endsWith('/login') ? Response.json({token:token(), expiresAt:Date.now()+900000, tenantId:'workspace'}) : result.clone();
    });
    await assert.rejects(client.login(input(), false));
    await client.getSession().catch(() => {});
    assert.equal(seen.headers.Authorization, undefined);
  }
});

test('Issue #63: failed logout still drops the bearer and reports the failure', async () => {
  let seen;
  const client = createApiClient('/', async (url, options) => {
    seen = options;
    if (url.endsWith('/login')) return Response.json({token:token(), expiresAt:Date.now()+900000, tenantId:'workspace'});
    if (url.endsWith('/logout')) return Response.json({errorCode:'BUILTIN_AUTH_UNAVAILABLE'}, {status:503});
    return Response.json(identity);
  });
  await client.login(input(), false);
  await assert.rejects(client.logout(), {errorCode:'BUILTIN_AUTH_UNAVAILABLE'});
  await client.getSession();
  assert.equal(seen.headers.Authorization, undefined);
});

test('Issue #63: cancelled or superseded login responses cannot restore credentials', async () => {
  let resolve, seen;
  const controller = new AbortController();
  const client = createApiClient('/', async (url, options) => {
    seen = options;
    if (url.endsWith('/login')) return new Promise(r => { resolve = r; });
    return Response.json(identity);
  });
  for (const cancel of [() => client.clearSession(), () => controller.abort()]) {
    const pending = client.login(input(), false, controller.signal);
    cancel();
    resolve(Response.json({token:token(), expiresAt:Date.now()+900000, tenantId:'workspace'}));
    await assert.rejects(pending, {errorCode:'AUTH_REQUEST_SUPERSEDED'});
    await client.getSession();
    assert.equal(seen.headers.Authorization, undefined);
  }
});

test('Issue #63: session verification completing after its deadline cannot establish access', async t => {
  t.mock.timers.enable({apis:['Date'],now:1_800_000_000_000});
  let calls=0;
  const client=createApiClient('/',async(url)=>{
    calls++;
    if(url.endsWith('/login'))return Response.json({token:token(),expiresAt:Date.now()+SHORT_SESSION_MS,tenantId:'workspace'});
    t.mock.timers.tick(SHORT_SESSION_MS);
    return Response.json(identity);
  });
  await assert.rejects(client.login(input(),false),{errorCode:'SESSION_EXPIRED'});
  assert.equal(calls,2);
});
