import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { totp } from '../dist/auth-crypto.js';
import { decode32 } from './hosted-helpers.mjs';
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
  const source = good(await f.request('/api/uploads', { method: 'POST', body: upload() }), 201);
  await f.renew(); // Source creation also bumps policy, which must still invalidate H2 sessions.
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } }));
  const dataset = { kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity.userId };
  good(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'amount', dataset, definition: { ...def, expression: 'sum({amount})' } } }), 201);
  good(await f.request('/api/v1/metrics/amount/publish', { method: 'POST', body: {}, headers: at(1) }));
  assert.equal((await f.metadata.get(await f.context(), { kind: 'metric', id: 'amount' })).body.publishedVersion, 2);
  error(await f.request('/api/v1/datasets/prepared', { method: 'DELETE', headers: at(1) }), 409, 'DATASET_DELETE_BLOCKED_BY_METRIC');
});

test('metric routes: hosted author and reader sessions survive draft creation, unpublished edits and publication (#170)', async t => {
  const f = await metricHosted(t);
  const source = good(await f.request('/api/uploads', { method: 'POST', body: upload() }), 201);
  await f.renew(); // Source creation also bumps policy, before the metric-session regression begins.
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } }));
  const dataset = { kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity.userId };
  const email = 'reader@example.test', password = randomBytes(24).toString('base64');
  await f.provisioning.inviteMember('metric-reader', f.tenant.tenantId, { email, name: 'Reader', role: 'reader' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await f.auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret);
  const code = () => totp(secret, Math.floor(f.clock() / 30000));
  await f.auth.accept(invitation, password, code(), 'local'); f.advance();
  // Inviting changes authorization. Establish both sessions before any metric write;
  // neither token is renewed during the draft/save/publish and reload sequence.
  await f.renew();
  const readerToken = (await f.auth.login(email, password, code(), f.tenant.tenantId, 'local')).token; f.advance();
  assert.deepEqual(good(await f.request('/api/v1/metrics')).items, []);
  assert.deepEqual(good(await f.request('/api/v1/metrics', { token: readerToken })).items, []);
  const definition = { ...def, expression: 'sum({amount})' }, edited = { ...definition, expression: 'sum({amount}) * 2' };
  let revisions = await f.metadata.revisions(await f.context());
  const assertFreshness = async () => {
    const context = await f.context(), current = await f.metadata.revisions(context);
    assert.deepEqual(current, { ...revisions, configuration: revisions.configuration + 1 });
    await assert.rejects(f.metadata.assertRevisions(context, revisions), { code: 'METADATA_REVISED' });
    revisions = current;
  };
  const assertDraftReload = async (version, expected) => {
    const catalog = good(await f.request('/api/v1/metrics'));
    assert.equal(catalog.items.length, 1); assert.equal(catalog.items[0].version, version);
    const metric = good(await f.request('/api/v1/metrics/amount'));
    assert.equal(metric.version, version); assert.equal(metric.state, 'draft');
    assert.equal(metric.publishedVersion, null); assert.deepEqual(metric.definition, expected);
    assert.deepEqual(good(await f.request('/api/v1/metrics', { token: readerToken })).items, []);
    error(await f.request('/api/v1/metrics/amount', { token: readerToken }), 404, 'METRIC_NOT_FOUND');
    await assertFreshness();
  };
  good(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'amount', dataset, definition } }), 201);
  await assertDraftReload(1, definition);
  good(await f.request('/api/v1/metrics/amount', { method: 'PUT', body: { definition: edited }, headers: at(1) }));
  await assertDraftReload(2, edited);
  good(await f.request('/api/v1/metrics/amount/publish', { method: 'POST', body: {}, headers: at(2) }));
  assert.equal(good(await f.request('/api/v1/metrics')).items[0].publishedVersion, 3);
  assert.deepEqual(good(await f.request('/api/v1/metrics/amount')).definition, edited);
  const published = good(await f.request('/api/v1/metrics/amount', { token: readerToken }));
  assert.equal(published.publishedVersion, 3); assert.equal(published.state, 'published');
  assert.deepEqual(published.definition, edited); assert.deepEqual(published.permissions, { edit: false, publish: false });
  assert.equal(good(await f.request('/api/v1/metrics', { token: readerToken })).items[0].publishedVersion, 3);
  await assertFreshness();
});

