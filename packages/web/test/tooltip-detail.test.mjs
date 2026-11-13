import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, validateDraft, serializeVisual } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual, tooltipDetailKinds, detailedTooltipKinds } from '../build/test/compiler.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { parseQsBundle } from '@opensight/bundle-parser';
import { TooltipSection } from '../build/test/TooltipEditor.js';
import { init } from '../build/test/echarts.js';

const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const bar = () => ({ ...selected(add('bar')), dimension: 'region', measures: ['revenue'] });
const input = (v, rows = [{ region: 'East', revenue: 123.456 }]) => ({ ...buildAuthorVisual(v), rows });

test('tooltip detail defaults to basic and validates at reducer and draft boundaries', () => {
  const v = selected(add('bar'));
  assert.equal(v.tooltipType, 'basic');
  assert.equal(v.tooltipTitleType, 'primaryValue');
  assert.equal(v.tooltipAggregations, true);
  assert.deepEqual(v.tooltipHiddenFields, []);
  const d = authorReducer(add('bar'), { type: 'tooltip', patch: { tooltipType: 'detailed', tooltipTitleType: 'fieldId', tooltipAggregations: false, tooltipHiddenFields: ['revenue'] } });
  assert.deepEqual([selected(d).tooltipType, selected(d).tooltipTitleType, selected(d).tooltipAggregations, selected(d).tooltipHiddenFields],
    ['detailed', 'fieldId', false, ['revenue']]);
  for (const patch of [{ tooltipType: 'fancy' }, { tooltipTitleType: 1 }, { tooltipAggregations: 'yes' }, { tooltipHiddenFields: ['ok', 2] }, { tooltipHiddenFields: ['dup', 'dup'] }, { unknown: 1 }]) {
    const before = selected(add('bar'));
    assert.equal(selected(authorReducer(add('bar'), { type: 'tooltip', patch })).tooltipType, 'basic', JSON.stringify(patch));
    const tampered = add('bar');
    Object.assign(selected(tampered), patch);
    assert.throws(() => validateDraft(tampered), JSON.stringify(patch));
  }
  // Hiding a field that is not in the visual is dropped, never stored.
  const dropped = authorReducer(add('bar'), { type: 'tooltip', patch: { tooltipHiddenFields: ['ghost'] } });
  assert.deepEqual(selected(dropped).tooltipHiddenFields, []);
});

test('detailed tooltips export to SelectedTooltipType/FieldBasedTooltip and import back', async () => {
  const v = { ...bar(), tooltipType: 'detailed', tooltipTitleType: 'fieldId', tooltipAggregations: false, tooltipHiddenFields: ['revenue'] };
  const tooltip = serializeVisual(v).barChartVisual.chartConfiguration.tooltip;
  assert.deepEqual(tooltip, {
    tooltipVisibility: 'VISIBLE',
    selectedTooltipType: 'DETAILED',
    fieldBasedTooltip: {
      aggregationVisibility: 'HIDDEN',
      tooltipTitleType: 'FIELD_ID',
      tooltipFields: [
        { fieldTooltipItem: { fieldId: 'region', visibility: 'VISIBLE' } },
        { fieldTooltipItem: { fieldId: 'revenue', visibility: 'HIDDEN' } },
      ],
    },
  });
  // Basic tooltips stay minimal: no detail keys exported.
  assert.deepEqual(serializeVisual(bar()).barChartVisual.chartConfiguration.tooltip, { tooltipVisibility: 'VISIBLE' });
  // Full bundle round trip through the .qs archive.
  let d = add('bar');
  d = authorReducer(d, { type: 'tooltip', patch: { tooltipType: 'detailed', tooltipTitleType: 'fieldId', tooltipAggregations: false, tooltipHiddenFields: ['revenue'] } });
  const edited = { ...d, sheets: [{ ...d.sheets[0], visuals: [{ ...selected(d), dimension: 'region', measures: ['revenue'] }] }] };
  validateDraft(edited);
  const bundle = await parseQsBundle(await downloadBundleBytes(edited));
  const restored = importBundle(bundle);
  assert.deepEqual([selected(restored).tooltipType, selected(restored).tooltipTitleType, selected(restored).tooltipAggregations, selected(restored).tooltipHiddenFields],
    ['detailed', 'fieldId', false, ['revenue']]);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
});

