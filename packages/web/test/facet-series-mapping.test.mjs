import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';

// #125: faceted charts flatten one series per measure per panel, so a global
// series index is not a facet index. Two facets x two measures give series
// 0-3 over facet groups 0-1; tooltip and conditional-formatting lookups must
// resolve through an explicit series -> (facet rows, measure) mapping.
const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];

const rows = [
  { region: 'East', category: 'Hardware', revenue: 200, profit: 20 },
  { region: 'West', category: 'Hardware', revenue: 50, profit: 5 },
  { region: 'East', category: 'Software', revenue: 100, profit: 90 },
  { region: 'West', category: 'Software', revenue: 300, profit: 95 },
];
const facetedBar = extra => {
  const visual = { ...selected(add('bar')), dimension: 'region', measures: ['revenue', 'profit'], smallMultiples: ['category'], ...extra };
  return { ...buildAuthorVisual(visual), rows };
};

test('detailed tooltips for multi-measure facets resolve the series own facet rows', () => {
  const { option } = compileVisual(facetedBar({ tooltipType: 'detailed' }));
  assert.equal(option.series.length, 4);
  const format = option.tooltip.formatter;
  // Series 0/1 are the Hardware panel, 2/3 the Software panel.
  assert.equal(format({ seriesIndex: 0, dataIndex: 0 }), 'East\nregion: East\ncategory: Hardware\nSum of revenue: 200\nSum of profit: 20');
  assert.equal(format({ seriesIndex: 2, dataIndex: 0 }), 'East\nregion: East\ncategory: Software\nSum of revenue: 100\nSum of profit: 90');
  assert.equal(format({ seriesIndex: 3, dataIndex: 1 }), 'West\nregion: West\ncategory: Software\nSum of revenue: 300\nSum of profit: 95');
  // Axis-triggered tooltips pass an array; the first entry carries the series.
  assert.equal(format([{ seriesIndex: 2, dataIndex: 1 }]), 'West\nregion: West\ncategory: Software\nSum of revenue: 300\nSum of profit: 95');
});

test('conditional formatting for multi-measure facets uses the facet row and measure of each series', () => {
  const rules = [
    { fieldId: 'profit', operator: 'gte', threshold: 90, color: '#0000ff', background: '#eeeeff' },
    { fieldId: 'revenue', operator: 'gte', threshold: 250, color: '#aa0000', background: '#ffeeee' },
  ];
  const { option } = compileVisual(facetedBar({ formatting: { rules } }));
  const color = (series, datum) => option.series[series].data[datum]?.itemStyle?.color;
  // Hardware panel: nothing reaches either threshold.
  assert.equal(color(0, 0), undefined);
  assert.equal(color(0, 1), undefined);
  assert.equal(color(1, 0), undefined);
  assert.equal(color(1, 1), undefined);
  // Software revenue series: only West (300) reaches the revenue threshold.
  assert.equal(color(2, 0), undefined);
  assert.equal(color(2, 1), '#aa0000');
  // Software profit series: both rows reach the profit threshold — evaluated
  // as profit, not as the fallback first measure.
  assert.equal(color(3, 0), '#0000ff');
  assert.equal(color(3, 1), '#0000ff');
});

// Extra kinds (combo/area/bar100) compile through compileExtra, which returns
// per-panel groups; the same mapping must expand them per series.
const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const facetedCombo = () => {
  const spec = EXTRA_VISUALS.combo;
  const wells = { [spec.dimensions[0]]: [dim('group')], smallMultiples: [dim('region')] };
  spec.measures.forEach((key, i) => { wells[key] = ['a', 'b'].slice(i, i + 1).map(measure); });
  const input = { source: 'bundle', path: '$.test', bindings: {}, rows: [
    { group: 'A', region: 'East', a: 10, b: 30 },
    { group: 'B', region: 'East', a: 20, b: 40 },
    { group: 'A', region: 'West', a: 50, b: 10 },
    { group: 'B', region: 'West', a: 60, b: 20 },
  ], definition: { [spec.variant]: { visualId: 'combo', chartConfiguration: { fieldWells: { [spec.wells]: wells } } } } };
  input.definition[spec.variant].opensightFormatting = { rules: [
    { fieldId: 'b', operator: 'gte', threshold: 35, color: '#0000ff', background: '#eeeeff' },
    { fieldId: 'a', operator: 'gte', threshold: 55, color: '#aa0000', background: '#ffeeee' },
  ] };
  return input;
};

test('conditional formatting for faceted combo uses the facet row and measure of each series', () => {
  const { option } = compileVisual(facetedCombo());
  assert.equal(option.series.length, 4);
  const color = (series, datum) => option.series[series].data[datum]?.itemStyle?.color;
  assert.equal(color(0, 1), undefined); // East a: 20 < 55
  assert.equal(color(1, 1), '#0000ff'); // East b: 40 >= 35
  assert.equal(color(2, 1), '#aa0000'); // West a: 60 >= 55 (second facet, not East rows)
  assert.equal(color(3, 1), undefined); // West b: 20 < 35
});
