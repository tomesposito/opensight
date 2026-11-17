import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource, parseQsBundle } from '@opensight/bundle-parser';
import { evaluatePlan, interactiveRequest, planVisual } from '@opensight/query-engine/browser';
import { activeSheet, authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { compileVisual } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import sales from '../src/sales.generated.json' with { type: 'json' };

const selected = draft => activeSheet(draft).visuals[0];
const native = (grain = 'MONTH') => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'insight' }));
  const api = { DataSetIdentifierDeclarations: resource.definition.dataSetIdentifierDeclarations.map(d => ({ Identifier: d.identifier, DataSetArn: d.dataSetArn })), Sheets: [{ SheetId: 'ptd-sheet', Visuals: [{ InsightVisual: {
    VisualId: 'ptd-insight', InsightConfiguration: { Computations: [{ PeriodToDate: {
      ComputationId: 'period-to-date', Name: 'Revenue to date',
      Time: { DateDimensionField: { FieldId: 'order_date', Column: { ColumnName: 'order_date', DataSetIdentifier: 'sales_data' }, DateGranularity: 'DAY' } },
      Value: { NumericalMeasureField: { FieldId: 'revenue', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales_data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } },
      ...(grain === undefined ? {} : { PeriodTimeGranularity: grain }),
    } }] },
  } }] }] };
  resource.definition = convertDefinition(api);
  return { api, resource, bundle: { members: [{ path: 'analysis/authored-analysis.json', resource }] } };
};

test('native period-to-date converts both ways, imports, queries, renders and exports unchanged', async () => {
  for (const [grain, period, expected] of [['DAY', '2024-04-30', 10], ['MONTH', '2024-04', 15], ['QUARTER', '2024-Q2', 15], ['YEAR', '2024', 45]]) {
    const { api, resource, bundle } = native(grain), before = structuredClone(bundle), apiBefore = structuredClone(api);
    assert.deepEqual(projectDefinition(resource.definition), api);
    assert.equal(resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration.computations[0].periodToDate.periodTimeGranularity, grain);
    assert.deepEqual(parseBundleResource(resource), resource);
    const draft = importBundle(bundle), visual = selected(draft);
    assert.deepEqual(visual.imported.issues, []);
    assert.deepEqual(visual.insightConfiguration, resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration);
    const request = buildAuthorQuery(visual); assert.ok(request);
    // Aggregate raw synthetic records through the same planner/evaluator as the demo.
    const source = [
      { order_date: '2023-12-31', revenue: 900 }, { order_date: '2024-01-01', revenue: 10 },
      { order_date: '2024-03-31', revenue: 20 }, { order_date: '2024-04-01', revenue: 5 },
      { order_date: '2024-04-30', revenue: 4 }, { order_date: '2024-04-30', revenue: 6 },
    ].toReversed();
    const rows = evaluatePlan(planVisual(interactiveRequest(request, sales.metadata)), source);
    assert.equal(rows.length, 5);
    const rendered = compileVisual({ ...buildAuthorVisual(visual), rows });
    const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: { order_date: 'day' } });
    assert.equal(rendered.state, 'ready'); assert.deepEqual(rendered.narrative, direct.narrative);
    assert.equal(rendered.narrative.text, `Period-to-date revenue for ${period} (${grain}): ${expected}.`);
    assert.deepEqual(rendered.narrative.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [expected]);
    assert.equal(rendered.table.rows.length, 5);
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 800, height: 300 });
    try {
      chart.setOption(rendered.option);
      const svg = chart.renderToSVGString();
      assert.equal([...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(m => m[1]).join(''), rendered.narrative.text);
      assert.doesNotMatch(svg, /NaN|Infinity/);
    } finally { chart.dispose(); }
    assert.deepEqual(exportBundle(draft), before);
    const downloaded = await parseQsBundle(await downloadBundleBytes(draft));
    assert.deepEqual(downloaded, before);
    assert.deepEqual(projectDefinition(downloaded.members[0].resource.definition), apiBefore);
    assert.deepEqual(bundle, before); assert.deepEqual(api, apiBefore);
  }
});

test('native period-to-date preserves an absent period granularity through conversion and export', () => {
  const { api, resource } = native();
  delete api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].PeriodToDate.PeriodTimeGranularity;
  resource.definition = convertDefinition(api);
  assert.deepEqual(projectDefinition(resource.definition), api);
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] }, draft = importBundle(bundle);
  assert.deepEqual(selected(draft).imported.issues, []);
  assert.deepEqual(exportBundle(draft), bundle);
  const rendered = compileVisual({ ...buildAuthorVisual(selected(draft)), rows: [{ day: '2024-02-28', revenue: 900 }, { day: '2024-02-29', revenue: 5 }] });
  assert.equal(rendered.narrative.text, 'Period-to-date revenue for 2024-02-29 (DAY): 5.');
});

test('malformed native period-to-date fails closed in validation, import and both compiler dialects', () => {
  for (const [patch, code] of [
    [{ PeriodTimeGranularity: 'WEEK' }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ PeriodTimeGranularity: null }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ ComputationId: '' }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ Unknown: true }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
  ]) {
    const { api, resource } = native();
    Object.assign(api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].PeriodToDate, patch);
    resource.definition = convertDefinition(api);
    const error = new RegExp(code);
    assert.throws(() => parseBundleResource(resource), error);
    assert.throws(() => importBundle({ members: [{ path: 'analysis/authored-analysis.json', resource }] }), error);
    for (const [source, definition] of [['api', api.Sheets[0].Visuals[0]], ['bundle', resource.definition.sheets[0].visuals[0]]]) {
      assert.throws(() => compileVisual({ source, definition, rows: null, path: '$', bindings: {} }), error);
    }
  }
});