test('compiler parses tooltip detail, fails closed on bad enums, treats non-well fields as extras', () => {
  const compiled = compileVisual(input({ ...bar(), tooltipType: 'detailed', tooltipAggregations: false }));
  assert.deepEqual(compiled.model.tooltipDetail, { type: 'detailed', titleType: 'primaryValue', aggregations: false, hiddenFields: [] });
  assert.equal(typeof compiled.option.tooltip.formatter, 'function');
  assert.equal(compiled.option.tooltip.renderMode, 'richText');
  const basic = compileVisual(input(bar()));
  assert.equal(basic.model.tooltipDetail, undefined);
  assert.equal(typeof basic.option.tooltip.formatter, 'undefined');
  const definition = serializeVisual(bar()).barChartVisual;
  for (const mutate of [
    d => { d.chartConfiguration.tooltip.selectedTooltipType = 'FANCY'; },
    d => { d.chartConfiguration.tooltip.fieldBasedTooltip = { aggregationVisibility: 'SOMETIMES' }; },
    d => { d.chartConfiguration.tooltip.fieldBasedTooltip = { tooltipTitleType: 'NAME' }; },
    d => { d.chartConfiguration.tooltip.fieldBasedTooltip = { tooltipFields: { fieldTooltipItem: [{ fieldId: '', visibility: 'HIDDEN' }] } }; },
  ]) {
    const bad = structuredClone(definition);
    mutate(bad);
    assert.throws(() => compileVisual({ ...input(bar()), definition: { barChartVisual: bad } }), /tooltip/i);
  }
  // A field tooltip item without visibility defaults to visible (lenient default, like other enums).
  const noVisibility = structuredClone(definition);
  noVisibility.chartConfiguration.tooltip.fieldBasedTooltip = { tooltipFields: [{ fieldTooltipItem: { fieldId: 'region' } }] };
  assert.deepEqual(compileVisual({ ...input(bar()), definition: { barChartVisual: noVisibility } }).model.tooltipDetail.hiddenFields, []);
  // The legacy object shape { fieldTooltipItem: [...] } is accepted too.
  const legacy = structuredClone(definition);
  legacy.chartConfiguration.tooltip.fieldBasedTooltip = { tooltipFields: { fieldTooltipItem: [{ fieldId: 'revenue', visibility: 'HIDDEN' }] } };
  assert.deepEqual(compileVisual({ ...input(bar()), definition: { barChartVisual: legacy } }).model.tooltipDetail.hiddenFields, ['revenue']);
  const unknown = structuredClone(definition);
  unknown.chartConfiguration.tooltip.selectedTooltipType = 'DETAILED';
  unknown.chartConfiguration.tooltip.fieldBasedTooltip = { tooltipFields: [{ fieldTooltipItem: { fieldId: 'ghost', visibility: 'VISIBLE' } }] };
  // A tooltip field outside the visual's wells is an added dataset field: it becomes an
  // extra with SUM defaults; rows that cannot supply it warn loudly and skip the row.
  const extra = compileVisual({ ...input(bar(), []), definition: { barChartVisual: unknown } });
  assert.deepEqual(extra.model.tooltipExtraFields, [{ id: 'ghost', aggregation: 'SUM' }]);
  const skipped = compileVisual({ ...input(bar()), definition: { barChartVisual: unknown } });
  assert.ok(skipped.model.warnings.some(w => w.includes("tooltip field 'ghost' has no data in this result")), JSON.stringify(skipped.model.warnings));
});

