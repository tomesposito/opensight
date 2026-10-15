import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { operations } from '../dist/generated.js';
import { handlers } from '../dist/dispatch.js';
import { descriptions } from '../dist/help.js';
import { execute, json } from './helpers.mjs';

const spec = load(readFileSync(new URL('../../../docs/api/openapi-v1.yaml', import.meta.url), 'utf8'));
const versioned = new Set(['describe_analysis', 'create_analysis', 'update_analysis', 'add_visual', 'update_visual', 'remove_visual', 'set_layouts', 'add_filter_group', 'update_filter_group', 'remove_filter_group', 'set_calculated_fields', 'publish_analysis', 'describe_dashboard', 'describe_dashboard_version', 'query_dashboard_visual', 'move_asset', 'copy_asset', 'get_asset_share', 'set_asset_share', 'delete_asset_share', 'describe_folder', 'rename_folder', 'get_folder_permissions', 'set_folder_permissions']);
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) return resolve(value.$ref.slice(2).split('/').reduce((v, k) => v[k], spec));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
}
function sample(schema) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf) return sample(schema.oneOf[0]);
  if (schema.anyOf) return sample(schema.anyOf[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (['integer', 'number'].includes(type)) return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  if (type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items));
  if (type === 'object') {
    const value = Object.fromEntries((schema.required ?? []).map(k => [k, sample(schema.properties[k])]));
    if (schema.minProperties && !Object.keys(value).length) value.tableVisual = sample(schema.additionalProperties);
    return value;
  }
  return 'sample';
}

test('SDK adapters and handwritten help cover exactly the generated operations', () => {
  const ids = operations.map(o => o.operationId).sort();
  assert.deepEqual(Object.keys(handlers).sort(), ids);
  assert.deepEqual(Object.keys(descriptions).sort(), ids);
});

for (const [path, item] of Object.entries(spec.paths)) for (const [method, raw] of Object.entries(item)) {
  if (!raw.operationId) continue;
  test(`${raw.operationId}: CLI → SDK → exact spec route, headers, body and result`, async () => {
    const op = operations.find(o => o.operationId === raw.operationId);
    const argv = [op.noun, op.command], expectedHeaders = { Authorization: 'Bearer synthetic-access-credential' };
    let expectedPath = path;
    for (const p of [...(item.parameters ?? []), ...(raw.parameters ?? [])].map(resolve)) {
      let value = sample(p.schema);
      if (p.in === 'path') {
        expectedPath = expectedPath.replace(`{${p.name}}`, encodeURIComponent(value));
        argv.push(...(p.name === 'id' ? [String(value)] : [`--${p.name}`, String(value)]));
      } else {
        value = p.name === 'If-Match' ? '"3"' : p.name === 'Limit' ? 7 : 'opaque-value';
        expectedHeaders[p.name] = String(value);
        argv.push(`--${{ Limit: 'limit', Cursor: 'cursor', 'If-Match': 'ifMatch', 'Idempotency-Key': 'idempotencyKey' }[p.name]}`, String(value));
      }
    }
    let expectedBody;
    if (raw.requestBody) {
      expectedBody = sample(resolve(raw.requestBody).content['application/json'].schema);
      argv.push(`--${raw.operationId === 'run_dataset_query' ? 'query' : 'body'}`, JSON.stringify(expectedBody));
      expectedHeaders['Content-Type'] = 'application/json';
    }
    const isExport = raw.operationId === 'create_dashboard_export';
    const result = { items: [{ id: 'example' }], nextCursor: 'next-page' };
    const output = await execute(argv, { fetch: async () => isExport
      ? new Response('a,b\n1,2\n', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="export.csv"', ETag: '"4"' } })
      : json(result, 200, { ETag: '"4"' }) });
    assert.equal(output.code, 0, output.stderr);
    assert.equal(output.stderr, versioned.has(raw.operationId) ? '{"etag":"\\\"4\\\""}\n' : '');
    assert.equal(output.calls.length, 1);
    const { url, init } = output.calls[0];
    assert.equal(String(url), `https://opensight.example/api/v1${expectedPath}`);
    assert.equal(init.method, method.toUpperCase());
    assert.deepEqual(init.headers, expectedHeaders);
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.body === undefined ? undefined : JSON.parse(init.body), expectedBody);
    assert.deepEqual(JSON.parse(output.stdout), isExport ? { base64: Buffer.from('a,b\n1,2\n').toString('base64'), contentType: 'text/csv', contentDisposition: 'attachment; filename="export.csv"', etag: '"4"' } : result);
  });
}

test('all resource and command help is available without credentials or transport', async () => {
  for (const argv of [[], ['--help'], ...[...new Set(operations.map(o => o.noun))].map(noun => [noun, '--help']), ...operations.map(o => [o.noun, o.command, '--help'])]) {
    const output = await execute(argv, { env: {} });
    assert.equal(output.code, 0, output.stderr);
    assert.match(output.stdout, /--format/);
    assert.match(output.stdout, /opensight/);
    assert.equal(output.stderr, '');
    assert.equal(output.calls.length + output.exchanges.length, 0);
  }
});
