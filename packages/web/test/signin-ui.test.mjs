import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { SignIn } from '../build/test/SignIn.js';
import { authNotice } from '../build/test/auth-errors.js';
import { ApiError, createApiClient, SHORT_SESSION_MS } from '../build/test/api-client.js';
import { SessionGate } from '../build/test/SessionGate.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { useAccess } from '../build/test/access.js';

const identity = {id:'user', namespaceId:'namespace', tenantId:'workspace', name:'Invited user', role:'author'};
function Probe() { const access = useAccess(); return createElement('output', {'data-access':access}, createElement(AppNavigation, {navigate(){}, route:{page:'home'}})); }
async function mount(t, element) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const events = new EventTarget();
  globalThis.window = {
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    setInterval: (...args) => setInterval(...args), clearInterval: id => clearInterval(id),
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    localStorage: {setItem(){assert.fail('credentials must not be persisted');}},
    sessionStorage: {setItem(){assert.fail('credentials must not be persisted');}},
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(async () => { renderer = create(element); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.window=oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct; });
  return {renderer, focus: () => act(async () => events.dispatchEvent(new Event('focus')))};
}
const field = (ui, id, value) => act(() => ui.renderer.root.findByProps({id}).props.onChange({target:{value}}));
const submit = ui => act(async () => ui.renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
const button = (ui, text) => ui.renderer.root.findAllByType('button').find(node => node.props.children === text);
async function credentials(ui) {
  const password = randomBytes(24).toString('base64');
  await field(ui, 'signin-email', 'invited@example.test');
  await field(ui, 'signin-password', password);
  await field(ui, 'signin-workspace', 'workspace');
  await submit(ui);
  return password;
}

test('Issue #63: credentials advance locally; only a six-digit TOTP submits, with memory-only remember choice', async t => {
  const calls=[];
  const ui=await mount(t, createElement(SignIn, {onSignIn:async (...args)=>{calls.push(args);}, onRetry(){}, onDemo(){}}));
  await act(() => ui.renderer.root.findAllByType('input').find(n=>n.props.type==='checkbox' && n.props['aria-describedby']).props.onChange({target:{checked:true}}));
  const password=await credentials(ui);
  assert.equal(calls.length,0);
  assert.equal(ui.renderer.root.findAllByProps({id:'signin-password'}).length,0);
  await field(ui,'signin-code','12a'); await submit(ui);
  assert.equal(calls.length,0);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /6-digit code/);
  await field(ui,'signin-code','012345'); await submit(ui);
  assert.deepEqual(calls, [[{email:'invited@example.test',password,code:'012345',tenantId:'workspace'},true]]);
  assert.equal(ui.renderer.root.findByProps({id:'signin-code'}).props.value,'');
});

test('Issue #63: back clears password and TOTP; rejected login clears code and keeps generic credentials error', async t => {
  const ui=await mount(t, createElement(SignIn, {onSignIn:async ()=>{throw new ApiError('private account status',401,'AUTHENTICATION_FAILED');}, onRetry(){}, onDemo(){}}));
  await credentials(ui); await field(ui,'signin-code','123456'); await submit(ui);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Invalid email or password/);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /private account status/);
  assert.equal(ui.renderer.root.findByProps({id:'signin-code'}).props.value,'');
  await act(()=>button(ui,'Back to sign in').props.onClick());
  assert.equal(ui.renderer.root.findByProps({id:'signin-password'}).props.value,'');
  assert.equal(ui.renderer.root.findByProps({id:'signin-email'}).props.value,'invited@example.test');
});

for (const [code,text] of Object.entries({AUTH_RATE_LIMITED:'Too many sign-in attempts',AUTH_KEY_REVOKED:'no longer valid',BUILTIN_AUTH_UNAVAILABLE:'not available',HOSTED_REQUEST_INVALID:'could not accept',UNTRUSTED_ORIGIN:'not trusted',FORGED_PRINCIPAL:'rejected the request identity',EMAIL_INVALID:'valid email',PASSWORD_INVALID:'at least 15',METADATA_INVALID:'workspace ID',PRINCIPAL_REQUIRED:'Sign in to access',UNKNOWN_PRINCIPAL:'cannot access',TENANT_UNAVAILABLE:'workspace is unavailable',AUTHORIZATION_REVISED:'access has changed',AUTH_RESPONSE_INVALID:'invalid sign-in response',AUTH_REQUEST_SUPERSEDED:'cancelled',SESSION_EXPIRED:'session has expired'})) {
  test(`Issue #63: ${code} has actionable, named UI guidance`, async t => {
    const ui=await mount(t,createElement(SignIn,{onSignIn:async()=>{throw new ApiError('sensitive backend text',403,code);},onRetry(){},onDemo(){}}));
    await credentials(ui); await field(ui,'signin-code','123456'); await submit(ui);
    const alert=ui.renderer.root.findByProps({role:'alert'});
    assert.match(JSON.stringify(ui.renderer.toJSON()), new RegExp(text));
    assert.match(JSON.stringify(ui.renderer.toJSON()), new RegExp(code));
    assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /sensitive backend text/);
  });
}

test('Issue #63: unknown codes, non-JSON failures and network outages are honest and sanitize backend messages', () => {
  assert.equal(authNotice(new ApiError('raw',500,'FUTURE_AUTH_ERROR')).code,'FUTURE_AUTH_ERROR');
  assert.equal(authNotice(new ApiError('raw',500,'<script>')).code,undefined);
  assert.match(authNotice(new TypeError('private hostname')).message,/Unable to reach/);
  assert.match(authNotice(new ApiError('raw',502)).message,/Unable to complete/);
});

