import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiClient } from '../build/test/api-client.js';

const token = () => randomBytes(32).toString('hex');
const password = () => randomBytes(24).toString('base64');
const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // Synthetic base32 test vector.
const uri = `otpauth://totp/OpenSight%3Ainvited%40example.test?secret=${secret}&issuer=OpenSight&algorithm=SHA1&digits=6&period=30`;
test('Issue #152: enrollment auth requests omit cookies and bearer credentials and send secrets only in JSON', async () => {
  const calls = [], invitation = token(), pass = password();
  const client = createApiClient('/prefix/', async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/login')) return Response.json({token:randomBytes(32).toString('base64url'), tenantId:'workspace', expiresAt:Date.now()+60000});
    if (url.endsWith('/session')) return Response.json({id:'user', name:'User', namespaceId:'namespace', tenantId:'workspace', role:'reader'});
    return Response.json(url.endsWith('/enroll') ? {enrollmentRequired:true, secret, uri} : {accepted:true});
  });
  await client.login({email:'invited@example.test',password:pass,code:'123456'},false);
  const controller = new AbortController();
  assert.deepEqual(await client.enroll(invitation,pass,controller.signal), {enrollmentRequired:true,secret,uri});
  await client.acceptEnrollment(invitation,pass,'234567',controller.signal);
  for (const [index, route] of ['enroll','accept'].entries()) {
    const {url, options} = calls[index+2];
    assert.equal(url, `/prefix/api/auth/${route}`);
    assert.equal(options.method,'POST'); assert.equal(options.credentials,'omit');
    assert.equal(options.signal,controller.signal);
    assert.deepEqual(options.headers,{Accept:'application/json','Content-Type':'application/json'});
    assert.deepEqual(JSON.parse(options.body),{invitationToken:invitation,password:pass,...(route==='accept'?{code:'234567'}:{})});
  }
});
test('Issue #152: already-enrolled response contains no setup secret', async () => {
  const client=createApiClient('/',async()=>Response.json({enrollmentRequired:false,secret,uri}));
  assert.deepEqual(await client.enroll(token(),password()),{enrollmentRequired:false});
});
for (const response of [{}, {enrollmentRequired:true}, {enrollmentRequired:true,secret:'bad',uri}, {enrollmentRequired:'false'}]) {
  test('Issue #152: malformed enrollment fails closed',async()=>{
    const client=createApiClient('/',async()=>Response.json(response));
    await assert.rejects(client.enroll(token(),password()),{errorCode:'AUTH_RESPONSE_INVALID'});
  });
}
test('Issue #152: acceptance must be explicitly acknowledged',async()=>{
  const client=createApiClient('/',async()=>Response.json({accepted:false}));
  await assert.rejects(client.acceptEnrollment(token(),password(),'123456'),{errorCode:'AUTH_RESPONSE_INVALID'});
});
for(const errorCode of ['PASSWORD_INVALID','AUTHENTICATION_FAILED','INVITATION_EXPIRED','INVITATION_REVOKED','INVITATION_USED']) {
  test(`Issue #152: ${errorCode} and server validation text survive enrollment client`,async()=>{
    const client=createApiClient('/',async()=>Response.json({errorCode,Message:'Server validation message'},{status:400}));
    await assert.rejects(client.enroll(token(),password()),{errorCode,status:400,message:'Server validation message'});
    await assert.rejects(client.acceptEnrollment(token(),password(),'123456'),{errorCode,status:400});
  });
}