test('detailed tooltip formatter shows title, fields, aggregations and hidden fields', () => {
  const v = { ...bar(), tooltipType: 'detailed' };
  const format = compileVisual(input(v)).option.tooltip.formatter;
  assert.equal(format({ dataIndex: 0 }), 'East\nregion: East\nSum of revenue: 123.456');
  // Axis-triggered tooltips pass an array; the first entry carries the row.
  assert.equal(format([{ dataIndex: 0, seriesIndex: 1 }]), 'East\nregion: East\nSum of revenue: 123.456');
  const fieldTitle = compileVisual(input({ ...v, tooltipTitleType: 'fieldId' })).option.tooltip.formatter;
  assert.equal(fieldTitle({ dataIndex: 0 }), 'region\nregion: East\nSum of revenue: 123.456');
  const noAgg = compileVisual(input({ ...v, tooltipAggregations: false })).option.tooltip.formatter;
  assert.equal(noAgg({ dataIndex: 0 }), 'East\nregion: East\nrevenue: 123.456');
  const hidden = compileVisual(input({ ...v, tooltipHiddenFields: ['revenue'] })).option.tooltip.formatter;
  assert.equal(hidden({ dataIndex: 0 }), 'East\nregion: East');
  // Pie uses item trigger with the same row mapping.
  const pie = compileVisual(input({ ...selected(add('pie')), dimension: 'region', measures: ['revenue'], tooltipType: 'detailed' }));
  assert.equal(pie.option.tooltip.formatter({ dataIndex: 0 }), 'East\nregion: East\nSum of revenue: 123.456');
  // Missing rows never throw from the formatter.
  assert.equal(format({}), '');
});

test('detailed tooltips render exact rows for index-mapped extra kinds', () => {
  // Scatter: one point per row, X/Y/size measures.
  const scatter = compileVisual(input({ ...selected(add('scatter')), dimension: 'region', measures: ['revenue', 'profit'], tooltipType: 'detailed' }, [{ region: 'East', revenue: 10, profit: 4 }]));
  assert.equal(typeof scatter.option.tooltip.formatter, 'function');
  assert.equal(scatter.option.tooltip.formatter({ dataIndex: 0 }), 'East\nregion: East\nSum of revenue: 10\nSum of profit: 4');
  // Funnel: one stage per row.
  const funnel = compileVisual(input({ ...selected(add('funnel')), dimension: 'region', measures: ['revenue'], tooltipType: 'detailed' }, [{ region: 'East', revenue: 100 }]));
  assert.equal(funnel.option.tooltip.formatter({ dataIndex: 0 }), 'East\nregion: East\nSum of revenue: 100');
  // Gauge: single datum from the single aggregate row; title falls back to the measure name.
  const gauge = compileVisual(input({ ...selected(add('gauge')), measures: ['revenue'], tooltipType: 'detailed' }, [{ revenue: 42 }]));
  assert.equal(gauge.option.tooltip.formatter({ dataIndex: 0 }), 'revenue\nSum of revenue: 42');
  // Heatmap: one cell per row across the rows/columns wells.
  const heatmap = compileVisual(input({ ...selected(add('heatmap')), rows: ['region'], columns: ['category'], measures: ['revenue'], tooltipType: 'detailed' }, [{ region: 'East', category: 'Hardware', revenue: 100 }]));
  assert.equal(heatmap.option.tooltip.formatter({ dataIndex: 0 }), 'East\nregion: East\ncategory: Hardware\nSum of revenue: 100');
  // Filled map: one region per row, matched against the bundled country names.
  const filledMap = compileVisual(input({ ...selected(add('filledMap')), dimension: 'country', measures: ['revenue'], tooltipType: 'detailed' }, [{ country: 'France', revenue: 100 }]));
  assert.equal(filledMap.option.tooltip.formatter({ dataIndex: 0 }), 'France\ncountry: France\nSum of revenue: 100');
  // Point map: one point per row (numeric latitude/longitude dimensions).
  const pointMap = compileVisual(input({ ...selected(add('pointMap')), rows: ['order_id'], columns: ['region'], measures: ['revenue'], tooltipType: 'detailed' }, [{ order_id: 48, region: 2, revenue: 100 }]));
  assert.equal(pointMap.option.tooltip.formatter({ dataIndex: 0 }), '48\norder_id: 48\nregion: 2\nSum of revenue: 100');
});

