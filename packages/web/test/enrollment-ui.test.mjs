import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { act, createElement, useState } from 'react';
import { create } from 'react-test-renderer';
import { InvitationEnrollment, authenticatorDetails } from '../build/test/InvitationEnrollment.js';
import { SessionGate } from '../build/test/SessionGate.js';
import { ApiError } from '../build/test/api-client.js';
import { invitationToken } from '../build/test/App.js';
import { encodeQr } from '../build/test/qr.js';
const secret='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', email='invited@example.test';
const uri=`otpauth://totp/OpenSight%3Ainvited%40example.test?secret=${secret}&issuer=OpenSight&algorithm=SHA1&digits=6&period=30`;
const enrollment={enrollmentRequired:true,secret,uri};
const identity={id:'user',name:'Invited',namespaceId:'namespace',tenantId:'workspace',role:'reader'};
const token=()=>randomBytes(32).toString('base64url');
async function mount(t,element) {
  const oldWindow=globalThis.window, oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
  const events=new EventTarget();
  globalThis.window={setTimeout,clearTimeout,setInterval,clearInterval,
    addEventListener:(...args)=>events.addEventListener(...args),removeEventListener:(...args)=>events.removeEventListener(...args),
    localStorage:{setItem(){assert.fail('No enrollment state in storage');}},sessionStorage:{setItem(){assert.fail('No enrollment state in storage');}}};
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let renderer; await act(()=>{renderer=create(element);});
  t.after(async()=>{await act(()=>renderer.unmount());globalThis.window=oldWindow;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;});
  return renderer;
}
const field=(ui,id,value)=>act(()=>ui.root.findByProps({id}).props.onChange({target:{value}}));
const submit=ui=>act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));
const text=ui=>JSON.stringify(ui.toJSON());
const button=(ui,label)=>ui.root.findAllByType('button').find(b=>b.props.children===label);
async function password(ui,value=randomBytes(24).toString('base64')) {
  await field(ui,'enrollment-password',value);await field(ui,'enrollment-confirmation',value);return value;
}
function client(overrides={}) {return {enroll:async()=>enrollment,acceptEnrollment:async()=>{},...overrides};}
function component(api,callbacks={}) {return createElement(InvitationEnrollment,{token:token(),client:api,onEnrolled(){},onSignIn(){},...callbacks});}

