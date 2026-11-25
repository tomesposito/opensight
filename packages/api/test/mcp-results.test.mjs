import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpFixture, readScope } from './mcp-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { HostedDataRoutes } from '../dist/hosted-data-routes.js';
import { serverlessDataPath, serverlessResultPublisher } from '../dist/serverless-application.js';
import { mcpResultBytes } from '../dist/mcp/results.js';
import { budgetConfig } from './budget-helpers.mjs';
import { serving } from './v1-helpers.mjs';
import { migrateRuntime } from '../dist/runtime-migration.js';
import { migrateV1Durable } from '../dist/v1-durable-schema.js';
import { DurableV1 } from '../dist/v1-durable.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { EmbedContent } from '../dist/embed-content.js';

const descriptor = { operation: { id: 'synthetic-result', kind: 'result', state: 'completed', resultAvailable: true,
  result: { version: 1, byteLength: mcpResultBytes + 1, sha256: '0'.repeat(64), chunks: [{ index: 0, byteLength: mcpResultBytes, sha256: '0'.repeat(64) }] } } };
const assertSizeError = result => {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(result._meta.status, 413, JSON.stringify(result));
  assert.equal(result.structuredContent.errorCode, 'MCP_RESULT_TOO_LARGE');
  assert.match(result.structuredContent.message, /1 MiB.*Narrow the query/);
  assert.equal('rows' in result.structuredContent, false);
  assert.equal('operation' in result.structuredContent, false);
};

test('serverless MCP publication accepts exactly 1 MiB and rejects larger UTF-8 results before chunk storage', async () => {
  let stored = 0, authorized = 0, checked = 0;
  const publish = serverlessResultPublisher({ publish: async () => { stored++; return { status: 202, body: descriptor }; } }, async () => { authorized++; return { kind: 'author', id: 'synthetic', expiresAt: Date.now() + 60000 }; });
  const request = { headers: { authorization: 'Bearer mcp_a_synthetic' } };
  const body = { value: 'x'.repeat(mcpResultBytes - Buffer.byteLength(JSON.stringify({ value: '' }))) };
  assert.equal(Buffer.byteLength(JSON.stringify(body)), mcpResultBytes);
  assert.deepEqual(await publish(request, {}, 200, body, async () => { checked++; }), { status: 200, body });
  body.value += 'é';
  await assert.rejects(publish(request, {}, 200, body, async () => { checked++; }), { code: 'MCP_RESULT_TOO_LARGE', status: 413 });
  assert.equal(authorized, 1); assert.equal(checked, 1); assert.equal(stored, 0);
  await assert.rejects(publish(request, {}, 200, body, async () => { throw Error('ACCESS_REVOKED'); }), /ACCESS_REVOKED/);
  assert.equal(stored, 0);
  assert.equal((await publish({ headers: { authorization: 'Bearer browser-session' } }, {}, 200, body, async () => {})).status, 202);
  assert.equal(stored, 1);
});

