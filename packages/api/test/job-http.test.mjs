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
