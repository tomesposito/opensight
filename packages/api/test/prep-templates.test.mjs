import test from 'node:test';
import assert from 'node:assert/strict';
import { metricLocal, metricHosted } from './metric-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { AssetCatalog } from '../dist/asset-model.js';
import { PrepTemplateCatalog, templateRecord, validateTemplateRecord } from '../dist/prep-template-model.js';
const good = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const error = (r, status, code) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.errorCode, code); };
const at = n => ({ 'If-Match': `"${n}"` });
for (const [label, fixture] of [['local', metricLocal], ['hosted', metricHosted]]) test(`recipe templates: ${label} propose, approve, explicit bindings, copy isolation, persistence`, async t => {
  const f = await fixture(t), renew = async () => { await f.renew?.(); };
  const source = good(await f.request('/api/uploads', { method: 'POST', body: label === 'hosted' ? upload() : { config: { format: 'csv' }, base64: upload().base64 } }), 201); await renew();
  const pipeline = { version: 1, input: source.id, steps: [{ id: 'calc', kind: 'calculate', config: { name: 'Doubled', expression: '{amount} * 2' } }] };
  good(await f.request('/api/datasets/recipe/prep', { method: 'PUT', body: { name: 'Recipe', pipeline, ...(label === 'hosted' ? { expectedVersion: 0 } : {}) } }), label === 'hosted' ? 200 : 201); await renew();
  const draft = good(await f.request('/api/v1/prep-templates', { method: 'POST', body: { id: 'recipe', datasetId: 'recipe', name: 'Double amounts' } }), 201); await renew();
  assert.equal(draft.state, 'draft'); assert.deepEqual(draft.slots, ['input']); assert.equal(draft.definition.pipeline.input, 'input'); assert.equal(JSON.stringify(draft).includes(source.id), false);
  error(await f.request('/api/v1/prep-templates/recipe/datasets', { method: 'POST', headers: at(1), body: { id: 'new', name: 'New', bindings: { input: source.id } } }), 409, 'TEMPLATE_NOT_PUBLISHED');
  if (label === 'local') {
    assert.deepEqual(good(await f.request('/api/v1/prep-templates', { user: 'peer' })).items, []);
    error(await f.request('/api/v1/prep-templates/recipe', { user: 'peer' }), 404, 'TEMPLATE_NOT_FOUND');
    error(await f.request('/api/v1/prep-templates', { user: 'reader', method: 'POST', body: { id: 'bad', datasetId: 'recipe', name: 'Bad' } }), 403, 'METADATA_WRITE_FORBIDDEN');
    error(await f.request('/api/v1/prep-templates', { user: 'peer', method: 'POST', body: { id: 'bad', datasetId: 'recipe', name: 'Bad' } }), 404, 'RESOURCE_NOT_FOUND');
  }
  good(await f.request('/api/v1/prep-templates/recipe/publish', { method: 'POST', headers: at(1), body: {} })); await renew();
  error(await f.request('/api/v1/prep-templates/recipe/datasets', { method: 'POST', headers: at(2), body: { id: 'unbound', name: 'New', bindings: {} } }), 422, 'TEMPLATE_INPUT_UNBOUND');
  error(await f.request('/api/v1/prep-templates/recipe/datasets', { method: 'POST', headers: at(2), body: { id: 'unbound', name: 'New', bindings: { input: 'absent' } } }), 422, 'TEMPLATE_BINDING_FAILED');
  const incompatibleBody = { ...(label === 'hosted' ? upload() : { config: { format: 'csv' } }), base64: Buffer.from('other\n1\n').toString('base64') };
  const incompatible = good(await f.request('/api/uploads', { method: 'POST', body: incompatibleBody }), 201); await renew();
  error(await f.request('/api/v1/prep-templates/recipe/datasets', { method: 'POST', headers: at(2), body: { id: 'wrong-fields', name: 'Wrong fields', bindings: { input: incompatible.id } } }), 422, 'TEMPLATE_BINDING_FAILED');
  const created = good(await f.request('/api/v1/prep-templates/recipe/datasets', { method: 'POST', headers: at(2), body: { id: 'new', name: 'New', bindings: { input: source.id } } }), 201); await renew();
  assert.deepEqual(created.resource.opensightPrep, pipeline);
  if (label === 'local') {
    error(await f.request('/api/v1/prep-templates/recipe/publish', { user: 'peer', method: 'POST', headers: at(2), body: {} }), 403, 'TEMPLATE_PUBLISH_FORBIDDEN');
    error(await f.request('/api/v1/prep-templates/recipe', { user: 'peer', method: 'PUT', headers: at(2), body: { definition: draft.definition } }), 403, 'TEMPLATE_EDIT_FORBIDDEN');
    error(await f.request('/api/v1/prep-templates/recipe/datasets', { user: 'peer', method: 'POST', headers: at(2), body: { id: 'foreign', name: 'Foreign', bindings: { input: source.id } } }), 422, 'TEMPLATE_BINDING_FAILED');
    error(await f.request('/api/v1/prep-templates/recipe/datasets', { method: 'POST', headers: at(2), body: { id: 'new', name: 'Overwrite', bindings: { input: source.id } } }), 409, 'TEMPLATE_DATASET_CONFLICT');
  }
  const changed = structuredClone(draft.definition); changed.pipeline.steps[0].config.expression = '{amount} * 3';
  good(await f.request('/api/v1/prep-templates/recipe', { method: 'PUT', headers: at(2), body: { definition: changed } })); await renew();
  good(await f.request('/api/v1/prep-templates/recipe/publish', { method: 'POST', headers: at(3), body: {} })); await renew();
  assert.deepEqual(good(await f.request('/api/datasets/new/prep')).resource.opensightPrep, pipeline);
  await f.restart();
  const history = good(await f.request('/api/v1/prep-templates/recipe/export'));
  assert.deepEqual(history.audit.map(a => a.action), ['propose', 'publish', 'edit', 'publish']); assert.equal(history.owner, draft.owner);
  assert.equal(good(await f.request('/api/v1/prep-templates/recipe/versions', { headers: { Limit: '2' } })).items.length, 2);
});

