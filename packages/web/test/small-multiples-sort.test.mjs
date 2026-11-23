import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withoutBindingAggregation } from './fixtures/compiler-baseline.mjs';
import { readFileSync } from 'node:fs';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, facetSortValid, parseDraft, serializeDraft, serializeVisual, defaultMultiplesOptions } from '../build/test/authoring.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
import { convertDefinition, projectDefinition } from '../build/test/definition-converter.js';
import { MultiplesOptions } from '../build/test/PropertiesSections.js';
import { FACETED_KINDS, groupRowsByFacet } from '../build/test/facet-layout.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const rows = [
  { category: 'A', region: 'West', revenue: 10, profit: 1 },
  { category: 'A', region: 'East', revenue: 20, profit: 2 },
  { category: 'B', region: 'West', revenue: 30, profit: 3 },
  { category: 'B', region: 'East', revenue: 40, profit: 4 },
  { category: 'A', region: 'North', revenue: 50, profit: 5 },
  { category: 'C', region: 'South', revenue: 60, profit: 6 },
];
const input = (kind = 'pie', limit, data = rows) => {
  const spec = EXTRA_VISUALS[kind] ?? { variant: `${kind === 'pie' ? 'pie' : kind === 'line' ? 'line' : 'bar'}ChartVisual`, wells: `${kind === 'pie' ? 'pie' : kind === 'line' ? 'line' : 'bar'}ChartAggregatedFieldWells`, dimensions: ['category'], measures: ['values'] };
  const wells = { [spec.dimensions[0]]: [dim('category')], smallMultiples: [dim('region')] };
  spec.measures.forEach(key => { wells[key] = [measure('revenue')]; });
  if (kind === 'combo') wells.lineValues = [measure('profit')];
  return { source: 'bundle', path: '$.test', bindings: {}, rows: structuredClone(data), definition: {
    [spec.variant]: { visualId: kind, chartConfiguration: {
      fieldWells: { [spec.wells]: wells },
      ...(kind === 'area' ? { type: 'AREA' } : {}),
      ...(kind === 'bar100' ? { barsArrangement: 'STACKED_PERCENT' } : {}),
      ...(limit === undefined ? {} : { sortConfiguration: { smallMultiplesLimitConfiguration: limit } }),
    } },
  } };
};
const config = value => Object.values(value.definition)[0].chartConfiguration;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const draftWithFacet = (kind = 'pie') => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind }), { type: 'assign', field: kind === 'pie' ? 'region' : 'category', well: 'smallMultiples' });
const sortBy = (fieldId = 'region', direction = 'ASC') => [{ fieldSort: { fieldId, direction } }];
const sorted = (value, direction = 'ASC') => {
  config(value).sortConfiguration = { ...config(value).sortConfiguration, smallMultiplesSort: sortBy('region', direction) };
  return value;
};
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const titles = compiled => compiled.option.title.map(t => t.text);
const malformed = [null, {}, 'sort', [null], [{}], [{ fieldSort: null }], [{ fieldSort: {} }],
  [{ fieldSort: { fieldId: 'region', direction: 'DOWN' } }], [{ fieldSort: { fieldId: 'region', direction: null } }],
  [{ fieldSort: { fieldId: 'region', direction: 'asc' } }], [{ fieldSort: { fieldId: 'region', extra: true } }],
  [{ fieldSort: { fieldId: 'region' }, extra: true }], sortBy('category'), sortBy('revenue'), sortBy('missing'),
  [...sortBy(), ...sortBy()], [{ fieldSort: { fieldId: '' } }]];

