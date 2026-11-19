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
import { parseDraft, serializeVisual, dataFields } from '../build/test/authoring.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { interpretQuestion } from '@opensight/o-interpreter';
const targetDraft = (field = 'profit') => authorReducer(kpiDraft(), { type: 'assign', well: 'target', field });
test('target authoring validates storage and preserves last valid state on invalid edits', () => {
  const d = targetDraft(); assert.deepEqual(parseDraft(JSON.stringify(d)), d);
  for (const field of ['region', 'order_id', 'missing', '', null, {}]) assert.equal(selected(authorReducer(d, { type: 'assign', well: 'target', field })), selected(d));
  for (const targetField of ['missing', 'region', ' ', 'profit\0', null, {}, []]) {
    const bad = structuredClone(d); selected(bad).targetField = targetField; assert.throws(() => parseDraft(JSON.stringify(bad)));
  }
  for (const kind of ['bar', 'line', 'table', 'pivot', 'pie', 'gauge']) {
    const other = authorReducer(emptyDraft(), { type: 'add', kind });
    assert.equal(selected(authorReducer(other, { type: 'assign', well: 'target', field: 'profit' })).targetField, undefined);
    selected(other).targetField = 'profit'; assert.throws(() => parseDraft(JSON.stringify(other)));
  }
});
test('removing/replacing target, kind switches and O replacement clear stale target state', () => {
  const d = targetDraft();
  for (const action of [{ type: 'unassign', well: 'target', field: 'profit' }, { type: 'unassign', field: 'profit' }, { type: 'kind', kind: 'bar' }]) assert.equal(selected(authorReducer(d, action)).targetField, undefined);
  assert.equal(selected(authorReducer(d, { type: 'assign', well: 'target', field: 'revenue' })).targetField, 'revenue');
  assert.equal(selected(authorReducer(d, { type: 'title', title: 'Goal' })).targetField, 'profit');
  const v = selected(d); v.o = { question: 'sum revenue', interpretation: interpretQuestion('sum revenue', dataFields([])).interpretations[0] };
  const next = authorReducer(d, { type: 'o-replace', id: v.id, visual: { ...v, targetField: undefined }, calculatedFields: [] });
  assert.equal(selected(next).targetField, undefined); assert.doesNotThrow(() => parseDraft(JSON.stringify(next)));
});
test('authored targets serialize only to targetValues, preview both grains and clear to the old definition', () => {
  const base = kpiDraft(), d = targetDraft();
  const c = config({ definition: serializeVisual(selected(d)) }); assert.deepEqual(Object.keys(c.fieldWells).sort(), ['targetValues', 'values']);
  for (const trendField of [undefined, 'region', 'order_date']) {
    const v = { ...selected(d), trendField }, preview = compileVisual(buildAuthorPreview(v));
    assert.equal(preview.state, 'ready'); assert.ok(preview.kpiTarget.value > 0);
    assert.equal(preview.table.rows.length > 1, !!trendField);
  }
  const cleared = authorReducer(d, { type: 'unassign', well: 'target', field: 'profit' });
  assert.deepEqual(serializeVisual(selected(cleared)), serializeVisual(selected(base)));
  const shared = compileVisual(buildAuthorPreview({ ...selected(d), targetField: 'revenue' }));
  assert.equal(shared.model.targetMeasure.id, 'target:revenue'); assert.equal(shared.table.rows[0][0], shared.table.rows[0][1]);
});
test('Target value well accepts only measures and uses measure labels', () => {
  const html = renderToStaticMarkup(React.createElement(AuthorCanvas, { draft: targetDraft(), dispatch() {} }));
  assert.match(html, /TARGET VALUE/); assert.match(html, /Remove profit from Target value/); assert.match(html, /SUM\(profit\)/);
  const select = /<select[^>]*aria-label="Assign Target value"[\s\S]*?<\/select>/.exec(html)[0];
  assert.match(select, /value="revenue"/); assert.match(select, /value="profit"/); assert.doesNotMatch(select, /value="region"|value="order_date"/);
});
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
const bundleVisual = b => b.members[0].resource.definition.sheets[0].visuals[0];
const bundleConfig = b => bundleVisual(b).kpiVisual.chartConfiguration;
const importDialect = (bundle, source) => {
  const copy = structuredClone(bundle);
  if (source === 'api') copy.members[0].resource.definition = convertDefinition(projectDefinition(copy.members[0].resource.definition));
  return importBundle(copy);
};
for (const source of ['bundle', 'api']) for (const wrapped of [false, true]) test(`${source}, wrapped=${wrapped}: target imports survive storage, edit, clearing and both dialect exports`, () => {
  const b = exportBundle(targetDraft()); const c = bundleConfig(b);
  c.fieldWells.targetValues[0].numericalMeasureField.fieldId = 'native-target';
  c.kpiOptions = { progressBar: { visibility: 'VISIBLE' }, trendArrows: { visibility: 'HIDDEN' } };
  if (wrapped) c.fieldWells = { kpiFieldWells: c.fieldWells };
  const d = importDialect(b, source);
  assert.equal(selected(d).targetField, 'profit'); assert.deepEqual(selected(d).imported.issues, []);
  assert.deepEqual(parseDraft(JSON.stringify(d)), JSON.parse(JSON.stringify(d)));
  assert.deepEqual(bundleVisual(exportBundle(d)), bundleVisual(b));
  assert.ok(compileVisual(buildAuthorPreview(selected(d))).kpiTarget.progress);
  const edited = authorReducer(d, { type: 'title', title: 'Target KPI' });
  assert.equal(normalizeVisual('bundle', bundleVisual(exportBundle(edited))).targetMeasure.id, 'native-target');
  const replaced = authorReducer(d, { type: 'assign', well: 'target', field: 'revenue' });
  assert.equal(selected(importBundle(exportBundle(replaced))).targetField, 'revenue');
  assert.doesNotThrow(() => normalizeVisual('bundle', bundleVisual(exportBundle(replaced))));
  const cleared = authorReducer(d, { type: 'unassign', well: 'target', field: 'profit' });
  assert.equal(normalizeVisual('bundle', bundleVisual(exportBundle(cleared))).targetMeasure, undefined);
  assert.equal(selected(importBundle(exportBundle(cleared))).targetField, undefined);
  for (const candidate of [d, edited, replaced, cleared]) {
    const definition = exportBundle(candidate).members[0].resource.definition;
    assert.deepEqual(convertDefinition(projectDefinition(definition)), definition);
  }
});
for (const source of ['bundle', 'api']) test(`${source}: malformed, unbound and non-SUM trended targets retain diagnostics and verbatim export`, () => {
  const base = exportBundle(authorReducer(targetDraft(), { type: 'assign', well: 'trend', field: 'region' }));
  const target = bundleConfig(base).fieldWells.targetValues[0];
  for (const targets of [null, {}, [null], [{}]]) {
    const b = structuredClone(base); bundleConfig(b).fieldWells.targetValues = targets;
    assert.throws(() => importDialect(b, source), /expected an array|expected an object|expected exactly one variant/);
  }
  for (const targets of [[{ numericalMeasureField: { ...target.numericalMeasureField, unsupported: true } }], [target, target], [{ numericalMeasureField: { ...target.numericalMeasureField, column: { ...target.numericalMeasureField.column, dataSetIdentifier: 'missing' } } }], [{ numericalMeasureField: { ...target.numericalMeasureField, column: { ...target.numericalMeasureField.column, columnName: '__metric_goal' }, aggregationFunction: { simpleNumericalAggregation: 'AVG' } } }], [{ numericalMeasureField: { ...target.numericalMeasureField, aggregationFunction: undefined } }]]) {
    const b = structuredClone(base); bundleConfig(b).fieldWells.targetValues = targets;
    // JSON models omit undefined properties, matching storage/import envelopes.
    const canonical = JSON.parse(JSON.stringify(b)); const d = importDialect(canonical, source);
    assert.ok(selected(d).imported.issues.length, JSON.stringify(targets)); assert.equal(selected(d).targetField, undefined);
    assert.deepEqual(bundleVisual(exportBundle(d)), bundleVisual(canonical));
    assert.deepEqual(bundleConfig(exportBundle(authorReducer(d, { type: 'title', title: 'Retained target' }))).fieldWells.targetValues, bundleConfig(canonical).fieldWells.targetValues);
    assert.doesNotThrow(() => parseDraft(JSON.stringify(d)));
  }
});
for (const type of ['remap', 'sheet-remap']) test(`${type}: targets rebind surviving columns and clear stale references`, () => {
  const b = exportBundle(targetDraft()); b.members[0].resource.definition.dataSetIdentifierDeclarations[0].dataSetArn = 'urn:synthetic:kpi-source';
  bundleConfig(b).fieldWells.targetValues[0].numericalMeasureField.fieldId = 'native-target';
  const d = importBundle(b); selected(d).imported.local = false;
  const action = { type, id: type === 'remap' ? selected(d).id : activeSheet(d).id };
  const mapped = authorReducer(d, action); assert.equal(selected(mapped).targetField, 'profit');
  const target = normalizeVisual('bundle', bundleVisual(exportBundle(mapped))).targetMeasure;
  assert.equal(target.id, 'native-target'); assert.equal(target.dataSet, 'opensight_local_sales');
  bundleConfig(b).fieldWells.targetValues[0].numericalMeasureField.column.columnName = 'missing';
  const stale = importBundle(b); selected(stale).imported.local = false;
  const clean = authorReducer(stale, action); assert.equal(selected(clean).targetField, undefined);
  assert.equal(normalizeVisual('bundle', bundleVisual(exportBundle(clean))).targetMeasure, undefined);
  assert.doesNotThrow(() => parseDraft(JSON.stringify(clean)));
});
test('constructed reduced fixture uses real targetValues shape with progress and trend arrows in both dialects', () => {
  // Constructed reduced fixture: existing bundle KPI wells, explicit SUM bindings and supported options only.
  const v = input(true); v.rows = [{ period: '2026-01', revenue: 20, budget: 25 }, { period: '2026-02', revenue: 30, budget: 25 }];
  config(v).kpiOptions = { progressBar: {}, trendArrows: {}, comparison: { comparisonMethod: 'DIFFERENCE' } };
  for (const source of ['bundle', 'api']) {
    const c = compileVisual(dialect(v, source)); assert.equal(c.kpiTarget.value, 50); assert.equal(c.kpiTarget.progress.ratio, 1); assert.equal(c.kpiTrendArrow.direction, 'up');
  }
  assert.deepEqual(convertDefinition(projectDefinition(definition(v.definition))), definition(v.definition));
});
for (const source of ['bundle', 'api']) test(`${source}: nontrended governed target preserves its explicit aggregation without summing averages`, () => {
  const b = exportBundle(targetDraft()); const f = bundleConfig(b).fieldWells.targetValues[0].numericalMeasureField;
  f.column.columnName = '__metric_goal'; f.aggregationFunction.simpleNumericalAggregation = 'AVG';
  const d = importDialect(b, source); assert.equal(selected(d).targetAggregation, 'AVG'); assert.deepEqual(selected(d).imported.issues, []);
  assert.deepEqual(parseDraft(JSON.stringify(d)), JSON.parse(JSON.stringify(d)));
  assert.equal(buildAuthorQuery(selected(d)).measures[1].aggregation, 'AVG');
  assert.equal(config({ definition: serializeVisual(selected(d)) }).fieldWells.targetValues[0].numericalMeasureField.aggregationFunction.simpleNumericalAggregation, 'AVG');
  assert.equal(selected(authorReducer(d, { type: 'assign', well: 'trend', field: 'region' })), selected(d));
  const changed = authorReducer(d, { type: 'assign', well: 'target', field: 'profit' }); assert.equal(selected(changed).targetAggregation, undefined);
  assert.equal(bundleConfig(exportBundle(changed)).fieldWells.targetValues[0].numericalMeasureField.aggregationFunction.simpleNumericalAggregation, 'SUM');
  const cleared = authorReducer(d, { type: 'unassign', well: 'target', field: '__metric_goal' }); assert.equal(selected(cleared).targetAggregation, undefined);
  const bad = structuredClone(d); selected(bad).trendField = 'region'; assert.throws(() => parseDraft(JSON.stringify(bad)));
});
