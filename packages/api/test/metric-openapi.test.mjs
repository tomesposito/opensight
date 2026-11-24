import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { Validator } from '@cfworker/json-schema';
import { metricLocal } from './metric-helpers.mjs';

const spec = load(readFileSync(new URL('../../../docs/api/openapi-v1.yaml', import.meta.url), 'utf8'));
function dereference(value) {
  if (Array.isArray(value)) return value.map(dereference);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) return dereference(value.$ref.slice(2).split('/').reduce((v, key) => v[key], spec));
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, dereference(v)]));
}

test('metric read contract validates actual draft, published, reader and paginated history responses (#327)', async t => {
  const f = await metricLocal(t);
  const definition = { name: 'Sales', expression: 'sum({revenue})', defaultAggregation: 'SUM',
    format: { style: 'currency', decimalPlaces: 2, currency: 'USD' }, description: '', synonyms: ['turnover'] };
  const read = async (path, route, options) => {
    const response = await f.request(path, { user: 'admin', ...options });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const schema = dereference(spec.paths[route].get.responses['200'].content['application/json'].schema);
    const result = new Validator(schema).validate(response.body);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    return response.body;
  };
  assert.equal((await f.request('/api/v1/metrics', { method: 'POST', body: {
    id: 'sales', dataset: { kind: 'dataset', id: 'sales' }, definition,
  } })).status, 201);
  assert.equal((await read('/api/v1/metrics/sales', '/metrics/{id}')).published, null);
  assert.equal((await f.request('/api/v1/metrics/sales/publish', { user: 'admin', method: 'POST', body: {}, headers: { 'If-Match': '"1"' } })).status, 200);
  assert.equal((await f.request('/api/v1/metrics/sales', { user: 'admin', method: 'PUT', body: {
    definition: { ...definition, expression: 'sum({revenue}) * 2' },
  }, headers: { 'If-Match': '"2"' } })).status, 200);
  const author = await read('/api/v1/metrics/sales', '/metrics/{id}');
  assert.equal(author.version, 3); assert.equal(author.publishedVersion, 2);
  assert.equal(author.definition.expression, 'sum({revenue}) * 2');
  assert.equal(author.published.expression, definition.expression);
  const reader = await read('/api/v1/metrics/sales', '/metrics/{id}', { user: 'reader' });
  assert.equal(reader.state, 'published'); assert.deepEqual(reader.definition, definition);
  assert.deepEqual(reader.permissions, { edit: false, publish: false });
  assert.equal((await read('/api/v1/metrics', '/metrics', { headers: { Limit: '1' } })).items.length, 1);
  const first = await read('/api/v1/metrics/sales/versions', '/metrics/{id}/versions', { headers: { Limit: '2' } });
  assert.deepEqual(first.items.map(v => v.state), ['draft', 'published']);
  const last = await read('/api/v1/metrics/sales/versions', '/metrics/{id}/versions', { headers: { Cursor: first.nextCursor } });
  assert.deepEqual(last.items.map(v => v.version), [3]); assert.equal(last.nextCursor, null);
});
