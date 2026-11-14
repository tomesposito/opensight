import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, rebindInsight, InsightError } from '../build/test/insight-configuration.js';
import { insightNarrative } from '../build/test/insight-narrative.js';

const field = column => ({ id: column, column, dataSet: 'sales' });
const category = field('region'), measure = field('revenue');
const configuration = (body = {}) => ({ computations: [{ uniqueValues: { computationId: 'uv', ...body } }] });
const dimension = f => ({ categoricalDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet } } });
const value = f => ({ numericalMeasureField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const error = code => e => e instanceof InsightError && e.code === code;

test('unique-values normalization binds the category and needs no measure field', () => {
  const config = configuration({ name: 'Regions' }), before = structuredClone(config);
  assert.deepEqual(normalizeInsight(config, [category], [measure]), [{ kind: 'uniqueValues', id: 'uv', measure: 0 }]);
  assert.deepEqual(config, before);
  const bound = configuration({ category: dimension(category) });
  assert.deepEqual(normalizeInsight(bound, [category], [measure, field('profit')]), [{ kind: 'uniqueValues', id: 'uv', measure: 0 }]);
});

test('unique-values rejects malformed bodies and extra properties before wells projection', () => {
  for (const body of [null, [], 3, 'invalid', {}, { computationId: '' }, { computationId: 'bad id' }, { computationId: 'u', name: 1 }]) {
    assert.throws(() => insightWells({ computations: [{ uniqueValues: body }] }), error('INSIGHT_COMPUTATION_INVALID'));
  }
  for (const extra of [{ future: true }, { value: value(measure) }, { time: dimension(category) }, { resultSize: 3 }, { Category: dimension(category) }]) {
    assert.throws(() => insightWells(configuration(extra)), error('INSIGHT_CONFIGURATION_UNSUPPORTED'));
  }
});

test('unique-values projects only the category well, rejects unbound categories and rebinds cleanly', () => {
  const config = configuration({ category: dimension(category), name: 'Regions' });
  assert.deepEqual(insightWells(config), { category: [dimension(category)], values: [] });
  assert.throws(() => normalizeInsight(config, [field('country')], [measure]), error('INSIGHT_FIELD_UNBOUND'));
  const newCategory = field('country');
  const rebound = rebindInsight(config, [dimension(newCategory)], [value(measure)]);
  assert.deepEqual(insightWells(rebound), { category: [dimension(newCategory)], values: [] });
  assert.deepEqual(normalizeInsight(rebound, [newCategory], [measure]), [{ kind: 'uniqueValues', id: 'uv', measure: 0 }]);
});

const narrative = (rows, formatting) => insightNarrative(rows, { category, measures: [measure], computations: configuration(), formatting });
const rowsOf = entries => entries.map(([cat, n]) => ({ category: cat, values: [n] }));

test('unique-values lists distinct categories in deterministic typed order, independent of row order', () => {
  const rows = rowsOf([['West', 5], ['East', 10], ['Central', 1]]), before = structuredClone(rows);
  const result = narrative(rows);
  assert.equal(result.text, 'Unique region: Central; East; West.');
  assert.deepEqual(result.paragraphs[0].parts.filter(p => p.value !== undefined), []);
  assert.deepEqual(narrative(rows.toReversed()), result);
  assert.deepEqual(rows, before);
  // Measure values (including nulls) do not affect the list and are not disclosed as excluded groups.
  assert.equal(narrative(rowsOf([['West', null], ['East', 10]])).text, 'Unique region: East; West.');
});

test('unique-values shows a null category as (null), respects display names and treats markup as plain text', () => {
  // Typed order is the JSON-typed sort used for ranked ties: quoted strings precede null.
  assert.equal(narrative(rowsOf([[null, 1], ['East', 2]])).text, 'Unique region: East; (null).');
  assert.equal(narrative(rowsOf([['East', 2]]), { names: { region: 'Sales region' } }).text, 'Unique Sales region: East.');
  const markup = narrative(rowsOf([['<script>evil</script>', 1]]));
  assert.equal(markup.text, 'Unique region: <script>evil</script>.');
});

test('unique-values keeps the empty state for empty results and composes with other computations', () => {
  assert.deepEqual(narrative([]), { paragraphs: [], text: '' });
  const mixed = insightNarrative(rowsOf([['East', 3], ['West', 7]]), { category, measures: [measure], computations: { computations: [
    { totalAggregation: { computationId: 'total' } }, ...configuration().computations,
  ] } });
  assert.equal(mixed.text, 'Total revenue: 10.\n\nUnique region: East; West.');
});

test('unique-values executes with no Values measure at all (native category-only shape)', () => {
  assert.deepEqual(normalizeInsight(configuration(), [category], []), [{ kind: 'uniqueValues', id: 'uv', measure: 0 }]);
  const result = insightNarrative([{ category: 'West', values: [] }, { category: 'East', values: [] }], { category, measures: [], computations: configuration() });
  assert.equal(result.text, 'Unique region: East; West.');
  // Zero measures remain an error for every other computation kind.
  assert.throws(() => normalizeInsight({ computations: [{ totalAggregation: { computationId: 't' } }] }, [category], []), error('INSIGHT_VALUES_REQUIRED'));
  assert.throws(() => normalizeInsight({ computations: [{ uniqueValues: { computationId: 'u' } }, { totalAggregation: { computationId: 't' } }] }, [category], []), error('INSIGHT_VALUES_REQUIRED'));
});

test('unique-values fails closed on duplicate categories and invalid measure values', () => {
  assert.throws(() => narrative(rowsOf([['East', 1], ['East', 2]])), error('INSIGHT_CATEGORY_INVALID'));
  for (const n of [Infinity, NaN, '3']) assert.throws(() => narrative(rowsOf([['East', n]])), error('INSIGHT_VALUE_INVALID'));
});
