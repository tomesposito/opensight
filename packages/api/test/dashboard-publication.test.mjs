import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { DashboardRoutes } from '../dist/dashboard-routes.js';

test('D-86 dashboard query and replay use authorized output publication; changed authority prevents publication', async () => {
  let allowed = true, publications = 0, queries = 0;
  const check = async () => { if (!allowed) throw Error('ACCESS_REVOKED'); };
  const record = { id: 'dashboard', latest: 1, versions: [{ version: 1, wireDefinition: {} }] };
  const backend = { authorize: check, get: async () => record, analyses: {
    scope: { tenantId: 'tenant', namespaceId: 'namespace', userId: 'reader' }, stamp: async () => 1, check,
  }, query: async () => { queries++; return { columns: [{ name: 'value', type: 'number' }], rows: [{ value: 42 }], bindings: {} }; } };
  const routes = new DashboardRoutes({ paging: () => ({ offset: 0, limit: 100 }),
    publishData: async (_request, response, status, body, recheck) => {
      assert.equal(status, 200); assert.deepEqual(body.rows, [{ value: 42 }]);
      await recheck(); publications++; response.body = { resultId: 'authorized-chunks' };
    } }, {});
  const call = async () => {
    const request = Readable.from([Buffer.from('{}')]); request.method = 'POST';
    request.headers = { 'content-type': 'application/json', 'idempotency-key': 'query' };
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    await routes.route(request, response, '/api/v1/dashboards/dashboard/versions/1/visuals/visual/query', backend);
    return response;
  };
  assert.deepEqual((await call()).body, { resultId: 'authorized-chunks' });
  const replay = await call(); assert.equal(replay.headers['Idempotent-Replayed'], 'true');
  assert.deepEqual(replay.body, { resultId: 'authorized-chunks' }); assert.equal(publications, 2); assert.equal(queries, 2);
  allowed = false; await assert.rejects(call, /ACCESS_REVOKED/); assert.equal(publications, 2);
});
