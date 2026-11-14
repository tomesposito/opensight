import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, rebindInsight, InsightError } from '../build/test/insight-configuration.js';
import { insightNarrative } from '../build/test/insight-narrative.js';

const field = column => ({ id: column, column, dataSet: 'sales' });
const time = { ...field('date'), dateGranularity: 'DAY' }, measure = field('revenue');
const configuration = (grain, body = {}) => ({ computations: [{ periodToDate: { computationId: 'ptd', ...(grain === undefined ? {} : { periodTimeGranularity: grain }), ...body } }] });
const dimension = f => ({ dateDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, dateGranularity: f.dateGranularity } });
const value = f => ({ numericalMeasureField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const error = code => e => e instanceof InsightError && e.code === code;

test('period-to-date normalization resolves an explicit grain or the bound grain without mutation', () => {
  for (const grain of ['DAY', 'MONTH', 'QUARTER', 'YEAR']) {
    const config = configuration(grain, { name: 'Revenue to date' }), before = structuredClone(config);
    assert.deepEqual(normalizeInsight(config, [time], [measure]), [{ kind: 'periodToDate', id: 'ptd', measure: 0, periodTimeGranularity: grain }]);
    assert.deepEqual(config, before);
    assert.deepEqual(normalizeInsight(configuration(), [{ ...time, dateGranularity: grain }], [measure]), [{ kind: 'periodToDate', id: 'ptd', measure: 0, periodTimeGranularity: grain }]);
  }
});

test('period-to-date rejects malformed properties before wells projection and requires a date dimension', () => {
  for (const grain of [null, '', 'month', 'WEEK', 'HOUR', 1, [], {}]) {
    assert.throws(() => normalizeInsight(configuration(grain), [time], [measure]), error('INSIGHT_COMPUTATION_INVALID'));
    assert.throws(() => insightWells(configuration(grain)), error('INSIGHT_COMPUTATION_INVALID'));
  }
  for (const body of [null, [], 3, 'invalid', {}, { computationId: '' }, { computationId: 'bad id' }, { computationId: 'p', name: 1 }]) {
    assert.throws(() => insightWells({ computations: [{ periodToDate: body }] }), error('INSIGHT_COMPUTATION_INVALID'));
  }
  for (const extra of [{ future: true }, { periodSize: 2 }, { PeriodTimeGranularity: 'MONTH' }, { category: dimension(time) }]) {
    assert.throws(() => insightWells(configuration(undefined, extra)), error('INSIGHT_CONFIGURATION_UNSUPPORTED'));
  }
  assert.throws(() => normalizeInsight(configuration(), [field('region')], [measure]), error('INSIGHT_TIME_REQUIRED'));
});

test('period-to-date projects time and value, rejects unbound fields and preserves granularity when rebinding', () => {
  const config = configuration('YEAR', { time: dimension(time), value: value(measure) });
  assert.deepEqual(insightWells(config), { category: [dimension(time)], values: [value(measure)] });
  assert.equal(normalizeInsight(config, [time], [field('profit'), measure])[0].measure, 1);
  const newTime = { ...field('invoice_date'), dateGranularity: 'MONTH' }, newMeasure = field('profit');
  assert.throws(() => normalizeInsight(config, [newTime], [measure]), error('INSIGHT_FIELD_UNBOUND'));
  assert.throws(() => normalizeInsight(config, [time], [newMeasure]), error('INSIGHT_FIELD_UNBOUND'));
  assert.throws(() => normalizeInsight(config, [{ ...time, dateGranularity: 'MONTH' }], [measure]), error('INSIGHT_FIELD_UNBOUND'));
  const rebound = rebindInsight(config, [dimension(newTime)], [value(newMeasure)]);
  assert.deepEqual(insightWells(rebound), { category: [dimension(newTime)], values: [value(newMeasure)] });
  assert.equal(normalizeInsight(rebound, [newTime], [newMeasure])[0].periodTimeGranularity, 'YEAR');
});

const narrative = (rows, grain, boundGrain = 'DAY', formatting) => insightNarrative(rows, { category: { ...time, dateGranularity: boundGrain }, measures: [measure], computations: configuration(grain), formatting });
const rowsOf = entries => entries.map(([category, n]) => ({ category, values: [n] }));

test('period-to-date sums only the latest UTC calendar month, quarter or year from finer-grain rows', () => {
  for (const [grain, boundGrain, entries, period, expected] of [
    ['MONTH', 'DAY', [['2023-12-31', 900], ['2024-01-01', 10], ['2024-01-31', 20], ['2024-02-01', 3], ['2024-02-29', 4]], '2024-02', 7],
    ['QUARTER', 'DAY', [['2024-03-31', 900], ['2024-04-01', 10], ['2024-05-15', 20], ['2024-06-30', 30]], '2024-Q2', 60],
    ['QUARTER', 'MONTH', [['2024-03', 900], ['2024-04', 10], ['2024-06', 30]], '2024-Q2', 40],
    ['YEAR', 'DAY', [['2023-12-31', 900], ['2024-01-01', 10], ['2024-02-29', 20], ['2024-12-31', 30]], '2024', 60],
    ['YEAR', 'MONTH', [['2023-12', 900], ['2024-01', 10], ['2024-12', 30]], '2024', 40],
    ['YEAR', 'QUARTER', [['2023-Q4', 900], ['2024-Q1', 10], ['2024-Q4', 30]], '2024', 40],
  ]) {
    const rows = rowsOf(entries), before = structuredClone(rows), result = narrative(rows.toReversed(), grain, boundGrain);
    assert.equal(result.text, `Period-to-date revenue for ${period} (${grain}): ${expected}.`);
    assert.deepEqual(result.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [expected]);
    assert.deepEqual(narrative(rows, grain, boundGrain), result);
    assert.deepEqual(rows, before);
  }
});

test('period-to-date defaults to the bound grain and same-grain periods contain only the latest group', () => {
  for (const [grain, labels] of [
    ['DAY', ['2024-02-28', '2024-02-29']], ['MONTH', ['2024-01', '2024-02']],
    ['QUARTER', ['2023-Q4', '2024-Q1']], ['YEAR', ['2023', '2024']],
  ]) {
    const rows = rowsOf(labels.map((label, i) => [label, i ? 20 : 900]));
    const result = narrative(rows, undefined, grain);
    assert.equal(result.text, `Period-to-date revenue for ${labels[1]} (${grain}): 20.`);
    assert.deepEqual(narrative(rows, grain, grain), result);
  }
});

test('period-to-date shares date decoding, measure selection and number formatting', () => {
  const rows = rowsOf([['2023-12', 999], ['2024-01', 10.1234], ['2024-02', -2.1]]);
  const result = narrative(rows, 'YEAR', 'MONTH', { decimalPlaces: 2, names: { revenue: 'Sales' } });
  assert.equal(result.text, 'Period-to-date Sales for 2024 (YEAR): 8.02.');
  assert.equal(result.paragraphs[0].parts.find(p => p.value !== undefined).value, 8.0234);
  assert.deepEqual(narrative(rows.map(r => ({ ...r, category: `${r.category}-01T00:00:00Z` })), 'YEAR', 'MONTH', { decimalPlaces: 2, names: { revenue: 'Sales' } }), result);
  const selected = insightNarrative(rows.map(r => ({ ...r, values: [999, ...r.values] })), {
    category: { ...time, dateGranularity: 'MONTH' }, measures: [field('profit'), measure],
    computations: configuration('YEAR', { value: value(measure) }), formatting: { decimalPlaces: 2, names: { revenue: 'Sales' } },
  });
  assert.deepEqual(selected, result);
});

test('period-to-date skips and discloses null groups only within the selected period, including trailing nulls', () => {
  const rows = rowsOf([['2023-12-31', null], ['2024-01-01', 10], ['2024-01-10', null], ['2024-01-31', null]]);
  assert.equal(narrative(rows, 'MONTH').text, 'Period-to-date revenue for 2024-01 (MONTH): 10. 2 null groups excluded.');
  assert.equal(narrative(rowsOf([['2024-01-01', -10], ['2024-01-02', 10]]), 'MONTH').text, 'Period-to-date revenue for 2024-01 (MONTH): 0.');
  const unavailable = narrative([...rows, { category: '2024-02-01', values: [null] }], 'MONTH');
  assert.equal(unavailable.text, 'Period-to-date revenue for 2024-02 (MONTH): unavailable (no non-null values in the period). 1 null group excluded.');
  assert.deepEqual(unavailable.paragraphs[0].parts.filter(p => p.value !== undefined), []);
});

test('period-to-date reports empty results and finer-than-bound grains as unavailable without invented values', () => {
  for (const [grain, boundGrain, label] of [
    ['DAY', 'MONTH', '2024-01'], ['DAY', 'QUARTER', '2024-Q1'], ['MONTH', 'QUARTER', '2024-Q1'],
    ['DAY', 'YEAR', '2024'], ['MONTH', 'YEAR', '2024'], ['QUARTER', 'YEAR', '2024'],
  ]) {
    const result = narrative(rowsOf([[label, 100]]), grain, boundGrain);
    assert.equal(result.text, `Period-to-date revenue: unavailable (${grain} is finer than the bound ${boundGrain} grain).`);
    assert.deepEqual(result.paragraphs[0].parts.filter(p => p.value !== undefined), []);
  }
  assert.equal(narrative([]).text, 'Period-to-date revenue: unavailable (no dated rows).');
  assert.deepEqual(narrative([]).paragraphs[0].parts.filter(p => p.value !== undefined), []);
  const mixed = insightNarrative([], { category: time, measures: [measure], computations: { computations: [
    { totalAggregation: { computationId: 'total' } }, { forecast: { computationId: 'forecast' } }, ...configuration().computations,
  ] } });
  assert.deepEqual(mixed, narrative([]));
});

test('period-to-date fails closed on duplicate decoded periods, invalid dates and nonfinite arithmetic', () => {
  for (const category of ['2024-01', '2024-01-01', '2024-01-15T00:00:00Z']) {
    assert.throws(() => narrative(rowsOf([['2024-01', 1], [category, 2]]), 'YEAR', 'MONTH'), error('INSIGHT_VALUE_INVALID'));
  }
  for (const category of ['not-a-date', '2024-02-30', null]) assert.throws(() => narrative(rowsOf([[category, 1]]), 'MONTH'), error('INSIGHT_TIME_REQUIRED'));
  for (const n of [Infinity, NaN, '3']) assert.throws(() => narrative(rowsOf([['2024-01-01', n]]), 'MONTH'), error('INSIGHT_VALUE_INVALID'));
  assert.throws(() => narrative(rowsOf([['2024-01-01', 1e308], ['2024-01-02', 1e308]]), 'MONTH'), error('INSIGHT_VALUE_INVALID'));
  // A total over old periods must never be substituted or even evaluated for PTD.
  assert.equal(narrative(rowsOf([['2023-12-01', 1e308], ['2023-12-02', 1e308], ['2024-01-01', 5]]), 'MONTH').text, 'Period-to-date revenue for 2024-01 (MONTH): 5.');
});
