import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInsightConfiguration, normalizeInsight, insightTemplate, INSIGHT_OUTPUTS } from '../build/test/insight-configuration.js';
const computation = (kind = 'totalAggregation', body = {}) => ({ [kind]: { computationId: 'total', ...body } });
const config = (narrative, computations = [computation()]) => ({ computations, customNarrative: { narrative } });
const field = column => ({ id: column, column, dataSet: 'sales' });
const base = { category: field('region'), measures: [field('revenue')] };
const error = code => e => e.code === code;

test('bounded custom syntax admits every catalog output and supported format', () => {
  for (const [kind, outputs] of Object.entries(INSIGHT_OUTPUTS)) for (const output of outputs) {
    assert.doesNotThrow(() => validateInsightConfiguration(config(`Result: {total.${output.replace('[i]', '[0]')}}`, [computation(kind, kind === 'topBottomMovers' ? { type: 'TOP' } : {})])));
  }
  const valid = config('Revenue {Total.value|decimals:2,grouping:false,percent:true}\n\n{field.revenue.formattedValue} {Total.value|date:QUARTER}', [computation('totalAggregation', { name: 'Total' })]);
  assert.doesNotThrow(() => validateInsightConfiguration(valid));
  assert.equal(insightTemplate(valid).filter(p => p.kind === 'placeholder').length, 3);
  for (const computations of [undefined, []]) {
    const fields = { ...(computations ? { computations } : {}), customNarrative: { narrative: '{field.revenue}' } };
    assert.doesNotThrow(() => validateInsightConfiguration(fields));
    assert.deepEqual(normalizeInsight(fields, [base.category], base.measures), []);
  }
});

