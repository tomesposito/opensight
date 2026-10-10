import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQsBundle } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { init } from '../build/test/echarts.js';

const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const input = (v, rows = [{ region: 'East', category: 'A', month: '2025-01', revenue: 12.345, profit: 5.5 }]) => ({ ...buildAuthorVisual(v), rows });
const withLines = d => authorReducer(authorReducer(authorReducer(authorReducer(d, { type: 'reference-line-add' }),
  { type: 'reference-line-update', id: 'refline-1', patch: { value: 5, label: 'Low', color: '#00ff00' } }),
  { type: 'reference-line-add' }),
  { type: 'reference-line-update', id: 'refline-2', patch: { value: 10, label: 'High', color: '#ff0000' } });
const expectedLines = [
  { id: 'refline-1', value: 5, label: 'Low', color: '#00ff00' },
  { id: 'refline-2', value: 10, label: 'High', color: '#ff0000' },
];

test('reference lines round-trip through bundle import/export with editor ids', async () => {
  const d = withLines(add('bar'));
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).referenceLines, expectedLines);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
});

test('hidden tooltip imports with tooltipVisible false and round-trips', async () => {
  const d = authorReducer(add('bar'), { type: 'display', property: 'tooltipVisible', value: false });
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  assert.equal(selected(restored).tooltipVisible, false);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
});

test('combined bar with reference lines and hidden tooltip survives the full cycle and renders markLines', async () => {
  const d = authorReducer(withLines(add('bar')), { type: 'display', property: 'tooltipVisible', value: false });
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  const v = selected(restored);
  assert.deepEqual(v.referenceLines, expectedLines);
  assert.equal(v.tooltipVisible, false);
  assert.deepEqual(v.imported.issues, []);
  const { option } = compileVisual(input(v));
  assert.deepEqual(option.series[0].markLine.data, [
    { name: 'Low', yAxis: 5, label: { color: '#00ff00' }, lineStyle: { color: '#00ff00' } },
    { name: 'High', yAxis: 10, label: { color: '#ff0000' }, lineStyle: { color: '#ff0000' } },
  ]);
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 320 });
  try { chart.setOption(option); assert.match(chart.renderToSVGString(), /High/); } finally { chart.dispose(); }
  const reExported = exportBundle(restored);
  assert.deepEqual(reExported, bundle);
  // A second import cycle of the exported bundle is stable: still zero issues.
  const again = importBundle(reExported);
  assert.deepEqual(selected(again).referenceLines, expectedLines);
  assert.equal(selected(again).tooltipVisible, false);
  assert.deepEqual(selected(again).imported.issues, []);
});

test('malformed extension entries stay retained read-only while valid lines import', () => {
  const resource = serializeDraft(withLines(add('bar')));
  const body = resource.definition.sheets[0].visuals[0].barChartVisual;
  body.opensightReferenceLines[1] = { value: 'high', label: 'Bad', color: 'red', extra: true };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const imported = importBundle(bundle);
  assert.deepEqual(selected(imported).referenceLines, [expectedLines[0]]);
  const issues = JSON.stringify(selected(imported).imported.issues);
  assert.match(issues, /opensightReferenceLines\[1\] \(retained, read-only\)|opensightReferenceLines\[1\]\.\w+ \(retained, read-only\)/);
  // The unmodified re-export keeps the malformed entry byte-for-byte.
  assert.deepEqual(exportBundle(imported), bundle);
});

test('reference lines on an unsupported kind stay retained read-only and are not restored', () => {
  const resource = serializeDraft(add('table'));
  const body = resource.definition.sheets[0].visuals[0].tableVisual;
  body.opensightReferenceLines = [{ value: 5, label: 'Goal', color: '#112233' }];
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const imported = importBundle(bundle);
  assert.equal(selected(imported).referenceLines, undefined);
  assert.match(JSON.stringify(selected(imported).imported.issues), /opensightReferenceLines/);
  assert.match(JSON.stringify(selected(imported).imported.issues), /retained, read-only/);
  assert.deepEqual(exportBundle(imported), bundle);
});

test('native tooltip visibility without the OpenSight extension imports and round-trips', () => {
  const resource = serializeDraft(authorReducer(add('bar'), { type: 'display', property: 'tooltipVisible', value: false }));
  const body = resource.definition.sheets[0].visuals[0].barChartVisual;
  assert.ok(!('opensightReferenceLines' in body));
  assert.deepEqual(body.chartConfiguration.tooltip, { tooltipVisibility: 'HIDDEN' });
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const imported = importBundle(bundle);
  assert.equal(selected(imported).tooltipVisible, false);
  assert.deepEqual(selected(imported).imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
});
