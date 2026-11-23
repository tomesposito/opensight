import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, validateInsightConfiguration, insightWells, rebindInsight, InsightError } from '../build/test/insight-configuration.js';
import { insightNarrative, ANOMALY_MAX_SERIES_POINTS, ANOMALY_MAX_WORK_UNITS } from '../build/test/insight-narrative.js';

const field = column => ({ id: column, column, dataSet: 'sales' });
const time = { ...field('date'), dateGranularity: 'DAY' }, measure = field('revenue');
const dimension = f => ({ dateDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, dateGranularity: f.dateGranularity } });
const value = f => ({ numericalMeasureField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const configuration = (detection, body = {}) => ({ computations: [{ anomaly: { computationId: 'anomaly', ...(detection === undefined ? {} : { anomalyDetection: detection }), ...body } }] });
const error = code => e => e instanceof InsightError && e.code === code;
const rowsOf = values => values.map((n, i) => ({ category: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), values: [n] }));
const narrative = (rows, detection, extra = {}) => insightNarrative(rows, { category: time, measures: [measure], computations: configuration(detection), ...extra });
const numbers = result => result.paragraphs.flatMap(p => p.parts).filter(p => p.value !== undefined).map(p => p.value);

test('anomaly normalization validates defaults, explicit options and names without mutation', () => {
  for (const detection of [undefined, {}, { direction: 'HIGHER', minSensitivityPercentage: 0 }, { direction: 'LOWER', minSensitivityPercentage: 100 }, { direction: 'BOTH', minSensitivityPercentage: 0.5 }]) {
    const config = configuration(detection, { name: 'Revenue anomalies' }), before = structuredClone(config);
    assert.deepEqual(normalizeInsight(config, [time], [measure]), [{ kind: 'anomaly', id: 'anomaly', measure: 0, anomalyDetection: { direction: 'BOTH', ...detection } }]);
    assert.deepEqual(config, before);
  }
  assert.throws(() => normalizeInsight(configuration(), [field('region')], [measure]), error('INSIGHT_TIME_REQUIRED'));
});

test('anomaly config rejects malformed bodies, options, unknown keys, duplicate IDs and movers mixing', () => {
  for (const detection of [null, [], 1, 'bad',
    ...['higher', 'UP', null, 1].map(direction => ({ direction })),
    ...[-1, 101, Infinity, -Infinity, NaN, null, '5'].map(minSensitivityPercentage => ({ minSensitivityPercentage })),
  ]) {
    assert.throws(() => validateInsightConfiguration(configuration(detection)), error('INSIGHT_COMPUTATION_INVALID'));
    assert.throws(() => insightWells(configuration(detection)), error('INSIGHT_COMPUTATION_INVALID'));
  }
  for (const body of [null, [], 1, 'bad', {}, { computationId: '' }, { computationId: 'bad id' }, { computationId: 'a'.repeat(513) }, { computationId: 'a', name: 2 }]) {
    assert.throws(() => validateInsightConfiguration({ computations: [{ anomaly: body }] }), error('INSIGHT_COMPUTATION_INVALID'));
  }
  for (const body of [{ future: true }, { direction: 'BOTH' }, { category: dimension(time) }, { anomalyDetection: { future: true } }, { anomalyDetection: { Direction: 'HIGHER' } }]) {
    assert.throws(() => insightWells(configuration(undefined, body)), error('INSIGHT_CONFIGURATION_UNSUPPORTED'));
  }
  assert.throws(() => validateInsightConfiguration({ computations: [...configuration().computations, ...configuration().computations] }), error('INSIGHT_COMPUTATION_INVALID'));
  assert.throws(() => validateInsightConfiguration({ computations: [...configuration().computations, { topBottomMovers: { computationId: 'm', type: 'TOP' } }] }), error('INSIGHT_COMPUTATION_INVALID'));
  assert.throws(() => normalizeInsight({ ...configuration(), customNarrative: { narrative: '${anomaly.result}' } }, [time], [measure]), error('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'));
});

test('anomaly projects and rebinds time/value while preserving options and rejecting conflicts', () => {
  const config = configuration({ direction: 'LOWER', minSensitivityPercentage: 20 }, { time: dimension(time), value: value(measure) });
  assert.deepEqual(insightWells(config), { category: [dimension(time)], values: [value(measure)] });
  assert.equal(normalizeInsight(config, [time], [field('profit'), measure])[0].measure, 1);
  const nextTime = { ...field('invoice_date'), dateGranularity: 'MONTH' }, nextValue = field('profit');
  for (const [dimensions, measures] of [[[nextTime], [measure]], [[time], [nextValue]], [[{ ...time, dateGranularity: 'MONTH' }], [measure]]]) {
    assert.throws(() => normalizeInsight(config, dimensions, measures), error('INSIGHT_FIELD_UNBOUND'));
  }
  const rebound = rebindInsight(config, [dimension(nextTime)], [value(nextValue)]);
  assert.deepEqual(insightWells(rebound), { category: [dimension(nextTime)], values: [value(nextValue)] });
  assert.deepEqual(normalizeInsight(rebound, [nextTime], [nextValue])[0].anomalyDetection, { direction: 'LOWER', minSensitivityPercentage: 20 });
});

test('anomaly detects a clear high outlier chronologically using median/MAD and shared formatting', () => {
  const rows = rowsOf([9, 10, 10, 11, 100]), before = structuredClone(rows);
  const result = narrative(rows.toReversed());
  assert.equal(result.text, 'Statistical anomaly detection for revenue by date: 2024-01-05 (100, unusually high).');
  assert.deepEqual(numbers(result), [100]); assert.deepEqual(narrative(rows), result); assert.deepEqual(rows, before);
  const selected = narrative(rows.map(r => ({ ...r, values: [999, ...r.values] })), undefined, {
    measures: [field('profit'), measure], computations: configuration(undefined, { value: value(measure), name: 'Metadata name' }),
    formatting: { decimalPlaces: 2, names: { revenue: 'Sales', date: 'Order date' } },
  });
  assert.equal(selected.text, 'Statistical anomaly detection for Sales by Order date: 2024-01-05 (100.00, unusually high).');
  assert.deepEqual(numbers(selected), [100]);
});

test('anomaly LOWER detects negative deviations and HIGHER filters them out', () => {
  const rows = rowsOf([10, 11, 11, 12, -100]);
  assert.match(narrative(rows, { direction: 'LOWER' }).text, /2024-01-05 \(-100, unusually low\)/);
  assert.deepEqual(narrative(rows, { direction: 'BOTH' }), narrative(rows));
  assert.equal(narrative(rows, { direction: 'HIGHER' }).text, 'Statistical anomaly detection for revenue by date: no anomalies detected.');
  assert.deepEqual(numbers(narrative(rows, { direction: 'HIGHER' })), []);
});

test('anomaly sensitivity adds an inclusive percentage filter using the absolute median', () => {
  for (const values of [[99, 100, 100, 100, 101, 106], [-101, -100, -100, -100, -99, -94]]) {
    const rows = rowsOf(values);
    assert.deepEqual(numbers(narrative(rows)), [values.at(-1)]);
    assert.deepEqual(numbers(narrative(rows, { minSensitivityPercentage: 6 })), [values.at(-1)]);
    assert.deepEqual(numbers(narrative(rows, { minSensitivityPercentage: 6.01 })), []);
  }
  const zeroMedian = rowsOf([0, 0, 0, 0, 1]);
  assert.deepEqual(narrative(zeroMedian, { minSensitivityPercentage: 100 }), narrative(zeroMedian));
});

test('anomaly MAD zero flags only values unequal to the median', () => {
  assert.deepEqual(numbers(narrative(rowsOf([10, 10, 10, 10, 11]))), [11]);
  assert.deepEqual(numbers(narrative(rowsOf([10, 10, 10, 10, 9]), { direction: 'LOWER' })), [9]);
  assert.match(narrative(rowsOf([10, 10, 10, 10, 10])).text, /no anomalies detected\./);
  assert.match(narrative(rowsOf([8, 9, 10, 11, 12])).text, /no anomalies detected\./);
});

test('anomaly uses the 3.5 robust-z threshold inclusively and averages even-length medians', () => {
  const threshold = 3.5 / 0.6745;
  assert.deepEqual(numbers(narrative(rowsOf([-1, 0, 0, 1, threshold]))), [threshold]);
  assert.deepEqual(numbers(narrative(rowsOf([-1, 0, 0, 1, threshold - 0.00001]))), []);
  assert.deepEqual(numbers(narrative(rowsOf([9, 10, 10, 11, 11, 12, 100, 101]))), [100, 101]);
  // No all-time sum or overflowing naive midpoint is evaluated.
  assert.match(narrative(rowsOf(Array(6).fill(1e308))).text, /no anomalies detected/);
});

test('anomaly requires five non-null points and discloses excluded nulls without invented values', () => {
  for (const values of [[], [1, 2, 3, 4], [null, null, null, null, null], [1, 2, 3, 4, null]]) {
    const result = narrative(rowsOf(values));
    assert.match(result.text, /unavailable \(not enough data points to detect anomalies; at least 5 non-null points required\)/);
    assert.deepEqual(numbers(result), []);
    const nulls = values.filter(n => n === null).length;
    if (nulls) assert.match(result.text, new RegExp(`${nulls} null group${nulls === 1 ? '' : 's'} excluded\\.`));
  }
  const result = narrative(rowsOf([9, 10, 10, 11, 100, null, null]));
  assert.deepEqual(numbers(result), [100]); assert.match(result.text, /2 null groups excluded\.$/);
});

test('anomaly labels bound periods consistently and accepts equivalent date spellings', () => {
  for (const [grain, labels] of [
    ['DAY', ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01']],
    ['MONTH', ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05']],
    ['QUARTER', ['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4', '2024-Q1']],
    ['YEAR', ['2020', '2021', '2022', '2023', '2024']],
  ]) {
    const rows = rowsOf([9, 10, 10, 11, 100]).map((r, i) => ({ ...r, category: labels[i] }));
    const result = narrative(rows, undefined, { category: { ...time, dateGranularity: grain } });
    assert.ok(result.text.includes(`${labels.at(-1)} (100, unusually high)`));
  }
  const rows = rowsOf([9, 10, 10, 11, 100]);
  assert.deepEqual(narrative(rows.map(r => ({ ...r, category: `${r.category}T00:00:00Z` }))), narrative(rows));
});

test('anomaly rejects duplicate periods before null exclusion, invalid dates and nonfinite values or arithmetic', () => {
  const rows = rowsOf([9, 10, 10, 11, 100]);
  for (const category of ['2024-01-01', '2024-01-01T12:00:00Z']) for (const n of [null, 1]) {
    assert.throws(() => narrative([...rows, { category, values: [n] }]), error('INSIGHT_VALUE_INVALID'));
  }
  for (const category of [null, 'bad', '2024-02-30']) assert.throws(() => narrative([{ category, values: [null] }]), error('INSIGHT_TIME_REQUIRED'));
  for (const n of [NaN, Infinity, -Infinity, '3']) assert.throws(() => narrative(rowsOf([n])), error('INSIGHT_VALUE_INVALID'));
  assert.throws(() => narrative(rowsOf([-1e308, 1e308, 1e308, 1e308, 1e308])), error('INSIGHT_VALUE_INVALID'));
  assert.throws(() => narrative(rowsOf([0, 0, 1e-308, -1e-308, 1e308])), error('INSIGHT_VALUE_INVALID'));
});

test('anomaly caps the chronological list at five and discloses every remaining candidate', () => {
  const rows = rowsOf([...Array(8).fill(10), 100, -100, 100, -100, 100, -100, 100]);
  const result = narrative(rows.toReversed());
  assert.deepEqual(numbers(result), [100, -100, 100, -100, 100]);
  assert.match(result.text, /2024-01-09 \(100, unusually high\); 2024-01-10 \(-100, unusually low\)/);
  assert.match(result.text, /2024-01-13 \(100, unusually high\); and 2 more\.$/);
  assert.doesNotMatch(result.text, /2024-01-14|2024-01-15/);
});

test('anomaly computations sharing a measure reuse statistics and stay behavior-identical', () => {
  const rows = rowsOf([10, 10, 10, 10, 10, 100, -100]);
  const multi = insightNarrative(rows, { category: time, measures: [measure], computations: { computations: [
    { anomaly: { computationId: 'high', anomalyDetection: { direction: 'HIGHER' } } },
    { anomaly: { computationId: 'low', anomalyDetection: { direction: 'LOWER' } } },
    { anomaly: { computationId: 'both' } },
    { anomaly: { computationId: 'sensitive', anomalyDetection: { minSensitivityPercentage: 100 } } },
  ] } });
  const singles = [{ direction: 'HIGHER' }, { direction: 'LOWER' }, undefined, { minSensitivityPercentage: 100 }]
    .map(detection => narrative(rows, detection).text);
  assert.deepEqual(multi.paragraphs.map(p => p.parts.map(part => part.text).join('')), singles);
  assert.match(multi.paragraphs[0].parts.map(p => p.text).join(''), /\(100, unusually high\)/);
  assert.match(multi.paragraphs[1].parts.map(p => p.text).join(''), /\(-100, unusually low\)/);
});

test('anomaly work budget fails closed before sorting and never truncates silently', () => {
  assert.ok(ANOMALY_MAX_SERIES_POINTS > 0 && ANOMALY_MAX_WORK_UNITS > 0);
  const over = rowsOf(Array.from({ length: ANOMALY_MAX_SERIES_POINTS + 1 }, (_, i) => i % 7));
  assert.throws(() => narrative(over), error('INSIGHT_ANOMALY_WORK_EXCEEDED'));
  // A series at the point cap passes with one computation but the total work
  // budget binds when 100 computations each scan it.
  const atCap = rowsOf(Array.from({ length: ANOMALY_MAX_SERIES_POINTS }, (_, i) => i % 7));
  assert.match(narrative(atCap).text, /^Statistical anomaly detection for revenue by date: /);
  const many = { computations: Array.from({ length: 100 }, (_, i) => ({ anomaly: { computationId: `a${i}` } })) };
  assert.throws(() => insightNarrative(atCap, { category: time, measures: [measure], computations: many }), error('INSIGHT_ANOMALY_WORK_EXCEEDED'));
  // The budget is anomaly-specific: a non-anomaly narrative over the same
  // rows is unaffected.
  const total = insightNarrative(over, { category: time, measures: [measure], computations: { computations: [{ totalAggregation: { computationId: 't' } }] } });
  assert.match(total.text, /^Total revenue: /);
});
