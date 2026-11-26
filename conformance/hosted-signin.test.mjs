import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApiClient } from '../packages/web/build/test/api-client.js';
import { authFixture } from '../packages/api/test/hosted-helpers.mjs';
import { createHostedApiServer } from '../packages/api/dist/hosted-server.js';

// Real durable SQLite + password verifier + TOTP. The adapter only supplies the
// trusted reverse-proxy Host; route bodies and authorization are the web client's.
test('Issue #282: browser client completes real hosted login, reload restore and server-side logout', async t => {
  const f = await authFixture(t);
  const env = {OPENSIGHT_PUBLIC_ORIGIN:f.config.origin, OPENSIGHT_AUTH_ISSUER:f.config.issuer, OPENSIGHT_AUTH_AUDIENCE:f.config.audience,
    OPENSIGHT_AUTH_KEY_ID:f.config.keyId, OPENSIGHT_AUTH_SIGNING_KEY:f.config.signingKey.toString('base64'),
    OPENSIGHT_AUTH_ENCRYPTION_KEY:f.config.encryptionKey.toString('base64'), OPENSIGHT_OPERATOR_KEY:f.config.operatorKey.toString('base64'),
    OPENSIGHT_SESSION_SECONDS:String(f.config.sessionSeconds), OPENSIGHT_INVITATION_SECONDS:String(f.config.invitationSeconds)};
  const server = await createHostedApiServer({membershipDatabase:f.db,tenantDatabase:f.db,security:{authenticate:f.auth.authenticate},builtinAuth:f.auth,env,clock:f.clock,mailTransport:f.mail});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  let bearer, cookie, issuedDeadline;
  const transport = async(path,options)=>new Promise((resolve,reject)=>{
    const headers = Object.fromEntries(new Headers(options.headers));
    assert.equal(headers.cookie,undefined,'page JavaScript never constructs the refresh cookie');
    if(path.endsWith('/login') || path.endsWith('/restore')) { assert.equal(options.credentials,'same-origin'); assert.equal(headers.authorization,undefined); }
    else if(headers.authorization) bearer=headers.authorization.slice(7);
    // The adapter models the browser's HttpOnly cookie jar, outside the client.
    if(options.credentials==='same-origin' && cookie) headers.cookie=cookie;
    const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method:options.method,signal:options.signal,
      headers:{...headers,Host:new URL(f.config.origin).host}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        if(options.credentials==='same-origin' && res.headers['set-cookie']) {
          const value=res.headers['set-cookie'][0];
          assert.match(value,/HttpOnly; SameSite=Lax; Secure/);
          cookie=value.includes('Max-Age=0;') ? undefined : value.split(';')[0];
        }
        const bytes=Buffer.concat(chunks);
        if(path.endsWith('/login') && res.statusCode===200) issuedDeadline=JSON.parse(bytes.toString()).expiresAt;
        resolve(new Response(bytes,{status:res.statusCode,headers:res.headers}));
      });
    });req.on('error',reject);req.end(options.body);
  });
  const client = createApiClient('/',transport);
  const login=()=>client.login({email:f.email,password:f.password,code:f.code()},false);
  await assert.rejects(client.getSession(),{errorCode:'AUTHENTICATION_FAILED'});
  const result=await login();
  assert.equal(result.session.tenantId,f.tenant.tenantId);
  assert.equal(result.session.role,'administrator');
  assert.ok(await f.auth.verify(bearer));
  const originalCookie=cookie, originalBearer=bearer;
  assert.ok(originalCookie); assert.ok(!originalCookie.includes(originalBearer));
  const reloaded=createApiClient('/',transport), restored=await reloaded.restoreSession();
  assert.equal(restored.session.tenantId,result.session.tenantId); assert.equal(restored.expiresAt,issuedDeadline);
  assert.notEqual(cookie,originalCookie); assert.notEqual(bearer,originalBearer);
  assert.ok(await f.auth.verify(bearer));
  await reloaded.logout(); assert.equal(cookie,undefined);
  await assert.rejects(f.auth.verify(bearer),{code:'AUTHENTICATION_FAILED'});
  await assert.rejects(reloaded.getSession(),{errorCode:'AUTHENTICATION_FAILED'});
  await assert.rejects(reloaded.restoreSession(),{errorCode:'AUTHENTICATION_FAILED'});
  f.advance();
  await f.provisioning.removeMember(f.tenant.tenantId, result.session.id);
  await assert.rejects(login(),{errorCode:'AUTHENTICATION_FAILED'});
});
