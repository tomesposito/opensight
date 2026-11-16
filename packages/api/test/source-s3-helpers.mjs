import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { sourceFixture } from './source-helpers.mjs';
export const config = { regionEnv: 'S3_REGION', accessKeyIdEnv: 'S3_ACCESS_KEY_ID', secretAccessKeyEnv: 'S3_SECRET_ACCESS_KEY', bucket: 'example-bucket', key: 'data/sales.csv', prefix: 'data/' };
export const s3Environment = () => ({ S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: randomBytes(12).toString('hex'), S3_SECRET_ACCESS_KEY: randomBytes(24).toString('hex') });
export const registration = () => ({ connectorId: 's3', config, fileConfig: { format: 'csv' }, expiresAt: '2099-01-01T00:00:00.000Z', policy: { rowLevel: false, rowRules: [] } });
export async function fixture(t) {
  const f = await sourceFixture(t), environment = s3Environment();
  f.s3 = { configs: [config], environment };
  f.sources = new HostedSources(f.metadata, f.key, f.endpoints, f.clock, undefined, f.s3);
  return f;
}
export async function serving(t, f, environment = s3Environment()) {
  const c = f.config, env = { ...environment, OPENSIGHT_S3_SOURCES: JSON.stringify([config]), OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds) };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, env });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path, method = 'GET', body, token) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { Host: new URL(c.origin).host,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}) } }, res => {
      let data = ''; res.on('data', b => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }); req.on('error', reject); req.end(bytes);
  });
}
