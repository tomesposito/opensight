import { request as httpRequest } from 'node:http';
import { createHostedApiServer } from '../dist/hosted-server.js';

export async function serving(t, f, envOverrides = {}) {
  const c = f.config, env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds),
    OPENSIGHT_SOURCE_ENDPOINTS: JSON.stringify([{ id: 'reference', host: 'localhost', port: 5433, database: 'opensight', tls: false }]), ...envOverrides };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, builtinAuth: f.auth, env });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path, { method = 'GET', body, token, headers = {}, rawBody } = {}) => new Promise((resolve, reject) => {
    const bytes = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { Host: new URL(c.origin).host,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, body: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text }); });
    }); req.on('error', reject); req.end(bytes);
  });
}
