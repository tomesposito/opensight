import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, rebindInsight, InsightError } from '../build/test/insight-configuration.js';

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
