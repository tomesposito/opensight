import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, CompileError } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import { insightGraphic } from '../build/test/insight-graphic.js';
import { DARK_THEME } from '../build/test/themes.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../build/test/authoring.js';
import { normalizeInsight, validateInsightConfiguration } from '../build/test/insight-configuration.js';
const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const input = (rows = [{ category: 'A', revenue: 100 }, { category: 'B', revenue: 300 }]) => ({ source: 'bundle', path: '$.insight', bindings: {}, rows, definition: { insightVisual: { visualId: 'insight', chartConfiguration: { fieldWells: { insightAggregatedFieldWells: { category: [dim('category')], values: [measure('revenue')] } } } } } });
const body = source => source.definition.insightVisual;
const wells = source => body(source).chartConfiguration.fieldWells.insightAggregatedFieldWells;

test('insight structural validation checks every explicit binding slot in every computation (issue #297)', () => {
  const slots = {
    totalAggregation: ['value'], maximumMinimum: ['time', 'value'], topBottomRanked: ['category', 'value'],
    growthRate: ['time', 'value'], periodOverPeriod: ['time', 'value'], metricComparison: ['time', 'fromValue', 'targetValue'],
    forecast: ['time', 'value'], periodToDate: ['time', 'value'], uniqueValues: ['category'],
    topBottomMovers: ['category', 'time', 'value'], anomaly: ['time', 'value'],
  };
  for (const [kind, keys] of Object.entries(slots)) {
    const options = kind === 'maximumMinimum' ? { type: 'MAXIMUM' } : ['topBottomRanked', 'topBottomMovers'].includes(kind) ? { type: 'TOP' } : {};
    const configuration = { computations: [{ [kind]: { computationId: 'c', ...options } }] };
    assert.doesNotThrow(() => validateInsightConfiguration(configuration), `${kind}: optional bindings`);
    for (const slot of keys) {
      for (const raw of [null, [], 'region', {}, { unsupportedDimensionField: {} }, { ...dim('region'), ...measure('revenue') }]) {
        const malformed = { computations: [{ [kind]: { computationId: 'c', ...options, [slot]: raw } }] };
        assert.throws(() => validateInsightConfiguration(malformed), /INSIGHT_(FIELD_UNBOUND|CONFIGURATION_INVALID)/, `${kind}.${slot}`);
      }
    }
  }
});

test('insight binding shape and SUM semantics agree in structural validation and normalization', () => {
  const dimensions = [{ id: 'category', column: 'category', dataSet: 'data' }];
  const measures = [{ id: 'revenue', column: 'revenue', dataSet: 'data' }];
  for (const [kind, slot, create] of [['uniqueValues', 'category', () => dim('category')], ['totalAggregation', 'value', () => measure('revenue')]]) {
    const mutations = [
      [raw => { raw[Object.keys(raw)[0]] = null; }, 'CONFIGURATION_INVALID'],
      [raw => { Object.values(raw)[0].fieldId = 1; }, 'FIELD_UNBOUND'],
      [raw => { delete Object.values(raw)[0].fieldId; }, 'FIELD_UNBOUND'],
      [raw => { Object.values(raw)[0].extra = true; }, 'CONFIGURATION_UNSUPPORTED'],
      [raw => { Object.values(raw)[0].column = []; }, 'CONFIGURATION_INVALID'],
      [raw => { Object.values(raw)[0].column.columnName = 1; }, 'FIELD_UNBOUND'],
      [raw => { delete Object.values(raw)[0].column.columnName; }, 'FIELD_UNBOUND'],
      [raw => { Object.values(raw)[0].column.dataSetIdentifier = 1; }, 'FIELD_UNBOUND'],
      [raw => { Object.values(raw)[0].column.extra = true; }, 'CONFIGURATION_UNSUPPORTED'],
      [raw => { Object.values(raw)[0].dateGranularity = 'MONTH'; }, 'CONFIGURATION_UNSUPPORTED'],
    ];
    if (slot === 'value') mutations.push(
      [raw => { delete raw.numericalMeasureField.aggregationFunction; }, 'CONFIGURATION_INVALID'],
      [raw => { raw.numericalMeasureField.aggregationFunction = []; }, 'CONFIGURATION_INVALID'],
      [raw => { raw.numericalMeasureField.aggregationFunction = {}; }, 'FIELD_UNBOUND'],
      [raw => { raw.numericalMeasureField.aggregationFunction.simpleNumericalAggregation = 'AVERAGE'; }, 'FIELD_UNBOUND'],
      [raw => { raw.numericalMeasureField.aggregationFunction.extra = true; }, 'CONFIGURATION_UNSUPPORTED'],
      [raw => { raw.numericalMeasureField.aggregationFunction = { percentileAggregation: { percentileValue: 50 } }; }, 'CONFIGURATION_UNSUPPORTED'],
    );
    else mutations.push([raw => { raw.categoricalDimensionField.aggregationFunction = { simpleNumericalAggregation: 'SUM' }; }, 'CONFIGURATION_UNSUPPORTED']);
    for (const [mutate, code] of mutations) {
      const raw = create(); mutate(raw);
      const configuration = { computations: [{ [kind]: { computationId: 'c', [slot]: raw } }] };
      const matches = error => error.code === `INSIGHT_${code}`;
      assert.throws(() => validateInsightConfiguration(configuration), matches);
      assert.throws(() => normalizeInsight(configuration, dimensions, measures), matches);
    }
    const wrongVariant = { computations: [{ [kind]: { computationId: 'c', [slot]: slot === 'value' ? dim('category') : measure('revenue') } }] };
    assert.throws(() => validateInsightConfiguration(wrongVariant), /INSIGHT_FIELD_UNBOUND/);
  }
});

