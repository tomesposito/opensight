import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { authorReducer, emptyDraft, activeSheet, serializeVisual, defaultMultiplesOptions, multiplesOptionsValid, parseDraft } from '../build/test/authoring.js';
import { MultiplesOptions } from '../build/test/PropertiesSections.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';

const fixtures = JSON.parse(await readFile(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const pieFixture = () => structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'PieChartVisual')));
const facetWell = (fieldId = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: fieldId } } });
const facetedInput = (rows) => {
  const input = pieFixture();
  input.definition.PieChartVisual.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.SmallMultiples = [facetWell()];
  input.rows = rows;
  return input;
};
const twoFacets = [
  { category: 'Hardware', region: 'East', revenue: 200 },
  { category: 'Software', region: 'East', revenue: 100 },
  { category: 'Hardware', region: 'West', revenue: 50 },
  { category: 'Software', region: 'West', revenue: 300 },
];
const nFacets = n => Array.from({ length: n }, (_, i) => ({ category: 'Hardware', region: `F${i}`, revenue: 1 }));
const fullOpts = (overrides = {}) => ({ ...defaultMultiplesOptions(), ...overrides });
const withOpts = (input, opts) => {
  input.definition.PieChartVisual.ChartConfiguration.OpenSightMultiplesOptions = opts;
  return input;
};
const pieDraft = (opts) => {
  const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
  let draft = authorReducer(add('pie'), { type: 'assign', well: 'smallMultiples', field: 'region' });
  if (opts) draft = authorReducer(draft, { type: 'multiples-options', options: opts });
  return draft;
};

test('absent options leave the model untouched', () => {
  assert.equal(normalizeVisual('api', facetedInput(twoFacets).definition).multiplesOptions, undefined);
});

test('partial options fill defaults', () => {
  const model = normalizeVisual('api', withOpts(facetedInput(twoFacets), { panelCount: 5 }).definition);
  assert.deepEqual(model.multiplesOptions, { ...defaultMultiplesOptions(), panelCount: 5 });
});

for (const [label, opts, pattern] of [
  ['panelCount zero', { panelCount: 0 }, /MULTIPLES_OPTIONS_INVALID/],
  ['panelCount above 20', { panelCount: 21 }, /MULTIPLES_OPTIONS_INVALID/],
  ['panelCount fractional', { panelCount: 2.5 }, /MULTIPLES_OPTIONS_INVALID/],
  ['negative visibleRows', { visibleRows: -1 }, /MULTIPLES_OPTIONS_INVALID/],
  ['zero visibleColumns', { visibleColumns: 0 }, /MULTIPLES_OPTIONS_INVALID/],
  ['non-numeric visibleRows', { visibleRows: 'many' }, /MULTIPLES_OPTIONS_INVALID/],
  ['unknown title size', { title: { size: 'huge' } }, /MULTIPLES_OPTIONS_INVALID/],
  ['unknown title align', { title: { align: 'justify' } }, /MULTIPLES_OPTIONS_INVALID/],
  ['non-boolean title flag', { title: { bold: 'yes' } }, /MULTIPLES_OPTIONS_INVALID/],
  ['named border color', { border: { color: 'red' } }, /MULTIPLES_OPTIONS_INVALID/],
  ['zero border width', { border: { widthPx: 0 } }, /MULTIPLES_OPTIONS_INVALID/],
  ['unknown border style', { border: { style: 'double' } }, /MULTIPLES_OPTIONS_INVALID/],
  ['non-boolean gutter', { gutter: 1 }, /MULTIPLES_OPTIONS_INVALID/],
  ['unknown top-level key', { bogus: true }, /unsupported property/],
  ['unknown nested key', { title: { bogus: 1 } }, /unsupported property/],
]) {
  test(`malformed options fail closed: ${label}`, () => {
    assert.throws(() => normalizeVisual('api', withOpts(facetedInput(twoFacets), opts).definition), pattern);
  });
}

test('non-faceted kinds reject the extension key', () => {
  const input = structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'TableVisual')));
  input.definition.TableVisual.ChartConfiguration.OpenSightMultiplesOptions = fullOpts();
  assert.throws(() => normalizeVisual('api', input.definition), /unsupported property/);
});