test('Issue #63: duplicate submits are suppressed while login is pending', async t => {
  let finish, calls=0;
  const ui=await mount(t,createElement(SignIn,{onSignIn:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},onRetry(){},onDemo(){}}));
  await credentials(ui); await field(ui,'signin-code','123456');
  let first;
  await act(()=>{first=ui.renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});
  await submit(ui);
  assert.equal(calls,1);
  assert.equal(button(ui,'Signing in…').props.disabled,true);
  await act(async()=>{finish();await first;});
});

function hostedClient({lifetime=3_600_000, logoutFails=false}={}) {
  let issued=false, revoked=false;
  const calls=[];
  const client=createApiClient('/',async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/login')) {issued=true;revoked=false;return Response.json({token:randomBytes(32).toString('base64url'),expiresAt:Date.now()+lifetime,tenantId:'workspace'});}
    if(url.endsWith('/logout')) {if(logoutFails) throw new TypeError('offline');revoked=true;return Response.json({loggedOut:true});}
    return issued&&!revoked&&options.headers.Authorization ? Response.json(identity) : Response.json({errorCode:'AUTHENTICATION_FAILED'},{status:401});
  });
  return {client,calls,revoke(){revoked=true;}};
}
async function signedIn(t, options) {
  const f=hostedClient(options);
  const ui=await mount(t,createElement(SessionGate,{client:f.client,offline:false},createElement(Probe)));
  await credentials(ui);await field(ui,'signin-code','123456');await submit(ui);
  assert.equal(ui.renderer.root.findByType('output').props['data-access'].mode,'hosted');
  return {...f,...ui};
}

test('Issue #63: full gate flow establishes session and sign-out removes the app and bearer', async t => {
  const ui=await signedIn(t);
  await act(async()=>button(ui,'Sign out').props.onClick());
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
  assert.equal(ui.renderer.root.findByProps({role:'status'}).props['data-kind'],'info');
  assert.match(JSON.stringify(ui.renderer.toJSON()),/You have signed out/);
  await ui.client.getSession().catch(()=>{});
  assert.equal(ui.calls.at(-1).options.headers.Authorization,undefined);
});

test('Issue #63: failed sign-out removes local access without claiming server revocation', async t => {
  const ui=await signedIn(t,{logoutFails:true});
  await act(async()=>button(ui,'Sign out').props.onClick());
  assert.match(JSON.stringify(ui.renderer.toJSON()),/Sign-out could not be confirmed/);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()),/You have signed out/);
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
});

test('Issue #63: exact 15-minute expiry removes the app and shows expired-session state', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1_800_000_000_000});
  const ui=await signedIn(t);
  await act(async()=>t.mock.timers.tick(SHORT_SESSION_MS-1));
  assert.equal(ui.renderer.root.findAllByType(Probe).length,1);
  await act(async()=>t.mock.timers.tick(1));
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/Your session has expired/);
  await ui.focus();
  assert.match(JSON.stringify(ui.renderer.toJSON()),/Your session has expired/);
});

test('Issue #63: periodic revocation is observed in 30 seconds and never reported as known expiry', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1_800_000_000_000});
  const ui=await signedIn(t);ui.revoke();
  await act(async()=>t.mock.timers.tick(30_000));
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/AUTHENTICATION_FAILED/);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()),/Your session has expired/);
});

test('Issue #63: remember-me keeps access past 15 minutes and expires at the server deadline', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1_800_000_000_000});
  const f=hostedClient({lifetime:36_000_000});
  const ui=await mount(t,createElement(SessionGate,{client:f.client,offline:false},createElement(Probe)));
  await act(()=>ui.renderer.root.findAllByType('input').find(n=>n.props.type==='checkbox'&&n.props['aria-describedby']).props.onChange({target:{checked:true}}));
  await credentials(ui);await field(ui,'signin-code','123456');await submit(ui);
  await act(async()=>t.mock.timers.tick(SHORT_SESSION_MS));
  assert.equal(ui.renderer.root.findAllByType(Probe).length,1);
  await act(async()=>t.mock.timers.tick(36_000_000-SHORT_SESSION_MS));
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/Your session has expired/);
});

test('Issue #63: a delayed revocation check cannot remount the app after sign-out', async t => {
  let delay=false, finish;
  const f=hostedClient();
  const original=f.client.getSession;
  f.client.getSession=signal=>delay?new Promise(resolve=>{finish=resolve;}):original(signal);
  const ui=await mount(t,createElement(SessionGate,{client:f.client,offline:false},createElement(Probe)));
  await credentials(ui);await field(ui,'signin-code','123456');await submit(ui);
  delay=true;await ui.focus();
  await act(async()=>button(ui,'Sign out').props.onClick());
  await act(async()=>finish(identity));
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/You have signed out/);
});

test('Issue #63: login timeout aborts transport and never mounts a workspace', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let signal;
  const client=createApiClient('/',async(url,options)=>{
    if(url.endsWith('/login')){signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}
    return Response.json({errorCode:'AUTHENTICATION_FAILED'},{status:401});
  });
  const ui=await mount(t,createElement(SessionGate,{client,offline:false},createElement(Probe)));
  await credentials(ui);await field(ui,'signin-code','123456');
  let pending;await act(()=>{pending=ui.renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});
  await act(async()=>{t.mock.timers.tick(10_000);await pending;});
  assert.equal(signal.aborted,true);
  assert.equal(ui.renderer.root.findAllByType(Probe).length,0);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/Unable to reach your workspace/);
});