test('insight structural validation accepts supported dimension variants without resolving fields', () => {
  for (const variant of ['categoricalDimensionField', 'numericalDimensionField', 'dateDimensionField']) {
    const grains = variant === 'dateDimensionField' ? [undefined, 'DAY', 'MONTH', 'QUARTER', 'YEAR'] : [undefined];
    for (const dateGranularity of grains) {
      const field = { fieldId: 'unassigned', column: { columnName: 'missing' }, ...(dateGranularity ? { dateGranularity } : {}) };
      const configuration = { computations: [{ uniqueValues: { computationId: 'c', category: { [variant]: field } } }] };
      assert.doesNotThrow(() => validateInsightConfiguration(configuration));
      assert.throws(() => normalizeInsight(configuration, [{ id: 'region', column: 'region' }], []), /INSIGHT_FIELD_UNBOUND/);
    }
  }
  for (const dateGranularity of [null, 1, {}, 'WEEK']) {
    const configuration = { computations: [{ uniqueValues: { computationId: 'c', category: { dateDimensionField: {
      fieldId: 'date', column: { columnName: 'date' }, dateGranularity,
    } } } }] };
    assert.throws(() => validateInsightConfiguration(configuration), /INSIGHT_FIELD_UNBOUND/);
  }
});

test('insight compiler emits graphic narrative text, computed emphasis, theme and unchanged data rows', () => {
  const source = input(), before = structuredClone(source); source.theme = DARK_THEME;
  const c = compileVisual(source);
  assert.equal(c.model.kind, 'insight'); assert.equal(c.state, 'ready'); assert.equal(c.option.series, undefined);
  assert.match(c.narrative.text, /Total revenue: 400/); assert.match(c.narrative.text, /B \(300, 75.00% of total\)/);
  assert.ok(c.option.graphic.some(g => g.style.text === '400' && g.style.fontWeight === 700));
  assert.ok(c.option.graphic.every(g => g.style.fill === DARK_THEME.textColor && g.style.fontFamily === DARK_THEME.fontFamily));
  assert.deepEqual(c.table.rows, [['A', 100], ['B', 300]]);
  delete source.theme; assert.deepEqual(source, before);
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 560, height: 300 });
  try { chart.setOption(c.option); const svg = chart.renderToSVGString(); assert.match(svg, />400</); assert.doesNotMatch(svg, /NaN|Infinity/); }
  finally { chart.dispose(); }
});
test('insight compiler uses the real pinned fixture query results including optional comparison', () => {
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'insight' });
  draft = authorReducer(draft, { type: 'assign', well: 'values', field: 'profit' });
  const visual = activeSheet(draft).visuals[0], result = executeFixtureQuery(buildAuthorQuery(visual));
  assert.ok(result.rows, result.message);
  const c = compileVisual({ source: 'bundle', path: '$', rows: result.rows, bindings: {}, definition: serializeVisual(visual) });
  assert.equal(c.narrative.paragraphs[0].parts.find(p => p.value !== undefined).value, result.rows.reduce((sum, row) => sum + row.revenue, 0));
  assert.match(c.narrative.text, /revenue vs profit/);
});
test('compiler checks insight wells and computation errors before unavailable rows', () => {
  for (const [slot, values, code] of [['category', [], 'CATEGORY'], ['category', [dim('A'), dim('B')], 'CATEGORY'], ['values', [], 'VALUES'], ['values', [measure('A'), measure('B'), measure('C')], 'VALUES']]) {
    const source = input(null); wells(source)[slot] = values;
    assert.throws(() => compileVisual(source), e => e instanceof CompileError && e.message.includes(`INSIGHT_${code}_REQUIRED`));
  }
  for (const [kind, code] of [['forecast', 'TIME_REQUIRED'], ['periodToDate', 'TIME_REQUIRED'], ['anomaly', 'TIME_REQUIRED'], ['growthRate', 'TIME_REQUIRED'], ['periodOverPeriod', 'TIME_REQUIRED'], ['metricComparison', 'VALUES_REQUIRED']]) {
    const source = input(null); body(source).insightConfiguration = { computations: [{ [kind]: { computationId: 'c' } }] };
    assert.throws(() => compileVisual(source), new RegExp(`INSIGHT_${code}`));
  }
  // Movers are supported now, but on a single non-date dimension they fail
  // closed with CATEGORY_REQUIRED (a Category and a Time dimension are needed).
  const movers = input(null); body(movers).insightConfiguration = { computations: [{ topBottomMovers: { computationId: 'c', type: 'TOP' } }] };
  assert.throws(() => compileVisual(movers), /INSIGHT_CATEGORY_REQUIRED/);
  const source = input(null); body(source).insightConfiguration = { customNarrative: { narrative: '${forecast.result}' } };
  assert.throws(() => compileVisual(source), /INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED.*bounded subset/);
  body(source).insightConfiguration = { customNarrative: { narrative: 'Revenue {field.revenue}' } };
  assert.equal(compileVisual({ ...source, rows: [{ category: 'East', revenue: 42 }] }).narrative.text, 'Revenue 42');
});
test('empty and unavailable insight panels contain no manufactured totals', () => {
  for (const [rows, state] of [[[], 'empty'], [null, 'unavailable']]) { const c = compileVisual(input(rows)); assert.equal(c.state, state); assert.equal(c.narrative.text, ''); assert.deepEqual(c.option.graphic, []); }
});
test('narrative layout wraps long categories and treats markup as plain text', () => {
  const source = input([{ category: '{value|<script>evil</script>}' + 'long'.repeat(45), revenue: 1 }]);
  const c = compileVisual(source), layout = insightGraphic(c.narrative, DARK_THEME, 20, 180);
  assert.ok(layout.height > 300); assert.ok(layout.graphic.every(g => !g.style.rich && g.x >= 16));
  assert.equal(layout.graphic.map(g => g.style.text).join('').includes('<script>'), true);
  const grouped = insightGraphic(compileVisual(input()).narrative, DARK_THEME, 16, 342);
  for (const g of grouped.graphic) if (g.style.text === ').' || g.style.text === '.') assert.ok(g.x > 16, 'punctuation must stay with its word');
});

test('period preview consumes real grouped-date aliases from the pinned query engine', () => {
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'insight' });
  draft = authorReducer(draft, { type: 'assign', field: 'order_date', well: 'dimension' });
  draft = authorReducer(draft, { type: 'insight', configuration: { computations: [{ growthRate: { computationId: 'growth' } }] } });
  for (const dateGrain of ['DAY', 'MONTH', 'QUARTER', 'YEAR']) {
    const visual = { ...activeSheet(draft).visuals[0], dateGrain };
    const result = executeFixtureQuery(buildAuthorQuery(visual)); assert.ok(result.rows, result.message);
    const c = compileVisual({ ...buildAuthorVisual(visual), rows: result.rows });
    assert.equal(c.state, 'ready'); assert.match(c.narrative.text, /Growth rate for revenue/);
    if (dateGrain === 'MONTH') assert.match(c.narrative.text, /2025-04 vs 2025-03: 250 vs 50; change 200 \(400.00%\)/);
  }
});