test('detailed tooltip rendering gates agree with implemented kinds', () => {
  for (const kind of ['bar', 'line', 'pie', 'combo', 'area', 'bar100', 'scatter', 'funnel', 'gauge', 'heatmap', 'filledMap', 'pointMap', 'treemap', 'wordCloud', 'box', 'histogram', 'waterfall', 'radar', 'sankey']) {
    assert.equal(detailedTooltipKinds(kind), true, kind);
    assert.equal(tooltipDetailKinds(kind), true, kind);
  }
  for (const kind of ['insight', 'kpi', 'table', 'pivot']) {
    assert.equal(tooltipDetailKinds(kind), false, kind);
    assert.equal(detailedTooltipKinds(kind), false, kind);
  }
  for (const kind of ['treemap', 'wordCloud', 'box', 'histogram']) {
    const v = { ...selected(add(kind)), dimension: 'region', rows: ['region'], measures: ['revenue'], tooltipType: 'detailed' };
    const compiled = compileVisual(input(v, [{ region: 'East', revenue: 10 }]));
    assert.equal(compiled.model.tooltipDetail.type, 'detailed');
    assert.equal(typeof compiled.option.tooltip.formatter, 'function');
    assert.ok(!compiled.model.warnings.some(w => w.includes('using basic tooltips')), JSON.stringify(compiled.model.warnings));
  }
});

test('waterfall detailed tooltips read delta-bar source rows; aggregate bars stay basic', () => {
  const v = { ...selected(add('waterfall')), dimension: 'region', measures: ['revenue'], tooltipType: 'detailed' };
  const rows = [{ region: 'East', revenue: 100, profit: 7 }, { region: 'West', revenue: -40, profit: 3 }];
  const compiled = compileVisual(input(v, rows));
  assert.equal(compiled.model.tooltipDetail.type, 'detailed');
  // Authored detailed state now exports for waterfall.
  assert.equal(serializeVisual(v).waterfallChartVisual.chartConfiguration.tooltip.selectedTooltipType, 'DETAILED');
  const format = compiled.option.tooltip.formatter;
  assert.equal(typeof format, 'function');
  const data = compiled.option.series[1].data;
  // Delta bars carry their source rows; the appended Total bar does not.
  assert.equal(data[0].sourceRowIndex, 0);
  assert.equal(data[1].sourceRowIndex, 1);
  assert.equal(data[2].sourceRowIndex, undefined);
  assert.equal(format({ name: 'East', data: data[0] }), 'East\nregion: East\nSum of revenue: 100');
  assert.equal(format({ name: 'West', data: data[1] }), 'West\nregion: West\nSum of revenue: -40');
  assert.equal(format({ name: 'Total', data: data[2] }), 'Total: 60');
  // Aggregations off, hidden fields and fieldId titles follow the shared detailed rules.
  const noAgg = compileVisual(input({ ...v, tooltipAggregations: false }, rows)).option.tooltip.formatter;
  assert.equal(noAgg({ name: 'East', data: data[0] }), 'East\nregion: East\nrevenue: 100');
  const hidden = compileVisual(input({ ...v, tooltipHiddenFields: ['revenue'] }, rows)).option.tooltip.formatter;
  assert.equal(hidden({ name: 'East', data: data[0] }), 'East\nregion: East');
  const fieldTitle = compileVisual(input({ ...v, tooltipTitleType: 'fieldId' }, rows)).option.tooltip.formatter;
  assert.equal(fieldTitle({ name: 'East', data: data[0] }), 'region\nregion: East\nSum of revenue: 100');
  // Extra fields resolve from the delta bar's source row.
  const withExtra = compileVisual(input({ ...v, tooltipExtraFields: [{ field: 'profit', aggregation: 'AVG' }] }, rows)).option.tooltip.formatter;
  assert.equal(withExtra({ name: 'East', data: data[0] }), 'East\nregion: East\nSum of revenue: 100\nAvg of profit: 7');
  // Basic mode is unchanged: no source indices, and the series keeps its own formatter.
  const basic = compileVisual(input({ ...selected(add('waterfall')), dimension: 'region', measures: ['revenue'] }, rows));
  assert.equal(basic.option.series[1].data[0].sourceRowIndex, undefined);
  assert.equal(typeof basic.option.series[1].tooltip.formatter, 'function');
  assert.equal(basic.option.series[1].tooltip.formatter({ name: 'East', data: basic.option.series[1].data[0] }), 'East: 100');
});

