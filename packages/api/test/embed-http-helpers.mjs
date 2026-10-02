import { request as httpRequest } from 'node:http';
import { createHostedApiServer } from '../dist/hosted-server.js';
export function serverEnvironment(f, overrides = {}) {
  const c = f.hostedConfig;
  return { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'), OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'),
    OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds), OPENSIGHT_EMBEDDING_POLICY: JSON.stringify(f.policyInput),
    OPENSIGHT_EMBED_SESSION_KEY_ID: f.key.id, OPENSIGHT_EMBED_SESSION_KEY: f.key.secret.toString('base64'), ...overrides };
}
export async function httpStack(t, f) {
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, builtinAuth: f.auth, env: serverEnvironment(f), mailTransport: f.mail });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const call = (path, method = 'GET', body, authorization, extra = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { host: new URL(f.hostedConfig.origin).host,
      ...(authorization ? { authorization } : {}), ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }), ...extra } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, body: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text }); });
    }); req.on('error', reject); req.end(bytes);
  });
  return { server, call };
}