for (const source of ['bundle', 'api']) {
  for (const kind of FACETED_KINDS) test(`${source} ${kind}: parses one facet sort, default ASC and empty list`, () => {
    for (const direction of ['ASC', 'DESC']) assert.deepEqual(normalize(dialect(sorted(input(kind), direction), source)).facetSort, { fieldId: 'region', direction });
    const value = sorted(input(kind));
    delete config(value).sortConfiguration.smallMultiplesSort[0].fieldSort.direction;
    assert.deepEqual(normalize(dialect(value, source)).facetSort, { fieldId: 'region', direction: 'ASC' });
    config(value).sortConfiguration.smallMultiplesSort = [];
    assert.equal(normalize(dialect(value, source)).facetSort, undefined);
  });
  test(`${source}: malformed sorts fail with a named error at the facet-sort path`, () => {
    for (const sort of malformed) {
      const value = input();
      config(value).sortConfiguration = { smallMultiplesSort: sort };
      assert.throws(() => normalize(dialect(value, source)), error => error instanceof CompileError && /[sS]mallMultiplesSort/.test(error.message), JSON.stringify(sort));
    }
    const value = sorted(input());
    config(value).sortConfiguration.smallMultiplesSort.push(...sortBy());
    assert.throws(() => normalize(dialect(value, source)), /only one field sort is supported/);
    config(value).sortConfiguration.smallMultiplesSort = sortBy('category');
    assert.throws(() => normalize(dialect(value, source)), /must reference the SmallMultiples field/);
    config(value).sortConfiguration.smallMultiplesSort = sortBy();
    delete config(value).fieldWells.pieChartAggregatedFieldWells.smallMultiples;
    assert.throws(() => normalize(dialect(value, source)), /requires a SmallMultiples field/);
  });
  test(`${source}: non-faceted kinds reject even an empty facet-sort key`, () => {
    for (const kind of ['funnel', 'waterfall', 'radar', 'sankey', 'kpi', 'table', 'pivot']) {
      const draft = authorReducer(emptyDraft(), { type: 'add', kind });
      const value = { ...input(), definition: serializeVisual(selected(draft)) };
      config(value).sortConfiguration = { smallMultiplesSort: [] };
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
  });
}

for (const kind of FACETED_KINDS) {
  for (const [label, cells, ascending, descending] of [
    ['strings', ['West', null, 'East', 'North'], ['East', 'North', 'West', null], ['West', 'North', 'East', null]],
    ['numbers', [10, null, 2, -1], [-1, 2, 10, null], [10, 2, -1, null]],
  ]) test(`${kind}: ${label} ASC/DESC match category comparison, including nulls last`, () => {
    for (const [direction, expected] of [['ASC', ascending], ['DESC', descending]]) {
      const value = sorted(input(kind, undefined, cells.map((region, i) => ({ category: 'A', region, revenue: i + 1, profit: i + 2 }))), direction);
      const before = structuredClone(value);
      const c = compileVisual(value);
      assert.deepEqual(titles(c), expected.map(v => v === null ? '(null)' : String(v)));
      assert.deepEqual(c.table.rows.map(r => r[1]), expected);
      const category = input('bar', undefined, cells.map((category, i) => ({ category, region: 'One', revenue: i + 1 })));
      config(category).sortConfiguration = { categorySort: sortBy('category', direction) };
      assert.deepEqual(c.table.rows.map(r => r[1]), compileVisual(category).table.rows.map(r => r[0]));
      assert.deepEqual(value, before);
    }
  });
  test(`${kind}: sort selects retained panels; merged Other stays last; tooltips and data follow`, () => {
    for (const direction of ['ASC', 'DESC']) for (const otherCategories of ['INCLUDE', 'EXCLUDE']) {
      const value = sorted(input(kind, { itemsLimit: 1, otherCategories }), direction);
      config(value).tooltip = { selectedTooltipType: 'DETAILED' };
      const c = compileVisual(value), first = direction === 'ASC' ? 'East' : 'West';
      assert.deepEqual(titles(c), [first, ...(otherCategories === 'INCLUDE' ? ['Other'] : [])]);
      assert.deepEqual([...new Set(c.table.rows.map(r => r[1]))], titles(c));
      assert.match(c.option.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }), new RegExp(`region: ${first}`));
      if (otherCategories === 'INCLUDE') {
        const stride = kind === 'combo' ? 2 : 1;
        assert.match(c.option.tooltip.formatter({ seriesIndex: stride, dataIndex: 0 }), /region: Other/);
        assert.equal(c.table.rows.filter(r => r[1] === 'Other').reduce((sum, r) => sum + r[2], 0), direction === 'ASC' ? 150 : 170);
      }
    }
  });
}

