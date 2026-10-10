export const runtimeEnv = () => ({ OPENSIGHT_RUNTIME: 'lambda', OPENSIGHT_MODE: 'hosted', OPENSIGHT_PUBLIC_ORIGIN: 'https://opensight.example',
  OPENSIGHT_INGRESS_DOMAIN: 'api.example.test', OPENSIGHT_INGRESS_API_ID: 'synthetic', OPENSIGHT_INGRESS_STAGE: '$default', OPENSIGHT_DEPLOYMENT: 'test',
  OPENSIGHT_INGRESS_KEYS: JSON.stringify([{ id: 'current', secret: 's'.repeat(43) }]) });
export const context = { getRemainingTimeInMillis: () => 28000 };
export function event(path = '/api/api/session', method = 'GET', body) {
  return { version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '', isBase64Encoded: false,
    headers: { host: 'api.example.test', 'x-opensight-ingress-key-id': 'current', 'x-opensight-ingress-secret': 's'.repeat(43), 'x-opensight-ingress-origin': 'https://opensight.example',
      'cloudfront-viewer-address': '192.0.2.1:443', 'x-forwarded-for': '192.0.2.1, 192.0.2.2', 'x-forwarded-proto': 'https', authorization: 'one', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    requestContext: { apiId: 'synthetic', stage: '$default', domainName: 'api.example.test', routeKey: '$default', timeEpoch: Date.now(),
      http: { method, path, sourceIp: '192.0.2.2' }, authorizer: { lambda: { version: '1', canonicalOrigin: 'https://opensight.example' } } } };
}
export function startupEvent() { const e = event('/api/api/startup', 'POST', {}); delete e.headers.authorization; return e; }
export const payload = result => JSON.parse(Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8').toString());
