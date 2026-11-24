import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { Validator } from '@cfworker/json-schema';
import { generateAnswer } from '../dist/o-generative.js';
const spec = load(readFileSync(new URL('../../../docs/api/openapi-v1.yaml', import.meta.url), 'utf8'));
function dereference(value) {
  if (Array.isArray(value)) return value.map(dereference);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) return dereference(value.$ref.slice(2).split('/').reduce((v, key) => v[key], spec));
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, dereference(v)]));
}

test('#329 ask_question contract validates the existing generative answer and named errors', async () => {
  const op = spec.paths['/ai/ask'].post;
  assert.equal(op.operationId, 'ask_question'); assert.deepEqual(op.tags, ['ai']);
  assert.equal(op.requestBody.required, true);
  const request = new Validator(dereference(op.requestBody.content['application/json'].schema));
  const body = { question: 'sum revenue by region', datasetId: 'sales' };
  assert.equal(request.validate(body).valid, true);
  assert.equal(request.validate({ ...body, question: 'x'.repeat(2000) }).valid, true);
  for (const invalid of [{ question: body.question }, { datasetId: 'sales' }, { ...body, question: '' }, { ...body, question: ' ' },
    { ...body, question: 'x'.repeat(2001) }, { ...body, datasetId: '../sales' }, { ...body, dashboardId: 'daily' }]) {
    assert.equal(request.validate(invalid).valid, false, JSON.stringify(invalid));
  }
  const answer = await generateAnswer(body, false, {
    securitySchema: async () => ({ columns: [{ name: 'region', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }], deniedColumns: [], datasetId: 'sales' }),
    metricLookup: async () => [], execute: async () => { assert.fail('Generation must not execute a query'); },
  }, async () => ({ text: JSON.stringify({ question: body.question }), commit: async () => {} }), async () => {});
  const response = new Validator(dereference(op.responses['200'].content['application/json'].schema));
  assert.equal(response.validate(answer).valid, true, JSON.stringify(response.validate(answer).errors));
  assert.deepEqual(Object.keys(answer).sort(), ['errors', 'interpretations', 'question']);
  assert.equal(response.validate({ ...answer, rows: [] }).valid, false);
  for (const [status, errorCode] of [[400, 'AI_FIELD_NAME_PII'], [403, 'SECURITY_AI_REQUIRED'], [404, 'RESOURCE_NOT_FOUND'],
    [429, 'AI_SPEND_CAP_EXCEEDED'], [503, 'AI_NOT_CONFIGURED']]) {
    const error = dereference(op.responses[status]);
    assert.ok(error.description.includes(errorCode) || status === 404);
    const validator = new Validator(error.content['application/json'].schema);
    assert.equal(validator.validate({ errorCode, message: 'Synthetic error' }).valid, true);
    assert.equal(validator.validate({ message: 'Missing code' }).valid, false);
  }
});