test('sort honors result bindings, typed mixed values and stable ties', () => {
  const value = sorted(input('bar', undefined, [{ c: 'A', f: 'West', m: 1 }, { c: 'A', f: 'East', m: 2 }]));
  value.bindings = { category: 'c', region: 'f', revenue: 'm' };
  assert.deepEqual(titles(compileVisual(value)), ['East', 'West']);
  const cells = [2, '2', null, true, false, '10'];
  const groups = direction => groupRowsByFacet(cells.map(value => ({ value })), { id: 'facet' }, row => row.value, { fieldId: 'facet', direction }).map(g => g.value);
  assert.deepEqual(groups('ASC'), ['10', 2, '2', false, true, null]);
  assert.deepEqual(groups('DESC'), [true, false, 2, '2', '10', null]);
  assert.deepEqual(groupRowsByFacet(cells.map(value => ({ value })), { id: 'facet' }, row => row.value).map(g => g.value), cells);
});

test('category sorting stays within sorted panels; limits and layout caps follow facet sorting', () => {
  const value = sorted(input('pie', { itemsLimit: 1 }));
  config(value).sortConfiguration.categorySort = sortBy('revenue', 'DESC');
  config(value).sortConfiguration.categoryItemsLimit = { itemsLimit: 1, otherCategories: 'INCLUDE' };
  const c = compileVisual(value);
  assert.deepEqual(titles(c), ['East', 'Other']);
  assert.deepEqual(c.option.series[0].data, [{ name: 'B', value: 40 }, { name: 'Other', value: 20 }]);
  const many = sorted(input('bar', undefined, Array.from({ length: 30 }, (_, i) => ({ category: 'A', region: 30 - i, revenue: 1 }))));
  assert.deepEqual(titles(compileVisual(many)), Array.from({ length: 20 }, (_, i) => String(i + 1)));
  config(many).opensightMultiplesOptions = { ...defaultMultiplesOptions(), panelCount: 1 };
  assert.deepEqual(titles(compileVisual(many)), ['1']);
  assert.match(compileVisual(many).model.warnings[0], /30 small-multiple panels exceed/);
});

test('a retained literal Other stays distinct from the final merged Other panel', () => {
  const value = sorted(input('pie', { itemsLimit: 1 }, rows.map(row => ({ ...row, region: row.region === 'East' ? 'Other' : `Z${row.region}` }))));
  const c = compileVisual(value);
  assert.deepEqual(titles(c), ['Other', 'Other']);
  assert.deepEqual(c.option.series[0].data, [{ name: 'A', value: 20 }, { name: 'B', value: 40 }]);
  assert.equal(c.option.series[1].data.reduce((sum, item) => sum + item.value, 0), 150);
});

// Captured before implementation from 203d0faa: full compiled output, including
// function source. This proves the unset path is byte-identical to the prior slice.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/small-multiples-sort-baseline.json', import.meta.url), 'utf8'));
for (const kind of FACETED_KINDS) test(`${kind}: unset facetSort preserves pre-slice output bytes apart from binding metadata`, () => {
  for (const [label, limit] of [['unset', undefined], ['include', { itemsLimit: 2 }], ['exclude', { itemsLimit: 2, otherCategories: 'EXCLUDE' }]]) {
    for (const categorySorted of [false, true]) {
      const value = input(kind, limit);
      if (categorySorted) config(value).sortConfiguration = { ...config(value).sortConfiguration, categorySort: sortBy('revenue', 'DESC') };
      const compiled = compileVisual(value);
      const bytes = JSON.stringify(withoutBindingAggregation(compiled), (_, v) => typeof v === 'function' ? v.toString() : v);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), baseline[`${kind}/${label}/${categorySorted ? 'category-sort' : 'source-order'}`]);
      config(value).sortConfiguration = { ...config(value).sortConfiguration, smallMultiplesSort: [] };
      assert.deepEqual(compileVisual(value), compiled);
    }
  }
});

const invalidDraftSorts = [null, [], 'sort', {}, { fieldId: 'region' }, { direction: 'ASC' }, { fieldId: '', direction: 'ASC' },
  { fieldId: 'region\0', direction: 'ASC' }, { fieldId: 'region', direction: 'asc' }, { fieldId: 'region', direction: 'ASC', extra: 1 }];
