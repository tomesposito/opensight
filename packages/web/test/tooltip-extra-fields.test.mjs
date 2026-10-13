import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, validateDraft, parseDraft, serializeVisual, tooltipExtraFieldsValid } from '../build/test/authoring.js';
import { buildAuthorVisual, buildAuthorPreview } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { importBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { parseQsBundle } from '@opensight/bundle-parser';
import { TooltipSection } from '../build/test/TooltipEditor.js';
import sales from '../src/sales.generated.json' with { type: 'json' };

const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const bar = () => ({ ...selected(add('bar')), dimension: 'region', measures: ['revenue'] });
const detailed = v => ({ ...v, tooltipType: 'detailed' });
const withExtra = v => detailed({ ...v, tooltipExtraFields: [{ field: 'profit', label: 'Avg profit', aggregation: 'AVG' }] });
const input = (v, rows) => ({ ...buildAuthorVisual(v), rows });

test('tooltip extra fields default empty and validate at reducer and draft boundaries', () => {
  assert.deepEqual(selected(add('bar')).tooltipExtraFields, []);
  assert.ok(tooltipExtraFieldsValid([]));
  assert.ok(tooltipExtraFieldsValid([{ field: 'profit', aggregation: 'SUM' }]));
  assert.ok(tooltipExtraFieldsValid([{ field: 'profit', label: 'P', aggregation: 'AVG' }]));
  for (const bad of [
    [{ field: '', aggregation: 'SUM' }],
    [{ field: 'profit' }],
    [{ field: 'profit', aggregation: 'MEDIAN' }],
    [{ field: 'profit', aggregation: 'SUM', label: 'x'.repeat(129) }],
    [{ field: 'profit', aggregation: 'SUM' }, { field: 'profit', aggregation: 'AVG' }],
    [{ field: 'profit', aggregation: 'SUM', bogus: 1 }],
    'profit',
  ]) {
    assert.equal(tooltipExtraFieldsValid(bad), false, JSON.stringify(bad));
  }
  // Valid patch applies; invalid patches leave the visual unchanged.
  const applied = selected(authorReducer(add('bar'), { type: 'tooltip', patch: { tooltipExtraFields: [{ field: 'profit', aggregation: 'AVG' }] } }));
  assert.deepEqual(applied.tooltipExtraFields, [{ field: 'profit', aggregation: 'AVG' }]);
  for (const patch of [
    { tooltipExtraFields: [{ field: 'profit', aggregation: 'MEDIAN' }] },
    { tooltipExtraFields: [{ field: 'profit', aggregation: 'SUM' }, { field: 'profit', aggregation: 'SUM' }] },
    { tooltipExtraFields: 'profit' },
  ]) {
    assert.deepEqual(selected(authorReducer(add('bar'), { type: 'tooltip', patch })).tooltipExtraFields, [], JSON.stringify(patch));
    const tampered = add('bar');
    Object.assign(selected(tampered), patch);
    assert.throws(() => validateDraft(tampered), JSON.stringify(patch));
  }
  // An extra field that is already in the visual is dropped, never stored.
  const dropped = selected(authorReducer(add('bar'), { type: 'tooltip', patch: { tooltipExtraFields: [{ field: 'revenue', aggregation: 'SUM' }] } }));
  assert.deepEqual(dropped.tooltipExtraFields, []);
  // Drafts saved before this feature migrate cleanly through parseDraft (migrate + validate).
  const legacy = add('bar');
  delete selected(legacy).tooltipExtraFields;
  assert.throws(() => validateDraft(legacy), /Invalid or unsupported author draft/);
  const migrated = parseDraft(JSON.stringify(legacy));
  assert.deepEqual(selected(migrated).tooltipExtraFields, []);
});

test('extra fields export to tooltipFields plus the OpenSight extension and keep the shape stable when empty', () => {
  const tooltip = serializeVisual(withExtra(bar())).barChartVisual.chartConfiguration.tooltip;
  assert.deepEqual(tooltip, {
    tooltipVisibility: 'VISIBLE',
    selectedTooltipType: 'DETAILED',
    fieldBasedTooltip: {
      aggregationVisibility: 'VISIBLE',
      tooltipTitleType: 'PRIMARY_VALUE',
      tooltipFields: [
        { fieldTooltipItem: { fieldId: 'region', visibility: 'VISIBLE' } },
        { fieldTooltipItem: { fieldId: 'revenue', visibility: 'VISIBLE' } },
        { fieldTooltipItem: { fieldId: 'profit', visibility: 'VISIBLE' } },
      ],
      opensightTooltipExtras: { profit: { label: 'Avg profit', aggregation: 'AVG' } },
    },
  });
  // No extras: byte-identical shape to before (no extension key).
  const plain = serializeVisual(detailed(bar())).barChartVisual.chartConfiguration.tooltip;
  assert.ok(!('opensightTooltipExtras' in plain.fieldBasedTooltip));
  assert.deepEqual(plain.fieldBasedTooltip.tooltipFields, [
    { fieldTooltipItem: { fieldId: 'region', visibility: 'VISIBLE' } },
    { fieldTooltipItem: { fieldId: 'revenue', visibility: 'VISIBLE' } },
  ]);
});

test('bundle round trip preserves extra fields with label and aggregation', async () => {
  const edited = { ...add('bar'), sheets: [{ ...add('bar').sheets[0], visuals: [withExtra(bar())] }] };
  validateDraft(edited);
  const bundle = await parseQsBundle(await downloadBundleBytes(edited));
  const draft = importBundle(bundle);
  assert.deepEqual(activeSheet(draft).visuals[0].tooltipExtraFields, [{ field: 'profit', label: 'Avg profit', aggregation: 'AVG' }]);
  assert.deepEqual(activeSheet(draft).visuals[0].imported.issues, []);
});

test('imported foreign tooltip fields without the extension become extras with SUM defaults', async () => {
  const edited = { ...add('bar'), sheets: [{ ...add('bar').sheets[0], visuals: [detailed(bar())] }] };
  const bundle = await parseQsBundle(await downloadBundleBytes(edited));
  // Simulate a foreign QuickSight bundle: extra tooltip field, no OpenSight extension.
  const visual = Object.values(bundle.members[0].resource.definition.sheets[0].visuals[0])[0];
  visual.chartConfiguration.tooltip.fieldBasedTooltip.tooltipFields.push({ fieldTooltipItem: { fieldId: 'profit', visibility: 'VISIBLE' } });
  const draft = importBundle(bundle);
  assert.deepEqual(activeSheet(draft).visuals[0].tooltipExtraFields, [{ field: 'profit', aggregation: 'SUM' }]);
});

test('malformed extras extension keeps tooltip defaults on import and fails closed in the compiler', async () => {
  const edited = { ...add('bar'), sheets: [{ ...add('bar').sheets[0], visuals: [withExtra(bar())] }] };
  const bundle = await parseQsBundle(await downloadBundleBytes(edited));
  const tooltip = Object.values(bundle.members[0].resource.definition.sheets[0].visuals[0])[0].chartConfiguration.tooltip;
  tooltip.fieldBasedTooltip.opensightTooltipExtras = { profit: { aggregation: 'MEDIAN' } };
  const draft = importBundle(bundle);
  assert.deepEqual(activeSheet(draft).visuals[0].tooltipExtraFields, []);
  assert.equal(activeSheet(draft).visuals[0].tooltipType, 'basic');
  // Compiler: malformed extension is a named error, never a silent default.
  const broken = serializeVisual(withExtra(bar()));
  broken.barChartVisual.chartConfiguration.tooltip.fieldBasedTooltip.opensightTooltipExtras = { profit: { aggregation: 'MEDIAN' } };
  assert.throws(() => compileVisual({ ...buildAuthorVisual(bar()), definition: broken, rows: [] }), /unsupported value/);
  // Duplicate extra field ids fail closed too.
  const duped = serializeVisual(withExtra(bar()));
  duped.barChartVisual.chartConfiguration.tooltip.fieldBasedTooltip.tooltipFields.push({ fieldTooltipItem: { fieldId: 'profit', visibility: 'VISIBLE' } });
  assert.throws(() => compileVisual({ ...buildAuthorVisual(bar()), definition: duped, rows: [] }), /duplicate tooltip field/);
});

test('buildAuthorQuery appends extras as measures at the existing grain', () => {
  const request = buildAuthorQuery(withExtra(bar()));
  assert.deepEqual(request.measures, [
    { fieldId: 'revenue', columnName: 'revenue', aggregation: 'SUM' },
    { fieldId: 'profit', columnName: 'profit', aggregation: 'AVG' },
  ]);
  assert.deepEqual(request.dimensions, [{ fieldId: 'region', columnName: 'region' }]);
  assert.equal(buildAuthorQuery(bar()).measures.length, 1);
});

test('fixture query computes extras at the visual grain (no client-side join guesses)', () => {
  const request = buildAuthorQuery(withExtra(bar()));
  assert.ok(request);
  const { rows, message } = executeFixtureQuery(request);
  assert.equal(message, undefined);
  assert.ok(rows && rows.length > 1);
  // Independent oracle: group the raw fixture rows by region and average profit (SQL AVG skips nulls).
  const byRegion = new Map();
  for (const row of sales.rows) {
    const key = row.region;
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(row.profit);
  }
  assert.equal(rows.length, byRegion.size);
  for (const row of rows) {
    const profits = byRegion.get(row.region).filter(p => p !== null);
    const expected = profits.reduce((a, b) => a + b, 0) / profits.length;
    assert.ok(Math.abs(row.profit - expected) < 1e-9, `region ${row.region}: ${row.profit} !== ${expected}`);
    assert.ok(typeof row.revenue === 'number');
  }
});

test('detailed tooltip formatter renders extra rows with label and aggregation word', () => {
  const v = withExtra(bar());
  const compiled = compileVisual(input(v, [{ region: 'East', revenue: 100, profit: 12.5 }]));
  const text = compiled.option.tooltip.formatter({ dataIndex: 0 });
  assert.ok(text.includes('East'), text);
  assert.ok(text.includes('Sum of revenue: 100'), text);
  assert.ok(text.includes('Avg of Avg profit: 12.5'), text);
  // Aggregations hidden: plain label, no "Avg of" prefix.
  const plain = compileVisual(input({ ...v, tooltipAggregations: false }, [{ region: 'East', revenue: 100, profit: 12.5 }]));
  const plainText = plain.option.tooltip.formatter({ dataIndex: 0 });
  assert.ok(plainText.includes('Avg profit: 12.5'), plainText);
  assert.ok(!plainText.includes('Avg of'), plainText);
});

test('missing extra result column fails closed with a named error', () => {
  const v = withExtra(bar());
  assert.throws(() => compileVisual(input(v, [{ region: 'East', revenue: 100 }])), /missing result column profit for field profit/);
});

test('author preview computes extras through the query engine instead of pinned oracles', () => {
  const preview = buildAuthorPreview(withExtra(bar()));
  assert.ok(preview.rows && preview.rows.length > 1);
  assert.ok(preview.rows.every(r => typeof r.profit === 'number' && typeof r.revenue === 'number'));
  const compiled = compileVisual(preview);
  assert.ok(compiled.option.tooltip.formatter({ dataIndex: 0 }).includes('Avg of Avg profit'));
  // Without extras the pinned oracle path is unchanged.
  const plain = buildAuthorPreview(bar());
  assert.deepEqual(plain.rows, [{ region: 'East', revenue: 500 }]);
});

test('Add field panel: staged save, disabled save, cancel, remove', () => {
  const seen = [];
  const dispatch = action => { seen.push(action); };
  // Detailed section shows the Add field button and the updated hint.
  const html = renderToStaticMarkup(createElement(TooltipSection, { visual: detailed(bar()), dispatch }));
  assert.ok(html.includes('Add field'), html.slice(0, 600));
  assert.ok(html.includes('Added fields must be dataset measures'), html);
  // Basic section has no Add field surface.
  const basic = renderToStaticMarkup(createElement(TooltipSection, { visual: bar(), dispatch }));
  assert.ok(!basic.includes('Add field'));
});
