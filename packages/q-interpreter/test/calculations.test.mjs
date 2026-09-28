import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestCalculation } from '../dist/index.js';
const schema = [{ name: 'revenue', type: 'DECIMAL' }, { name: 'profit', type: 'DECIMAL' }, { name: 'order_date', type: 'DATETIME' }, { name: 'first_name', type: 'STRING' }, { name: 'last_name', type: 'STRING' }];
test('year and month growth use the Phase 2c calendar-period function', () => {
  for (const [period, prompt] of [['YEAR', 'year over year sales growth'], ['YEAR', 'year-over-year sales growth'], ['MONTH', 'month over month sales percent change']]) {
    const r = suggestCalculation(prompt, schema); assert.equal(r.suggestion.expression, `periodOverPeriodPercentDifference(sum({revenue}), {order_date}, ${period}, 1)`);
  }
});
test('profit margin is a guarded ratio of aggregate sums', () => {
  assert.equal(suggestCalculation('profit margin', schema).suggestion.expression, 'sum({profit}) / nullIf(sum({revenue}), 0)');
});
test('full name uses concat, nullable components and a dimension role', () => {
  const s = suggestCalculation('full name', schema).suggestion;
  assert.equal(s.expression, "trim(concat(coalesce({first_name}, ''), ' ', coalesce({last_name}, '')))" ); assert.equal(s.role, 'dimension');
});
test('missing fields and ambiguous dates require explicit correction', () => {
  assert.equal(suggestCalculation('full name', schema.slice(0, 3)).error.code, 'MISSING_CALCULATION_FIELDS');
  assert.equal(suggestCalculation('profit margin', []).error.code, 'MISSING_CALCULATION_FIELDS');
  const many = [...schema, { name: 'ship_date', type: 'DATETIME' }];
  assert.equal(suggestCalculation('yoy sales growth', many).error.code, 'AMBIGUOUS_DATE_FIELD');
  assert.match(suggestCalculation('yoy sales growth by ship date', many).suggestion.expression, /\{ship_date\}/);
});
test('unsupported requests/functions are named and never fabricated', () => {
  for (const q of ['forecast(revenue)', 'median of sales', 'zzzz']) {
    const r = suggestCalculation(q, schema); assert.equal(r.error.code, 'UNSUPPORTED_CALCULATION_TEMPLATE'); assert.ok(r.error.message.includes(q.split('(')[0])); assert.equal(r.suggestion, undefined);
  }
  assert.equal(suggestCalculation('', schema).error.code, 'EMPTY_QUESTION');
  assert.equal(suggestCalculation('x'.repeat(2001), schema).error.code, 'INPUT_LIMIT');
});
