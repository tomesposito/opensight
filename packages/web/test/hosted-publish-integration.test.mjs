import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixture } from '../../api/test/hosted-helpers.mjs';
import { serving } from '../../api/test/v1-helpers.mjs';
import { readerMember } from '../../api/test/embed-content-helpers.mjs';
import { TenantMetadata } from '../../api/dist/metadata.js';
import { upload } from '../../api/test/source-helpers.mjs';
import { createApiClient } from '../build/test/api-client.js';
import { hostedAnalysisInput, publishHostedDraft } from '../build/test/hosted-publish.js';
import { emptyDraft, authorReducer } from '../build/test/authoring.js';

test('editor client publishes real hosted assets, live controls, republish, reader grants and independent-data denial', async t => {
  const f = await authFixture(t), call = await serving(t, f), metadata = new TenantMetadata(f.db, f.db);
  const identity = await f.auth.verify((await f.login()).token);
  const reader = await readerMember({ ...f, metadata, identity, context: () => metadata.authenticate(null, async () => identity) });
  const apiFor = login => {
    let token;
    return createApiClient('/', async (path, options = {}) => {
      if (!token) token = (await login()).token;
      const send = () => call(path, { token, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined });
      let result = await send();
      if (result.status === 401) { token = (await login()).token; result = await send(); }
      return Response.json(result.body, { status: result.status, headers: result.headers });
    });
  };
  const api = apiFor(f.login), read = apiFor(reader.login);
  assert.deepEqual(await api.listDashboards(), []); assert.deepEqual(await read.listDashboards(), []);
  const source = await api.uploadFile(upload());
  await api.savePrep('orders', 'Orders', { version: 1, input: source.id, steps: [{ id: 'rename', kind: 'rename', config: { column: 'amount', name: 'revenue' } }] }, 0);
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  draft.title = 'Daily Orders'; draft.dataset = { id: 'orders', name: 'Orders', columns: [{ name: 'region', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }] };
  draft.sheets[0].visuals[0].dimension = 'region'; draft.sheets[0].visuals[0].measures = ['revenue'];
  draft.sheets[0].visuals[0].filters = [{ columnName: 'region', parameterName: 'Region', values: [] }];
  draft.parameters = [{ id: 'parameter-1', name: 'Region', type: 'string', multiple: false, values: ['east'], defaultValues: ['east'] }];
  draft.sheets[0].controls = [{ id: 'region', kind: 'dropdown', parameterId: 'parameter-1', label: 'Region', options: ['east', 'west'] }];
  let link = { analysisId: 'daily-orders' }; const persist = next => { link = next; };
  const published = await publishHostedDraft(api, hostedAnalysisInput(draft), link, persist);
  assert.deepEqual(published.Errors, []); assert.equal(published.Version, 1);
  const list = await api.listDashboards(); assert.equal(list.length, 1); assert.equal(list[0].name, 'Daily Orders');
  const definition = await api.getPublishedDashboard(published.DashboardId);
  assert.equal(definition.version, 1);
  const query = controls => api.queryDashboardVisual(published.DashboardId, 1, draft.sheets[0].visuals[0].id, controls);
  assert.deepEqual((await query({})).rows, [{ region: 'east', revenue: 40 }]);
  assert.deepEqual((await query({ region: ['west'] })).rows, [{ region: 'west', revenue: 20 }]);
  await assert.rejects(query({ arbitrary: ['west'] }), /DASHBOARD_UNDECLARED_CONTROL/);
  const second = await publishHostedDraft(api, hostedAnalysisInput({ ...draft, title: 'Daily Orders updated' }), link, persist);
  assert.equal(second.DashboardId, published.DashboardId); assert.equal(second.Version, 2);
  assert.deepEqual(await read.listDashboards(), []);
  await api.shareDashboard(published.DashboardId, reader.identity.userId);
  assert.equal((await read.listDashboards())[0].id, published.DashboardId);
  assert.equal((await read.getPublishedDashboard(published.DashboardId)).name, 'Daily Orders updated');
  await assert.rejects(read.queryDashboardVisual(published.DashboardId, 2, draft.sheets[0].visuals[0].id, {}), /DASHBOARD_DATASET_ACCESS_DENIED/);
  await assert.rejects(read.shareDashboard(published.DashboardId, identity.userId), /METADATA_WRITE_FORBIDDEN/);
});