test('grammar, catalog, parameters and malformed custom shapes fail with the bounded-subset error', () => {
  const templates = ['${total.value}', 'plain $ text', '{if total.value}', '{for total}', '{sum(total.value)}', '{total.value+1}', '{total.value * 2}', '{ total.value}', '{total.value }', '{{total.value}}', '{total.value', 'total.value}', '{total.unknown}', '{total.value|unknown:2}', '{total.value|decimals:7}', '{total.value|decimals:-1}', '{total.value|decimals:1.5}', '{total.value|grouping:yes}', '{total.value|percent:false}', '{total.value|date:WEEK}', '{total.value|}', '{total.value||}', '{total.value|decimals:2,decimals:2}', '{field.revenue.unknown}', '{field.revenue.value.extra}'];
  for (const template of templates) assert.throws(() => validateInsightConfiguration(config(template)), e => e.code === 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED' && /bounded subset/.test(e.message), template);
  for (const customNarrative of [null, false, [], 'text', {}, { narrative: 1 }, { narrative: 'text', extra: true }]) assert.throws(() => validateInsightConfiguration({ customNarrative }), error('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'));
  for (const template of ['{total.items[-1].value}', '{total.items[1.5].value}', '{total.items[i].value}', '{total.items[0].metricValue.value}']) assert.throws(() => validateInsightConfiguration(config(template, [computation('topBottomRanked')])), error('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'));
});

test('computation existence is structural; field existence is checked against measure wells', () => {
  for (const template of ['{missing.value}', '{total.value}']) assert.throws(() => validateInsightConfiguration(config(template, [computation('totalAggregation', { name: 'Total' })])), error('INSIGHT_CUSTOM_NARRATIVE_REFERENCE'));
  for (const fieldId of ['region', 'missing']) {
    const c = config(`{field.${fieldId}}`, []);
    assert.doesNotThrow(() => validateInsightConfiguration(c));
    assert.throws(() => normalizeInsight(c, [base.category], base.measures), error('INSIGHT_CUSTOM_NARRATIVE_REFERENCE'));
  }
});

const { insightNarrative, UNIQUE_VALUES_MAX_TEXT_CHARS } = await import('../build/test/insight-narrative.js');
const rows = [{ category: 'East', values: [100] }, { category: 'West', values: [300] }, { category: 'North', values: [200] }, { category: 'South', values: [null] }];
const render = (template, data = rows, computations = [computation()], input = base) => insightNarrative(data, { ...input, computations: config(template, computations) });

test('custom text replaces computed prose, preserving numeric parts and paragraph boundaries', () => {
  const result = render('Revenue {total.formattedValue}\n\nShare {field.revenue|decimals:2,grouping:false}', rows, undefined, { ...base, formatting: { decimalPlaces: 1 } });
  assert.equal(result.text, 'Revenue 600.0\n\nShare 600.00');
  assert.equal(result.paragraphs.length, 2);
  assert.deepEqual(result.paragraphs.map(p => p.parts.filter(p => p.value !== undefined).map(p => p.value)), [[600], [600]]);
  assert.equal(render('literal only', rows, []).text, 'literal only');
  assert.equal(render('{field.revenue} / {field.revenue.value} / {field.revenue.formattedValue}', rows, [], { ...base, formatting: { decimalPlaces: 2 } }).text, '600 / 600 / 600.00');
});

test('published totals and ranked lists equal computed narrative values from the same rows', () => {
  for (const computations of [[computation()], [computation('topBottomRanked', { type: 'TOP', resultSize: 2 })]]) {
    const computed = insightNarrative(rows, { ...base, computations: { computations } });
    const template = computations[0].totalAggregation ? '{total.value}' : '{total.items[0].value} {total.items[1].value}';
    const custom = render(template, rows, computations);
    const numbers = narrative => narrative.paragraphs.flatMap(p => p.parts.filter(p => p.value !== undefined).map(p => p.value));
    assert.deepEqual(numbers(custom), numbers(computed));
  }
  assert.equal(render('{total.itemsCount}: {total.items[0].category} {total.items[0].formattedValue}', rows, [computation('topBottomRanked', { type: 'TOP', resultSize: 2 })], { ...base, formatting: { decimalPlaces: 2 } }).text, '2: West 300.00');
});

test('default, visual and explicit formats preserve raw fractions and numeric emphasis', () => {
  const data = [{ category: 'East', values: [1234.567] }];
  assert.equal(render('{total.value} / {total.formattedValue} / {total.value|decimals:0,grouping:false}', data, undefined, { ...base, formatting: { decimalPlaces: 2 } }).text, '1,234.567 / 1,234.57 / 1235');
  const maximum = [computation('maximumMinimum', { type: 'MAXIMUM' })];
  assert.equal(render('{total.value} {total.category}: {total.percentOfTotal} / {total.percentOfTotal.value} / {total.percentOfTotal.formattedValue} / {total.percentOfTotal.value|percent:true,decimals:0}', rows, maximum, { ...base, formatting: { decimalPlaces: 3 } }).text, '300 West: 50.00% / 0.5 / 50.000% / 50%');
  assert.equal(render('{field.revenue|percent:true}', [{ category: 'A', values: [0.125] }], []).text, '12.50%');
  assert.equal(render('{total.value|decimals:6,grouping:true}', data).text, '1,234.567000');
});

const dated = { ...base, category: { ...field('month'), dateGranularity: 'MONTH' } };
const months = [100, 150, 200, 250, 300, 350].map((n, i) => ({ category: `2024-0${i + 1}`, values: [n] }));
test('comparison, period, forecast and unique values publish their pinned catalogs', () => {
  const comparison = [computation('metricComparison')];
  assert.equal(render('{total.value} {total.targetValue} {total.targetValue.formattedValue} {total.difference} {total.difference.formattedValue} {total.percentDifference} {total.percentDifference.value} {total.percentDifference.formattedValue}', [{ category: 'East', values: [150, 100] }], comparison, { ...base, measures: [field('revenue'), field('profit')], formatting: { decimalPlaces: 1 } }).text, '150 100 100.0 50 50.0 50.00% 0.5 50.0%');
  for (const kind of ['growthRate', 'periodOverPeriod']) {
    assert.equal(render('{total.value} {total.previousValue} {total.previousValue.formattedValue} {total.change} {total.change.formattedValue} {total.percentChange} {total.percentChange.value} {total.percentChange.formattedValue} {total.currentPeriod} {total.previousPeriod}', months.slice(0, 2), [computation(kind)], dated).text, '150 100 100 50 50 50.00% 0.5 50.00% 2024-02 2024-01');
    for (const [grain, expected] of [['DAY', '2024-02-01'], ['MONTH', '2024-02'], ['QUARTER', '2024-Q1'], ['YEAR', '2024']]) assert.equal(render(`{total.currentPeriod|date:${grain}}`, months.slice(0, 2), [computation(kind)], dated).text, expected);
  }
  assert.equal(render('{total.value} {total.formattedValue} {total.period} {total.period|date:YEAR}', months, [computation('periodToDate', { periodTimeGranularity: 'QUARTER' })], dated).text, '900 900 2024-Q2 2024');
  const forecast = [computation('forecast', { forecastProperties: { periodsForward: 1, seasonality: 'NONE' } })];
  const computed = insightNarrative(months, { ...dated, computations: { computations: forecast } });
  const custom = render('{total.value} {total.lowerBound} {total.upperBound}', months, forecast, dated);
  assert.deepEqual(custom.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), computed.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value));
  assert.equal(render('{total.period} {total.period|date:QUARTER}', months, forecast, dated).text, '2024-07 2024-Q3');
  assert.equal(render('{total.itemsCount}: {total.items[0]}, {total.items[1]}', rows.map(r => ({ ...r, values: [] })), [computation('uniqueValues')], { ...base, measures: [] }).text, '4: East, North');
});

