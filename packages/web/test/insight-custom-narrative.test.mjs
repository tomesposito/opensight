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
