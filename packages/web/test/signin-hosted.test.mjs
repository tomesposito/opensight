import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApiClient } from '../build/test/api-client.js';
import { authFixture } from '../../api/test/hosted-helpers.mjs';
import { createHostedApiServer } from '../../api/dist/hosted-server.js';

// Real durable SQLite + password verifier + TOTP. The adapter only supplies the
// trusted reverse-proxy Host; route bodies and authorization are the web client's.
test('Issue #63: browser client completes real hosted login, session establishment and server-side logout', async t => {
  const f = await authFixture(t);
  const env = {OPENSIGHT_PUBLIC_ORIGIN:f.config.origin, OPENSIGHT_AUTH_ISSUER:f.config.issuer, OPENSIGHT_AUTH_AUDIENCE:f.config.audience,
    OPENSIGHT_AUTH_KEY_ID:f.config.keyId, OPENSIGHT_AUTH_SIGNING_KEY:f.config.signingKey.toString('base64'),
    OPENSIGHT_AUTH_ENCRYPTION_KEY:f.config.encryptionKey.toString('base64'), OPENSIGHT_OPERATOR_KEY:f.config.operatorKey.toString('base64'),
    OPENSIGHT_SESSION_SECONDS:String(f.config.sessionSeconds), OPENSIGHT_INVITATION_SECONDS:String(f.config.invitationSeconds)};
  const server = await createHostedApiServer({membershipDatabase:f.db,tenantDatabase:f.db,security:{authenticate:f.auth.authenticate},builtinAuth:f.auth,env,mailTransport:f.mail});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  let bearer;
  const client = createApiClient('/',async(path,options)=>new Promise((resolve,reject)=>{
    const headers = Object.fromEntries(new Headers(options.headers));
    if(path.endsWith('/login')) { assert.equal(options.credentials,'omit'); assert.equal(headers.authorization,undefined); assert.equal(headers.cookie,undefined); }
    else if(headers.authorization) bearer=headers.authorization.slice(7);
    const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method:options.method,signal:options.signal,
      headers:{...headers,Host:new URL(f.config.origin).host}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.end(options.body);
  }));
  const login=()=>client.login({email:f.email,password:f.password,code:f.code(),tenantId:f.tenant.tenantId},false);
  await assert.rejects(client.getSession(),{errorCode:'AUTHENTICATION_FAILED'});
  const result=await login();
  assert.equal(result.session.tenantId,f.tenant.tenantId);
  assert.equal(result.session.role,'administrator');
  assert.ok(await f.auth.verify(bearer));
  await client.logout();
  await assert.rejects(f.auth.verify(bearer),{code:'AUTHENTICATION_FAILED'});
  await assert.rejects(client.getSession(),{errorCode:'AUTHENTICATION_FAILED'});
  f.advance();
  await f.provisioning.removeMember(f.tenant.tenantId, result.session.id);
  await assert.rejects(login(),{errorCode:'AUTHENTICATION_FAILED'});
});
