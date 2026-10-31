import test from 'node:test';
import assert from 'node:assert/strict';
import { dataFields, emptyDraft, authorReducer, serializeVisual, validateDraft } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { formatMetric } from '../build/test/governed-metrics.js';
import { compileVisual } from '../build/test/compiler.js';
const metric = { id: 'margin', version: 2, name: 'Margin', expression: 'sum({profit}) / sum({revenue})', defaultAggregation: 'AVG', format: { style: 'percent', decimalPlaces: 1 }, description: '', synonyms: ['profit rate'] };
const dataset = { id: 'prepared', name: 'Sales', columns: [{ name: 'revenue', type: 'DECIMAL' }, { name: 'profit', type: 'DECIMAL' }], metrics: [metric] };
test('metric panel fields, assignment, serialization and queries retain stable references and defaults', () => {
  const field = dataFields([], dataset).find(f => f.metric);
  assert.equal(field.label, 'Margin'); assert.equal(field.name, '__metric_margin'); assert.equal(field.group, 'Governed metrics');
  let draft = { ...emptyDraft(), dataset };
  draft = authorReducer(draft, { type: 'assign-with-no-selection', field: field.name, well: 'values' });
  draft = authorReducer(draft, { type: 'kind', kind: 'kpi' });
  validateDraft(draft);
  const visual = draft.sheets[0].visuals[0], query = buildAuthorQuery(visual, [], [], dataset);
  assert.equal(query.measures[0].aggregation, 'AVG'); assert.equal(query.calculatedFields, undefined);
  const definition = serializeVisual(visual, true, [], dataset);
  const compiled = compileVisual({ source: 'bundle', definition, rows: [{ __metric_margin: .1234 }], bindings: {}, path: '$' });
  assert.equal(compiled.option.graphic[0].style.text, '12.3%');
  assert.equal(formatMetric(1.25, { style: 'currency', currency: 'USD', decimalPlaces: 2 }), '$1.25');
  assert.equal(formatMetric(1234, { style: 'number', decimalPlaces: 0 }), '1,234');
});

test('Ask O produces a stable metric reference without snapshotting a governed expression', async () => {
  const { oVocabulary, prepareOVisual } = await import('../build/test/o-authoring.js');
  const { interpretQuestion } = await import('@opensight/o-interpreter');
  const interpreted = interpretQuestion('profit rate', oVocabulary([], dataset)).interpretations[0];
  const prepared = prepareOVisual(interpreted, [], dataset);
  assert.equal(prepared.visual.measures[0], '__metric_margin');
  assert.deepEqual(prepared.calculatedFields, []);
  assert.equal(buildAuthorQuery(prepared.visual, [], [], dataset).measures[0].aggregation, 'AVG');
});


test('governed chart defaults format axis, label and tooltip without an explicit visual override', () => {
  const chartDataset = { ...dataset, columns: [...dataset.columns, { name: 'region', type: 'STRING' }] };
  let draft = { ...emptyDraft(), dataset: chartDataset };
  draft = authorReducer(draft, { type: 'assign-with-no-selection', field: '__metric_margin', well: 'values' });
  draft = authorReducer(draft, { type: 'assign', field: 'region', well: 'dimension' });
  const visual = draft.sheets[0].visuals[0];
  const compiled = compileVisual({ source: 'bundle', definition: serializeVisual(visual, true, [], chartDataset), rows: [{ region: 'East', __metric_margin: .1234 }], bindings: {}, path: '$' });
  const series = compiled.option.series[0];
  assert.equal(series.label.formatter({ value: .1234 }), '12.3%');
  assert.equal(series.tooltip.valueFormatter(.1234), '12.3%');
  assert.equal(compiled.option.yAxis.axisLabel.formatter(.1234), '12.3%');
});
