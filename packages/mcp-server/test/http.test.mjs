import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpHttp, mcpScopes, mcpRouteAllowed } from '../dist/http.js';
import { credentials, json } from './helpers.mjs';

const request = (message, headers = {}) => new Request('https://opensight.example/api/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(message)
});
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const options = { baseUrl: 'https://opensight.example/api/v1', credentials: credentials(), scopes: mcpScopes, fetch: async () => json({ items: [] }) };
test('Streamable HTTP initializes, lists the unchanged 58 tools, calls v1, and accepts notifications', async () => {
  const init = await handleMcpHttp(request(rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })), options);
  assert.equal(init.status, 200); assert.equal((await init.json()).result.protocolVersion, '2025-11-25');
  assert.equal(init.headers.has('mcp-session-id'), false);
  assert.equal((await (await handleMcpHttp(request(rpc('tools/list')), options)).json()).result.tools.length, 58);
  const call = await handleMcpHttp(request(rpc('tools/call', { name: 'list_datasets' })), options);
  assert.deepEqual((await call.json()).result.structuredContent, { items: [] });
  assert.equal((await handleMcpHttp(request({ jsonrpc: '2.0', method: 'notifications/initialized' }), options)).status, 202);
});
test('read scope hides and refuses writes and direct non-tool v1 routes', async () => {
  const read = { ...options, scopes: [mcpScopes[0]], fetch: async () => { throw Error('Must not dispatch a write'); } };
  const list = (await (await handleMcpHttp(request(rpc('tools/list')), read)).json()).result.tools;
  assert.ok(list.some(t => t.name === 'run_dataset_query')); assert.ok(list.some(t => t.name === 'ask_question'));
  for (const name of ['query_dashboard_visual', 'search_assets']) assert.ok(list.some(t => t.name === name));
  assert.ok(!list.some(t => t.name === 'create_analysis'));
  assert.ok(!list.some(t => t.name === 'create_dashboard_export'));
  const call = (await (await handleMcpHttp(request(rpc('tools/call', { name: 'create_analysis' })), read)).json()).result;
  assert.equal(call.isError, true); assert.equal(call.structuredContent.errorCode, 'MCP_SCOPE_REQUIRED');
  assert.equal(mcpRouteAllowed('POST', '/api/v1/datasets/sales/query', read.scopes), true);
  for (const path of ['/api/session', '/api/v1/../session', '/api/v1/analyses', '/api/v1/notebooks']) assert.equal(mcpRouteAllowed('POST', path, read.scopes), false);
  assert.equal(mcpRouteAllowed('POST', '/api/v1/analyses', mcpScopes), true);
});
test('HTTP validates protocol and media types, rejects batches and unsupported methods', async () => {
  for (const method of ['GET', 'DELETE']) assert.equal((await handleMcpHttp(new Request('https://opensight.example/api/mcp', { method }), options)).status, 405);
  assert.equal((await handleMcpHttp(request(rpc('tools/list'), { Accept: 'text/plain' }), options)).status, 406);
  assert.equal((await handleMcpHttp(request(rpc('tools/list'), { 'MCP-Protocol-Version': 'bad' }), options)).status, 400);
  assert.equal((await handleMcpHttp(request([rpc('tools/list')]), options)).status, 400);
});
