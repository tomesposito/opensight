import test from 'node:test';
import assert from 'node:assert/strict';
import { upload } from './source-helpers.mjs';
import { metricLocal, metricHosted } from './metric-helpers.mjs';
const good = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const error = (r, status, code) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.errorCode, code); };
for (const [label, fixture] of [['local', metricLocal], ['hosted', metricHosted]]) test(`calc promotion: ${label} immutable source, draft approval, provenance and persistence`, async t => {
  const f = await fixture(t), renew = async () => { await f.renew?.(); };
  const source = good(await f.request('/api/uploads', { method: 'POST', body: label === 'hosted' ? upload() : { config: { format: 'csv' }, base64: upload().base64 } }), 201); await renew();
  const pipeline = { version: 1, input: source.id, steps: [{ id: 'double', kind: 'calculate', config: { name: 'Doubled', expression: '{amount} * 2' } }] };
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Prepared', pipeline, ...(label === 'hosted' ? { expectedVersion: 0 } : {}) } }), label === 'hosted' ? 200 : 201); await renew();
  const dataset = { kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity?.userId ?? 'author' };
  const options = good(await f.request('/api/v1/metric-datasets')).items.find(d => d.dataset.id === 'prepared');
  const definition = options.calculations[0].definition;
  assert.equal(definition.defaultAggregation, 'SUM'); assert.equal(definition.expression, '{amount} * 2');
  const body = { id: 'promoted', dataset, calculationId: 'double' };
  error(await f.request('/api/v1/metrics/promote-calc', { method: 'POST', body }), 409, 'METRIC_NAME_CONFLICT');
  const proposal = { method: 'POST', body: { ...body, definition: { ...definition, name: 'Double amount' } }, headers: { 'Idempotency-Key': 'promote' } };
  const draft = good(await f.request('/api/v1/metrics/promote-calc', proposal), 201); await renew();
  assert.equal(draft.state, 'draft'); assert.equal(draft.published, null); assert.equal(draft.provenance.calculationId, 'double');
  assert.equal((await f.request('/api/v1/metrics/promote-calc', proposal)).headers['idempotent-replayed'], 'true');
  assert.deepEqual(good(await f.request('/api/datasets/prepared/prep')).resource.opensightPrep, pipeline);
  good(await f.request('/api/v1/metrics/promoted/publish', { method: 'POST', body: {}, headers: { 'If-Match': '"1"' } })); await renew();
  const exported = good(await f.request('/api/v1/metrics/promoted/export'));
  assert.deepEqual(exported.audit.map(a => a.action), ['promote', 'publish']); assert.deepEqual(exported.dataset, dataset);
  assert.equal(exported.provenance.expression, '{amount} * 2');
  error(await f.request('/api/v1/metrics/promote-calc', { method: 'POST', body: { ...body, id: 'missing', calculationId: 'missing' } }), 404, 'METRIC_CALCULATION_NOT_FOUND');
  if (label === 'local') {
    error(await f.request('/api/v1/metrics/promote-calc', { ...proposal, user: 'reader', headers: {} }), 403, 'METADATA_WRITE_FORBIDDEN');
    const peer = good(await f.request('/api/v1/metrics/promote-calc', { user: 'peer', method: 'POST', body: { ...body, id: 'peer', definition: { ...definition, name: 'Peer amount' } } }), 201);
    error(await f.request('/api/v1/metrics/peer/publish', { user: 'peer', method: 'POST', body: {}, headers: { 'If-Match': '"1"' } }), 403, 'METRIC_PUBLISH_FORBIDDEN');
    assert.equal(peer.createdBy, 'peer'); assert.deepEqual(good(await f.request('/api/v1/metrics', { user: 'reader' })).items.map(m => m.id), ['promoted']);
  }
  await f.restart(); assert.equal(good(await f.request('/api/v1/metrics/promoted/export')).provenance.calculationId, 'double');
});