test('waterfall breakdown detailed tooltips read the (category, breakdown) row; subtotals stay basic', () => {
  const v = { ...selected(add('waterfall')), dimension: 'region', measures: ['revenue'], breakdowns: ['category'], tooltipType: 'detailed' };
  const rows = [
    { region: 'East', category: 'Hardware', revenue: 100 },
    { region: 'East', category: 'Software', revenue: 50 },
    { region: 'West', category: 'Hardware', revenue: 30 },
    { region: 'West', category: 'Software', revenue: -10 },
  ];
  const compiled = compileVisual(input(v, rows));
  const data = compiled.option.series[1].data;
  // Bars: East subtotal, West Hardware delta, West Software delta, West subtotal.
  assert.deepEqual(data.map(d => d.name), ['East', 'Hardware', 'Software', 'West']);
  assert.equal(data[0].sourceRowIndex, undefined);
  assert.equal(data[1].sourceRowIndex, 2);
  assert.equal(data[2].sourceRowIndex, 3);
  assert.equal(data[3].sourceRowIndex, undefined);
  const format = compiled.option.tooltip.formatter;
  assert.equal(format({ name: 'Hardware', data: data[1] }), 'Hardware\nregion: West\ncategory: Hardware\nSum of revenue: 30');
  assert.equal(format({ name: 'Software', data: data[2] }), 'Software\nregion: West\ncategory: Software\nSum of revenue: -10');
  assert.equal(format({ name: 'East', data: data[0] }), 'East: 150');
  assert.equal(format({ name: 'West', data: data[3] }), 'West: 170');
});

test('treemap details use hierarchy levels and the hovered node value', () => {
  const v = { ...selected(add('treemap')), rows: ['region', 'category'], measures: ['revenue'], tooltipType: 'detailed' };
  const rows = [{ region: 'East', category: 'Hardware', revenue: 10 }, { region: 'East', category: 'Software', revenue: 20 }];
  const compiled = compileVisual(input(v, rows));
  const parent = compiled.option.series[0].data[0];
  const leaf = parent.children[0];
  const path = [{ name: 'root' }, { name: 'East' }, { name: 'Hardware' }];
  const params = { name: leaf.name, value: leaf.value, data: leaf, treePathInfo: path };
  assert.equal(compiled.option.tooltip.formatter(params), 'East\nregion: East\ncategory: Hardware\nSum of revenue: 10');
  assert.equal(compiled.option.tooltip.formatter({ name: 'East', value: 30, data: parent, treePathInfo: path.slice(0, 2) }), 'East\nregion: East\nSum of revenue: 30');
  const hidden = compileVisual(input({ ...v, tooltipHiddenFields: ['region'], tooltipTitleType: 'fieldId', tooltipAggregations: false }, rows));
  assert.equal(hidden.option.tooltip.formatter(params), 'region\ncategory: Hardware\nrevenue: 10');
});

test('word cloud details display the word and compiled weight after sorting', () => {
  const v = { ...selected(add('wordCloud')), dimension: 'region', measures: ['revenue'], tooltipType: 'detailed' };
  const compiled = compileVisual(input(v, [{ region: 'East', revenue: 10 }, { region: 'West', revenue: 30 }, { region: 'North', revenue: 20 }]));
  const data = compiled.option.series[0].data[0];
  assert.equal(data.sourceRowIndex, 1);
  assert.equal(compiled.option.tooltip.formatter({ name: data.name, value: data.value, data }), 'West\nregion: West\nSum of revenue: 30');
});

test('box details use compiled group quartiles and omit empty or hidden statistics', () => {
  const v = { ...selected(add('box')), rows: ['region'], measures: ['revenue'], tooltipType: 'detailed' };
  const rows = [2, 6, 10, 14, 18].map(revenue => ({ region: 'West', revenue })).concat([{ region: 'Empty', revenue: null }]);
  const compiled = compileVisual(input(v, rows));
  assert.equal(compiled.option.tooltip.formatter({ dataIndex: 0, value: [0, 2, 6, 10, 14, 18] }), 'West\nregion: West\nrevenue min: 2\nrevenue Q1: 6\nrevenue median: 10\nrevenue Q3: 14\nrevenue max: 18');
  // dataIndex 1 is the second compiled group, not the second source row.
  assert.equal(compiled.option.tooltip.formatter({ dataIndex: 1 }), 'Empty\nregion: Empty');
  const hidden = compileVisual(input({ ...v, tooltipHiddenFields: ['revenue'], tooltipTitleType: 'fieldId' }, rows));
  assert.equal(hidden.option.tooltip.formatter({ dataIndex: 0 }), 'region\nregion: West');
});

