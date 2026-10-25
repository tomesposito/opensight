import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiClient, ApiError, SHORT_SESSION_MS, MAX_SESSION_MS } from '../build/test/api-client.js';

const input = () => ({ email: 'invited@example.test', password: randomBytes(24).toString('base64'), code: '123456' });
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
  assert.deepEqual(result.session, {...identity, workspaceName: 'workspace', workspaceSlug: null});
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
  for (const body of [{}, null, { token: 'bad token', expiresAt: Date.now()+900000, tenantId:'workspace' }, { token: token(), expiresAt: Date.now()-1, tenantId:'workspace' }, { token:token(), expiresAt:Date.now()+900000, tenantId:42 }]) {
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

test('on-demand outages retain the memory bearer; a current 401 clears it and requests sign-in', async () => {
  const events = [], headers = []; let mode = 'ok';
  const client = createApiClient('/', async (url, options) => {
    headers.push(options.headers.Authorization);
    if (url.endsWith('/login')) return Response.json({ token: token(), tenantId: 'workspace', expiresAt: Date.now() + 900000 });
    if (mode === 'outage') return Response.json({ errorCode: 'WORKSPACE_STARTING' }, { status: 503 });
    if (mode === 'revoked') return Response.json({ errorCode: 'AUTHORIZATION_REVISED' }, { status: 401 });
    return Response.json(identity);
  }, { onDemand: true });
  const unsubscribe = client.subscribeAvailability(event => events.push(event));
  await client.login(input(), false); const bearer = headers.at(-1); mode = 'outage'; await assert.rejects(client.getSession());
  assert.deepEqual(events, [{ kind: 'connection-required', errorCode: 'WORKSPACE_STARTING' }]);
  mode = 'ok'; await client.getSession(); assert.equal(headers.at(-1), bearer);
  mode = 'revoked'; await assert.rejects(client.getSession()); assert.equal(events.at(-1).kind, 'authentication-required');
  mode = 'ok'; await client.getSession(); assert.equal(headers.at(-1), undefined); unsubscribe();
});
test('on-demand late prior-session failures cannot hide a replacement session; local expiry emits without a request', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  let held = false, resolve, calls = 0; const events = [];
  const client = createApiClient('/', async url => {
    calls++;
    if (url.endsWith('/login')) return Response.json({ token: token(), tenantId: 'workspace', expiresAt: Date.now() + 900000 });
    if (held) return new Promise(r => { resolve = r; }); return Response.json(identity);
  }, { onDemand: true });
  client.subscribeAvailability(event => events.push(event)); await client.login(input(), false);
  held = true; const old = client.getSession(); held = false; await client.login(input(), false);
  resolve(Response.json({ errorCode: 'AUTHORIZATION_REVISED' }, { status: 401 })); await assert.rejects(old, { errorCode: 'AUTH_REQUEST_SUPERSEDED' }); assert.equal(events.length, 0);
  const before = calls; t.mock.timers.tick(900000); await assert.rejects(client.getSession(), { errorCode: 'SESSION_EXPIRED' }); assert.equal(calls, before); assert.deepEqual(events, [{ kind: 'authentication-required', errorCode: 'SESSION_EXPIRED' }]);
});

const selection = () => ({selectionRequired:true,email:'invited@example.test',workspaces:[
  {tenantId:'workspace',name:'Sales team',slug:'sales-team'}, {tenantId:'legacy',name:'legacy',slug:null},
],selectionToken:token(),selectionExpiresAt:Date.now()+300000});

test('Issue #146: challenge is typed and credential-free; selecting establishes the shared verified session', async () => {
  const challenge=selection(), calls=[];
  const client=createApiClient('/',async(url,options)=>{
    calls.push(url);
    if(url==='/api/auth/login'||url==='/api/auth/login/select') {
      assert.equal(options.credentials,'omit');assert.equal(new Headers(options.headers).get('authorization'),null);
      assert.equal(new Headers(options.headers).get('cookie'),null);
      if(url.endsWith('/login')) {assert.equal('tenantId' in JSON.parse(options.body),false);return Response.json(challenge);}
      assert.deepEqual(JSON.parse(options.body),{selectionToken:challenge.selectionToken,tenantId:'workspace'});
      return Response.json({token:token(),tenantId:'workspace',expiresAt:Date.now()+900000});
    }
    assert.ok(options.headers.Authorization);return Response.json({...identity,workspaceName:'Sales team',workspaceSlug:'sales-team'});
  });
  assert.deepEqual(await client.login(input(),false),{kind:'selection',email:challenge.email,workspaces:challenge.workspaces,selectionToken:challenge.selectionToken,selectionExpiresAt:challenge.selectionExpiresAt});
  assert.deepEqual(calls,['/api/auth/login']);
  const signed=await client.selectWorkspace(challenge.selectionToken,'workspace',false);
  assert.equal(signed.session.workspaceName,'Sales team');assert.equal(signed.session.workspaceSlug,'sales-team');
  assert.deepEqual(calls,['/api/auth/login','/api/auth/login/select','/api/session']);
});

test('Issue #146: malformed/expired challenges fail closed without requesting a session', async () => {
  for(const change of [c=>{c.selectionToken='bad';},c=>{c.selectionExpiresAt=Date.now();},c=>{c.workspaces=[];},c=>{c.workspaces=[c.workspaces[0],c.workspaces[0]];},c=>{c.workspaces[0].name=42;},c=>{c.workspaces[0].slug={};}]) {
    const challenge=selection();change(challenge);let calls=0;
    const client=createApiClient('/',async()=>{calls++;return Response.json(challenge);});
    await assert.rejects(client.login(input(),false),{errorCode:'AUTH_RESPONSE_INVALID'});assert.equal(calls,1);
  }
});

test('Issue #146: selection must match both requested tenant and verified session, and failure clears credentials', async () => {
  for(const [issued,verified] of [['other','other'],['workspace','other']]) {
    let seen;
    const client=createApiClient('/',async(url,options)=>{seen=options;return Response.json(url.endsWith('/select')?{token:token(),tenantId:issued,expiresAt:Date.now()+900000}:{...identity,tenantId:verified});});
    await assert.rejects(client.selectWorkspace(token(),'workspace',false),{errorCode:'AUTH_RESPONSE_INVALID'});
    await client.getSession();assert.equal(seen.headers.Authorization,undefined);
  }
});

test('Issue #146: null slugs and absent fields support older servers; malformed label fields are rejected', async () => {
  for(const body of [identity,{...identity,workspaceName:'',workspaceSlug:null}]) {
    const client=createApiClient('/',async()=>Response.json(body));
    const session=await client.getSession();assert.equal(session.workspaceName,'workspace');assert.equal(session.workspaceSlug,null);
  }
  for(const fields of [{workspaceName:42},{workspaceSlug:{}}]) {
    const client=createApiClient('/',async()=>Response.json({...identity,...fields}));await assert.rejects(client.getSession());
  }
});
