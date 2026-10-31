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

test('promotion action does not hide an existing metric with the same resource ID', async t => {
  const f = await metricLocal(t, false);
  const definition = { name: 'Action name metric', expression: '{revenue}', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] };
  good(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'promote-calc', dataset: { kind: 'dataset', id: 'sales' }, definition } }), 201);
  assert.equal(good(await f.request('/api/v1/metrics/promote-calc')).definition.name, definition.name);
  good(await f.request('/api/v1/metrics/promote-calc', { method: 'PUT', headers: { 'If-Match': '\"1\"' }, body: { definition: { ...definition, name: 'Renamed action' } } }));
});

test('legacy dataset promotion validates the stored source even when overridden and infers scalar defaults', async () => {
  const { AssetCatalog } = await import('../dist/asset-model.js');
  const { MetricCatalog, metricRecord } = await import('../dist/metric-model.js');
  const ref = { kind: 'dataset', id: 'legacy' }, schema = { columns: [{ name: 'amount', type: 'DECIMAL' }, { name: 'team', type: 'STRING' }] };
  const column = { ColumnId: 'calc', ColumnName: 'Team label', Expression: 'upper({team})' };
  const resources = [{ kind: 'user', id: 'editor', version: 1, body: { name: 'Editor', role: 'author' } }, { ...ref, version: 4, body: { definition: { DataSet: { LogicalTableMap: { table: { DataTransforms: [{ CreateColumnsOperation: { Columns: [column] } }] } } } }, sources: [] } }];
  const c = new MetricCatalog(new AssetCatalog({ tenantId: 't', namespaceId: 'w', userId: 'editor' }, resources));
  const calc = c.calculations(ref)[0]; assert.equal(calc.id, 'table/0/calc');
  const d = c.promotionDefinition(ref, calc.id, schema); assert.equal(d.defaultAggregation, 'COUNT');
  const r = c.promote('label', ref, calc.id, d, schema); assert.equal(metricRecord(r).provenance.datasetVersion, 4);
  assert.throws(() => c.promote('duplicate', ref, calc.id, { ...d, name: 'TEAM LABEL' }, schema), { code: 'METRIC_NAME_CONFLICT' });
  column.ColumnName = '{Team label}';
  const renamed = c.promotionDefinition(ref, calc.id, schema);
  assert.equal(renamed.name, '{Team label}');
  const promoted = c.promote('renamed', ref, calc.id, { ...renamed, name: 'Shared team count' }, schema);
  assert.equal(metricRecord(promoted).provenance.name, '{Team label}');
  column.Expression = '{missing}';
  assert.throws(() => c.promote('bad', ref, calc.id, { ...d, name: 'Override', expression: '{amount}' }, schema), { code: 'METRIC_UNKNOWN_FIELD' });
  column.Expression = '${AnalysisParameter}';
  assert.throws(() => c.promote('parameter', ref, calc.id, { ...d, name: 'Override', expression: '{amount}' }, schema), { code: 'METRIC_INVALID_EXPRESSION' });
  assert.equal(resources.filter(r => r.kind === 'metric').length, 2);
});
