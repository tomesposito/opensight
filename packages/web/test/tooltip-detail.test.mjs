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

test('detailed tooltips on kinds without renderer support fall back to basic with a warning', () => {
  for (const kind of ['scatter', 'funnel', 'gauge', 'heatmap', 'filledMap', 'pointMap']) {
    assert.equal(detailedTooltipKinds(kind), true, kind);
    assert.equal(tooltipDetailKinds(kind), true, kind);
  }
  for (const kind of ['treemap', 'box', 'histogram', 'wordCloud']) {
    assert.equal(detailedTooltipKinds(kind), false, kind);
    assert.equal(tooltipDetailKinds(kind), true, kind);
  }
  assert.equal(tooltipDetailKinds('radar'), false);
  assert.equal(tooltipDetailKinds('kpi'), false);
  const v = { ...selected(add('treemap')), dimension: 'region', rows: ['region'], measures: ['revenue'] };
  const compiled = compileVisual(input({ ...v, tooltipType: 'detailed' }, [{ region: 'East', revenue: 10 }]));
  assert.equal(compiled.model.tooltipDetail.type, 'detailed');
  assert.equal(typeof compiled.option.tooltip.formatter, 'undefined');
  assert.ok(compiled.model.warnings.some(w => w.includes('treemap')), JSON.stringify(compiled.model.warnings));
});

test('tooltip section renders for supported kinds and hides for others', () => {
  const html = renderToStaticMarkup(createElement(TooltipSection, { visual: bar(), dispatch() {} }));
  assert.ok(html.includes('data-author-control="tooltip-detail"'), html.slice(0, 200));
  assert.ok(html.includes('Detailed'), html.slice(0, 400));
  const kpi = renderToStaticMarkup(createElement(TooltipSection, { visual: selected(add('kpi')), dispatch() {} }));
  assert.equal(kpi, '');
  const radar = renderToStaticMarkup(createElement(TooltipSection, { visual: selected(add('radar')), dispatch() {} }));
  assert.equal(radar, '');
  // Kinds that accept detailed config but don't render it get the honest hint naming the supported set.
  const treemapDetailed = renderToStaticMarkup(createElement(TooltipSection, { visual: { ...selected(add('treemap')), tooltipType: 'detailed' }, dispatch() {} }));
  assert.ok(treemapDetailed.includes('Detailed tooltips render for bar, line, pie, combo, area, 100% bar, scatter, funnel, gauge, heatmap and map visuals'), treemapDetailed.slice(0, 500));
});
