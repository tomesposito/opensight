import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, InsightError } from '../build/test/insight-configuration.js';

// Issue #322: the projected Insight wells must deduplicate bindings by the
// same canonical semantics the native planner uses — field identity plus
// normalized defaults — not by raw JSON text.

const timeField = { id: 'date', column: 'date', dataSet: 'sales', dateGranularity: 'DAY' };
const measureField = { id: 'revenue', column: 'revenue', dataSet: 'sales' };
const dimension = (f, grain) => ({ dateDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, ...(grain === undefined ? {} : { dateGranularity: grain }) } });
const value = f => ({ numericalMeasureField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const error = code => e => e instanceof InsightError && e.code === code;

test('omitted date grain and explicit DAY are one dimension across computations (issue #322 example)', () => {
  const omitted = dimension(timeField);
  const explicit = dimension(timeField, 'DAY');
  const config = { computations: [
    { periodOverPeriod: { computationId: 'pop', time: omitted, value: value(measureField) } },
    { growthRate: { computationId: 'growth', time: explicit, value: value(measureField) } },
  ] };
  const wells = insightWells(config);
  assert.equal(wells.category.length, 1);
  assert.equal(wells.values.length, 1);
  // The first original definition is preserved unchanged for export.
  assert.equal(wells.category[0], omitted);
  // And the narrative compiler accepts the single derived dimension.
  const requests = normalizeInsight(config, [{ ...timeField, dateGranularity: 'DAY' }], [measureField]);
  assert.deepEqual(requests.map(r => r.kind), ['periodOverPeriod', 'growthRate']);
});

test('reordered JSON members do not defeat deduplication', () => {
  const a = { dateDimensionField: { fieldId: 'date', column: { columnName: 'date', dataSetIdentifier: 'sales' }, dateGranularity: 'DAY' } };
  const b = { dateDimensionField: { dateGranularity: 'DAY', column: { dataSetIdentifier: 'sales', columnName: 'date' }, fieldId: 'date' } };
  const config = { computations: [
    { periodOverPeriod: { computationId: 'pop', time: a, value: value(measureField) } },
    { growthRate: { computationId: 'growth', time: b, value: value(measureField) } },
  ] };
  assert.deepEqual(insightWells(config).category, [a]);
});

test('equivalent repeated measure bindings deduplicate regardless of member order', () => {
  const a = value(measureField);
  const b = { numericalMeasureField: { aggregationFunction: { simpleNumericalAggregation: 'SUM' }, column: { dataSetIdentifier: 'sales', columnName: 'revenue' }, fieldId: 'revenue' } };
  const config = { computations: [
    { periodOverPeriod: { computationId: 'pop', time: dimension(timeField, 'DAY'), value: a } },
    { growthRate: { computationId: 'growth', time: dimension(timeField, 'DAY'), value: b } },
  ] };
  assert.deepEqual(insightWells(config).values, [a]);
});

test('genuinely conflicting bindings for one fieldId fail closed', () => {
  const base = { periodOverPeriod: { computationId: 'pop', time: dimension(timeField, 'DAY'), value: value(measureField) } };
  for (const conflicting of [
    dimension(timeField, 'MONTH'), // different grain
    dimension({ ...timeField, column: 'invoice_date' }, 'DAY'), // different column
    dimension({ ...timeField, dataSet: 'other' }, 'DAY'), // different dataset
  ]) {
    const config = { computations: [base, { growthRate: { computationId: 'growth', time: conflicting, value: value(measureField) } }] };
    assert.throws(() => insightWells(config), error('INSIGHT_FIELD_UNBOUND'), JSON.stringify(conflicting));
  }
  // A measure fieldId rebound to a different column conflicts the same way.
  const config = { computations: [base, { growthRate: { computationId: 'growth', time: dimension(timeField, 'DAY'), value: value({ ...measureField, column: 'profit' }) } }] };
  assert.throws(() => insightWells(config), error('INSIGHT_FIELD_UNBOUND'));
});

test('distinct fields still project as distinct wells', () => {
  const config = { computations: [
    { metricComparison: { computationId: 'cmp', time: dimension(timeField, 'DAY'), fromValue: value(measureField), targetValue: value({ id: 'profit', column: 'profit', dataSet: 'sales' }) } },
  ] };
  const wells = insightWells(config);
  assert.equal(wells.category.length, 1);
  assert.equal(wells.values.length, 2);
});
