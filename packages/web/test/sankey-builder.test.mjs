import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, serializeVisual, validateDraft, capabilityNote, authorVisualProblem } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { compileVisual } from '../build/test/compiler.js';
import { convertDefinition } from '../build/test/definition-converter.js';

const add = () => authorReducer(emptyDraft(), { type: 'add', kind: 'sankey' });
const visual = d => activeSheet(d).visuals[0];
const bundleOf = resource => ({ members: [{ path: 'analysis/authored-analysis.json', resource }] });

test('sankey gallery exposes Source, Destination and Weight and recomputes pinned flows', () => {
  let draft = add();
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  for (const label of ['Source', 'Destination', 'Weight']) assert.ok(html.includes(`aria-label="Assign ${label}"`));
  assert.ok(html.includes(capabilityNote('sankey'))); assert.match(html, /Show legend/);
  assert.deepEqual(visual(draft).rows, ['region']); assert.deepEqual(visual(draft).columns, ['category']);
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'values' });
  assert.deepEqual(visual(draft).measures, ['profit']); validateDraft(draft);
  const profit = executeFixtureQuery(buildAuthorQuery(visual(draft)));
  assert.throws(() => compileVisual({ source: 'bundle', definition: serializeVisual(visual(draft)), rows: profit.rows, bindings: {}, path: '$' }), /SANKEY_WEIGHT_INVALID/);
  draft = authorReducer(draft, { type: 'assign', field: 'revenue', well: 'values' });
  const query = buildAuthorQuery(visual(draft));
  assert.deepEqual(query.dimensions.map(d => d.columnName), ['region', 'category']);
  assert.deepEqual(query.measures.map(m => m.columnName), ['revenue']);
  const result = executeFixtureQuery(query); assert.ok(result.rows, result.message);
  const c = compileVisual({ source: 'bundle', definition: serializeVisual(visual(draft)), rows: result.rows, bindings: {}, path: '$' });
  assert.equal(c.state, 'ready');
  assert.equal(c.option.series[0].data.length, new Set(result.rows.flatMap(r => [r.region, r.category])).size);
  assert.equal(c.option.series[0].links.reduce((sum, l) => sum + l.value, 0), result.rows.reduce((sum, r) => sum + r.revenue, 0));
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).columns, ['category']); assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
});

test('sankey replacements, removal and type changes enforce one field per well', () => {
  let draft = add();
  for (const field of ['category', 'order_date']) draft = authorReducer(draft, { type: 'assign', field, well: 'columns' });
  assert.deepEqual(visual(draft).columns, ['order_date']);
  draft = authorReducer(draft, { type: 'assign', field: 'category', well: 'rows' });
  assert.deepEqual(visual(draft).rows, ['category']); validateDraft(draft);
  draft = authorReducer(draft, { type: 'kind', kind: 'pivot' });
  draft = authorReducer(draft, { type: 'assign', field: 'region', well: 'rows' });
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'values' });
  assert.equal(visual(draft).rows.length, 2); assert.equal(visual(draft).measures.length, 2);
  draft = authorReducer(draft, { type: 'kind', kind: 'sankey' });
  assert.deepEqual(visual(draft).rows, ['category']); assert.deepEqual(visual(draft).columns, ['order_date']);
  assert.deepEqual(visual(draft).measures, ['revenue']); validateDraft(draft);
  for (const [field, well, error] of [['category', 'rows', 'SOURCE'], ['order_date', 'columns', 'DESTINATION'], ['revenue', 'values', 'WEIGHT']]) {
    const removed = authorReducer(draft, { type: 'unassign', field, well }); validateDraft(removed);
    assert.throws(() => compileVisual({ source: 'bundle', definition: serializeVisual(visual(removed)), rows: null, bindings: {}, path: '$' }), new RegExp(`SANKEY_${error}_REQUIRED`));
  }
  visual(draft).columns.push('region');
  assert.throws(() => validateDraft(draft), /Invalid or unsupported/);
});

test('sankey imported native options and malformed wells are named, blocked and retained', () => {
  for (const [change, error] of [
    [c => { c.sortConfiguration = { sourceSort: [] }; }, /sourceSort.*unsupported property/],
    [c => { c.sortConfiguration = { weightSort: [] }; }, /weightSort.*unsupported property/],
    [c => { c.sortConfiguration = { sourceItemsLimit: { itemsLimit: 5 } }; }, /sourceItemsLimit.*unsupported property/],
    [c => { c.sortConfiguration = { categoryItemsLimit: {} }; }, /categoryItemsLimit.*unsupported property/],
    [c => { c.tooltip = { selectedTooltipType: 'DETAILED' }; }, /selectedTooltipType.*unsupported property/],
    [c => { c.linkStyle = { color: 'SOURCE' }; }, /linkStyle.*unsupported property/],
    [c => { c.fieldWells.sankeyDiagramAggregatedFieldWells.source = []; }, /SANKEY_SOURCE_REQUIRED/],
    [c => { c.fieldWells.sankeyDiagramAggregatedFieldWells.destination = []; }, /SANKEY_DESTINATION_REQUIRED/],
    [c => { c.fieldWells.sankeyDiagramAggregatedFieldWells.weight = []; }, /SANKEY_WEIGHT_REQUIRED/],
  ]) {
    const resource = serializeDraft(add()); change(resource.definition.sheets[0].visuals[0].sankeyDiagramVisual.chartConfiguration);
    const bundle = bundleOf(resource), imported = importBundle(bundle), report = JSON.stringify(imported.bundle.report);
    assert.match(report, /CompileError/); assert.match(report, error);
    assert.match(authorVisualProblem(visual(imported)), /Unsupported features/);
    assert.equal(buildAuthorQuery(visual(imported)), null); assert.deepEqual(exportBundle(imported), bundle);
  }
});

test('SankeyDiagramVisual API imports hydrate all three wells and retain unknown native options', () => {
  const apiKeys = v => Array.isArray(v) ? v.map(apiKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), apiKeys(v)])) : v;
  const original = serializeDraft(add());
  const api = apiKeys(original.definition);
  // Omit layouts; their OpenSight-authored keys have dedicated API spellings.
  delete api.Sheets[0].Layouts;
  const resource = { ...original, definition: convertDefinition(api) };
  const imported = importBundle(bundleOf(resource));
  assert.equal(visual(imported).kind, 'sankey'); assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(visual(imported).rows, ['region']); assert.deepEqual(visual(imported).columns, ['category']);
  assert.deepEqual(visual(imported).measures, ['revenue']); assert.ok(buildAuthorQuery(visual(imported)));
  api.Sheets[0].Visuals[0].SankeyDiagramVisual.ChartConfiguration.NativeFutureOption = { KeepCase: true };
  const unsupported = { ...original, definition: convertDefinition(api) }, bundle = bundleOf(unsupported), blocked = importBundle(bundle);
  assert.match(JSON.stringify(blocked.bundle.report), /CompileError.*NativeFutureOption.*unsupported property/);
  assert.equal(buildAuthorQuery(visual(blocked)), null); assert.deepEqual(exportBundle(blocked), bundle);
});
