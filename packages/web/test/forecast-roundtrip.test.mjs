import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQsBundle } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, authorVisualProblem, emptyDraft, serializeDraft, serializeVisual, validateDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { init } from '../build/test/echarts.js';

const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const forecast = { enabled: true, periodsForward: 5, periodsBackward: 1, predictionInterval: 90, seasonality: 'auto' };
const withForecast = d => authorReducer(d, { type: 'forecast', forecast });

test('area draft validation accepts valid forecasts and rejects malformed stored configs', () => {
  const draft = withForecast(add('area'));
  assert.doesNotThrow(() => validateDraft(draft));
  for (const patch of [{ periodsForward: -1 }, { predictionInterval: 42 }, { seasonality: 1 }, { lowerBoundary: 10, upperBoundary: 5 }, { unknown: true }]) {
    const invalid = structuredClone(draft);
    selected(invalid).forecast = { ...forecast, ...patch };
    assert.throws(() => validateDraft(invalid), /Invalid or unsupported author draft/);
  }
});

test('forecast config round-trips through bundle import/export', async () => {
  const d = withForecast(add('line'));
  assert.deepEqual(selected(d).forecast, forecast);
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).forecast, forecast);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
});

test('imported forecast renders through the author preview compile path', async () => {
  const d = withForecast(add('line'));
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  const rows = Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, revenue: 100 + 10 * i }));
  const { option } = compileVisual({ ...buildAuthorVisual(selected(restored)), rows });
  assert.ok(option.series.some(s => typeof s.id === 'string' && s.id.startsWith('forecast-seg')), 'forecast segment rendered');
  assert.equal(option.xAxis.data.length, 17, 'axis extended by 5 periods');
});

test('invalid forecast action is a no-op; clearing removes the config', () => {
  const d0 = add('line');
  const bad = authorReducer(d0, { type: 'forecast', forecast: { enabled: true, periodsForward: -2, periodsBackward: 0, predictionInterval: 95, seasonality: 'auto' } });
  assert.equal(selected(bad).forecast, undefined);
  const set = withForecast(d0);
  const cleared = authorReducer(set, { type: 'forecast', forecast: undefined });
  assert.equal(selected(cleared).forecast, undefined);
});

test('disabled forecast stays in the draft but out of the serialized definition', () => {
  const d = authorReducer(add('line'), { type: 'forecast', forecast: { ...forecast, enabled: false } });
  assert.equal(selected(d).forecast.enabled, false);
  const body = Object.values(serializeVisual(selected(d)))[0];
  assert.equal(body.chartConfiguration.forecastConfigurations, undefined);
  const enabledBody = Object.values(serializeVisual(selected(withForecast(add('line')))))[0];
  assert.deepEqual(enabledBody.chartConfiguration.forecastConfigurations, [{ periodsForward: 5, periodsBackward: 1, predictionInterval: 90, seasonality: 'AUTOMATIC' }]);
});

test('custom seasonality and boundaries round-trip', async () => {
  const custom = { enabled: true, periodsForward: 2, periodsBackward: 0, predictionInterval: 80, seasonality: 7, lowerBoundary: 0, upperBoundary: 500 };
  const d = authorReducer(add('line'), { type: 'forecast', forecast: custom });
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).forecast, custom);
  assert.deepEqual(selected(restored).imported.issues, []);
});

test('authored area forecast serializes as AREA and re-imports identical forecast state', async () => {
  for (const config of [forecast, { ...forecast, seasonality: 7, lowerBoundary: 0, upperBoundary: 500 }]) {
    const draft = authorReducer(add('area'), { type: 'forecast', forecast: config });
    const visual = serializeVisual(selected(draft));
    assert.equal(visual.lineChartVisual.chartConfiguration.type, 'AREA');
    const line = authorReducer(add('line'), { type: 'forecast', forecast: config });
    assert.deepEqual(visual.lineChartVisual.chartConfiguration.forecastConfigurations, serializeVisual(selected(line)).lineChartVisual.chartConfiguration.forecastConfigurations);
    assert.deepEqual(serializeDraft(draft).definition.sheets[0].visuals[0], visual);
    const bundle = await parseQsBundle(await downloadBundleBytes(draft));
    const restored = importBundle(bundle);
    assert.equal(selected(restored).kind, 'area');
    assert.deepEqual(selected(restored).forecast, config);
    assert.deepEqual(selected(restored).imported.issues, []);
    assert.deepEqual(exportBundle(restored), bundle);
    const rows = Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, revenue: 100 + 10 * i }));
    const { option } = compileVisual({ ...buildAuthorVisual(selected(restored)), rows });
    assert.ok(option.series.some(s => s.id === 'forecast-seg-0-0'));
    assert.equal(option.xAxis.data.length, 17);
    assert.deepEqual(option.series[0].areaStyle, { opacity: 0.3 });
  }
});

test('disabled area forecast remains draft-local and serializes only after enabling', () => {
  const draft = authorReducer(add('area'), { type: 'forecast', forecast: { ...forecast, enabled: false } });
  assert.equal(selected(draft).forecast.enabled, false);
  assert.equal(serializeVisual(selected(draft)).lineChartVisual.chartConfiguration.forecastConfigurations, undefined);
  assert.equal(serializeDraft(draft).definition.sheets[0].visuals[0].lineChartVisual.chartConfiguration.forecastConfigurations, undefined);
  assert.deepEqual(serializeVisual(selected(withForecast(draft))).lineChartVisual.chartConfiguration.forecastConfigurations,
    [{ periodsForward: 5, periodsBackward: 1, predictionInterval: 90, seasonality: 'AUTOMATIC' }]);
});

