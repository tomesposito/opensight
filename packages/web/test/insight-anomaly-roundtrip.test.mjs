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
const native = detection => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'insight' }));
  const api = { DataSetIdentifierDeclarations: resource.definition.dataSetIdentifierDeclarations.map(d => ({ Identifier: d.identifier, DataSetArn: d.dataSetArn })), Sheets: [{ SheetId: 'anomaly-sheet', Visuals: [{ InsightVisual: {
    VisualId: 'anomaly-insight', InsightConfiguration: { Computations: [{ Anomaly: {
      ComputationId: 'anomaly', Name: 'Revenue anomalies',
      Time: { DateDimensionField: { FieldId: 'order_date', Column: { ColumnName: 'order_date', DataSetIdentifier: 'sales_data' }, DateGranularity: 'DAY' } },
      Value: { NumericalMeasureField: { FieldId: 'revenue', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales_data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } },
      ...(detection === undefined ? {} : { AnomalyDetection: detection }),
    } }] },
  } }] }] };
  resource.definition = convertDefinition(api);
  return { api, resource, bundle: { members: [{ path: 'analysis/authored-analysis.json', resource }] } };
};

test('native anomaly converts, imports, aggregates, renders SVG and exports unchanged without default injection', async () => {
  for (const detection of [undefined, {}, { Direction: 'BOTH', MinSensitivityPercentage: 0 }, { Direction: 'HIGHER', MinSensitivityPercentage: 100 }, { Direction: 'LOWER', MinSensitivityPercentage: 2.5 }]) {
    const { api, resource, bundle } = native(detection), before = structuredClone(bundle), apiBefore = structuredClone(api);
    assert.deepEqual(projectDefinition(resource.definition), api);
    const converted = resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration.computations[0].anomaly;
    assert.deepEqual(converted.anomalyDetection, detection === undefined ? undefined : Object.fromEntries(Object.entries(detection).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v])));
    assert.deepEqual(parseBundleResource(resource), resource);
    const draft = importBundle(bundle), visual = selected(draft);
    assert.deepEqual(visual.imported.issues, []);
    const request = buildAuthorQuery(visual); assert.ok(request);
    // Duplicate source dates are aggregated first; the narrative receives one row per period.
    const source = [9, 10, 10, 11, 40].map((revenue, i) => ({ order_date: `2024-01-0${i + 1}`, revenue }));
    source.push({ order_date: '2024-01-05', revenue: 60 });
    const rows = evaluatePlan(planVisual(interactiveRequest(request, sales.metadata)), source.toReversed());
    assert.equal(rows.length, 5);
    const rendered = compileVisual({ ...buildAuthorVisual(visual), rows });
    const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: { order_date: 'day' } });
    assert.equal(rendered.state, 'ready'); assert.deepEqual(rendered.narrative, direct.narrative);
    const result = detection?.Direction === 'LOWER' ? 'no anomalies detected' : '2024-01-05 (100, unusually high)';
    assert.equal(rendered.narrative.text, `Statistical anomaly detection for revenue by order_date: ${result}.`);
    assert.equal(rendered.table.rows.length, 5);
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 800, height: 300 });
    try {
      chart.setOption(rendered.option);
      const svg = chart.renderToSVGString();
      // The shared text layout drops whitespace at visual line boundaries.
      assert.equal([...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(m => m[1]).join('').replace(/\s/g, ''), rendered.narrative.text.replace(/\s/g, ''));
      assert.doesNotMatch(svg, /NaN|Infinity/);
    } finally { chart.dispose(); }
    assert.deepEqual(exportBundle(draft), before);
    const downloaded = await parseQsBundle(await downloadBundleBytes(draft));
    assert.deepEqual(downloaded, before);
    assert.deepEqual(projectDefinition(downloaded.members[0].resource.definition), apiBefore);
    assert.deepEqual(bundle, before); assert.deepEqual(api, apiBefore);
  }
});

test('malformed native anomaly fails closed before querying in both compiler dialects', () => {
  for (const [patch, code] of [
    [{ AnomalyDetection: { Direction: 'UP' } }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ AnomalyDetection: { MinSensitivityPercentage: 101 } }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ AnomalyDetection: null }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ ComputationId: '' }, 'INSIGHT_COMPUTATION_INVALID'],
    [{ Unknown: true }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
    [{ AnomalyDetection: { Unknown: true } }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
  ]) {
    const { api, resource } = native();
    Object.assign(api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].Anomaly, patch);
    resource.definition = convertDefinition(api);
    const error = new RegExp(code);
    assert.throws(() => parseBundleResource(resource), error);
    assert.throws(() => importBundle({ members: [{ path: 'analysis/authored-analysis.json', resource }] }), error);
    for (const [source, definition] of [['api', api.Sheets[0].Visuals[0]], ['bundle', resource.definition.sheets[0].visuals[0]]]) {
      assert.throws(() => compileVisual({ source, definition, rows: null, path: '$', bindings: {} }), error);
    }
  }
});