test('multiplesOptionsValid requires the complete shape', () => {
  assert.ok(multiplesOptionsValid(defaultMultiplesOptions()));
  assert.ok(!multiplesOptionsValid({}));
  assert.ok(!multiplesOptionsValid(null));
  assert.ok(!multiplesOptionsValid({ ...defaultMultiplesOptions(), panelCount: 99 }));
  assert.ok(!multiplesOptionsValid({ ...defaultMultiplesOptions(), extra: 1 }));
  assert.ok(!multiplesOptionsValid({ ...defaultMultiplesOptions(), title: { ...defaultMultiplesOptions().title, size: 'tiny' } }));
});

test('fixed rows and columns pin the grid and cut to the visible capacity', () => {
  const { model, option } = compileVisual(withOpts(facetedInput(nFacets(4)), fullOpts({ visibleRows: 1, visibleColumns: 2 })));
  assert.equal(option.series.length, 2);
  assert.match(model.warnings.join('\n'), /4 small-multiple panels exceed the 1x2 visible grid; showing the first 2/);
});

test('fixed rows alone derive the column count', () => {
  const { option } = compileVisual(withOpts(facetedInput(nFacets(5)), fullOpts({ visibleRows: 2 })));
  assert.equal(option.series.length, 5);
  assert.deepEqual([option.series[0].center[0], option.series[2].center[0]], ['16.67%', '83.33%']);
});

test('fixed columns alone derive the row count', () => {
  const { option } = compileVisual(withOpts(facetedInput(nFacets(5)), fullOpts({ visibleColumns: 2 })));
  assert.equal(option.series.length, 5);
  assert.deepEqual([option.series[0].center[1], option.series[4].center[1]], ['24.33%', '73.67%']);
});

test('panelCount caps the panels with a warning', () => {
  const { model, option } = compileVisual(withOpts(facetedInput(nFacets(21)), fullOpts({ panelCount: 10 })));
  assert.equal(option.series.length, 10);
  assert.match(model.warnings.join('\n'), /21 small-multiple panels exceed the 10-panel limit; showing the first 10/);
});

test('title options map to textStyle and per-panel alignment', () => {
  const title = { size: 'large', bold: true, italic: true, underline: true, align: 'right' };
  const { model, option } = compileVisual(withOpts(facetedInput(twoFacets), fullOpts({ title })));
  const first = option.title[0];
  assert.deepEqual(first.textStyle, { fontSize: 15, fontWeight: 700, fontStyle: 'italic', color: first.textStyle.color, fontFamily: first.textStyle.fontFamily });
  assert.equal(first.textAlign, 'right');
  assert.equal(first.left, '50.00%');
  // Underline is preserved in the model but never rendered.
  assert.equal(model.multiplesOptions.title.underline, true);
  assert.ok(!JSON.stringify(option.title).includes('underline'));
});

test('panel chrome renders one grid per panel', () => {
  const { option } = compileVisual(withOpts(facetedInput(twoFacets),
    fullOpts({ border: { enabled: true, widthPx: 2, style: 'solid', color: '#ff0000' }, background: true })));
  assert.equal(option.grid.length, 2);
  assert.deepEqual(option.grid[0], { show: true, left: '0.00%', top: '12.00%', width: '50.00%', height: '74.00%',
    backgroundColor: '#f4f6f8', borderWidth: 2, borderColor: '#ff0000' });
  assert.equal(option.grid[1].left, '50.00%');
});

test('dashed border style is preserved but renders solid', () => {
  const { model, option } = compileVisual(withOpts(facetedInput(twoFacets),
    fullOpts({ border: { enabled: true, widthPx: 1, style: 'dashed', color: '#9aa3b2' } })));
  assert.equal(model.multiplesOptions.border.style, 'dashed');
  assert.ok(!Object.hasOwn(option.grid[0], 'borderType'), 'ECharts grids cannot dash');
});

test('gutter shrinks the pie radii and insets the chrome', () => {
  const plain = compileVisual(facetedInput(twoFacets)).option;
  const guttered = compileVisual(withOpts(facetedInput(twoFacets),
    fullOpts({ gutter: true, border: { enabled: true, widthPx: 1, style: 'solid', color: '#9aa3b2' } }))).option;
  assert.equal(plain.series[0].radius[1], '17.0%');
  assert.equal(guttered.series[0].radius[1], '15.6%');
  assert.equal(guttered.grid[0].left, '1.50%');
  assert.equal(guttered.grid[0].width, '47.00%');
});