test('malformed imported forecast configurations are blocking and stay out of the draft (issue #263)', async () => {
  const valid = { periodsForward: 5, periodsBackward: 1, predictionInterval: 90, seasonality: 'AUTOMATIC' };
  const cases = [
    ['string lower boundary', { ...valid, lowerBoundary: '20' }],
    ['string upper boundary', { ...valid, upperBoundary: '500' }],
    ['unknown property', { ...valid, unsupportedThing: true }],
    ['inverted boundary pair', { ...valid, lowerBoundary: 500, upperBoundary: 10 }],
    ['bad prediction interval', { ...valid, predictionInterval: 42 }],
    ['string periodsForward', { ...valid, periodsForward: '5' }],
    ['custom seasonality without a value', { ...valid, seasonality: 'CUSTOM' }],
    ['unsupported seasonality', { ...valid, seasonality: 'WEEKLY' }],
    ['non-object configuration', null],
  ];
  for (const [name, config] of cases) {
    const bundle = await parseQsBundle(await downloadBundleBytes(withForecast(add('line'))));
    const chart = bundle.members[0].resource.definition.sheets[0].visuals[0].lineChartVisual.chartConfiguration;
    chart.forecastConfigurations = [config];
    const restored = importBundle(bundle);
    const visual = selected(restored);
    assert.equal(visual.forecast, undefined, `${name}: malformed forecast must not become editable draft state`);
    const problem = authorVisualProblem(visual);
    assert.match(problem ?? '', /Unsupported features/, `${name}: preview must be blocked, got ${problem}`);
    assert.match(problem ?? '', /forecast/i, `${name}: diagnostic must name the forecast configuration`);
    assert.ok(restored.bundle.report[0].messages.some(m => /forecast/i.test(m)), `${name}: import report names the forecast problem`);
    assert.deepEqual(exportBundle(restored), bundle, `${name}: unchanged export preserves the original definition verbatim`);
  }
});

test('malformed imported forecast configurations block area visuals too (issue #263)', async () => {
  const bundle = await parseQsBundle(await downloadBundleBytes(withForecast(add('area'))));
  const chart = bundle.members[0].resource.definition.sheets[0].visuals[0].lineChartVisual.chartConfiguration;
  chart.forecastConfigurations = [{ periodsForward: 5, predictionInterval: 90, seasonality: 'AUTOMATIC', upperBoundary: '500' }];
  const restored = importBundle(bundle);
  assert.equal(selected(restored).kind, 'area');
  assert.equal(selected(restored).forecast, undefined);
  assert.match(authorVisualProblem(selected(restored)) ?? '', /Unsupported features/);
  assert.deepEqual(exportBundle(restored), bundle);
});

test('non-array forecastConfigurations is a blocking diagnostic (issue #263)', async () => {
  const bundle = await parseQsBundle(await downloadBundleBytes(withForecast(add('line'))));
  const chart = bundle.members[0].resource.definition.sheets[0].visuals[0].lineChartVisual.chartConfiguration;
  chart.forecastConfigurations = { periodsForward: 5 };
  const restored = importBundle(bundle);
  assert.equal(selected(restored).forecast, undefined);
  assert.match(authorVisualProblem(selected(restored)) ?? '', /Unsupported features/);
  assert.deepEqual(exportBundle(restored), bundle);
});

test('valid imported forecast with boundaries still imports clean (issue #263)', async () => {
  const bounded = { enabled: true, periodsForward: 2, periodsBackward: 0, predictionInterval: 80, seasonality: 7, lowerBoundary: 0, upperBoundary: 500 };
  const bundle = await parseQsBundle(await downloadBundleBytes(authorReducer(add('line'), { type: 'forecast', forecast: bounded })));
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).forecast, bounded);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.equal(authorVisualProblem(selected(restored)), undefined);
});

test('foreign AREA LineChartVisual hydrates forecast state and keeps the import report', () => {
  const bundle = { members: [{ path: 'analysis/foreign-area.json', resource: {
    resourceType: 'analysis', analysisId: 'foreign-area', name: 'Foreign area forecast', definition: {
      dataSetIdentifierDeclarations: [{ identifier: 'sales_data', dataSetArn: 'local:sales' }],
      sheets: [{ sheetId: 'sheet-foreign', name: 'Forecasts', visuals: [{ lineChartVisual: {
        visualId: 'area-foreign', chartConfiguration: {
          type: 'AREA',
          fieldWells: { lineChartAggregatedFieldWells: {
            category: [{ dateDimensionField: { fieldId: 'date', column: { dataSetIdentifier: 'sales_data', columnName: 'order_date' }, dateGranularity: 'MONTH' } }],
            values: [{ numericalMeasureField: { fieldId: 'sales', column: { dataSetIdentifier: 'sales_data', columnName: 'revenue' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
          } },
          forecastConfigurations: [{ periodsForward: 5, periodsBackward: 1, predictionInterval: 90, seasonality: 'AUTOMATIC' }],
        },
      } }] }],
    },
  } }] };
  const restored = importBundle(bundle);
  assert.equal(selected(restored).kind, 'area');
  assert.deepEqual(selected(restored).forecast, forecast);
  assert.ok(restored.bundle.report[0].messages.includes('Visual area-foreign: forecast configuration mapped (statistical forecast, 5 period(s) forward, 90% prediction interval).'));
  assert.deepEqual(exportBundle(restored), bundle);
});
