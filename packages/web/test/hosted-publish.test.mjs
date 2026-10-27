import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../build/test/api-client.js';
import { emptyDraft } from '../build/test/authoring.js';
import { hostedAnalysisInput, saveHostedDraft, publishHostedDraft } from '../build/test/hosted-publish.js';

const draft = () => ({ ...emptyDraft(), title: 'Daily Orders', dataset: { id: 'orders', name: 'Orders', columns: [{ name: 'region', type: 'STRING' }] } });
test('hosted input binds selected prepared data and rejects implicit sample data', () => {
  assert.throws(() => hostedAnalysisInput(emptyDraft()), /HOSTED_DATASET_REQUIRED/);
  const input = hostedAnalysisInput(draft());
  assert.deepEqual(input.datasetBindings, { sales_data: { kind: 'prepared-dataset', id: 'orders' } });
  assert.equal(input.name, 'Daily Orders'); assert.equal('rows' in input, false);
});
test('create then revision-checked save then publish uses the v1 contract', async () => {
  const calls = [];
  const api = createApiClient('/', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    if (url.endsWith('/publish')) return Response.json({ DashboardId: 'published', Version: 1, Errors: [] }, { status: 201 });
    return Response.json({ AnalysisId: 'editor-draft' }, { status: 201, headers: { etag: calls.length === 1 ? '"1"' : '"2"' } });
  });
  let link = { analysisId: 'editor-draft' }; const persist = value => { link = value; };
  await saveHostedDraft(api, hostedAnalysisInput(draft()), link, persist);
  const result = await publishHostedDraft(api, hostedAnalysisInput(draft()), link, persist);
  assert.equal(calls[0].url, '/api/v1/analyses'); assert.equal(calls[0].body.analysisId, 'editor-draft');
  assert.equal(calls[1].method, 'PUT'); assert.equal(calls[1].headers['If-Match'], '"1"');
  assert.equal(calls[2].url, '/api/v1/analyses/editor-draft/publish'); assert.deepEqual(calls[2].body, {});
  assert.ok(calls[2].headers['Idempotency-Key']); assert.equal(result.Version, 1);
  assert.deepEqual(link, { analysisId: 'editor-draft', revision: 2, dashboardId: 'published' });
});
test('failed save never publishes; server error names survive', async () => {
  const api = createApiClient('/', async () => Response.json({ errorCode: 'METADATA_CONFLICT' }, { status: 409 }));
  let publishes = 0;
  await assert.rejects(publishHostedDraft({ ...api, publishAnalysis() { publishes++; } }, hostedAnalysisInput(draft()), { analysisId: 'a', revision: 1 }, () => {}), /METADATA_CONFLICT/);
  assert.equal(publishes, 0);
});
test('ambiguous publish retry reuses saved version and idempotency key; republish targets the same dashboard', async () => {
  let link = { analysisId: 'a' }, saves = 0, fail = true; const calls = [];
  const api = { async saveHostedAnalysis() { return ++saves; }, async publishAnalysis(...args) { calls.push(args); if (fail) throw new Error('connection lost'); return { DashboardId: 'd', Version: calls.length, Errors: [] }; } };
  const persist = value => { link = value; }, input = hostedAnalysisInput(draft());
  await assert.rejects(publishHostedDraft(api, input, link, persist), /connection lost/);
  await assert.rejects(saveHostedDraft(api, input, link, persist), /PUBLISH_PENDING/);
  fail = false; await publishHostedDraft(api, input, link, persist);
  assert.deepEqual(calls[0], calls[1]); assert.equal(saves, 1);
  await publishHostedDraft(api, input, link, persist); assert.equal(calls[2][1], 'd'); assert.equal(saves, 2);
});
test('invalid success receipt never becomes a publication', async () => {
  const api = createApiClient('/', async () => Response.json({}));
  await assert.rejects(api.publishAnalysis('a', undefined, 'retry'), /DASHBOARD_RESPONSE_INVALID/);
  await assert.rejects(api.saveHostedAnalysis('a', hostedAnalysisInput(draft())), /ANALYSIS_RESPONSE_INVALID/);
});
