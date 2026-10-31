import test from 'node:test';
import assert from 'node:assert/strict';
import { withGovernedMetrics, interpretQuestion } from '../dist/index.js';
const fields = [{ name: 'revenue', type: 'DECIMAL' }, { name: 'region', type: 'STRING' }];
const metric = { id: 'net', datasetId: 'sales', state: 'published', version: 4, name: 'Total sales', synonyms: ['turnover', 'total receipts'], defaultAggregation: 'AVG' };
test('Ask O selects governed metric names and synonyms with governed aggregation and explicit version grounding', () => {
  const schema = withGovernedMetrics(fields, 'sales', [metric]);
  for (const question of ['Total sales by region', 'turnover by region', 'total receipts by region']) {
    const result = interpretQuestion(question, schema);
    assert.deepEqual(result.errors, [], question); assert.equal(result.interpretations.length, 1);
    const i = result.interpretations[0]; assert.equal(i.measure, 'Total sales'); assert.equal(i.aggregation, 'AVG');
    assert.deepEqual(i.grounding.metricsUsed, [{ id: 'net', name: 'Total sales', version: 4 }]);
    if (question.startsWith('turnover')) assert.deepEqual(i.grounding.synonymsMatched, [{ term: 'turnover', field: 'Total sales' }]);
  }
  assert.ok(interpretQuestion('sum turnover', schema).errors.some(e => e.code === 'METRIC_AGGREGATION_OVERRIDE'));
});
test('Ask O excludes drafts and other datasets; metric grouping and ambiguous synonyms fail closed', () => {
  const schema = withGovernedMetrics(fields, 'sales', [{ ...metric, state: 'draft' }, { ...metric, datasetId: 'other', name: 'Foreign sales' }]);
  assert.equal(schema.length, fields.length);
  assert.equal(interpretQuestion('turnover', schema).interpretations.length, 0);
  const all = withGovernedMetrics(fields, 'sales', [metric, { ...metric, id: 'other', name: 'Other metric' }]);
  assert.ok(interpretQuestion('turnover', all).errors.some(e => e.code === 'AMBIGUOUS_QUESTION'));
  assert.equal(interpretQuestion('sum revenue by Total sales', all).interpretations.length, 0);
});
