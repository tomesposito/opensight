import { request as httpRequest } from 'node:http';
import { database, environment } from './hosted-helpers.mjs';
import { seedSources } from './source-helpers.mjs';
import { createHostedApiServer, drainHostedServer } from '../dist/hosted-server.js';
import { StubMailTransport } from '../dist/mail.js';
export async function h8Fixture(t) {
  const f = await database(t), env = environment(); await seedSources(f.db);
  await f.db.transaction(async c => {
    for (const ns of ['one', 'two']) {
      await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'active')", [ns, `${ns}@example.test`]);
      await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,'admin','active')", [ns, `tenant-${ns}`, ns]);
    }
  });
  return { ...f, env };
}
export async function serveH8(t, f, extra = {}) {
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: f.env, mailTransport: new StubMailTransport(),
    security: { authenticate: async req => ['one', 'two'].includes(req.headers.authorization) ? { namespaceId: req.headers.authorization, userId: 'admin' } : undefined }, ...extra });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => drainHostedServer(server));
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ port, host: '127.0.0.1', path, method, headers: { host: 'opensight.example', ...headers,
      ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, body: res.headers['content-type']?.includes('json') ? JSON.parse(text) : text });
      });
    }); req.on('error', reject); req.end(bytes);
  });
  return { server, request, operator: { authorization: `Operator ${Buffer.from(f.env.OPENSIGHT_OPERATOR_KEY, 'base64').toString('base64url')}` } };
}