test('absent options keep the exact automatic rendering', () => {
  const { model, option } = compileVisual(facetedInput(twoFacets));
  assert.equal(option.grid, undefined);
  assert.deepEqual(option.title.map(t => [t.textStyle.fontSize, t.textStyle.fontWeight, t.textAlign]),
    [[12, 600, 'center'], [12, 600, 'center']]);
  assert.ok(model.warnings.every(w => !w.includes('small-multiple')));
});

test('panel renders the reference controls for a faceted pie', () => {
  const visual = activeSheet(pieDraft()).visuals[0];
  const html = renderToStaticMarkup(createElement(MultiplesOptions, { visual, dispatch() {} }));
  for (const label of ['Visible rows', 'Visible columns', 'Number of panels', 'Title options', 'Panel title size',
    'Panel title emphasis', 'Panel title alignment', 'Panel border', 'Panel gutter', 'Panel background']) {
    assert.ok(html.includes(label), `missing control: ${label}`);
  }
  assert.match(html, /aria-pressed="true"[^>]*>Center/);
  assert.ok(!html.includes('Border options'), 'border options hide until the border is enabled');
  const bordered = activeSheet(pieDraft(fullOpts({ border: { ...defaultMultiplesOptions().border, enabled: true } }))).visuals[0];
  const borderedHtml = renderToStaticMarkup(createElement(MultiplesOptions, { visual: bordered, dispatch() {} }));
  assert.ok(borderedHtml.includes('Border options'));
});

test('panel gate: well kinds show it, other kinds hide it', () => {
  const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
  const bar = activeSheet(add('bar')).visuals[0];
  assert.ok(renderToStaticMarkup(createElement(MultiplesOptions, { visual: bar, dispatch() {} })).includes('Visible rows'));
  const kpi = activeSheet(add('kpi')).visuals[0];
  assert.equal(renderToStaticMarkup(createElement(MultiplesOptions, { visual: kpi, dispatch() {} })), '');
});

test('panel edits reach the draft through the reducer', () => {
  let draft = pieDraft();
  const options = { ...defaultMultiplesOptions(), panelCount: 7 };
  draft = authorReducer(draft, { type: 'multiples-options', options });
  const visual = activeSheet(draft).visuals[0];
  assert.equal(visual.multiplesOptions.panelCount, 7);
  const html = renderToStaticMarkup(createElement(MultiplesOptions, { visual, dispatch() {} }));
  assert.match(html, /value="7"/);
});

test('invalid options are dropped by the reducer', () => {
  const draft = pieDraft();
  const next = authorReducer(draft, { type: 'multiples-options', options: { panelCount: 99 } });
  assert.equal(activeSheet(next).visuals[0].multiplesOptions, undefined);
});

test('draft round-trips through localStorage validation', () => {
  const draft = pieDraft({ ...defaultMultiplesOptions(), panelCount: 7 });
  assert.equal(parseDraft(JSON.stringify(draft)).sheets[0].visuals[0].multiplesOptions.panelCount, 7);
  const bad = structuredClone(draft);
  bad.sheets[0].visuals[0].multiplesOptions = { panelCount: 99 };
  assert.throws(() => parseDraft(JSON.stringify(bad)), /Invalid or unsupported author draft/);
});

test('multiplesOptions survive a serialize/normalize round trip', () => {
  const options = fullOpts({ panelCount: 8, title: { ...defaultMultiplesOptions().title, size: 'medium', align: 'left' } });
  const visual = activeSheet(pieDraft(options)).visuals[0];
  const definition = serializeVisual(visual, false);
  assert.deepEqual(definition.pieChartVisual.chartConfiguration.opensightMultiplesOptions, options);
  assert.deepEqual(normalizeVisual('bundle', definition).multiplesOptions, options);
});

test('exportBundle and importBundle carry the panel state', () => {
  const options = fullOpts({ border: { enabled: true, widthPx: 2, style: 'dotted', color: '#112233' }, background: true });
  const draft = pieDraft(options);
  const imported = importBundle(exportBundle(draft));
  assert.deepEqual(imported.sheets[0].visuals[0].multiplesOptions, options);
});

test('non-faceted visuals never export the options', () => {
  const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
  const visual = { ...activeSheet(add('table')).visuals[0], multiplesOptions: defaultMultiplesOptions() };
  const definition = serializeVisual(visual, false);
  assert.ok(!Object.hasOwn(definition.tableVisual.chartConfiguration, 'opensightMultiplesOptions'));
});
