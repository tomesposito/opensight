import test from 'node:test';
import assert from 'node:assert/strict';
import { metricHosted, metricLocal } from './metric-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { definition, digestInput } from './digest-helpers.mjs';
import { publicPath } from '../dist/runtime-ingress.js';
import { serverlessV1Methods } from '../dist/v1-route-contract.js';
import { serverlessDataPath } from '../dist/serverless-application.js';
const good = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
async function seed(t) {
  const f = await metricHosted(t);
  const source = good(await f.request('/api/uploads', { method: 'POST', body: { ...upload(), base64: Buffer.from('day,region,amount\n2026-10-26,east,10\n').toString('base64') } }), 201); await f.renew();
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } }));
  good(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'revenue', dataset: { kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity.userId }, definition } }), 201);
  good(await f.request('/api/v1/metrics/revenue/publish', { method: 'POST', body: {}, headers: { 'If-Match': '"1"' } }));
  return f;
}
test('digest HTTP routes create/list/preview/delete on the real hosted stack; no forged recipients or generic job writes', async t => {
  const f = await seed(t), base = '/api/v1/metrics/revenue/subscriptions';
  assert.equal((await f.request(base, { token: null })).status, 401);
  const sub = good(await f.request(base, { method: 'POST', body: digestInput }), 201);
  assert.equal(sub.subscriberId, f.identity.userId); assert.equal(sub.cadence, 'weekly');
  assert.deepEqual(good(await f.request(base)).items.map(s => s.id), [sub.id]);
  const preview = good(await f.request(`/api/v1/metric-subscriptions/${sub.id}/preview`)); assert.equal(preview.metric.id, 'revenue');
  assert.equal((await f.request(base, { method: 'POST', body: { ...digestInput, subscriberId: 'other' } })).status, 400);
  const rows = await f.db.transaction(c => c.query('SELECT spec FROM h7_jobs WHERE job_id = ?', [sub.id])); const spec = JSON.parse(rows[0].spec);
  const bypass = await f.request('/api/jobs/forged', { method: 'PUT', body: { expectedVersion: 0, spec } }); assert.equal(bypass.body.errorCode, 'DIGEST_SUBSCRIPTION_ROUTE_REQUIRED');
  good(await f.request(`/api/v1/metric-subscriptions/${sub.id}`, { method: 'DELETE' })); assert.deepEqual(good(await f.request(base)).items, []);
});
test('digest email unsubscribe works without a session and is scoped, idempotent and actually stops its job', async t => {
  const f = await seed(t), sub = good(await f.request('/api/v1/metrics/revenue/subscriptions', { method: 'POST', body: digestInput }), 201);
  const job = (await f.db.transaction(c => c.query('SELECT * FROM h7_jobs WHERE job_id = ?', [sub.id])))[0], token = JSON.parse(job.spec).unsubscribeToken;
  const path = `/api/v1/metric-unsubscribe/${job.tenant_id}/${job.namespace_id}/${sub.id}/${token}`;
  assert.equal((await f.request(path.replace(token, '0'.repeat(64)), { token: null })).status, 404);
  const reply = await f.request(path, { token: null }); assert.equal(reply.status, 200); assert.match(reply.body, /Unsubscribed/); assert.equal(reply.headers['referrer-policy'], 'no-referrer');
  assert.equal((await f.request(path, { token: null, method: 'POST' })).status, 200);
  assert.equal((await f.db.transaction(c => c.query('SELECT stopped FROM h7_jobs WHERE job_id = ?', [sub.id])))[0].stopped, 1);
});
test('digest routes are honest on local API and explicitly enabled on the serverless route contract', async t => {
  const f = await metricLocal(t);
  const reply = await f.request('/api/v1/metrics/revenue/subscriptions', { method: 'POST', body: digestInput }); assert.equal(reply.status, 503); assert.equal(reply.body.errorCode, 'HOSTED_API_REQUIRED');
  assert.deepEqual(serverlessV1Methods('/api/v1/metrics/revenue/subscriptions'), ['GET', 'POST']);
  assert.deepEqual(serverlessV1Methods('/api/v1/metric-subscriptions/sub/preview'), ['GET']);
  const internal = `/api/v1/metric-unsubscribe/t/n/sub/${'a'.repeat(64)}`;
  assert.equal(serverlessDataPath(internal), true); assert.equal(publicPath(`/api${internal}`), internal);
  assert.deepEqual(serverlessV1Methods(internal), ['GET', 'POST']);
});
