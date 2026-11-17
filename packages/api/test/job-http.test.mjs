import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture } from './embed-session-helpers.mjs';
import { readerMember, seedEmbedContent } from './embed-content-helpers.mjs';
import { httpStack } from './embed-http-helpers.mjs';
import { schedule } from './job-helpers.mjs';

test('H7 hosted HTTP derives owners, rejects foreign recipients and requires reviewed operator deletion', async t => {
  const f = await sessionFixture(t), reader = await readerMember(f), data = await seedEmbedContent(f, reader); t.after(() => data.budgets.close());
  const { call } = await httpStack(t, f), auth = `Bearer ${(await f.login()).token}`, operator = `Operator ${f.hostedConfig.operatorKey.toString('base64url')}`;
  const spec = { kind: 'report', dashboardId: 'dashboard', recipients: [reader.identity.userId], enabled: true, schedule };
  for (const body of [{ expectedVersion: 0, spec, ownerId: reader.identity.userId }, { expectedVersion: 0, spec: { ...spec, tenantId: 'foreign' } }]) assert.equal((await call('/api/jobs/report', 'PUT', body, auth)).status, 400);
  const foreign = await call('/api/jobs/report', 'PUT', { expectedVersion: 0, spec: { ...spec, recipients: ['foreign'] } }, auth); assert.equal(foreign.body.errorCode, 'JOB_PRINCIPAL_UNAVAILABLE');
  const job = await call('/api/jobs/report', 'PUT', { expectedVersion: 0, spec }, auth); assert.equal(job.status, 200); assert.equal(job.body.ownerId, f.identity.userId);
  assert.equal((await call('/api/namespaces/foreign/jobs/report/runs', 'GET', undefined, auth)).status, 404);
  assert.equal((await call('/api/jobs/report', 'PUT', { expectedVersion: 0, spec }, auth)).body.errorCode, 'JOB_VERSION_CONFLICT');
  assert.equal((await call('/api/job-recipients', 'GET', undefined, auth)).body.length, 2);
  const path = `/api/host/tenants/${f.tenant.tenantId}/users/${f.identity.userId}`;
  assert.equal((await call(path, 'DELETE', {}, auth)).body.errorCode, 'OPERATOR_REQUIRED');
  assert.equal((await call(path, 'DELETE', {}, operator)).body.errorCode, 'JOB_DISPOSITION_REQUIRED');
  const preview = await call(path, 'GET', undefined, operator); assert.equal(preview.body.jobs.length, 1);
  assert.equal((await call(path, 'DELETE', { jobs: { action: 'stop', preview: preview.body.preview } }, operator, { origin: 'https://foreign.example' })).body.errorCode, 'UNTRUSTED_ORIGIN');
  assert.equal((await call(path, 'DELETE', { jobs: { action: 'stop', preview: preview.body.preview } }, operator, { origin: f.hostedConfig.origin })).status, 200);
  assert.equal((await call('/api/jobs/report/runs', 'GET', undefined, auth)).status, 401);
});
test('H7 delivery retry route restarts a dead delivery in place and refuses a second retry', async t => {
  const f = await sessionFixture(t), reader = await readerMember(f), data = await seedEmbedContent(f, reader); t.after(() => data.budgets.close());
  const { call } = await httpStack(t, f), auth = `Bearer ${(await f.login()).token}`;
  const spec = { kind: 'report', dashboardId: 'dashboard', recipients: [reader.identity.userId], enabled: true, schedule };
  assert.equal((await call('/api/jobs/report', 'PUT', { expectedVersion: 0, spec }, auth)).status, 200);
  const now = new Date().toISOString(), scope = [f.tenant.tenantId, f.identity.namespaceId];
  await f.db.transaction(async c => {
    await c.query(`INSERT INTO h7_occurrences VALUES (?,?,?,?,?,?,?,?,?,?,'failed','JOB_DELIVERY_EXHAUSTED',?,?)`,
      [...scope, 'retry-occ', 'report', f.identity.userId, f.identity.userId, 1, now, JSON.stringify(spec), JSON.stringify({ authorization: 1, policy: 1, configuration: 1 }), now, now]);
    await c.query(`INSERT INTO h7_deliveries (tenant_id, namespace_id, delivery_id, job_id, occurrence_id, recipient_id, state, attempts, next_attempt, error_code) VALUES (?,?, 'retry-delivery', 'report', 'retry-occ', ?, 'dead', 10, ?, 'SMTP_SEND_FAILED')`,
      [...scope, reader.identity.userId, now]);
  });
  const retried = await call('/api/jobs/report/deliveries/retry-delivery/retry', 'POST', {}, auth);
  assert.equal(retried.status, 200); assert.equal(retried.body.state, 'pending'); assert.equal(retried.body.attempts, 0); assert.equal(retried.body.delivery_id, 'retry-delivery');
  const again = await call('/api/jobs/report/deliveries/retry-delivery/retry', 'POST', {}, auth);
  assert.equal(again.status, 409); assert.equal(again.body.errorCode, 'DELIVERY_NOT_DEAD');
  const deliveries = await call('/api/jobs/report/deliveries', 'GET', undefined, auth);
  assert.equal(deliveries.body[0].state, 'pending');
  const runs = await call('/api/jobs/report/runs', 'GET', undefined, auth);
  assert.equal(runs.body[0].state, 'delivering');
});