test('movers and anomaly lists publish computed values and date labels', () => {
  const movers = [{ category: 'A', time: '2024-01', values: [100] }, { category: 'A', time: '2024-02', values: [150] }];
  const input = { ...base, time: dated.category };
  const output = ['category', 'previousValue', 'previousValue.formattedValue', 'value', 'formattedValue', 'change', 'change.formattedValue', 'percentChange', 'percentChange.value'];
  assert.equal(render(`{total.itemsCount}: ${output.map(o => `{total.items[0].${o}}`).join(' ')}`, movers, [computation('topBottomMovers', { type: 'TOP' })], { ...input, formatting: { decimalPlaces: 1 } }).text, '1: A 100 100.0 150 150.0 50 50.0 50.00% 0.5');
  const anomalies = [10, 10, 10, 10, 100].map((n, i) => ({ category: `2024-0${i + 1}`, values: [n] }));
  assert.equal(render('{total.itemsCount}: {total.items[0].period} {total.items[0].period|date:QUARTER} {total.items[0].value} {total.items[0].formattedValue}', anomalies, [computation('anomaly')], { ...dated, formatting: { decimalPlaces: 2 } }).text, '1: 2024-05 2024-Q2 100 100.00');
});

test('unavailable scalar outputs never invent values; absent list entries and bindings fail closed', () => {
  for (const data of [[], [{ category: 'A', values: [null] }]]) assert.equal(render('{total.value} {total.formattedValue} {field.revenue}', data).text, 'unavailable unavailable unavailable');
  for (const kind of ['growthRate', 'periodOverPeriod', 'forecast', 'periodToDate']) assert.equal(render('{total.value}', [], [computation(kind)], dated).text, 'unavailable');
  assert.equal(render('{total.value} {total.percentChange} {total.previousPeriod}', months.slice(0, 1), [computation('growthRate')], dated).text, 'unavailable unavailable unavailable');
  for (const index of ['2', '1000000000000000000000']) assert.throws(() => render(`{total.items[${index}].value}`, rows, [computation('topBottomRanked', { type: 'TOP', resultSize: 2 })]), error('INSIGHT_CUSTOM_NARRATIVE_REFERENCE'));
  assert.throws(() => render('{field.region}', rows, []), error('INSIGHT_CUSTOM_NARRATIVE_REFERENCE'));
  assert.throws(() => render('{field.missing}', [], []), error('INSIGHT_CUSTOM_NARRATIVE_REFERENCE'));
  assert.throws(() => render('{total.value|date:DAY}'), error('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'));
  assert.throws(() => render('{total.category|percent:true}', rows, [computation('maximumMinimum', { type: 'MAXIMUM' })]), error('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'));
});

test('the rendered size bound applies to literal text and expanded values without truncation', () => {
  const max = UNIQUE_VALUES_MAX_TEXT_CHARS;
  assert.equal(render('x'.repeat(max), rows, []).text.length, max);
  assert.throws(() => render('x'.repeat(max + 1), rows, []), error('INSIGHT_CUSTOM_NARRATIVE_TOO_LARGE'));
  assert.throws(() => render('x'.repeat(max - 2) + '{total.value}'), error('INSIGHT_CUSTOM_NARRATIVE_TOO_LARGE'));
  const huge = [{ category: 'x'.repeat(max + 1), values: [1] }];
  assert.throws(() => render('{total.items[0]}', huge, [computation('uniqueValues')]), error('INSIGHT_CUSTOM_NARRATIVE_TOO_LARGE'));
});