test('reducer and storage validate sort structure and facet membership, with cloned state', () => {
  const sort = { fieldId: 'region', direction: 'DESC' };
  assert.equal(facetSortValid(sort), true);
  const draft = authorReducer(draftWithFacet(), { type: 'facet-sort', sort });
  sort.direction = 'ASC';
  assert.deepEqual(selected(draft).facetSort, { fieldId: 'region', direction: 'DESC' });
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  for (const bad of invalidDraftSorts) assert.equal(facetSortValid(bad), false);
  for (const bad of [...invalidDraftSorts, { fieldId: 'category', direction: 'ASC' }, { fieldId: 'revenue', direction: 'ASC' }]) {
    assert.deepEqual(selected(authorReducer(draft, { type: 'facet-sort', sort: bad })), selected(draft));
    const tampered = structuredClone(draft);
    selected(tampered).facetSort = bad;
    assert.throws(() => parseDraft(JSON.stringify(tampered)));
  }
  assert.equal(selected(authorReducer(draft, { type: 'facet-sort', sort: undefined })).facetSort, undefined);
  const bare = authorReducer(emptyDraft(), { type: 'add', kind: 'pie' });
  assert.equal(selected(authorReducer(bare, { type: 'facet-sort', sort })).facetSort, undefined);
  const tampered = structuredClone(draft);
  delete selected(tampered).smallMultiples;
  assert.throws(() => parseDraft(JSON.stringify(tampered)));
});

test('facet removal and replacement clear the sort; unrelated or identical field edits preserve it', () => {
  const draft = authorReducer(draftWithFacet(), { type: 'facet-sort', sort: { fieldId: 'region', direction: 'DESC' } });
  for (const well of ['smallMultiples', undefined]) assert.equal(selected(authorReducer(draft, { type: 'unassign', field: 'region', well })).facetSort, undefined);
  assert.equal(selected(authorReducer(draft, { type: 'assign', field: 'category', well: 'smallMultiples' })).facetSort, undefined);
  for (const action of [{ type: 'unassign', field: 'revenue', well: 'values' }, { type: 'assign', field: 'region', well: 'smallMultiples' }, { type: 'unassign', field: 'category', well: 'smallMultiples' }, { type: 'kind', kind: 'bar' }]) {
    assert.deepEqual(selected(authorReducer(draft, action)).facetSort, selected(draft).facetSort);
  }
});