test('OAuth MCP returns a named error for a real >1 MiB dashboard query through the hosted publisher and bridge', async t => {
  const testBudgets = { ...budgetConfig,
    node: { ...budgetConfig.node, resultBytes: 4 * mcpResultBytes }, defaults: { ...budgetConfig.defaults, resultBytes: 4 * mcpResultBytes }
  };
  const f = await mcpFixture(t, {}, { testBudgets });
  // JSON escaping makes this result exceed 1 MiB while its CSV upload remains
  // within the normal control-request limit.
  const csv = 'region,amount\n' + Array.from({ length: 600 }, (_, i) => `region_${i}_${'\\'.repeat(1000)},1\n`).join('');
  const source = await f.http('/api/uploads', { method: 'POST', token: f.token(), body: { ...upload(), base64: Buffer.from(csv).toString('base64') } });
  assert.equal(source.status, 201, JSON.stringify(source.body)); await f.renew();
  const prep = await f.http('/api/datasets/sales/prep', { method: 'PUT', token: f.token(), body: { name: 'Sales', expectedVersion: 0, pipeline: { version: 1, input: source.body.id, steps: [] } } });
  assert.equal(prep.status, 200, JSON.stringify(prep.body)); await f.renew();
  const measure = { numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'sales', columnName: 'amount' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } };
  const draft = await f.http('/api/v1/analyses', { method: 'POST', token: f.token(), body: {
    analysisId: 'large-result', name: 'Synthetic large result', datasetBindings: { sales: { kind: 'prepared-dataset', id: 'sales' } },
    definition: { dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:sales' }], calculatedFields: [], filterGroups: [], sheets: [{ sheetId: 'sheet', visuals: [
      { tableVisual: { visualId: 'large', chartConfiguration: { fieldWells: { tableAggregatedFieldWells: {
        groupBy: [{ categoricalDimensionField: { fieldId: 'region', column: { dataSetIdentifier: 'sales', columnName: 'region' } } }], values: [measure]
      } } } } },
      { kpiVisual: { visualId: 'small', chartConfiguration: { fieldWells: { values: [measure] } } } }
    ] }] }
  } });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const published = await f.http('/api/v1/analyses/large-result/publish', { method: 'POST', token: f.token(), body: {} });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const id = published.body.DashboardId, grant = await f.grant(readScope);
  const args = visualId => ({ id, version: 1, visualId, body: {} });
  let chunksPublished = 0; const sizes = [];
  // Use the production serverless publication policy; only external object storage
  // is replaced. Query execution, v1 authorization, OAuth, HTTP and MCP are real.
  const publish = serverlessResultPublisher({ publish: async (_context, body) => {
    chunksPublished++; assert.ok(Buffer.byteLength(JSON.stringify(body)) > mcpResultBytes);
    return { status: 202, body: descriptor };
  } }, request => f.auth.resultSession(request));
  await migrateRuntime(f.db, { OPENSIGHT_MAINTENANCE: 'frozen', OPENSIGHT_DEPLOYMENT: 'test',
    OPENSIGHT_NODE_LIMITS: JSON.stringify(testBudgets.node), OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(testBudgets.defaults) }, 'sqlite');
  await migrateV1Durable(f.db, 'test', 'sqlite');
  const hostedHttp = await serving(t, f, {}, { clock: f.clock, invocation: {
    signal: new AbortController().signal,
    compose: (metadata, budgets) => {
      const data = new HostedData(new HostedSources(metadata, f.config.encryptionKey.toString('base64'), []), undefined, budgets);
      return { data: new HostedDataRoutes(data, undefined, async (...params) => {
        sizes.push(Buffer.byteLength(JSON.stringify(params[3]))); return publish(...params);
      }), embedContent: new EmbedContent(data), allows: serverlessDataPath, capabilities: {},
      v1: context => new DurableV1(f.db, metadata, context, 'test', {}, 'sqlite'), route: async () => false, finish: async () => {} };
    }
  } });
  const hostedCall = async visualId => {
    const result = await hostedHttp('/api/mcp', { method: 'POST', token: grant.access_token,
      headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query_dashboard_visual', arguments: args(visualId) } } });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.result;
  };
  const small = await hostedCall('small');
  assert.equal(small.isError, undefined, JSON.stringify(small)); assert.equal(small.structuredContent.rows[0].value, 600);
  assertSizeError(await hostedCall('large'));
  assert.ok(sizes.at(-1) > mcpResultBytes); assert.equal(chunksPublished, 0);
  const path = `/api/v1/dashboards/${id}/versions/1/visuals/large/query`;
  const direct = await hostedHttp(path, { method: 'POST', token: grant.access_token, body: {} });
  assert.equal(direct.status, 413); assert.equal(direct.body.errorCode, 'MCP_RESULT_TOO_LARGE');
  const browser = await hostedHttp(path, { method: 'POST', token: f.token(), body: {} });
  assert.equal(browser.status, 202, JSON.stringify(browser.body)); assert.deepEqual(browser.body, descriptor); assert.equal(chunksPublished, 1);
  // An inline upstream response over the boundary is also refused by the bridge.
  assertSizeError(await f.call(grant.access_token, 'query_dashboard_visual', args('large')));
  // Defense in depth: an upstream descriptor must never become tool success.
  const fallback = t.mock.method(HostedDataRoutes.prototype, 'output', async () => ({ status: 202, body: descriptor }));
  assertSizeError(await hostedCall('small'));
  fallback.mock.mockImplementation(async () => ({ status: 200, body: { rows: [{ value: 'x'.repeat(2 * mcpResultBytes) }] } }));
  assertSizeError(await hostedCall('small'));
  const chunk = await hostedHttp('/api/operations/synthetic-result/result/0', { token: grant.access_token });
  assert.equal(chunk.status, 403); assert.equal(chunk.body.errorCode, 'MCP_SCOPE_REQUIRED');
});