test('histogram details use compiled bin ranges and frequencies', () => {
  const v = { ...selected(add('histogram')), dimension: null, measures: ['revenue'], bins: 2, tooltipType: 'detailed' };
  const rows = [0, 1, 2, 4].map(revenue => ({ revenue }));
  const compiled = compileVisual(input(v, rows));
  assert.deepEqual(compiled.option.xAxis.data, ['0–2', '2–4']);
  assert.equal(compiled.option.tooltip.formatter([{ dataIndex: 1 }]), '2–4\nrevenue: 2–4\nFrequency: 2');
  const hidden = compileVisual(input({ ...v, tooltipHiddenFields: ['revenue'], tooltipTitleType: 'fieldId' }, rows));
  assert.equal(hidden.option.tooltip.formatter({ dataIndex: 0 }), 'revenue\nFrequency: 2');
});

test('transformed details honor field labels, governed formats, visibility and rich-text escaping', () => {
  for (const kind of ['treemap', 'wordCloud']) {
    const v = { ...selected(add(kind)), rows: ['region'], dimension: 'region', measures: ['revenue'], tooltipType: 'detailed', tooltipTitleType: 'fieldId',
      formatting: { names: { region: '{Region|label}', revenue: '{Revenue|label}' }, metricFormats: { revenue: { style: 'currency', currency: 'USD', decimalPlaces: 2 } } } };
    const rows = [{ region: '{East|value}', revenue: 1234.5 }];
    const compiled = compileVisual(input(v, rows)), data = compiled.option.series[0].data[0];
    const params = { data, name: data.name, value: data.value, treePathInfo: [{ name: 'root' }, { name: data.name }] };
    assert.equal(compiled.option.tooltip.formatter(params), '｛Region|label｝\n｛Region|label｝: ｛East|value｝\n｛Revenue|label｝: $1,234.50');
    const hidden = compileVisual(input({ ...v, tooltipHiddenFields: ['region', 'revenue'], tooltipTitleType: 'primaryValue' }, rows));
    assert.equal(hidden.option.tooltip.formatter(params), '｛East|value｝');
    const noAgg = compileVisual(input({ ...v, formatting: undefined, tooltipAggregations: false }, rows));
    assert.equal(noAgg.option.tooltip.formatter(params), 'region\nregion: ｛East|value｝\nrevenue: 1,234.5');
  }
});

test('box statistics interpolate, skip nulls, format metrics and honor hidden dimensions', () => {
  const v = { ...selected(add('box')), rows: ['region'], measures: ['revenue'], tooltipType: 'detailed', tooltipHiddenFields: ['region'],
    formatting: { names: { revenue: '{Value|label}' }, metricFormats: { revenue: { style: 'currency', currency: 'USD', decimalPlaces: 2 } } } };
  const rows = [0, 10, null, 20, 30].map(revenue => ({ region: '{West|value}', revenue }));
  const compiled = compileVisual(input(v, rows));
  const expected = '｛West|value｝\n｛Value|label｝ min: $0.00\n｛Value|label｝ Q1: $7.50\n｛Value|label｝ median: $15.00\n｛Value|label｝ Q3: $22.50\n｛Value|label｝ max: $30.00';
  assert.equal(compiled.option.tooltip.formatter({ dataIndex: 0 }), expected);
  assert.equal(compileVisual(input({ ...v, tooltipAggregations: false }, rows)).option.tooltip.formatter({ dataIndex: 0 }), expected);
});

test('histogram sample dimensions never replace the measure title or format frequencies as metrics', () => {
  const v = { ...selected(add('histogram')), dimension: 'region', measures: ['revenue'], tooltipType: 'detailed', tooltipTitleType: 'fieldId',
    formatting: { names: { revenue: '{Value|label}' }, metricFormats: { revenue: { style: 'currency', currency: 'USD', decimalPlaces: 2 } } } };
  const compiled = compileVisual(input(v, [{ region: 'A', revenue: 5 }, { region: 'B', revenue: null }, { region: 'C', revenue: 5 }]));
  assert.equal(compiled.option.tooltip.formatter({ dataIndex: 0 }), '｛Value|label｝\n｛Value|label｝: 5–6\nFrequency: 2');
});

