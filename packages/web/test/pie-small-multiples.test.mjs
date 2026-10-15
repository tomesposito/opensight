import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import { authorReducer, emptyDraft, activeSheet, serializeVisual } from '../build/test/authoring.js';
import { buildAuthorVisual, buildAuthorPreview } from '../build/test/author-preview.js';

const fixtures = JSON.parse(await readFile(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const pieFixture = () => structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'PieChartVisual')));
const facetWell = (fieldId = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: fieldId } } });
const facetedInput = (rows) => {
  const input = pieFixture();
  input.definition.PieChartVisual.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.SmallMultiples = [facetWell()];
  input.rows = rows;
  return input;
};
const rows = [
  { category: 'Hardware', region: 'East', revenue: 200 },
  { category: 'Software', region: 'East', revenue: 100 },
  { category: 'Hardware', region: 'West', revenue: 50 },
  { category: 'Software', region: 'West', revenue: 300 },
];

test('pie small multiples parse into model.facet, keeping one category dimension', () => {
  const model = normalizeVisual('api', facetedInput(rows).definition);
  assert.equal(model.kind, 'pie');
  assert.deepEqual(model.dimensions.map(f => f.id), ['category']);
  assert.equal(model.facet.id, 'region');
  assert.equal(model.facet.column, 'region');
});

test('more than one small multiples field fails closed', () => {
  const input = facetedInput(rows);
  input.definition.PieChartVisual.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.SmallMultiples.push(facetWell('category'));
  assert.throws(() => normalizeVisual('api', input.definition), /at most one Small multiples field/);
});

test('non-faceted kinds still reject a nonempty small multiples well', () => {
  const input = structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'TableVisual')));
  input.definition.TableVisual.ChartConfiguration.FieldWells.TableAggregatedFieldWells.SmallMultiples = [facetWell()];
  assert.throws(() => normalizeVisual('api', input.definition), /field well not supported/);
});

test('faceted pie renders one series per facet with titles and a single shared legend', () => {
  const { model, option, state, table } = compileVisual(facetedInput(rows));
  assert.equal(state, 'ready');
  assert.equal(option.series.length, 2);
  assert.deepEqual(option.series.map(s => s.type), ['pie', 'pie']);
  assert.deepEqual(option.series.map(s => s.data), [
    [{ name: 'Hardware', value: 200 }, { name: 'Software', value: 100 }],
    [{ name: 'Hardware', value: 50 }, { name: 'Software', value: 300 }],
  ]);
  assert.deepEqual(option.title.map(t => t.text), ['East', 'West']);
  // Two-column grid: the facet centers differ horizontally.
  assert.notEqual(option.series[0].center[0], option.series[1].center[0]);
  assert.equal(option.legend.type, 'scroll');
  assert.ok(!Array.isArray(option.legend), 'one shared legend, not one per facet');
  assert.deepEqual(table.columns, ['category', 'region', 'revenue']);
  assert.deepEqual(table.rows[0], ['Hardware', 'East', 200]);
  assert.ok(model.warnings.every(w => !w.includes('small-multiple')));
});

test('the same category may repeat across facets, but not within one facet', () => {
  const dup = [...rows, { category: 'Hardware', region: 'East', revenue: 7 }];
  assert.throws(() => compileVisual(facetedInput(dup)), /duplicate categories/);
});

test('negative slice values fail per facet', () => {
  const bad = rows.map(r => r.region === 'West' && r.category === 'Software' ? { ...r, revenue: -1 } : r);
  assert.throws(() => compileVisual(facetedInput(bad)), /nonnegative/);
});

test('more than 20 facets truncate with a warning', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ category: 'Hardware', region: `F${i}`, revenue: 1 }));
  const { model, option } = compileVisual(facetedInput(many));
  assert.equal(option.series.length, 20);
  assert.match(model.warnings.join('\n'), /21 small-multiple panels exceed the 20-panel limit/);
});

test('facet titles render through the registered ECharts title component', () => {
  const { option } = compileVisual(facetedInput(rows));
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 700, height: 400 });
  try {
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    assert.match(svg, />East</);
    assert.match(svg, />West</);
  } finally { chart.dispose(); }
});

test('detailed tooltips resolve the row inside its own facet', () => {
  const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
  const visual = { ...activeSheet(add('pie')).visuals[0], tooltipType: 'detailed', smallMultiples: ['region'] };
  const { option } = compileVisual({ ...buildAuthorVisual(visual), rows });
  const east = option.tooltip.formatter({ seriesIndex: 0, dataIndex: 1 });
  const west = option.tooltip.formatter({ seriesIndex: 1, dataIndex: 1 });
  assert.match(east, /Software/);
  assert.match(east, /region: East/);
  assert.match(west, /region: West/);
  assert.doesNotMatch(west, /region: East/);
});

test('pie facet survives a serialize/normalize round trip', () => {
  const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
  const draft = authorReducer(add('pie'), { type: 'assign', well: 'smallMultiples', field: 'region' });
  const visual = activeSheet(draft).visuals[0];
  const definition = serializeVisual(visual, false);
  const wells = definition.pieChartVisual.chartConfiguration.fieldWells.pieChartAggregatedFieldWells;
  assert.equal(wells.smallMultiples[0].categoricalDimensionField.column.columnName, 'region');
  const model = normalizeVisual('bundle', definition);
  assert.equal(model.facet.id, 'region');
  // The facet is a tooltip field, not an invented extra measure.
  const tooltip = definition.pieChartVisual.chartConfiguration.tooltip;
  assert.deepEqual(tooltip.fieldBasedTooltip, undefined, 'basic tooltips stay minimal');
  const detailed = serializeVisual({ ...visual, tooltipType: 'detailed' }, false).pieChartVisual.chartConfiguration.tooltip;
  assert.deepEqual(detailed.fieldBasedTooltip.tooltipFields.map(f => f.fieldTooltipItem.fieldId), ['category', 'region', 'revenue']);
  assert.equal(normalizeVisual('bundle', serializeVisual({ ...visual, tooltipType: 'detailed' }, false)).tooltipDetail.type, 'detailed');
});

test('author preview groups pie rows by the facet through the fixture query engine', () => {
  const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
  const draft = authorReducer(add('pie'), { type: 'assign', well: 'smallMultiples', field: 'region' });
  const preview = buildAuthorPreview(activeSheet(draft).visuals[0]);
  assert.equal(preview.rows.length, 4);
  assert.deepEqual([...new Set(preview.rows.map(r => r.region))].sort(), ['East', 'West']);
  const { option } = compileVisual(preview);
  assert.equal(option.series.length, 2);
  assert.deepEqual(option.title.map(t => t.text), ['East', 'West']);
});