test('Issue #152: matching passwords, exact local QR, manual key and live code activate only the invited identity',async t=>{
  const calls=[],invitation=token();let completed;
  const ui=await mount(t,component(client({enroll:async(...args)=>{calls.push(args);return enrollment;},acceptEnrollment:async(...args)=>{calls.push(args);}}),{token:invitation,onEnrolled:value=>{completed=value;}}));
  const pass=await password(ui);await field(ui,'enrollment-confirmation','different');await submit(ui);
  assert.equal(calls.length,0);assert.match(text(ui),/Passwords do not match/);
  await field(ui,'enrollment-confirmation',pass);await submit(ui);
  assert.deepEqual(calls[0].slice(0,2),[invitation,pass]);
  assert.equal(ui.root.findByProps({id:'enrollment-secret'}).props.value,secret);
  assert.equal(ui.root.findByProps({id:'enrollment-secret'}).props.readOnly,true);
  assert.match(text(ui),/Account:.*invited@example.test/);assert.match(text(ui),/Issuer:.*OpenSight/);
  const qr=ui.root.findByProps({'aria-label':'Authenticator setup QR code'}), modules=encodeQr(uri).modules;
  assert.equal(qr.props.viewBox,`0 0 ${modules.length+8} ${modules.length+8}`);
  assert.equal(qr.findByType('rect').props.fill,'#fff');assert.equal(qr.findByType('path').props.fill,'#000');
  assert.equal(qr.findByType('path').props.d,modules.flatMap((row,y)=>row.flatMap((dark,x)=>dark?[`M${x+4},${y+4}h1v1h-1z`]:[])).join(''));
  assert.ok(!text(ui).includes(invitation));
  await field(ui,'enrollment-code','123');await submit(ui);assert.equal(calls.length,1);
  await field(ui,'enrollment-code','123456');await submit(ui);
  assert.deepEqual(calls[1].slice(0,3),[invitation,pass,'123456']);assert.deepEqual(completed,{email,password:pass});
  assert.equal(ui.root.findAllByProps({id:'enrollment-secret'}).length,0);
});
test('Issue #152: password validation text is shown as returned and can be corrected',async t=>{
  const ui=await mount(t,component(client({enroll:async()=>{throw new ApiError('At least 15 characters required.',400,'PASSWORD_INVALID');}})));
  await password(ui,'short');await submit(ui);
  assert.match(text(ui),/PASSWORD_INVALID: At least 15 characters required/);
  assert.equal(ui.root.findByProps({id:'enrollment-password'}).props.value,'short');
});
for(const phase of ['enroll','accept']) for(const code of ['AUTHENTICATION_FAILED','INVITATION_USED','INVITATION_EXPIRED','INVITATION_REVOKED']) {
  test(`Issue #152: ${phase} ${code} leaves no partial enrollment or retry form`,async t=>{
    const fail=async()=>{throw new ApiError('Denied',401,code);};let success=false;
    const ui=await mount(t,component(client(phase==='enroll'?{enroll:fail}:{acceptEnrollment:fail}),{onEnrolled(){success=true;}}));
    await password(ui);await submit(ui);
    if(phase==='accept'){await field(ui,'enrollment-code','123456');await submit(ui);}
    assert.match(text(ui),new RegExp(code));assert.match(text(ui),/used, expired or revoked/);
    assert.equal(ui.root.findAllByType('form').length,0);assert.equal(ui.root.findAllByType('input').length,0);
    assert.ok(!text(ui).includes(secret));assert.equal(success,false);
  });
}
test('Issue #152: malformed authenticator metadata fails closed without rendering a QR',async t=>{
  const ui=await mount(t,component(client({enroll:async()=>({...enrollment,uri:uri.replace(secret,'different')})})));
  await password(ui);await submit(ui);assert.match(text(ui),/AUTH_RESPONSE_INVALID/);
  assert.equal(ui.root.findAllByType('svg').filter(n=>n.props['aria-label']).length,0);
  assert.equal(ui.root.findAllByType('form').length,0);
});
for(const bad of [uri.replace('otpauth:','https:'),uri.replace('totp/','hotp/'),uri.replace('issuer=OpenSight','issuer=Other'),uri.replace('digits=6','digits=8'),uri+'#fragment','broken']) {
  test('Issue #152: authenticator URI validation rejects incompatible or mismatched parameters',()=>assert.throws(()=>authenticatorDetails(bad,secret),{errorCode:'AUTH_RESPONSE_INVALID'}));
}
test('Issue #152: duplicate submits are suppressed and unmount aborts secret-bearing requests',async t=>{
  let finish,calls=0,signal,completed=false;
  const ui=await mount(t,component(client({enroll:(_token,_password,s)=>{calls++;signal=s;return new Promise(resolve=>{finish=resolve;});}}),{onEnrolled(){completed=true;}}));
  await password(ui);let pending;
  await act(()=>{pending=ui.root.findByType('form').props.onSubmit({preventDefault(){}});});
  await submit(ui);assert.equal(calls,1);assert.equal(button(ui,'Setting up…').props.disabled,true);
  await act(()=>ui.unmount());assert.equal(signal.aborted,true);
  await act(async()=>{finish(enrollment);await pending;});assert.equal(completed,false);
});
test('Issue #152: lost enrollment response resumes with the same password; transport diagnostics are not shown',async t=>{
  const attempts=[];const ui=await mount(t,component(client({enroll:async(_token,pass)=>{attempts.push(pass);if(attempts.length===1)throw new Error('private connection details');return enrollment;}})));
  const pass=await password(ui);await submit(ui);assert.match(text(ui),/same password/);assert.doesNotMatch(text(ui),/private connection details/);
  await submit(ui);assert.deepEqual(attempts,[pass,pass]);assert.equal(ui.root.findByProps({id:'enrollment-secret'}).props.value,secret);
});
function Gate({api,invitation=token(),onCleared=()=>{}}) {
  const [pending,setPending]=useState(invitation);
  return createElement(SessionGate,{client:api,offline:false,invitation:pending?{token:pending,onAccepted(){onCleared();setPending(undefined);}}:undefined},createElement('output',null,'Workspace'));
}
function gatedClient(overrides={}) {return {...client(),getSession:async()=>{throw new ApiError('Sign in',401,'AUTHENTICATION_FAILED');},...overrides};}
test('Issue #152: enrollment clears invitation, carries email/password into sign-in and requires a fresh code before opening workspace',async t=>{
  let cleared=false,login;
  const ui=await mount(t,createElement(Gate,{onCleared(){cleared=true;},api:gatedClient({login:async(input)=>{login=input;return {session:identity,expiresAt:Date.now()+60000};}})}));
  const pass=await password(ui);await submit(ui);await field(ui,'enrollment-code','123456');await submit(ui);
  assert.equal(cleared,true);assert.equal(ui.root.findByProps({id:'signin-email'}).props.value,email);
  assert.equal(ui.root.findByProps({id:'signin-password'}).props.value,pass);assert.equal(login,undefined);
  await submit(ui);assert.match(text(ui),/Wait for a fresh code/);assert.equal(ui.root.findByProps({id:'signin-code'}).props.value,'');
  await field(ui,'signin-code','234567');await submit(ui);
  assert.deepEqual(login,{email,password:pass,code:'234567'});assert.match(text(ui),/Workspace/);
});
for(const mode of ['server-already-enrolled','sign-in-link','signed-in']) {
  test(`Issue #152: ${mode} preserves invitation through sign-in and uses session acceptance`,async t=>{
    const invitation=token();let accepted,cleared=false;
    const api=gatedClient({enroll:async()=>({enrollmentRequired:false}),login:async()=>({session:identity,expiresAt:Date.now()+60000}),acceptInvitation:async value=>{accepted=value;return {accepted:true};},...(mode==='signed-in'?{getSession:async()=>identity}:{})});
    const ui=await mount(t,createElement(Gate,{api,invitation,onCleared(){cleared=true;}}));
    if(mode!=='signed-in') {
      if(mode==='server-already-enrolled'){await password(ui);await submit(ui);}else await act(()=>button(ui,'Already have an account? Sign in').props.onClick());
      assert.equal(cleared,false);assert.equal(ui.root.findByProps({id:'signin-password'}).props.value,'');
      await field(ui,'signin-email',email);await field(ui,'signin-password',randomBytes(24).toString('base64'));await submit(ui);
      await field(ui,'signin-code','123456');await submit(ui);
    }
    assert.equal(cleared,false);await act(async()=>button(ui,'Accept invitation').props.onClick());
    assert.equal(accepted,invitation);assert.equal(cleared,true);assert.match(text(ui),/Workspace/);
  });
}
test('Issue #152: hash router supports hosted and legacy tokens, rejects extra URL data',()=>{
  for(const value of [token(),randomBytes(32).toString('hex')]) {
    assert.equal(invitationToken(`#invite=${value}`),value);
    assert.equal(invitationToken(`#invite=${value}&email=forged`),undefined);
  }
  for(const hash of ['', '#invite=', '#invite=wrong','#invite=%3Cscript%3E']) assert.equal(invitationToken(hash),undefined);
});