test('template model: branching, secondary slots, immutable versions, forged history and unknown fields', () => {
  const resources = [{ kind: 'user', id: 'owner', version: 1, body: { name: 'Owner', role: 'author' } }, { kind: 'prepared-dataset', id: 'recipe', ownerId: 'owner', version: 7, body: { resource: { opensightPrep: { version: 1, input: 'private-source', output: 'branch', steps: [
    { id: 'keep', kind: 'select', config: { columns: ['amount'] } },
    { id: 'append', kind: 'append', config: { source: 'other' } },
    { id: 'branch', kind: 'select', from: 'keep', config: { columns: ['amount'] } },
  ] } } } }];
  const c = new PrepTemplateCatalog(new AssetCatalog({ tenantId: 't', namespaceId: 'w', userId: 'owner' }, resources));
  const r = c.propose('t', 'recipe', 'Template'); c.publish('t', 1);
  const pipeline = c.bind('t', 2, { input: 'new-source', 'input-1': 'new-other' });
  assert.equal(pipeline.steps[1].config.source, 'new-other'); assert.equal(pipeline.steps[2].from, 'keep'); assert.equal(pipeline.output, 'branch');
  assert.throws(() => c.bind('t', 2, { input: 'new-source', extra: 'ignored' }), { code: 'TEMPLATE_INPUT_UNBOUND' });
  assert.throws(() => c.edit('t', 1, {}), { code: 'ASSET_PRECONDITION_FAILED' });
  assert.equal(validateTemplateRecord(r.body), r.body); const forged = structuredClone(r.body); forged.audit[0].action = 'publish'; assert.throws(() => validateTemplateRecord(forged), { code: 'TEMPLATE_INVALID_HISTORY' });
  const d = structuredClone(templateRecord(r).versions[0].definition); d.pipeline.input = 'private-source'; assert.throws(() => c.edit('t', 2, d), { code: 'TEMPLATE_INVALID_INPUT' });
});
