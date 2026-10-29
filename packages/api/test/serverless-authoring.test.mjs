import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { coordinationFixture } from './coordination-helpers.mjs';
import { migrateServerless } from '../dist/serverless-migration.js';
import { createRuntime } from '../dist/runtime.js';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { serverlessAdapters, serverlessDataPath } from '../dist/serverless-application.js';
import { InvocationAws } from '../dist/runtime-aws.js';
import { event, context, payload } from './runtime-helpers.mjs';
import { adaptGatewayRequest } from '../dist/runtime-ingress.js';
import { serverlessV1Methods } from '../dist/v1-route-contract.js';
import { runtimeEnv } from './runtime-helpers.mjs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createHash } from 'node:crypto';

const awsEnv = {
  AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic',
  OPENSIGHT_ARTIFACT_BUCKET: 'synthetic-test', OPENSIGHT_WORK_QUEUE_URL: 'https://sqs.us-east-1.api.aws/000000000000/work',
  OPENSIGHT_WORK_QUEUE_ARN: 'arn:aws:sqs:us-east-1:000000000000:work', OPENSIGHT_RECOVERY_QUEUE_URL: 'https://sqs.us-east-1.api.aws/000000000000/recover',
  OPENSIGHT_RECOVERY_QUEUE_ARN: 'arn:aws:sqs:us-east-1:000000000000:recover', OPENSIGHT_SCHEDULER_GROUP: 'synthetic',
  OPENSIGHT_SCHEDULER_ROLE_ARN: 'arn:aws:iam::000000000000:role/synthetic', OPENSIGHT_SCHEDULER_DLQ_ARN: 'arn:aws:sqs:us-east-1:000000000000:dlq',
};
const draft = id => ({ analysisId: id, name: 'Draft', definition: { dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 'sheet', visuals: [] }], calculatedFields: [], filterGroups: [] }, datasetBindings: {} });
async function fixture(t, overrides = {}) {
  const f = await coordinationFixture(t, { migrate: false });
  const env = { ...f.env, ...awsEnv, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements), ...overrides };
  await migrateServerless(f.db, env, 'sqlite'); await f.open();
  const queued = [];
  t.mock.method(SQSClient.prototype, 'send', async command => {
    assert.equal(command.constructor.name, 'SendMessageCommand'); queued.push(JSON.parse(command.input.MessageBody));
    return { MessageId: 'synthetic', MD5OfMessageBody: createHash('md5').update(command.input.MessageBody).digest('hex') };
  });
  t.mock.method(InvocationAws.prototype, 'secret', async () => assert.fail('request attempted to load SMTP credentials'));
  const queries = [];
  const db = { dialect: 'sqlite', durable: true, transaction: (work, scope) => f.db.transaction(c => work({ query: (sql, values) => { queries.push(sql); return c.query(sql, values); } }), scope), close: async () => {} };
  const runtime = createRuntime(() => env, { databases: () => ({ membership: db, tenant: db }), readiness: async () => {},
    application: (db, scope, env) => createHostedApiServer({ env, membershipDatabase: db.membership, tenantDatabase: db.tenant,
      security: { authenticate: async req => ['one', 'two'].includes(req.headers.authorization) ? { namespaceId: req.headers.authorization, userId: 'admin' } : undefined },
      invocation: { signal: scope.signal, compose: (metadata, budgets, auth, _meter, analytics) => serverlessAdapters(db.membership, metadata, budgets, new InvocationAws(scope, env), env, auth, analytics) } }) });
  const code = (await readFile(new URL('../../../ops/serverless/edge-viewer.js', import.meta.url), 'utf8'))
    .replaceAll('__OPENSIGHT_HOST__', JSON.stringify('opensight.example')).replaceAll('__OPENSIGHT_ORIGIN__', JSON.stringify('https://opensight.example'));
  const sandbox = vm.createContext({ Buffer }); vm.runInContext(code, sandbox);
  async function call(path, method = 'GET', body, headers = {}) {
    const e = event('/api' + path, method, body); Object.assign(e.headers, headers);
    const edge = sandbox.handler({ viewer: { ip: '192.0.2.1' }, request: { method, uri: e.rawPath, querystring: {}, headers: { host: { value: 'opensight.example' } } } });
    assert.equal(edge.statusCode, undefined, `edge rejected ${method} ${path}`);
    const result = await runtime.lambda(e, context); return { status: result.statusCode, headers: result.headers, body: payload(result) };
  }
  return { ...f, env, call, queries, queued };
}
test('D-86 generated edge, gateway and real invocation composition support save, publish, list, share and replay', async t => {
  const f = await fixture(t);
  const saved = await f.call('/api/v1/analyses', 'POST', draft('draft'), { 'idempotency-key': 'save' });
  assert.equal(saved.status, 201, JSON.stringify(saved.body)); assert.equal(saved.headers.etag, '"1"');
  const retry = await f.call('/api/v1/analyses', 'POST', draft('draft'), { 'idempotency-key': 'save' });
  assert.equal(retry.headers['idempotent-replayed'], 'true'); assert.deepEqual(retry.body, saved.body);
  const publish = () => f.call('/api/v1/analyses/draft/publish', 'POST', {}, { 'idempotency-key': 'publish' });
  const published = await publish(); assert.equal(published.status, 201, JSON.stringify(published.body));
  const again = await publish(); assert.equal(again.headers['idempotent-replayed'], 'true'); assert.deepEqual(again.body, published.body);
  const id = published.body.DashboardId, list = await f.call('/api/v1/dashboards'); assert.equal(list.body.items.length, 1); assert.equal(list.body.items[0].id, id);
  assert.equal((await f.call('/api/v1/dashboards', 'GET', undefined, { cursor: Buffer.from('{"offset":1}').toString('base64'), limit: '1' })).body.items.length, 0);
  const read = await f.call(`/api/v1/dashboards/${id}`); assert.equal(read.status, 200);
  const shared = await f.call(`/api/v1/dashboards/${id}/shares/user/other`, 'PUT', { role: 'viewer' }, { 'if-match': read.headers.etag, 'idempotency-key': 'share' });
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
  const sharedAgain = await f.call(`/api/v1/dashboards/${id}/shares/user/other`, 'PUT', { role: 'viewer' }, { 'if-match': read.headers.etag, 'idempotency-key': 'share' });
  assert.equal(sharedAgain.headers['idempotent-replayed'], 'true');
  assert.equal((await f.call(`/api/v1/dashboards/${id}`, 'GET', undefined, { authorization: 'two' })).status, 404);
  const deleted = await f.call('/api/v1/analyses/draft', 'DELETE', undefined, { 'if-match': '"1"', 'idempotency-key': 'delete' });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal((await f.call('/api/v1/analyses/draft', 'DELETE', undefined, { 'if-match': '"1"', 'idempotency-key': 'delete' })).headers['idempotent-replayed'], 'true');
  assert.equal((await f.call(`/api/v1/dashboards/${id}`)).status, 200);
  assert.ok(!f.queries.some(sql => /^CREATE|^ALTER/.test(sql)), 'invocations must not run migrations');
});
test('D-86 tenant invitations work through edge and Lambda and cannot cross tenant or role boundaries', async t => {
  const f = await fixture(t, { OPENSIGHT_WORKER_SMTP_CAPABILITY: 'configured' });
  const created = await f.call('/api/invitations', 'POST', { email: 'invited@example.test', name: 'Invited', role: 'reader' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const listed = await f.call('/api/invitations'); assert.equal(listed.status, 200);
  assert.equal((await f.call('/api/invitations', 'POST', { email: 'forged@example.test', name: 'Forged', role: 'reader', tenantId: 'tenant-two' })).status, 403);
  assert.deepEqual((await f.call('/api/invitations', 'GET', undefined, { authorization: 'two' })).body, []);
  assert.equal((await f.call(`/api/invitations/${created.body.invitation.id}`, 'DELETE', undefined, { authorization: 'two' })).status, 404);
  const revoked = await f.call(`/api/invitations/${created.body.invitation.id}`, 'DELETE'); assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(f.queued.length, 2); assert.ok(f.queued.every(e => Object.keys(e).sort().join() === 'deploymentEpoch,eventId,kind,version'));
});
test('D-86 concurrent publishes and revoked access cannot reuse a receipt unsafely', async t => {
  const f = await fixture(t); assert.equal((await f.call('/api/v1/analyses', 'POST', draft('draft'))).status, 201);
  const call = () => f.call('/api/v1/analyses/draft/publish', 'POST', {}, { 'idempotency-key': 'publish' });
  const results = await Promise.all([call(), call()]);
  assert.ok(results.some(r => r.status === 201)); assert.ok(results.every(r => r.status === 201 || r.status === 409));
  const replay = await call(); assert.equal(replay.status, 201); assert.equal(replay.headers['idempotent-replayed'], 'true');
  assert.equal((await f.call('/api/v1/dashboards')).body.items.length, 1);
  await f.db.transaction(async c => {
    const row = (await c.query("SELECT body FROM h1_resources WHERE tenant_id = 'tenant-one' AND kind = 'user' AND resource_id = 'admin'"))[0];
    const body = JSON.parse(row.body); body.role = 'reader'; await c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND kind = 'user' AND resource_id = 'admin'", [JSON.stringify(body)]);
  });
  assert.equal((await call()).status, 403);
});
test('D-86 route and method grammar stays closed outside the tested authoring slice', () => {
  for (const path of ['/api/v1/analyses', '/api/v1/analyses/a', '/api/v1/analyses/a/publish', '/api/v1/dashboards', '/api/v1/dashboards/a/versions/1', '/api/v1/dashboards/a/versions/1/visuals/v/query', '/api/v1/dashboards/a/shares/user/u', '/api/v1/dashboards/a/exports']) {
    assert.equal(serverlessDataPath(path), true);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      if (serverlessV1Methods(path).includes(method)) assert.equal(adaptGatewayRequest(event('/api' + path, method), runtimeEnv()).path, path);
      else assert.throws(() => adaptGatewayRequest(event('/api' + path, method), runtimeEnv()));
    }
  }
  for (const path of ['/api/v1/datasets', '/api/v1/sources', '/api/v1/assets', '/api/v1/folders', '/api/v1/analyses/a/unknown', '/api/v1/dashboards/a/versions/0', '/api/v1/host/tenants']) {
    assert.equal(serverlessDataPath(path), false); assert.throws(() => adaptGatewayRequest(event('/api' + path), runtimeEnv()));
  }
  for (const [path, allowed] of [['/api/invitations', ['GET', 'POST']], ['/api/invitations/id', ['DELETE']]]) for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    if (allowed.includes(method)) assert.equal(adaptGatewayRequest(event('/api' + path, method), runtimeEnv()).path, path);
    else assert.throws(() => adaptGatewayRequest(event('/api' + path, method), runtimeEnv()));
  }
});