test('metrics: analysis and frozen dashboard follow latest publication; drafts and request overrides never execute', async t => {
  const f = await metricLocal(t, false), dataset = { kind: 'dataset', id: 'sales' };
  const query = { dimensions: [], measures: [{ fieldId: 'value', columnName: '__metric_net', aggregation: 'SUM' }], filters: [] };
  const create = { method: 'POST', body: { id: 'net', dataset, definition: { ...def, expression: '{revenue}', defaultAggregation: 'AVG' } } };
  good(await f.request('/api/v1/metrics', create), 201);
  error(await f.request('/api/datasets/sales/query', { method: 'POST', body: query }), 422, 'METRIC_NOT_PUBLISHED');
  good(await f.request('/api/v1/metrics/net/publish', { method: 'POST', body: {}, headers: at(1) }));
  assert.equal(good(await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).rows[0].value, 900 / 7);
  error(await f.request('/api/datasets/sales/query', { method: 'POST', body: { ...query, calculatedFields: [{ name: '__metric_net', expression: '1' }] } }), 422, 'METRIC_OVERRIDE_FORBIDDEN');
  const definition = { dataSetIdentifierDeclarations: [{ identifier: 'data', dataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales' }], calculatedFields: [], sheets: [{ sheetId: 'sheet', name: 'Sheet', visuals: [{ kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: { values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'data', columnName: '__metric_net' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }] } } } }] }] };
  good(await f.request('/api/v1/analyses', { method: 'POST', body: { analysisId: 'governed', name: 'Governed', definition, datasetBindings: { data: dataset } } }), 201);
  const published = good(await f.request('/api/v1/analyses/governed/publish', { method: 'POST', body: {} }), 201);
  const path = `/api/v1/dashboards/${published.DashboardId}/versions/1/visuals/kpi/query`;
  assert.equal(good(await f.request(path, { method: 'POST', body: {} })).rows[0].value, 900 / 7);
  good(await f.request('/api/v1/metrics/net', { method: 'PUT', body: { definition: { ...def, name: 'Renamed revenue', expression: '{revenue} * 2' } }, headers: at(2) }));
  assert.equal(good(await f.request(path, { method: 'POST', body: {} })).rows[0].value, 900 / 7);
  good(await f.request('/api/v1/metrics/net/publish', { method: 'POST', body: {}, headers: at(3) }));
  assert.equal(good(await f.request(path, { method: 'POST', body: {} })).rows[0].value, 1800);
  assert.equal(good(await f.request(`/api/v1/dashboards/${published.DashboardId}/question`, { method: 'POST', body: { query } })).rows[0].value, 1800);
  assert.equal(good(await f.request(`/api/v1/dashboards/${published.DashboardId}`)).Metrics[0].name, 'Renamed revenue');
  assert.equal(good(await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).rows[0].value, 1800);
  assert.deepEqual(good(await f.request('/api/v1/analyses/governed')).Definition.CalculatedFields, []);
});


test('hosted metric consumers resolve analyses, dashboards, vocabulary and prep without parsing unrelated assets (#172)', async t => {
  const f = await metricHosted(t);
  const source = good(await f.request('/api/uploads', { method: 'POST', body: upload() }), 201);
  await f.renew();
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } }));
  const dataset = { kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity.userId };
  good(await f.request('/api/v1/metrics', { method: 'POST', body: { id: 'amount', dataset, definition: { ...def, expression: 'sum({amount})' } } }), 201);
  good(await f.request('/api/v1/metrics/amount/publish', { method: 'POST', body: {}, headers: at(1) }));
  const definition = { dataSetIdentifierDeclarations: [{ identifier: 'data', dataSetArn: 'urn:synthetic:prepared' }], calculatedFields: [], sheets: [{ sheetId: 'sheet', name: 'Sheet', visuals: [{ kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: { values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'data', columnName: '__metric_amount' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }] } } } }] }] };
  const body = { analysisId: 'governed', name: 'Governed', definition, datasetBindings: { data: { kind: 'prepared-dataset', id: 'prepared' } } };
  good(await f.request('/api/v1/analyses', { method: 'POST', body }), 201);
  const published = good(await f.request('/api/v1/analyses/governed/publish', { method: 'POST', body: {} }), 201);
  const context = await f.context();
  await f.db.transaction(c => c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [context.tenantId, context.namespaceId, 'analysis', '', 'unrelated-broken', 'not JSON', 1]));
  await assert.rejects(f.metadata.assetTransaction(context, false, () => null), SyntaxError);
  good(await f.request('/api/v1/analyses', { method: 'POST', body: { ...body, analysisId: 'another' } }), 201);
  const dashboard = `/api/v1/dashboards/${published.DashboardId}`;
  assert.equal(good(await f.request(dashboard)).Metrics[0].id, 'amount');
  const result = good(await f.request(`${dashboard}/versions/1/visuals/kpi/query`, { method: 'POST', body: {} }));
  assert.equal(result.rows[0].value, 60); assert.equal(result.metrics[0].version, 2);
  const query = { dimensions: [], measures: [{ fieldId: 'value', columnName: '__metric_amount', aggregation: 'SUM' }], filters: [] };
  assert.equal(good(await f.request('/api/datasets/prepared/query', { method: 'POST', body: query })).rows[0].value, 60);
  assert.equal(good(await f.request(`${dashboard}/question`, { method: 'POST', body: { query } })).rows[0].value, 60);
});

test('metric dataset catalog exposes real fields for editor drafts and preserves dataset ownership', async t => {
  const f = await metricLocal(t);
  const source = good(await f.request('/api/uploads', { method: 'POST', body: { config: { format: 'csv' }, base64: Buffer.from('amount\n2\n').toString('base64') } }), 201);
  good(await f.request('/api/datasets/prepared/prep', { method: 'PUT', body: { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] } } }), 201);
  const peerDatasets = good(await f.request('/api/v1/metric-datasets', { user: 'peer' })).items;
  const choice = peerDatasets.find(d => d.dataset.id === 'prepared');
  assert.equal(choice.owned, false); assert.equal(choice.canPublish, false);
  assert.ok(choice.columns.some(c => c.name === 'amount')); assert.equal(choice.dataset.ownerId, 'author');
  good(await f.request('/api/v1/metrics', { user: 'peer', method: 'POST', body: { id: 'amount', dataset: choice.dataset, definition: { ...def, expression: 'sum({amount})' } } }), 201);
  error(await f.request('/api/v1/metrics/amount/publish', { user: 'peer', method: 'POST', body: {}, headers: at(1) }), 403, 'METRIC_PUBLISH_FORBIDDEN');
  good(await f.request('/api/v1/metrics/amount/publish', { method: 'POST', body: {}, headers: at(1) }));
  assert.equal(good(await f.request('/api/v1/metric-datasets')).items.find(d => d.dataset.id === 'prepared').owned, true);
  error(await f.request('/api/v1/metric-datasets', { user: 'reader' }), 403, 'METADATA_WRITE_FORBIDDEN');
});