test('transformed formatters tolerate missing hover data and unavailable results', () => {
  for (const kind of ['treemap', 'wordCloud', 'box', 'histogram']) {
    const v = { ...selected(add(kind)), rows: ['region'], dimension: 'region', measures: ['revenue'], tooltipType: 'detailed' };
    for (const rows of [[], null]) {
      const compiled = compileVisual(input(v, rows));
      for (const params of [undefined, null, [], {}, { dataIndex: -1 }, { dataIndex: 999 }]) assert.equal(compiled.option.tooltip.formatter(params), '', kind);
    }
  }
});

test('real ECharts datum parameters render detailed treemap, word, box and histogram tooltips', () => {
  for (const kind of ['treemap', 'wordCloud', 'box', 'histogram']) {
    const v = { ...selected(add(kind)), rows: ['region', ...(kind === 'treemap' ? ['category'] : [])], dimension: 'region', measures: ['revenue'], tooltipType: 'detailed', bins: 2,
      tooltipExtraFields: ['treemap', 'wordCloud'].includes(kind) ? [{ field: 'profit', aggregation: 'AVG' }] : [] };
    const rows = [{ region: 'East', category: 'Hardware', revenue: 10, profit: 2 }, { region: 'East', category: 'Software', revenue: 30, profit: 9 }];
    if (kind === 'wordCloud') rows[1].region = 'West';
    const compiled = compileVisual(input(v, rows));
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 360 });
    try {
      chart.setOption(compiled.option);
      const series = chart.getModel().getSeriesByIndex(0);
      if (kind === 'treemap') {
        const tree = series.getData().tree, parent = tree.root.children[0], leaf = parent.children[1];
        assert.equal(compiled.option.tooltip.formatter(series.getDataParams(parent.dataIndex)), 'East\nregion: East\nSum of revenue: 40');
        assert.equal(compiled.option.tooltip.formatter(series.getDataParams(leaf.dataIndex)), 'East\nregion: East\ncategory: Software\nSum of revenue: 30\nAvg of profit: 9');
      } else {
        const expected = {
          wordCloud: 'West\nregion: West\nSum of revenue: 30\nAvg of profit: 9',
          box: 'East\nregion: East\nrevenue min: 10\nrevenue Q1: 15\nrevenue median: 20\nrevenue Q3: 25\nrevenue max: 30',
          histogram: '10–20\nrevenue: 10–20\nFrequency: 1',
        }[kind];
        assert.equal(compiled.option.tooltip.formatter(series.getDataParams(0)), expected);
      }
    } finally { chart.dispose(); }
  }
});

test('tooltip section renders for supported kinds and hides for others', () => {
  const html = renderToStaticMarkup(createElement(TooltipSection, { visual: bar(), dispatch() {} }));
  assert.ok(html.includes('data-author-control="tooltip-detail"'), html.slice(0, 200));
  assert.ok(html.includes('Detailed'), html.slice(0, 400));
  const kpi = renderToStaticMarkup(createElement(TooltipSection, { visual: selected(add('kpi')), dispatch() {} }));
  assert.equal(kpi, '');
  for (const kind of ['radar', 'sankey']) {
    const html = renderToStaticMarkup(createElement(TooltipSection, { visual: selected(add(kind)), dispatch() {} }));
    assert.ok(html.includes('data-author-control="tooltip-detail"'), kind);
    assert.ok(html.includes('Detailed'), kind);
  }
  // Treemap now renders detailed tooltips and no longer needs a fallback hint.
  const treemapDetailed = renderToStaticMarkup(createElement(TooltipSection, { visual: { ...selected(add('treemap')), tooltipType: 'detailed' }, dispatch() {} }));
  assert.ok(!treemapDetailed.includes('other visual types use basic tooltips'), treemapDetailed);
  assert.ok(treemapDetailed.includes('Primary value as title'), treemapDetailed);
});
