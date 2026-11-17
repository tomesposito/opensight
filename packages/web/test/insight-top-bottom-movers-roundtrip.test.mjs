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
const native = () => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'insight' }));
  const api = { DataSetIdentifierDeclarations: resource.definition.dataSetIdentifierDeclarations.map(d => ({ Identifier: d.identifier, DataSetArn: d.dataSetArn })), Sheets: [{ SheetId: 'movers-sheet', Visuals: [{ InsightVisual: {
    VisualId: 'movers-insight', InsightConfiguration: { Computations: [{ TopBottomMovers: {
      ComputationId: 'movers', Name: 'Revenue movers', Type: 'TOP', MoverSize: 2, SortOrder: 'PERCENT_DIFFERENCE',
      Category: { CategoricalDimensionField: { FieldId: 'region', Column: { ColumnName: 'region', DataSetIdentifier: 'sales_data' } } },
      Time: { DateDimensionField: { FieldId: 'order_date', Column: { ColumnName: 'order_date', DataSetIdentifier: 'sales_data' }, DateGranularity: 'MONTH' } },
      Value: { NumericalMeasureField: { FieldId: 'revenue', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales_data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } },
    } }] },
  } }] }] };
  resource.definition = convertDefinition(api);
  return { api, resource, bundle: { members: [{ path: 'analysis/authored-analysis.json', resource }] } };
};

test('native top/bottom movers converts both ways, imports, queries, renders and exports unchanged', async () => {
  const { api, resource, bundle } = native(), before = structuredClone(bundle), apiBefore = structuredClone(api);
  assert.deepEqual(projectDefinition(resource.definition), api);
  const internal = resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration.computations[0].topBottomMovers;
  assert.equal(internal.moverSize, 2); assert.equal(internal.sortOrder, 'PERCENT_DIFFERENCE'); assert.equal(internal.type, 'TOP');
  assert.deepEqual(parseBundleResource(resource), resource);
  const draft = importBundle(bundle), visual = selected(draft);
  assert.deepEqual(visual.imported.issues, []);
  assert.deepEqual(visual.insightConfiguration, resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration);
  const request = buildAuthorQuery(visual); assert.ok(request);
  assert.deepEqual(request.dimensions.map(d => d.fieldId), ['region', 'order_date']);
  // Aggregate raw synthetic records through the same planner/evaluator as the demo.
  const source = [
    { region: 'East', order_date: '2024-01-15', revenue: 100 }, { region: 'East', order_date: '2024-02-15', revenue: 150 },
    { region: 'West', order_date: '2024-01-15', revenue: 200 }, { region: 'West', order_date: '2024-02-15', revenue: 100 },
    { region: 'North', order_date: '2024-01-15', revenue: 50 }, { region: 'North', order_date: '2024-02-15', revenue: 100 },
  ].toReversed();
  const rows = evaluatePlan(planVisual(interactiveRequest(request, sales.metadata)), source);
  assert.equal(rows.length, 6);
  const rendered = compileVisual({ ...buildAuthorVisual(visual), rows });
  const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: { order_date: 'month' } });
  assert.equal(rendered.state, 'ready'); assert.deepEqual(rendered.narrative, direct.narrative);
  assert.equal(rendered.narrative.text, 'Top movers revenue (2024-02 vs 2024-01): North (50 → 100; 50, 100.00%); East (100 → 150; 50, 50.00%).');
  assert.deepEqual(rendered.narrative.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [50, 100, 50, 100, 100, 150, 50, 50]);
  assert.equal(rendered.table.rows.length, 6);
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
});

test('native movers preserves absent MoverSize and SortOrder through conversion and export', () => {
  const { api, resource } = native();
  const body = api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].TopBottomMovers;
  delete body.MoverSize; delete body.SortOrder;
  resource.definition = convertDefinition(api);
  assert.deepEqual(projectDefinition(resource.definition), api);
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] }, draft = importBundle(bundle);
  assert.deepEqual(selected(draft).imported.issues, []);
  assert.deepEqual(exportBundle(draft), bundle);
});

test('malformed native movers fails closed in validation, import and both compiler dialects', () => {
  for (const [patch, code] of [
    [{ Type: 'MIDDLE' }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ MoverSize: 21 }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ MoverSize: 0 }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ SortOrder: 'PERCENT' }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ Unknown: true }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
  ]) {
    const { api, resource } = native();
    Object.assign(api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].TopBottomMovers, patch);
    resource.definition = convertDefinition(api);
    const error = new RegExp(code);
    assert.throws(() => parseBundleResource(resource), error);
    assert.throws(() => importBundle({ members: [{ path: 'analysis/authored-analysis.json', resource }] }), error);
    for (const [source, definition] of [['api', api.Sheets[0].Visuals[0]], ['bundle', resource.definition.sheets[0].visuals[0]]]) {
      assert.throws(() => compileVisual({ source, definition, rows: null, path: '$', bindings: {} }), error);
    }
  }
});