for (const kind of FACETED_KINDS) test(`${kind}: authored sorts merge with limits and survive bundle/storage/native round-trips`, () => {
  let draft = draftWithFacet(kind);
  const fieldId = selected(draft).smallMultiples[0];
  draft = authorReducer(draft, { type: 'facet-sort', sort: { fieldId, direction: 'DESC' } });
  draft = authorReducer(draft, { type: 'facet-limit', limit: { count: 2, includeOther: true } });
  draft = authorReducer(draft, { type: 'slice-limit', limit: { count: 3, includeOther: false } });
  if (['bar', 'bar100', 'pie'].includes(kind)) draft = authorReducer(draft, { type: 'group-sort', sort: { fieldId: 'revenue', direction: 'DESC' } });
  const resource = serializeDraft(draft), visual = resource.definition.sheets[0].visuals[0];
  const config = Object.values(visual)[0].chartConfiguration;
  assert.deepEqual(config.sortConfiguration.smallMultiplesSort, sortBy(fieldId, 'DESC'));
  assert.deepEqual(config.sortConfiguration.smallMultiplesLimitConfiguration, { itemsLimit: 2, otherCategories: 'INCLUDE' });
  assert.deepEqual(config.sortConfiguration.categoryItemsLimit, { itemsLimit: 3, otherCategories: 'EXCLUDE' });
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  const bundle = exportBundle(draft), imported = importBundle(bundle);
  assert.deepEqual(activeSheet(imported).visuals[0].facetSort, selected(draft).facetSort);
  assert.deepEqual(activeSheet(imported).visuals[0].imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
  const native = projectDefinition(resource.definition);
  assert.deepEqual(convertDefinition(native), resource.definition);
  const nativeModel = normalizeVisual('api', native.Sheets[0].Visuals[0]);
  nativeModel.warnings = nativeModel.warnings.map(w => w.replace(Object.keys(native.Sheets[0].Visuals[0])[0], Object.keys(visual)[0]));
  assert.deepEqual(nativeModel, normalizeVisual('bundle', visual));
});

test('sort serialization is limited to faceted kinds with a facet assigned', () => {
  const visual = selected(draftWithFacet());
  const sort = { fieldId: 'region', direction: 'ASC' };
  for (const kind of ['pie', 'kpi']) {
    const config = Object.values(serializeVisual({ ...visual, kind, dimension: null, smallMultiples: [], facetSort: sort }))[0].chartConfiguration;
    assert.equal(config.sortConfiguration?.smallMultiplesSort, undefined);
  }
});

test('malformed imported sorts are reported and retained read-only, never silently removed', () => {
  for (const sort of malformed) {
    const bundle = exportBundle(draftWithFacet());
    const visual = bundle.members[0].resource.definition.sheets[0].visuals[0];
    visual.pieChartVisual.chartConfiguration.sortConfiguration = { smallMultiplesSort: sort };
    const imported = importBundle(bundle), first = activeSheet(imported).visuals[0];
    assert.equal(first.facetSort, undefined, JSON.stringify(sort));
    assert.ok(first.imported.issues.length, JSON.stringify(sort));
    assert.deepEqual(exportBundle(imported), bundle);
  }
});

test('native facet IDs differing from columns remain bound when adding, editing and clearing imported sorts', () => {
  for (const initial of [undefined, [{ fieldSort: { fieldId: 'facet-id' } }], sortBy('facet-id', 'DESC')]) {
    const bundle = exportBundle(draftWithFacet());
    const body = bundle.members[0].resource.definition.sheets[0].visuals[0].pieChartVisual;
    body.chartConfiguration.fieldWells.pieChartAggregatedFieldWells.smallMultiples[0].categoricalDimensionField.fieldId = 'facet-id';
    if (initial) body.chartConfiguration.sortConfiguration = { smallMultiplesSort: initial };
    let draft = importBundle(bundle);
    assert.deepEqual(activeSheet(draft).visuals[0].facetSort, initial ? { fieldId: 'region', direction: initial[0].fieldSort.direction ?? 'ASC' } : undefined);
    assert.deepEqual(activeSheet(draft).visuals[0].imported.issues, []);
    assert.deepEqual(exportBundle(draft), bundle);
    for (const direction of ['ASC', 'DESC', undefined]) {
      draft = authorReducer(draft, { type: 'facet-sort', sort: direction ? { fieldId: 'region', direction } : undefined });
      const exported = exportBundle(draft), raw = exported.members[0].resource.definition.sheets[0].visuals[0];
      assert.deepEqual(normalizeVisual('bundle', raw).facetSort, direction ? { fieldId: 'facet-id', direction } : undefined);
      assert.deepEqual(activeSheet(importBundle(exported)).visuals[0].facetSort, direction ? { fieldId: 'region', direction } : undefined);
    }
  }
});

test('Multiples Options renders and updates None/Ascending/Descending only for supported assigned facets', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, current, dispatch;
  function Harness() {
    [current, dispatch] = useReducer(authorReducer, draftWithFacet());
    return createElement(MultiplesOptions, { visual: selected(current), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const control = () => renderer.root.findByProps({ 'aria-label': 'Sort panels' });
  assert.deepEqual(control().findAllByType('option').map(o => o.children[0]), ['None', 'Ascending', 'Descending']);
  assert.equal(control().props.value, '');
  for (const direction of ['ASC', 'DESC']) {
    await act(() => control().props.onChange({ target: { value: direction } }));
    assert.deepEqual(selected(current).facetSort, { fieldId: 'region', direction });
  }
  await act(() => control().props.onChange({ target: { value: 'INVALID' } }));
  assert.equal(control().props.value, 'DESC');
  await act(() => control().props.onChange({ target: { value: '' } }));
  assert.equal(selected(current).facetSort, undefined);
  for (const kind of FACETED_KINDS) {
    await act(() => dispatch({ type: 'kind', kind }));
    assert.equal(control().props.value, '');
  }
  await act(() => dispatch({ type: 'kind', kind: 'kpi' }));
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Sort panels' }).length, 0);
  await act(() => dispatch({ type: 'kind', kind: 'pie' }));
  await act(() => dispatch({ type: 'unassign', well: 'smallMultiples', field: 'region' }));
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Sort panels' }).length, 0);
});
