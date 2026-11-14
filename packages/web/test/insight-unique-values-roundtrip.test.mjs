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
  const api = { DataSetIdentifierDeclarations: resource.definition.dataSetIdentifierDeclarations.map(d => ({ Identifier: d.identifier, DataSetArn: d.dataSetArn })), Sheets: [{ SheetId: 'uv-sheet', Visuals: [{ InsightVisual: {
    VisualId: 'uv-insight', InsightConfiguration: { Computations: [{ UniqueValues: {
      ComputationId: 'unique-values', Name: 'Regions',
      Category: { CategoricalDimensionField: { FieldId: 'region', Column: { ColumnName: 'region', DataSetIdentifier: 'sales_data' } } },
    } }] },
  } }] }] };
  resource.definition = convertDefinition(api);
  return { api, resource, bundle: { members: [{ path: 'analysis/authored-analysis.json', resource }] } };
};

test('native unique-values converts both ways, imports, queries, renders and exports unchanged', async () => {
  const { api, resource, bundle } = native(), before = structuredClone(bundle), apiBefore = structuredClone(api);
  assert.deepEqual(projectDefinition(resource.definition), api);
  assert.deepEqual(parseBundleResource(resource), resource);
  const draft = importBundle(bundle), visual = selected(draft);
  assert.deepEqual(visual.imported.issues, []);
  assert.deepEqual(visual.insightConfiguration, resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration);
  const request = buildAuthorQuery(visual); assert.ok(request);
  const source = [
    { region: 'West', revenue: 5 }, { region: 'East', revenue: 10 },
    { region: 'West', revenue: 7 }, { region: 'Central', revenue: 1 },
  ];
  const rows = evaluatePlan(planVisual(interactiveRequest(request, sales.metadata)), source);
  assert.equal(rows.length, 3);
  const rendered = compileVisual({ ...buildAuthorVisual(visual), rows });
  const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: {} });
  assert.equal(rendered.state, 'ready'); assert.deepEqual(rendered.narrative, direct.narrative);
  assert.equal(rendered.narrative.text, 'Unique region: Central; East; West.');
  assert.deepEqual(rendered.narrative.paragraphs[0].parts.filter(p => p.value !== undefined), []);
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

test('malformed native unique-values fails closed in validation, import and both compiler dialects', () => {
  for (const [patch, code] of [
    [{ ComputationId: '' }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ Name: 3 }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ Unknown: true }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
    [{ Value: { NumericalMeasureField: { FieldId: 'revenue', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales_data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } } }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
  ]) {
    const { api, resource } = native();
    Object.assign(api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].UniqueValues, patch);
    resource.definition = convertDefinition(api);
    const error = new RegExp(code);
    assert.throws(() => parseBundleResource(resource), error);
    assert.throws(() => importBundle({ members: [{ path: 'analysis/authored-analysis.json', resource }] }), error);
    for (const [source, definition] of [['api', api.Sheets[0].Visuals[0]], ['bundle', resource.definition.sheets[0].visuals[0]]]) {
      assert.throws(() => compileVisual({ source, definition, rows: null, path: '$', bindings: {} }), error);
    }
  }
});
