import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { Validator } from '@cfworker/json-schema';
import { connect, call, json } from './helpers.mjs';
import { inventory } from '../scripts/generate.mjs';
const spec = load(readFileSync(new URL('../../../docs/api/openapi-v1.yaml', import.meta.url), 'utf8'));
const methods = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
const entries = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item).filter(([verb]) => methods.includes(verb)).map(([verb, op]) => ({ path, item, verb, op })));
function dereference(value) {
  if (Array.isArray(value)) return value.map(dereference);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) return dereference(value.$ref.slice(2).split('/').reduce((v, key) => v[key], spec));
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, dereference(v)]));
}
function sample(schema) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf) return sample(schema.oneOf[0]);
  if (schema.anyOf) return sample(schema.anyOf[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'integer' || type === 'number') return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  if (type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items));
  if (type === 'object') {
    const data = Object.fromEntries((schema.required ?? []).map(key => [key, sample(schema.properties[key])]));
    if (schema.minProperties && !Object.keys(data).length) data.tableVisual = sample(schema.additionalProperties);
    return data;
  }
  return 'sample';
}

test('tools/list exactly equals all OpenAPI operations, schemas and versions; no invented tools/resources/prompts', async t => {
  const client = await connect(t, { fetch: async () => { throw new Error('Discovery must not access data'); } });
  const { tools } = await client.listTools();
  assert.equal(entries.length, 53);
  assert.deepEqual(tools.map(tool => tool.name).sort(), entries.map(e => e.op.operationId).sort());
  assert.equal(new Set(tools.map(tool => tool.name)).size, entries.length);
  for (const e of entries) {
    const tool = tools.find(tool => tool.name === e.op.operationId);
    assert.match(tool.name, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    assert.ok(tool.description.includes(`${e.verb.toUpperCase()} /api/v1${e.path}`));
    assert.equal(tool.inputSchema.additionalProperties, false);
    if (e.op.requestBody) {
      const schema = dereference(e.op.requestBody).content['application/json'].schema;
      if (schema.maxProperties !== 0) assert.deepEqual(tool.inputSchema.properties[tool.name === 'run_dataset_query' ? 'query' : 'body'], schema);
    }
  }
  assert.deepEqual(client.getServerCapabilities(), { tools: {} });
  assert.equal(client.getServerVersion().version, spec.info.version);
  assert.ok(client.getInstructions().includes(spec.info.version));
  await assert.rejects(() => client.listResources());
  await assert.rejects(() => client.listPrompts());
  await assert.rejects(() => call(client, 'run_generative_query'), error => error.code === -32602);
});

for (const e of entries) test(`${e.op.operationId} maps only ${e.verb.toUpperCase()} ${e.path}, preserving headers/body/result`, async t => {
  const requests = [];
  const result = { items: [{ id: 'example' }], nextCursor: 'cursor-2' };
  const client = await connect(t, { fetch: async (url, init) => { requests.push({ url, init }); return json(result, 200, { ETag: '"4"', 'Idempotent-Replayed': 'true' }); } });
  const args = {}, headers = {}, params = [...(e.item.parameters ?? []), ...(e.op.parameters ?? [])].map(dereference);
  let path = e.path;
  for (const p of params) {
    if (p.in === 'path') { args[p.name] = sample(p.schema); path = path.replace(`{${p.name}}`, encodeURIComponent(String(args[p.name]))); }
    else {
      const name = { Limit: 'limit', Cursor: 'cursor', 'Idempotency-Key': 'idempotencyKey', 'If-Match': 'ifMatch' }[p.name];
      args[name] = p.name === 'If-Match' ? '"3"' : p.name === 'Limit' ? 7 : 'opaque-value';
      headers[p.name.toLowerCase()] = String(args[name]);
    }
  }
  let expectedBody;
  if (e.op.requestBody) {
    const schema = dereference(e.op.requestBody).content['application/json'].schema;
    expectedBody = sample(schema);
    if (schema.maxProperties !== 0) args[e.op.operationId === 'run_dataset_query' ? 'query' : 'body'] = expectedBody;
  }
  const tools = await client.listTools(), tool = tools.tools.find(t => t.name === e.op.operationId);
  assert.equal(new Validator(tool.inputSchema).validate(args).valid, true, 'mapping input must satisfy generated OpenAPI schema');
  const response = await call(client, e.op.operationId, args);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.href, `https://opensight.example/api/v1${path}`);
  assert.equal(requests[0].init.method, e.verb.toUpperCase());
  assert.deepEqual(requests[0].init.body === undefined ? undefined : JSON.parse(requests[0].init.body), expectedBody);
  assert.equal(requests[0].init.redirect, 'error');
  const actualHeaders = Object.fromEntries(requests[0].init.headers);
  assert.match(actualHeaders.authorization, /^Bearer /); delete actualHeaders.authorization;
  assert.deepEqual(actualHeaders, { accept: 'application/json', ...(expectedBody === undefined ? {} : { 'content-type': 'application/json' }), ...headers });
  assert.deepEqual(response.structuredContent, result);
  assert.deepEqual(JSON.parse(response.content[0].text), result);
  assert.equal(response._meta.headers['Idempotent-Replayed'], 'true');
  assert.equal(response._meta.headers.ETag, '"4"');
});

test('generator refuses missing/duplicate IDs, external references, unknown headers and body collisions', () => {
  for (const alter of [
    s => { delete s.paths['/analyses'].get.operationId; },
    s => { s.paths['/analyses'].get.operationId = s.paths['/analyses'].post.operationId; },
    s => { s.paths['/analyses'].get.parameters = [{ $ref: 'https://external.example/schema' }]; },
    s => { s.paths['/analyses'].get.parameters = [{ name: 'Authorization', in: 'header', schema: { type: 'string' } }]; },
    s => { s.paths['/analyses'].post.parameters = [{ name: 'body', in: 'path', schema: { type: 'string' } }]; },
  ]) { const changed = structuredClone(spec); alter(changed); assert.throws(() => inventory(changed)); }
});
