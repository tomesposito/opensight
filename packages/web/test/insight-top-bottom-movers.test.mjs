import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, rebindInsight, topBottomMoversOnly, topBottomMoversTimeColumn, InsightError } from '../build/test/insight-configuration.js';
import { insightNarrative } from '../build/test/insight-narrative.js';
import { compileVisual, CompileError } from '../build/test/compiler.js';

const field = column => ({ id: column, column, dataSet: 'sales' });
const category = field('region'), measure = field('revenue');
const time = { ...field('month'), dateGranularity: 'MONTH' };
const configuration = (body = {}) => ({ computations: [{ topBottomMovers: { computationId: 'movers', type: 'TOP', ...body } }] });
const catField = f => ({ categoricalDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet } } });
const dateField = f => ({ dateDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, dateGranularity: f.dateGranularity } });
const value = f => ({ numericalMeasureField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const error = code => e => e instanceof InsightError && e.code === code;

test('movers normalization defaults size 3 and percent difference, honors explicit options, without mutation', () => {
  const config = configuration({ name: 'Revenue movers' }), before = structuredClone(config);
  assert.deepEqual(normalizeInsight(config, [category, time], [measure]), [{ kind: 'topBottomMovers', id: 'movers', measure: 0, type: 'TOP', size: 3, sortOrder: 'PERCENT_DIFFERENCE' }]);
  assert.deepEqual(config, before);
  assert.deepEqual(normalizeInsight(configuration({ type: 'BOTTOM', moverSize: 20, sortOrder: 'ABSOLUTE_DIFFERENCE' }), [category, time], [measure]),
    [{ kind: 'topBottomMovers', id: 'movers', measure: 0, type: 'BOTTOM', size: 20, sortOrder: 'ABSOLUTE_DIFFERENCE' }]);
  assert.equal(topBottomMoversOnly(configuration()), true);
  assert.equal(topBottomMoversOnly({ computations: [{ totalAggregation: { computationId: 't' } }] }), false);
});

test('movers rejects malformed bodies, mixing, and bad dimension bindings before execution', () => {
  for (const body of [{ type: undefined }, { type: 'MIDDLE' }, { type: 'top' }, { moverSize: 0 }, { moverSize: 21 }, { moverSize: 1.5 }, { moverSize: '3' }, { sortOrder: 'PERCENT' }, { sortOrder: null }]) {
    assert.throws(() => insightWells(configuration(body)), error('INSIGHT_COMPUTATION_INVALID'), JSON.stringify(body));
    assert.throws(() => normalizeInsight(configuration(body), [category, time], [measure]), error('INSIGHT_COMPUTATION_INVALID'), JSON.stringify(body));
  }
  assert.throws(() => insightWells(configuration({ future: true })), error('INSIGHT_CONFIGURATION_UNSUPPORTED'));
  const mixed = { computations: [...configuration().computations, { totalAggregation: { computationId: 't' } }] };
  assert.throws(() => normalizeInsight(mixed, [category, time], [measure]), error('INSIGHT_COMPUTATION_INVALID'));
  assert.equal(topBottomMoversOnly(mixed), false);
  // Exactly two dimensions: category first, time (dated) second.
  assert.throws(() => normalizeInsight(configuration(), [category], [measure]), error('INSIGHT_CATEGORY_REQUIRED'));
  assert.throws(() => normalizeInsight(configuration(), [category, field('country')], [measure]), error('INSIGHT_TIME_REQUIRED'));
  assert.throws(() => normalizeInsight(configuration(), [category, category], [measure]), error('INSIGHT_TIME_REQUIRED'));
  const sameField = configuration({ category: catField(category), time: dateField({ ...category, dateGranularity: 'MONTH' }) });
  assert.throws(() => normalizeInsight(sameField, [category, time], [measure]), error('INSIGHT_FIELD_UNBOUND'));
  const unbound = configuration({ category: catField(field('country')) });
  assert.throws(() => normalizeInsight(unbound, [category, time], [measure]), error('INSIGHT_FIELD_UNBOUND'));
});

test('movers projects category and time wells in order and rebinds each by column', () => {
  const config = configuration({ category: catField(category), time: dateField(time), value: value(measure), moverSize: 5 });
  assert.deepEqual(insightWells(config), { category: [catField(category), dateField(time)], values: [value(measure)] });
  assert.equal(topBottomMoversTimeColumn(config), 'month');
  assert.equal(topBottomMoversTimeColumn({ computations: [{ totalAggregation: { computationId: 't' } }] }), undefined);
  const newCategory = field('country'), newTime = { ...field('invoice_month'), dateGranularity: 'MONTH' }, newMeasure = field('profit');
  const rebound = rebindInsight(config, [catField(newCategory), dateField(newTime)], [value(newMeasure)]);
  assert.deepEqual(insightWells(rebound), { category: [catField(newCategory), dateField(newTime)], values: [value(newMeasure)] });
  assert.deepEqual(normalizeInsight(rebound, [newCategory, newTime], [newMeasure]), [{ kind: 'topBottomMovers', id: 'movers', measure: 0, type: 'TOP', size: 5, sortOrder: 'PERCENT_DIFFERENCE' }]);
});

const narrative = (rows, body = {}, formatting) => insightNarrative(rows, { category, time, measures: [measure], computations: configuration(body), formatting });
const rowsOf = entries => entries.map(([cat, month, n]) => ({ category: cat, time: month, values: [n] }));
const base = rowsOf([['East', '2024-01', 100], ['East', '2024-02', 150], ['West', '2024-01', 200], ['West', '2024-02', 100], ['North', '2024-01', 50], ['North', '2024-02', 100]]);

test('movers ranks top and bottom by percent difference against the preceding calendar period', () => {
  const top = narrative(base), before = structuredClone(base);
  assert.equal(top.text, 'Top movers revenue (2024-02 vs 2024-01): North (50 → 100; 50, 100.00%); East (100 → 150; 50, 50.00%); West (200 → 100; -100, -50.00%).');
  assert.deepEqual(narrative(base.toReversed()), top);
  assert.deepEqual(base, before);
  assert.equal(narrative(base, { type: 'BOTTOM' }).text, 'Bottom movers revenue (2024-02 vs 2024-01): West (200 → 100; -100, -50.00%); East (100 → 150; 50, 50.00%); North (50 → 100; 50, 100.00%).');
  assert.equal(narrative(base, { moverSize: 1 }).text, 'Top movers revenue (2024-02 vs 2024-01): North (50 → 100; 50, 100.00%).');
});

test('movers ranks by absolute difference when asked, with deterministic typed ties', () => {
  // East and North tie at +50; typed category order puts East first.
  assert.equal(narrative(base, { sortOrder: 'ABSOLUTE_DIFFERENCE' }).text, 'Top movers revenue (2024-02 vs 2024-01): East (100 → 150; 50, 50.00%); North (50 → 100; 50, 100.00%); West (200 → 100; -100, -50.00%).');
  assert.equal(narrative(base, { sortOrder: 'ABSOLUTE_DIFFERENCE', type: 'BOTTOM' }).text, 'Bottom movers revenue (2024-02 vs 2024-01): West (200 → 100; -100, -50.00%); East (100 → 150; 50, 50.00%); North (50 → 100; 50, 100.00%).');
});

test('movers excludes categories without a value in both periods and discloses the count', () => {
  const rows = [...base, ...rowsOf([['South', '2024-02', 70], ['Gap', '2023-12', 10], ['Gap', '2024-02', 40], ['Null', '2024-01', null], ['Null', '2024-02', 5]])];
  // South has no preceding period, Gap has no 2024-01 (an older period is never
  // substituted), Null has a null preceding value: all three are excluded.
  assert.equal(narrative(rows).text, 'Top movers revenue (2024-02 vs 2024-01): North (50 → 100; 50, 100.00%); East (100 → 150; 50, 50.00%); West (200 → 100; -100, -50.00%). 3 categories excluded (no value in both periods or no computable percent change).');
});

test('movers percent ranking excludes a zero previous value; absolute ranking keeps it with an unavailable percent', () => {
  const rows = rowsOf([['East', '2024-01', 0], ['East', '2024-02', 100], ['West', '2024-01', 50], ['West', '2024-02', 75]]);
  assert.equal(narrative(rows).text, 'Top movers revenue (2024-02 vs 2024-01): West (50 → 75; 25, 50.00%). 1 category excluded (no value in both periods or no computable percent change).');
  assert.equal(narrative(rows, { sortOrder: 'ABSOLUTE_DIFFERENCE' }).text, 'Top movers revenue (2024-02 vs 2024-01): East (0 → 100; 100, unavailable); West (50 → 75; 25, 50.00%).');
});

test('movers reports an honest unavailable sentence when no category is eligible, and keeps the empty state', () => {
  const rows = rowsOf([['East', '2024-02', 100], ['West', '2024-02', 50]]);
  const result = narrative(rows);
  assert.equal(result.text, 'Top movers revenue (2024-02 vs 2024-01): unavailable (no category has a value in both periods). 2 categories excluded (no value in both periods or no computable percent change).');
  assert.deepEqual(result.paragraphs[0].parts.filter(p => p.value !== undefined), []);
  assert.deepEqual(narrative([]), { paragraphs: [], text: '' });
});

test('movers labels quarter and year periods and fails closed on duplicate pairs and invalid times', () => {
  const quarterTime = { ...field('quarter'), dateGranularity: 'QUARTER' };
  const q = insightNarrative([{ category: 'East', time: '2024-Q1', values: [10] }, { category: 'East', time: '2024-Q2', values: [30] }],
    { category, time: quarterTime, measures: [measure], computations: configuration() });
  assert.equal(q.text, 'Top movers revenue (2024-Q2 vs 2024-Q1): East (10 → 30; 20, 200.00%).');
  assert.throws(() => narrative([...base, base[0]]), error('INSIGHT_VALUE_INVALID'));
  assert.throws(() => narrative(rowsOf([['East', 'not-a-month', 1]])), error('INSIGHT_TIME_REQUIRED'));
  assert.throws(() => narrative(rowsOf([['East', '2024-02', Infinity]])), error('INSIGHT_VALUE_INVALID'));
});

test('compiler executes movers over two wells and keeps grouped rows unchanged', () => {
  const definition = { insightVisual: { visualId: 'movers-insight', insightConfiguration: configuration({ category: catField(category), time: dateField(time), value: value(measure) }),
    chartConfiguration: { fieldWells: { insightAggregatedFieldWells: { category: [catField(category), dateField(time)], values: [value(measure)] } } } } };
  const rows = base.map(r => ({ region: r.category, month: r.time, revenue: r.values[0] })), before = structuredClone(rows);
  const compiled = compileVisual({ source: 'bundle', path: '$', bindings: {}, rows, definition });
  assert.equal(compiled.state, 'ready');
  assert.equal(compiled.narrative.text, 'Top movers revenue (2024-02 vs 2024-01): North (50 → 100; 50, 100.00%); East (100 → 150; 50, 50.00%); West (200 → 100; -100, -50.00%).');
  assert.deepEqual(compiled.table.rows, base.map(r => [r.category, r.time, r.values[0]]));
  assert.deepEqual(rows, before);
  const mixed = structuredClone(definition);
  mixed.insightVisual.insightConfiguration.computations.push({ totalAggregation: { computationId: 't' } });
  // Mixing is INSIGHT_COMPUTATION_INVALID at the configuration layer (above);
  // in the compiler the two-dimension wells check fires first — either way the
  // visual fails closed with a named error and never executes.
  assert.throws(() => compileVisual({ source: 'bundle', path: '$', bindings: {}, rows, definition: mixed }), e => e instanceof CompileError && /INSIGHT_CATEGORY_REQUIRED/.test(e.message));
});
