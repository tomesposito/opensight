import test from 'node:test';
import assert from 'node:assert/strict';
import { metricLocal, metricHosted } from './metric-helpers.mjs';
import { upload } from './source-helpers.mjs';
const def = { name: 'Net sales', expression: 'sum({revenue})', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: 'Governed sales', synonyms: ['turnover'] };
const at = n => ({ 'If-Match': `"${n}"` });
const good = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const error = (r, status, code) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.errorCode, code); };

test('metric routes: approval, restart, exact history/export, current publication and retry', async t => {
  const f = await metricLocal(t), dataset = { kind: 'dataset', id: 'sales' };
  const create = { method: 'POST', body: { id: 'net', dataset, definition: def }, headers: { 'Idempotency-Key': 'create' } };
  good(await f.request('/api/v1/metrics', create), 201);
  assert.equal((await f.request('/api/v1/metrics', create)).headers['idempotent-replayed'], 'true');
  error(await f.request('/api/v1/metrics/net/publish', { method: 'POST', body: {}, headers: at(1) }), 403, 'METRIC_PUBLISH_FORBIDDEN');
  assert.deepEqual(good(await f.request('/api/v1/metrics', { user: 'reader' })).items, []);
  good(await f.request('/api/v1/metrics/net/publish', { user: 'admin', method: 'POST', body: {}, headers: at(1) }));
  good(await f.request('/api/v1/metrics/net', { user: 'admin', method: 'PUT', body: { definition: { ...def, expression: 'sum({profit})' } }, headers: at(2) }));
  const reader = good(await f.request('/api/v1/metrics/net', { user: 'reader' }));
  assert.equal(reader.definition.expression, def.expression); assert.equal(reader.published.version, 2);
  error(await f.request('/api/v1/metrics/net/versions', { user: 'reader' }), 403, 'METRIC_HISTORY_FORBIDDEN');
  good(await f.request('/api/v1/metrics/net/publish', { user: 'admin', method: 'POST', body: {}, headers: at(3) }));
  await f.restart();
  const exported = good(await f.request('/api/v1/metrics/net/export', { user: 'admin' }));
  assert.equal(exported.versions.length, 4); assert.equal(exported.audit.length, 4); assert.deepEqual(exported.dataset, dataset);
  assert.equal(good(await f.request('/api/v1/metrics/net/versions', { user: 'admin', headers: { Limit: '2' } })).items.length, 2);
  assert.equal(good(await f.request('/api/v1/datasets/sales/metrics', { headers: { 'Metric-Dataset': JSON.stringify(dataset) } })).items[0].published.expression, 'sum({profit})');
});

test('metric routes: invalid datasets, fields, conflicts, forged authority and stale edits', async t => {
  const f = await metricLocal(t), dataset = { kind: 'dataset', id: 'sales' };
  const create = definition => ({ method: 'POST', body: { id: 'net', dataset, definition } });
  error(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'net', dataset: { kind: 'dataset', id: 'missing' }, definition: def } }), 404, 'METRIC_DATASET_NOT_FOUND');
  error(await f.request('/api/v1/metrics', create({ ...def, expression: 'sum({not_real})' })), 422, 'METRIC_UNKNOWN_FIELD');
  error(await f.request('/api/v1/metrics', { ...create(def), body: { ...create(def).body, role: 'administrator' } }), 400, 'METADATA_INVALID');
  error(await f.request('/api/v1/metrics', { ...create(def), user: 'reader' }), 403, 'METADATA_WRITE_FORBIDDEN');
  good(await f.request('/api/v1/metrics', create(def)), 201);
  error(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'second', dataset, definition: { ...def, name: 'NET SALES' } } }), 409, 'METRIC_NAME_CONFLICT');
  error(await f.request('/api/v1/metrics/net', { method: 'PUT', body: { definition: def } }), 428, 'V1_IF_MATCH_REQUIRED');
  error(await f.request('/api/v1/metrics/net', { method: 'PUT', body: { definition: def }, headers: at(0) }), 412, 'ASSET_PRECONDITION_FAILED');
  error(await f.request('/api/v1/metrics/net/publish', { method: 'POST', body: { publishedVersion: 1 }, headers: at(1) }), 400, 'METADATA_INVALID');
});

test('metric routes: hosted prepared schema and dataset owner publishing through existing durable assets', async t => {
  const f = await metricHosted(t);
  const source = good(await f.request('/api/uploads', { method: 'POST', body: upload() }), 201); await f.renew();
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } }));
  await f.renew();
  const dataset = { kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity.userId };
  good(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'amount', dataset, definition: { ...def, expression: 'sum({amount})' } } }), 201); await f.renew();
  good(await f.request('/api/v1/metrics/amount/publish', { method: 'POST', body: {}, headers: at(1) })); await f.renew();
  assert.equal((await f.metadata.get(await f.context(), { kind: 'metric', id: 'amount' })).body.publishedVersion, 2);
  error(await f.request('/api/v1/datasets/prepared', { method: 'DELETE', headers: at(1) }), 409, 'DATASET_DELETE_BLOCKED_BY_METRIC');
});
