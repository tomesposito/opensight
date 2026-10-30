import test from 'node:test';
import assert from 'node:assert/strict';
import { describeInterpretation, interpretationSteps, interpretQuestion } from '../dist/index.js';

const schema = [
  { name: 'revenue', type: 'DECIMAL', synonyms: ['sales', 'net sales'] },
  { name: 'region', type: 'STRING', synonyms: ['territory'] },
  { name: 'category', type: 'STRING', synonyms: ['product kind'] },
  { name: 'order_date', type: 'DATETIME' },
];
const ask = (question, fields = schema) => interpretQuestion(question, fields);
const first = question => { const r = ask(question); assert.ok(r.interpretations.length, JSON.stringify(r)); return r.interpretations[0]; };

test('grounding follows measure, dimensions and filters, deduplicating fields', () => {
  const i = first('sum revenue by region for region East where category Hardware in 2025');
  assert.deepEqual(i.grounding, { fieldsUsed: ['revenue', 'region', 'category', 'order_date'], synonymsMatched: [], unmatchedTerms: [] });
  assert.deepEqual(first('count rows by region for category Hardware').grounding.fieldsUsed, ['region', 'category']);
  assert.deepEqual(first('count rows').grounding.fieldsUsed, []);
});

test('metadata synonyms ground measures, dimensions and filter fields with the existing confidence penalty', () => {
  const i = first('sum sales by territory where product kind Hardware');
  assert.deepEqual(i.grounding.synonymsMatched, [
    { term: 'sales', field: 'revenue' }, { term: 'territory', field: 'region' }, { term: 'product kind', field: 'category' },
  ]);
  assert.deepEqual(i.grounding.fieldsUsed, ['revenue', 'region', 'category']);
  assert.equal(i.confidence, 0.83);
  for (const term of ['net sales', '"net sales"', 'Net_Sales']) {
    assert.equal(first(`sum ${term}`).grounding.synonymsMatched[0].field, 'revenue');
  }
  assert.equal(ask('sum sales', schema.map(({ synonyms, ...field }) => field)).interpretations.length, 0);
});

test('exact names beat synonyms, including longer aliases; repeated aliases do not duplicate interpretations', () => {
  const fields = [...schema, { name: 'sales', type: 'DECIMAL', synonyms: ['sales'] }];
  const i = ask('sum sales', fields).interpretations[0];
  assert.equal(i.measure, 'sales'); assert.equal(i.confidence, 0.98); assert.deepEqual(i.grounding.synonymsMatched, []);
  const longer = ask('sum sales extra', [{ name: 'revenue', type: 'DECIMAL', synonyms: ['sales extra'] }, fields.at(-1)]).interpretations[0];
  assert.equal(longer.measure, 'sales'); assert.deepEqual(longer.grounding.unmatchedTerms, ['extra']);
  const duplicates = ask('sum sales', [{ name: 'Net Sales', type: 'DECIMAL', synonyms: ['sales', 'sales', ''] }]);
  assert.equal(duplicates.interpretations.length, 1);
  assert.deepEqual(duplicates.interpretations[0].grounding.synonymsMatched, [{ term: 'sales', field: 'Net Sales' }]);
});

test('ambiguous aliases report only the fields grounded by each alternative', () => {
  const r = ask('sum amount', [{ name: 'revenue', type: 'DECIMAL', synonyms: ['amount'] }, { name: 'profit', type: 'DECIMAL', synonyms: ['amount'] }]);
  assert.equal(r.interpretations.length, 2);
  for (const i of r.interpretations) assert.deepEqual(i.grounding.synonymsMatched, [{ term: 'amount', field: i.measure }]);
});

test('unmatched terms retain their diagnostic and confidence penalty without invented fields', () => {
  const r = ask('sum revenue by region blargh whoosh');
  assert.deepEqual(r.interpretations[0].grounding.unmatchedTerms, ['blargh', 'whoosh']);
  assert.equal(r.errors[0].code, 'UNRECOGNIZED_WORDS'); assert.equal(r.interpretations[0].confidence, 0.68);
  for (const q of ['sum unicorn by region', 'sum revenue by unicorn', 'sum revenue where unicorn is x']) {
    assert.equal(ask(q).interpretations.length, 0);
  }
});

test('steps expose all current values without sharing mutable dimension/filter objects', () => {
  const i = first('sum sales by region and order_date yearly for category Hardware top 5');
  const steps = interpretationSteps(i);
  assert.deepEqual(steps, [
    { kind: 'aggregation', value: 'SUM' }, { kind: 'measure', value: 'revenue' },
    { kind: 'group-by', values: ['region', 'order_date'] },
    { kind: 'filter', value: { field: 'category', operator: 'equals', value: 'Hardware' } },
    { kind: 'top-n', value: 5 }, { kind: 'granularity', value: 'YEAR' }, { kind: 'visual', value: 'table' },
  ]);
  steps[2].values.pop(); steps[3].value.value = 'Software';
  assert.deepEqual(i.dimensions, ['region', 'order_date']); assert.equal(i.filters[0].value, 'Hardware');
  assert.equal(interpretationSteps(first('count rows')).some(s => s.kind === 'granularity'), false);
});

test('description round-trips ordinary interpretations and describes immutable edits with unchanged wording', () => {
  const i = first('sum revenue by region and order_date yearly for category Hardware top 5');
  assert.equal(describeInterpretation(i), i.explanation);
  const edited = { ...i, aggregation: 'AVG', dimensions: ['order_date'], granularity: 'DAY', filters: [], topN: 3, suggestedVisualType: 'line' };
  assert.equal(describeInterpretation(edited), 'Showing avg of revenue by order_date (day); top 3.');
  assert.equal(interpretationSteps(edited)[0].value, 'AVG');
  assert.equal(i.aggregation, 'SUM');
  const fallback = first('sum revenue by region and category pie');
  assert.equal(fallback.explanation, 'Showing sum of revenue by region and category; table used for this grouping.');
  assert.equal(describeInterpretation(fallback, 'pie'), fallback.explanation);
});
