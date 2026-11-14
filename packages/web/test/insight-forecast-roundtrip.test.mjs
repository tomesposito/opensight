import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource, parseQsBundle } from '@opensight/bundle-parser';
import { evaluatePlan, interactiveRequest, planVisual } from '@opensight/query-engine/browser';
import { activeSheet, authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { compileVisual } from '../build/test/compiler.js';
import { computeForecast } from '../build/test/forecast.js';
import { normalizeInsight } from '../build/test/insight-configuration.js';
import { init } from '../build/test/echarts.js';
import sales from '../src/sales.generated.json' with { type: 'json' };

const selected = draft => activeSheet(draft).visuals[0];
const native = () => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'insight' }));
  const api = { DataSetIdentifierDeclarations: resource.definition.dataSetIdentifierDeclarations.map(d => ({ Identifier: d.identifier, DataSetArn: d.dataSetArn })), Sheets: [{ SheetId: 'forecast-sheet', Visuals: [{ InsightVisual: {
    VisualId: 'forecast-insight', InsightConfiguration: { Computations: [{ Forecast: {
      ComputationId: 'projection', Name: 'Revenue projection',
      Time: { DateDimensionField: { FieldId: 'order_date', Column: { ColumnName: 'order_date', DataSetIdentifier: 'sales_data' }, DateGranularity: 'MONTH' } },
      Value: { NumericalMeasureField: { FieldId: 'revenue', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales_data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } },
      ForecastProperties: { PeriodsForward: 2, PeriodsBackward: 1, PredictionInterval: 90, Seasonality: 'NONE', LowerBoundary: 0, UpperBoundary: 1000 },
    } }] },
  } }] }] };
  resource.definition = convertDefinition(api);
  return { api, resource, bundle: { members: [{ path: 'analysis/authored-analysis.json', resource }] } };
};

test('native forecast imports, validates, queries, renders and exports unchanged including every property', async () => {
  const { api, resource, bundle } = native(), before = structuredClone(bundle);
  assert.deepEqual(parseBundleResource(resource), resource);
  const draft = importBundle(bundle), visual = selected(draft);
  assert.deepEqual(visual.imported.issues, []);
  assert.deepEqual(visual.insightConfiguration, resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration);
  const request = buildAuthorQuery(visual); assert.ok(request);
  // Query an explicit synthetic history through the same plan/evaluator as the demo.
  const values = [100, 120, 115, 140, 150, 160];
  const source = values.flatMap((revenue, i) => [
    { order_date: `2024-0${i + 1}-01`, revenue: revenue / 2 },
    { order_date: `2024-0${i + 1}-02`, revenue: revenue / 2 },
  ]).toReversed();
  const rows = evaluatePlan(planVisual(interactiveRequest(request, sales.metadata)), source);
  assert.equal(rows.length, 6);
  const rendered = compileVisual({ ...buildAuthorVisual(visual), rows });
  const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: { order_date: 'month' } });
  assert.equal(rendered.state, 'ready'); assert.deepEqual(rendered.narrative, direct.narrative);
  const config = normalizeInsight(rendered.model.insightConfiguration, rendered.model.dimensions, rendered.model.measures)[0].forecast;
  const final = computeForecast(values, 'MONTH', config).future.at(-1);
  assert.deepEqual(rendered.narrative.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [final.value, final.lower, final.upper]);
  assert.match(rendered.narrative.text, /in 2 months \(2024-08\).*90% prediction interval/);
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
  assert.deepEqual(bundle, before);
});

test('malformed native forecast properties fail closed in validation, imports and both compiler dialects', () => {
  for (const [patch, code] of [
    [{ PeriodsForward: -1 }, 'INSIGHT_COMPUTATION_INVALID'],
    ...['auto', 'none'].map(CustomSeasonalityValue => [{ Seasonality: 'CUSTOM', CustomSeasonalityValue }, 'INSIGHT_COMPUTATION_INVALID']),
    [{ Unknown: true }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
  ]) {
    const { api, resource } = native();
    Object.assign(api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].Forecast.ForecastProperties, patch);
    resource.definition = convertDefinition(api);
    const error = new RegExp(code);
    assert.throws(() => parseBundleResource(resource), error);
    assert.throws(() => importBundle({ members: [{ path: 'analysis/authored-analysis.json', resource }] }), error);
    for (const [source, definition] of [['api', api.Sheets[0].Visuals[0]], ['bundle', resource.definition.sheets[0].visuals[0]]]) assert.throws(() => compileVisual({ source, definition, rows: null, path: '$', bindings: {} }), error);
  }
});
