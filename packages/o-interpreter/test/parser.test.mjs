import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretQuestion } from '../dist/index.js';
const schema = [
  { name: 'Sales', type: 'DECIMAL' }, { name: 'Profit', type: 'NUMBER' },
  { name: 'Region', type: 'STRING' }, { name: 'Customer Name', type: 'STRING' },
  { name: 'Order Date', type: 'DATETIME' },
];
const ask = (q, fields = schema) => interpretQuestion(q, fields);
const first = q => { const r = ask(q); assert.ok(r.interpretations.length, JSON.stringify(r)); return r.interpretations[0]; };
for (const [word, expected] of [['sum', 'SUM'], ['average', 'AVG'], ['count', 'COUNT'], ['min', 'MIN'], ['maximum', 'MAX']]) {
  test(`${word} binds an explicit aggregation and measure`, () => {
    const i = first(`${word} of Sales by Region`);
    assert.equal(i.aggregation, expected); assert.equal(i.measure, 'Sales'); assert.deepEqual(i.dimensions, ['Region']);
    assert.equal(i.confidence, 0.98);
  });
}
test('count rows is distinct from count of a nullable field', () => {
  assert.equal(first('count rows').measure, null);
  assert.equal(first('count Region').measure, 'Region');
});
test('multiple dimensions and multiword names retain schema spelling', () => {
  const i = first('sum sales per region and customer name table');
  assert.deepEqual(i.dimensions, ['Region', 'Customer Name']); assert.equal(i.suggestedVisualType, 'table');
});
for (const [phrase, grain] of [['per month', 'MONTH'], ['over time', 'MONTH'], ['yearly', 'YEAR'], ['per quarter', 'QUARTER'], ['daily', 'DAY']]) {
  test(`${phrase} infers date grouping`, () => {
    const i = first(`sum sales ${phrase}`);
    assert.deepEqual(i.dimensions, ['Order Date']); assert.equal(i.granularity, grain); assert.equal(i.suggestedVisualType, 'line');
  });
}
for (const hint of ['pie', 'bar', 'line', 'table', 'trend']) test(`${hint} selects a visual`, () => {
  assert.equal(first(`sum sales ${hint === 'trend' ? '' : 'by region'} ${hint}`).suggestedVisualType, hint === 'trend' ? 'line' : hint);
});
test('year, category and quoted multiword filters are conjunctive and preserve value case', () => {
  const i = first('sum sales in 2024 for region East where customer name is "Ada Lovelace" by region top 5');
  assert.deepEqual(i.filters, [
    { field: 'Order Date', operator: 'year', value: 2024 }, { field: 'Region', operator: 'equals', value: 'East' },
    { field: 'Customer Name', operator: 'equals', value: 'Ada Lovelace' },
  ]); assert.equal(i.topN, 5);
});
test('numeric filters are typed and invalid numeric values fail closed', () => {
  assert.equal(first('sum sales where profit is 12.5').filters[0].value, 12.5);
  assert.equal(ask('sum sales where profit is bananas').interpretations.length, 0);
  assert.equal(ask(`sum sales where profit is ${'9'.repeat(400)}`).interpretations.length, 0);
  assert.equal(ask('sum sales where order date is 2025-02-30').interpretations.length, 0);
});
test('omitted aggregation ranks sum before average; output is repeatable', () => {
  const r = ask('Sales by Region');
  assert.deepEqual(r.interpretations.map(i => i.aggregation), ['SUM', 'AVG']);
  assert.ok(r.interpretations[0].confidence > r.interpretations[1].confidence);
  assert.deepEqual(r, ask('Sales by Region'));
});
test('ambiguous suffixes, date fields and explicit multiple measures produce alternatives', () => {
  const r = ask('sum sales per month', [
    { name: 'Net Sales', type: 'DECIMAL' }, { name: 'Gross Sales', type: 'DECIMAL' },
    { name: 'Order Date', type: 'DATETIME' }, { name: 'Ship Date', type: 'DATETIME' },
  ]);
  assert.equal(r.interpretations.length, 4); assert.ok(r.errors.some(e => e.code === 'AMBIGUOUS_QUESTION'));
  assert.equal(ask('sum Sales or Profit by Region').interpretations.length, 2);
});
test('exact field names beat aliases; sales can resolve to revenue with reduced confidence', () => {
  assert.equal(first('sum sales').measure, 'Sales');
  const i = ask('sum sales', [{ name: 'revenue', type: 'DECIMAL' }]).interpretations[0];
  assert.equal(i.measure, 'revenue'); assert.ok(i.confidence < 0.98);
});
test('unknown words reduce confidence and gibberish/blank inputs give named diagnostics', () => {
  assert.ok(first('sum sales blargh whoosh zzz').confidence < 0.6);
  for (const q of ['', 'zzzz 🐙 !', 'constructor', '__proto__', "'; DROP TABLE sales; --"]) {
    const r = ask(q); assert.equal(r.interpretations.length, 0); assert.ok(r.errors.every(e => e.code && e.message));
  }
  assert.equal(first('sum sales constructor __proto__').aggregation, 'SUM');
});
test('unresolved filter/dimension/date intent never silently drops a clause', () => {
  for (const q of ['sum sales by unicorn', 'sum sales where unknown is x', 'sum sales for region', 'sum sales in yesterday', 'sum sales top 0', 'sum sales top 1.5', 'sum sales top 5']) {
    assert.equal(ask(q).interpretations.length, 0, q);
  }
  assert.equal(ask('sum sales in 2024', schema.filter(f => f.type !== 'DATETIME')).interpretations.length, 0);
});
test('schema and input bounds yield diagnostics, without throwing', () => {
  for (const fields of [[], [{ name: '{unsafe}', type: 'NUMBER' }], [...schema, schema[0]]]) assert.equal(ask('sales', fields).errors[0].code, 'INVALID_SCHEMA');
  assert.equal(ask('x'.repeat(2001)).errors[0].code, 'INPUT_LIMIT');
});
test('unsupported negation, disjunction and incomplete filter conjunctions fail closed', () => {
  for (const q of ['sum sales where region is not East', 'sum sales where region is East or West', 'sum sales for region East and customer name is Ada']) {
    const r = ask(q); assert.equal(r.interpretations.length, 0, q); assert.ok(r.errors.some(e => e.code === 'UNSUPPORTED_FILTER'));
  }
  assert.equal(first('sum sales where profit is -12.5').filters[0].value, -12.5);
  assert.equal(first('sum sales for region "North and West"').filters[0].value, 'North and West');
});
test('bounded generated questions never throw, and their rankings and confidence remain valid', () => {
  const fragments = ['sales', 'sum', 'where', 'by', 'region', 'top', 'in', '🌿', 'is', 'xyz', '-5', '2024', '"West"'];
  let seed = 42;
  for (let i = 0; i < 300; i++) {
    const q = Array.from({ length: 7 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return fragments[seed % fragments.length]; }).join(' ');
    const result = ask(q);
    assert.ok(result.interpretations.length <= 12);
    result.interpretations.forEach((r, j) => { assert.ok(r.confidence >= 0 && r.confidence <= 1); if (j) assert.ok(result.interpretations[j - 1].confidence >= r.confidence); });
  }
});
