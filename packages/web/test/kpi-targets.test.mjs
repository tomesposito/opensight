import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { projectDefinition, convertDefinition } from '../build/test/definition-converter.js';
const measure = (id = 'target', column = 'budget', aggregation = 'SUM') => ({ numericalMeasureField: {
  fieldId: id, column: { dataSetIdentifier: 'data', columnName: column }, aggregationFunction: { simpleNumericalAggregation: aggregation },
} });
const dimension = () => ({ categoricalDimensionField: { fieldId: 'period', column: { dataSetIdentifier: 'data', columnName: 'period' } } });
const input = (trend = false) => ({ source: 'bundle', path: '$', bindings: {}, rows: [{ period: 'A', revenue: 10, budget: 20 }], definition: {
  kpiVisual: { visualId: 'kpi', chartConfiguration: { fieldWells: { values: [measure('value', 'revenue')], targetValues: [measure()], ...(trend ? { trendGroups: [dimension()] } : {}) } } },
} });
const config = v => v.definition.kpiVisual.chartConfiguration;
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (v, source) => source === 'api' ? { ...v, source, definition: projectDefinition(definition(v.definition)).Sheets[0].Visuals[0] } : v;
const normalize = v => normalizeVisual(v.source, v.definition, v.path);
for (const source of ['bundle', 'api']) {
  test(`${source}: one KPI target uses the measure parser and joins result bindings`, () => {
    const v = dialect(input(), source);
    assert.deepEqual(normalize(v).targetMeasure, { id: 'target', column: 'budget', dataSet: 'data' });
    assert.deepEqual(compileVisual({ ...v, bindings: { target: 'goal' }, rows: [{ revenue: 10, goal: 20 }] }).table.rows, [[10, 20]]);
    assert.throws(() => compileVisual({ ...v, rows: [{ revenue: 10 }] }), /missing result column budget/);
    for (const budget of ['20', true, Infinity, NaN]) assert.throws(() => compileVisual({ ...v, rows: [{ revenue: 10, budget }] }), CompileError);
  });
  test(`${source}: target well rejects malformed/multiple fields, duplicate IDs and mixed datasets`, () => {
    for (const targetValues of [null, {}, [null], [{}], [dimension()], [measure(), measure('other')]]) {
      const v = input(); config(v).fieldWells.targetValues = targetValues;
      assert.throws(() => normalize(dialect(v, source)), CompileError);
    }
    const v = input(); config(v).fieldWells.targetValues = [measure('value')];
    assert.throws(() => normalize(dialect(v, source)), /duplicate field IDs/);
    config(v).fieldWells.targetValues = [measure()]; config(v).fieldWells.targetValues[0].numericalMeasureField.column.dataSetIdentifier = 'other';
    assert.throws(() => normalize(dialect(v, source)), /multiple datasets/);
    config(v).fieldWells.targetValues = [measure()]; delete config(v).fieldWells.targetValues[0].numericalMeasureField.aggregationFunction;
    assert.throws(() => normalize(dialect(v, source)), /expected an object/);
  });
  test(`${source}: absent and empty target wells preserve complete compiled output`, () => {
    for (const trend of [false, true]) {
      const v = input(trend); delete config(v).fieldWells.targetValues;
      const empty = structuredClone(v); config(empty).fieldWells.targetValues = [];
      assert.deepEqual(compileVisual(dialect(v, source)), compileVisual(dialect(empty, source)));
      assert.equal('targetMeasure' in normalize(dialect(v, source)), false);
    }
  });
  test(`${source}: other kinds reject nonempty targets and retain empty no-ops`, () => {
    for (const [variant, well, category] of [['barChartVisual', 'barChartAggregatedFieldWells', 'category'], ['tableVisual', 'tableAggregatedFieldWells', 'groupBy'], ['pivotTableVisual', 'pivotTableAggregatedFieldWells', 'rows']]) {
      const v = input(); v.definition = { [variant]: { visualId: 'v', chartConfiguration: { fieldWells: { [well]: { [category]: [dimension()], values: [measure('value', 'revenue')], targetValues: [measure()] } } } } };
      assert.throws(() => normalize(dialect(v, source)), /field well not supported/);
      v.definition[variant].chartConfiguration.fieldWells[well].targetValues = [];
      const empty = compileVisual(dialect(v, source)); delete v.definition[variant].chartConfiguration.fieldWells[well].targetValues;
      assert.deepEqual(empty, compileVisual(dialect(v, source)));
    }
  });
}
for (const source of ['bundle', 'api']) {
  test(`${source}: target totals follow the primary grain and ignore nulls without inventing zero`, () => {
    const v = input(true); v.rows = [{ period: 'B', revenue: 4, budget: null }, { period: 'A', revenue: 3, budget: 8 }, { period: 'C', revenue: null, budget: 2 }];
    const before = structuredClone(v), c = compileVisual(dialect(v, source));
    assert.equal(c.kpiTarget.value, 10); assert.equal(c.option.graphic[0].style.text, '7'); assert.deepEqual(v, before);
    assert.deepEqual(c.table.rows, [['A', 3, 8], ['B', 4, null], ['C', null, 2]]);
    for (const rows of [[], null, [{ period: 'A', revenue: 4, budget: null }], [{ period: 'A', revenue: 4, budget: null }, { period: 'B', revenue: null, budget: null }]]) {
      assert.equal(compileVisual(dialect({ ...v, rows }, source)).kpiTarget.value, null);
    }
    assert.equal(compileVisual(dialect(input(), source)).kpiTarget.value, 20);
    assert.throws(() => compileVisual(dialect({ ...input(), rows: [input().rows[0], input().rows[0]] }, source)), /exactly one aggregate row/);
  });
  test(`${source}: target arithmetic and duplicate trend keys fail closed`, () => {
    const v = input(true); v.rows = [{ period: 'A', revenue: 1, budget: Number.MAX_VALUE }, { period: 'B', revenue: 2, budget: Number.MAX_VALUE }];
    assert.throws(() => compileVisual(dialect(v, source)), /target: KPI total must be finite/);
    v.rows = [input().rows[0], input().rows[0]];
    assert.throws(() => compileVisual(dialect(v, source)), /duplicate trend groups/);
  });
  test(`${source}: trended targets require explicit SUM even for governed metrics`, () => {
    for (const aggregation of ['AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT_COUNT']) {
      const v = input(true); config(v).fieldWells.targetValues = [measure('target', '__metric_budget', aggregation)];
      assert.throws(() => normalize(dialect(v, source)), /trended KPI requires an explicit SUM/);
      delete config(v).fieldWells.trendGroups;
      assert.equal(normalize(dialect(v, source)).targetMeasure.column, '__metric_budget');
    }
  });
}
import { buildAuthorQuery } from '../build/test/author-query.js';
import { publishedBindings } from '../build/test/published-dashboard.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
const selected = d => activeSheet(d).visuals.find(v => v.id === activeSheet(d).selectedId);
const kpiDraft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' });
test('author target queries preserve trend grain and calculated dependencies; missing target fails closed', () => {
  const visual = { ...selected(kpiDraft()), measures: ['revenue'], targetField: 'profit' };
  for (const trendField of [undefined, 'region', 'order_date']) {
    const query = buildAuthorQuery({ ...visual, trendField });
    assert.deepEqual(query.measures, ['revenue', 'profit'].map(name => ({ fieldId: name, columnName: name, aggregation: 'SUM' })));
    assert.deepEqual(query.dimensions, trendField ? [{ fieldId: trendField, columnName: trendField, ...(trendField === 'order_date' ? { granularity: 'MONTH' } : {}) }] : []);
  }
  const calculations = [{ name: 'goal', expression: '{profit} * 2', role: 'measure' }];
  assert.deepEqual(buildAuthorQuery({ ...visual, targetField: 'goal' }, calculations).calculatedFields, [{ name: 'goal', expression: '{profit} * 2' }]);
  assert.equal(buildAuthorQuery(visual, [], [], { id: 'd', name: 'Data', columns: [{ name: 'revenue', type: 'DECIMAL' }] }), null);
});
test('published bindings include distinct native target IDs and date trend aliases', () => {
  for (const source of ['bundle', 'api']) {
    const v = input(true); config(v).fieldWells.trendGroups = [{ dateDimensionField: { ...dimension().categoricalDimensionField, dateGranularity: 'MONTH' } }];
    assert.deepEqual(publishedBindings(dialect(v, source)), { value: 'value', target: 'target', period: 'month' });
    assert.equal(compileVisual({ ...dialect(v, source), bindings: publishedBindings(dialect(v, source)), rows: [{ month: '2026-01', value: 4, target: 8 }] }).kpiTarget.value, 8);
  }
});
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisualCard } from '../build/test/VisualCard.js';
const markup = v => renderToStaticMarkup(React.createElement(VisualCard, { visual: { ...v, placement: { column: 0, columns: 36, row: 0, rows: 6 } } }));
for (const source of ['bundle', 'api']) {
  test(`${source}: target text and accessible data remain when the progress bar is absent or hidden`, () => {
    const v = input();
    for (const progressBar of [undefined, { visibility: 'HIDDEN' }]) {
      config(v).kpiOptions = progressBar ? { progressBar } : {};
      const c = compileVisual(dialect(v, source));
      assert.ok(c.option.graphic.some(g => g.style?.text === 'Target: 20'));
      assert.deepEqual(c.table.columns, ['revenue', 'Target: budget']);
      assert.equal(c.kpiTarget.progress, undefined);
      assert.match(markup(dialect(v, source)), /Target: budget/);
    }
  });
  test(`${source}: progress bar uses actual primary / target and clamps only the visual fill`, () => {
    const v = input(); config(v).kpiOptions = { progressBar: {} };
    for (const [revenue, ratio, percent, label] of [[10, 0.5, 50, '50% of target'], [30, 1.5, 100, '150% of target'], [-10, -0.5, 0, '-50% of target'], [0, 0, 0, '0% of target']]) {
      v.rows[0].revenue = revenue;
      const c = compileVisual(dialect(v, source));
      assert.deepEqual(c.kpiTarget.progress, { ratio, percent, label });
      assert.equal(c.option.graphic.find(g => g.id === 'kpi-progress').children[1].shape.width, percent * 2);
      assert.equal(c.model.warnings.some(w => w.includes('progressBar')), false);
      assert.match(markup(dialect(v, source)), new RegExp(`aria-valuetext="${label}"`));
    }
  });
  test(`${source}: unusable targets and primary values omit the bar and explain why`, () => {
    const v = input(); config(v).kpiOptions = { progressBar: {} };
    for (const [revenue, budget, reason] of [[10, null, 'target is null'], [10, 0, 'greater than zero'], [10, -1, 'greater than zero'], [null, 20, 'primary value is null'], [Number.MAX_VALUE, Number.MIN_VALUE, 'ratio is not finite']]) {
      v.rows = [{ revenue, budget }]; const c = compileVisual(dialect(v, source));
      assert.equal(c.kpiTarget.progress, undefined); assert.ok(c.model.warnings.some(w => w.includes(reason)));
      assert.equal(c.option.graphic.some(g => g.id === 'kpi-progress'), false);
    }
    delete config(v).fieldWells.targetValues; v.rows = [{ revenue: 10 }];
    assert.ok(compileVisual(dialect(v, source)).model.warnings.some(w => w.includes('targetValues')));
    assert.equal(compileVisual(dialect(v, source)).kpiTarget, undefined);
  });
}
test('target text and View data use the primary metric format', () => {
  const v = input(); v.definition.kpiVisual.opensightFormatting = { metricFormats: { revenue: { style: 'currency', currency: 'USD', decimalPlaces: 2 } } };
  const c = compileVisual(v);
  assert.equal(c.kpiTarget.label, '$20.00'); assert.equal(c.option.graphic[0].style.text, '$10.00');
  assert.match(markup(v), /\$20\.00/);
});
for (const source of ['bundle', 'api']) {
  test(`${source}: arrows follow last-vs-previous comparison in trend order and have accessible words`, () => {
    const v = input(true); config(v).kpiOptions = { comparison: { comparisonMethod: 'DIFFERENCE' }, trendArrows: {} };
    for (const [current, direction, glyph] of [[15, 'up', '↑'], [5, 'down', '↓']]) for (const primaryValueDisplayType of ['ACTUAL', 'COMPARISON']) {
      v.rows = [{ period: 'B', revenue: current, budget: 20 }, { period: 'A', revenue: 10, budget: 20 }];
      config(v).kpiOptions.primaryValueDisplayType = primaryValueDisplayType;
      const c = compileVisual(dialect(v, source));
      assert.deepEqual(c.kpiTrendArrow, { direction, label: `Trend ${direction}: ${current - 10}` });
      assert.equal(c.option.graphic[primaryValueDisplayType === 'COMPARISON' ? 0 : 1].style.text, `${glyph} ${current - 10}`);
      assert.equal(c.model.warnings.some(w => w.includes('trendArrows')), false);
      const html = markup(dialect(v, source)); assert.match(html, new RegExp(`Trend ${direction}:`)); assert.match(html, /aria-hidden="true"/);
    }
    config(v).sortConfiguration = { trendGroupSort: [{ fieldSort: { fieldId: 'period', direction: 'DESC' } }] };
    assert.equal(compileVisual(dialect(v, source)).kpiTrendArrow.direction, 'up');
  });
  test(`${source}: zero/unavailable comparisons keep an honest note; hidden/absent arrows stay absent`, () => {
    const v = input(true); config(v).kpiOptions = { comparison: { comparisonMethod: 'PERCENT_DIFFERENCE' }, trendArrows: {} };
    for (const values of [[], [1], [10, 10], [null, 1], [1, null], [0, 1], [Number.MAX_VALUE, -Number.MAX_VALUE]]) {
      v.rows = values.map((revenue, i) => ({ period: String(i), revenue, budget: 20 }));
      const c = compileVisual(dialect(v, source)); assert.equal(c.kpiTrendArrow, undefined);
      assert.ok(c.model.warnings.some(w => w.includes('trendArrows')));
    }
    v.rows = [{ period: 'A', revenue: 10, budget: 20 }, { period: 'B', revenue: 15, budget: 20 }];
    for (const trendArrows of [undefined, { visibility: 'HIDDEN' }]) {
      config(v).kpiOptions.trendArrows = trendArrows;
      const c = compileVisual(dialect(v, source)); assert.equal(c.kpiTrendArrow, undefined); assert.equal(c.option.graphic[1].style.text, '50%');
      assert.equal(c.model.warnings.some(w => w.includes('trendArrows')), false);
    }
    config(v).kpiOptions = { trendArrows: {} }; assert.ok(compileVisual(dialect(v, source)).model.warnings.some(w => w.includes('comparison is unavailable')));
  });
}
