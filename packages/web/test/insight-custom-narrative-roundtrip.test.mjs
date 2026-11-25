import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource, parseQsBundle } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, validateDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { compileVisual } from '../build/test/compiler.js';
const selected = draft => activeSheet(draft).visuals[0];
const template = 'Leader {Top.items[0].category}: {Top.items[0].value|decimals:2}\n\nTotal {field.revenue-id|grouping:false,decimals:0}';
const native = (narrative = template) => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'insight' }));
  const api = { DataSetIdentifierDeclarations: resource.definition.dataSetIdentifierDeclarations.map(d => ({ Identifier: d.identifier, DataSetArn: d.dataSetArn })), Sheets: [{ SheetId: 'custom-sheet', Visuals: [{ InsightVisual: {
    VisualId: 'custom', InsightConfiguration: { CustomNarrative: { Narrative: narrative }, Computations: [{ TopBottomRanked: {
      ComputationId: 'rank', Name: 'Top', Type: 'TOP', ResultSize: 2,
      Category: { CategoricalDimensionField: { FieldId: 'region', Column: { ColumnName: 'region', DataSetIdentifier: 'sales_data' } } },
      Value: { NumericalMeasureField: { FieldId: 'revenue-id', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales_data' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } },
    } }] },
  } }] }] };
  resource.definition = convertDefinition(api);
  return { api, resource, bundle: { members: [{ path: 'analysis/authored-analysis.json', resource }] } };
};
const rows = [{ region: 'East', revenue: 100 }, { region: 'West', revenue: 300 }];

test('native and bundle subset narratives import, query, compile, store and export byte-identical templates', async () => {
  const { api, resource, bundle } = native(), before = structuredClone(bundle);
  assert.deepEqual(parseBundleResource(resource), resource);
  const draft = importBundle(bundle), visual = selected(draft);
  assert.deepEqual(visual.imported.issues, []); validateDraft(draft);
  const changedKind = authorReducer(draft, { type: 'kind', kind: 'bar' });
  assert.doesNotThrow(() => validateDraft(changedKind));
  const restoredKind = authorReducer(changedKind, { type: 'kind', kind: 'insight' });
  assert.doesNotThrow(() => validateDraft(restoredKind));
  assert.equal(selected(restoredKind).insightMeasureIds.revenue, 'revenue-id');
  const request = buildAuthorQuery(visual); assert.ok(request);
  const computed = structuredClone(visual); delete computed.insightConfiguration.customNarrative;
  assert.deepEqual(request, buildAuthorQuery(computed));
  const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: {} });
  const authored = compileVisual({ ...buildAuthorVisual(visual), rows });
  assert.equal(authored.state, 'ready'); assert.deepEqual(authored.narrative, direct.narrative);
  assert.equal(direct.narrative.text, 'Leader West: 300.00\n\nTotal 400');
  assert.deepEqual(exportBundle(draft), before);
  assert.deepEqual(await parseQsBundle(await downloadBundleBytes(draft)), before);
  assert.equal(projectDefinition(resource.definition).Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.CustomNarrative.Narrative, template);
  const edited = authorReducer(draft, { type: 'insight', configuration: { ...visual.insightConfiguration, customNarrative: { narrative: `${template}!` } } });
  const exported = exportBundle(edited);
  assert.equal(exported.members[0].resource.definition.sheets[0].visuals[0].insightVisual.insightConfiguration.customNarrative.narrative, `${template}!`);
  const reopened = importBundle(exported); assert.deepEqual(selected(reopened).imported.issues, []);
  assert.equal(compileVisual({ ...buildAuthorVisual(selected(reopened)), rows }).narrative.text, `${direct.narrative.text}!`);
  assert.deepEqual(bundle, before);
});

test('field-only custom narratives retain imported well IDs without adding computations', () => {
  const { resource } = native('{field.revenue-id}');
  const body = resource.definition.sheets[0].visuals[0].insightVisual;
  const ranked = body.insightConfiguration.computations[0].topBottomRanked;
  body.chartConfiguration = { fieldWells: { insightAggregatedFieldWells: { category: [ranked.category], values: [ranked.value] } } };
  delete body.insightConfiguration.computations;
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const draft = importBundle(bundle); assert.deepEqual(selected(draft).imported.issues, []);
  assert.ok(buildAuthorQuery(selected(draft)));
  assert.equal(compileVisual({ ...buildAuthorVisual(selected(draft)), rows }).narrative.text, '400');
  assert.deepEqual(exportBundle(draft), bundle);
  const unbound = authorReducer(draft, { type: 'unassign', well: 'values', field: 'revenue' });
  assert.equal(buildAuthorQuery(selected(unbound)), null);
});

test('unsupported expressions and unresolved references fail at import and retain the original template', () => {
  for (const [narrative, code] of [
    ['{if Top.itemsCount}', 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'],
    ['{sum(Top.items[0].value)}', 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'],
    ['${forecast.result}', 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'],
    ['{missing.value}', 'INSIGHT_CUSTOM_NARRATIVE_REFERENCE'],
    ['{field.unbound}', 'INSIGHT_CUSTOM_NARRATIVE_REFERENCE'],
    ['{field.region}', 'INSIGHT_CUSTOM_NARRATIVE_REFERENCE'],
  ]) {
    const { api, bundle } = native(narrative), draft = importBundle(bundle);
    assert.match(JSON.stringify(draft.bundle.report), new RegExp(code));
    assert.equal(buildAuthorQuery(selected(draft)), null);
    assert.throws(() => compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: {} }), new RegExp(code));
    assert.deepEqual(exportBundle(draft), bundle);
  }
});
