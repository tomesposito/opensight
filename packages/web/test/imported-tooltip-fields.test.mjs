import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQsBundle } from '@opensight/bundle-parser/browser';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { activeSheet, authorReducer, emptyDraft, remapVisual } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';

const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const tooltipItem = (fieldId, visibility = 'VISIBLE') => ({ fieldTooltipItem: { fieldId, visibility } });
const realBundle = async () => parseQsBundle(await readFile(new URL('../../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs', import.meta.url)));
function foreignBundle() {
  return { members: [{ path: 'analysis/foreign.json', resource: {
    resourceType: 'analysis', analysisId: 'foreign', name: 'Foreign tooltip fields',
    definition: {
      dataSetIdentifierDeclarations: [{ identifier: 'foreign', dataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/foreign' }],
      sheets: [{ sheetId: 'sheet', name: 'Imported pie', visuals: [{ pieChartVisual: {
        visualId: 'pie', chartConfiguration: {
          fieldWells: { pieChartAggregatedFieldWells: {
            category: [{ categoricalDimensionField: { fieldId: 'generated-region', column: { columnName: 'region', dataSetIdentifier: 'foreign' } } }],
            values: [{ numericalMeasureField: { fieldId: 'generated-revenue', column: { columnName: 'revenue', dataSetIdentifier: 'foreign' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
          } },
          tooltip: { selectedTooltipType: 'DETAILED', fieldBasedTooltip: { tooltipFields: [
            tooltipItem('generated-region', 'HIDDEN'), tooltipItem('generated-revenue'),
            tooltipItem('generated-unknown'), tooltipItem('generated-hidden-unknown', 'HIDDEN'),
          ] } },
        },
      } }] }],
    },
  } }] };
}
const tooltip = bundle => bundle.members[0].resource.definition.sheets[0].visuals[0].pieChartVisual.chartConfiguration.tooltip;

test('real bundle imports every sheet without foreign tooltip IDs in executable fields', async () => {
  const original = await realBundle(), draft = importBundle(original);
  assert.equal(draft.sheets.length, 2);
  for (const sheet of draft.sheets) {
    assert.ok(sheet.visuals.length > 0);
    for (const visual of sheet.visuals) {
      assert.deepEqual(visual.tooltipExtraFields, []);
      const fields = [visual.dimension, ...visual.rows, ...visual.columns, ...visual.measures,
        ...visual.tooltipExtraFields.map(e => e.field), ...visual.tooltipHiddenFields, ...visual.filters.map(f => f.columnName)];
      for (const field of fields.filter(f => f !== null)) assert.doesNotMatch(field, /^us_simpli-/);
    }
  }
  assert.deepEqual(exportBundle(draft), original, 'untouched original members remain identical');
});

test('real bundle sheet remap and UI assignments produce only the region/revenue query', async () => {
  let draft = importBundle(await realBundle());
  draft = authorReducer(draft, { type: 'sheet-remap', id: draft.sheets[0].id });
  draft = authorReducer(draft, { type: 'select', id: draft.sheets[0].visuals[0].id });
  draft = authorReducer(draft, { type: 'assign', field: 'region', well: 'dimension' });
  draft = authorReducer(draft, { type: 'assign', field: 'revenue', well: 'values' });
  const query = buildAuthorQuery(selected(draft), draft.calculatedFields);
  assert.ok(query);
  assert.doesNotMatch(JSON.stringify(query), /us_simpli/);
  assert.deepEqual(query.dimensions, [{ fieldId: 'region', columnName: 'region' }]);
  assert.deepEqual(query.measures, [{ fieldId: 'revenue', columnName: 'revenue', aggregation: 'SUM' }]);
});

test('foreign well IDs resolve to hidden column names and unknown tooltip references stay retained', () => {
  const original = foreignBundle(), draft = importBundle(original), visual = selected(draft);
  assert.deepEqual(visual.tooltipHiddenFields, ['region']);
  assert.deepEqual(visual.tooltipExtraFields, []);
  assert.ok(visual.imported.issues.some(issue => issue.includes('tooltipFields[2]') && issue.endsWith('(retained, read-only)')));
  assert.ok(visual.imported.issues.some(issue => issue.includes('tooltipFields[3]') && issue.endsWith('(retained, read-only)')));
  assert.deepEqual(exportBundle(draft), original);
  assert.deepEqual(exportBundle(authorReducer(draft, { type: 'title', title: 'Edited title' })).members[0].resource.definition.sheets[0].visuals[0].pieChartVisual.chartConfiguration.tooltip,
    tooltip(original), 'unrelated edits preserve foreign tooltip JSON');
});

test('OpenSight detailed tooltip extras round trip with their label and aggregation', () => {
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'pie' });
  draft = authorReducer(draft, { type: 'assign', field: 'region', well: 'dimension' });
  draft = authorReducer(draft, { type: 'assign', field: 'revenue', well: 'values' });
  draft = authorReducer(draft, { type: 'tooltip', patch: { tooltipType: 'detailed', tooltipHiddenFields: ['region'],
    tooltipExtraFields: [{ field: 'profit', label: 'Average profit', aggregation: 'AVG' }] } });
  const visual = selected(importBundle(exportBundle(draft)));
  assert.deepEqual(visual.tooltipExtraFields, [{ field: 'profit', label: 'Average profit', aggregation: 'AVG' }]);
  assert.deepEqual(visual.tooltipHiddenFields, ['region']);
  assert.deepEqual(visual.imported.issues, []);
});

test('remap keeps annotated sales measures and reports dropped foreign extras', () => {
  const bundle = foreignBundle(), detail = tooltip(bundle).fieldBasedTooltip;
  detail.tooltipFields.push(tooltipItem('profit'), tooltipItem('external_score'));
  detail.opensightTooltipExtras = { profit: { label: 'Average profit', aggregation: 'AVG' }, external_score: { aggregation: 'MAX' } };
  const imported = selected(importBundle(bundle)), before = structuredClone(imported);
  assert.equal(imported.tooltipExtraFields.length, 2);
  const visual = remapVisual(imported);
  assert.deepEqual(visual.tooltipExtraFields, [{ field: 'profit', label: 'Average profit', aggregation: 'AVG' }]);
  assert.deepEqual(visual.imported.unmappedFields, ['external_score']);
  assert.deepEqual(imported, before, 'remap does not mutate retained source state');
});

test('remap matches tooltip fields case-insensitively and discards unknown hidden state without missing fields', () => {
  const imported = selected(importBundle(foreignBundle()));
  const visual = remapVisual({ ...imported,
    tooltipExtraFields: [{ field: 'PrOfIt', label: 'Profit', aggregation: 'AVG' }, { field: 'REGION', aggregation: 'COUNT' }],
    tooltipHiddenFields: ['REGION', 'ReVeNuE', 'foreign-hidden'],
  });
  assert.deepEqual(visual.tooltipExtraFields, [{ field: 'profit', label: 'Profit', aggregation: 'AVG' }]);
  assert.deepEqual(visual.tooltipHiddenFields, ['region', 'revenue']);
  assert.deepEqual(visual.imported.unmappedFields, ['REGION'], 'dimension extras cannot execute as measures');
});

test('annotated extras cannot duplicate a well by generated ID or column name', () => {
  const bundle = foreignBundle(), detail = tooltip(bundle).fieldBasedTooltip;
  detail.tooltipFields.push(tooltipItem('revenue'), tooltipItem('profit'), tooltipItem('profit'));
  detail.opensightTooltipExtras = { 'generated-revenue': { aggregation: 'AVG' }, revenue: { aggregation: 'AVG' }, profit: { aggregation: 'AVG' } };
  assert.deepEqual(selected(importBundle(bundle)).tooltipExtraFields, [{ field: 'profit', aggregation: 'AVG' }]);
});

test('generated IDs resolve across multiple well shapes, including columns and KPI-style gauge wells', () => {
  for (const kind of ['heatmap', 'scatter', 'gauge']) {
    let draft = authorReducer(emptyDraft(), { type: 'add', kind });
    draft = authorReducer(draft, { type: 'tooltip', patch: { tooltipType: 'detailed' } });
    const bundle = exportBundle(draft), body = Object.values(bundle.members[0].resource.definition.sheets[0].visuals[0])[0];
    const config = body.chartConfiguration, names = [];
    const rename = value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.fieldId === 'string' && value.column?.columnName) {
        names.push(value.column.columnName); value.fieldId = `generated-${value.column.columnName}`;
      }
      Object.values(value).forEach(rename);
    };
    rename(config.fieldWells);
    assert.ok(names.length > 0);
    config.tooltip.fieldBasedTooltip.tooltipFields = names.map(name => tooltipItem(`generated-${name}`, 'HIDDEN'));
    const visual = selected(importBundle(bundle));
    assert.deepEqual(visual.tooltipHiddenFields, names, kind);
    assert.deepEqual(visual.tooltipExtraFields, [], kind);
  }
});

test('malformed tooltip items and annotations still keep all tooltip defaults on import', () => {
  for (const mutate of [
    detail => { detail.tooltipFields.push({ invalid: true }); },
    detail => { detail.tooltipFields.push(tooltipItem('profit', 'INVALID')); },
    detail => { detail.opensightTooltipExtras = { profit: { aggregation: 'INVALID' } }; },
  ]) {
    const bundle = foreignBundle(); mutate(tooltip(bundle).fieldBasedTooltip);
    const visual = selected(importBundle(bundle));
    assert.equal(visual.tooltipType, 'basic');
    assert.deepEqual(visual.tooltipHiddenFields, []);
    assert.deepEqual(visual.tooltipExtraFields, []);
  }
});
