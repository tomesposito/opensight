import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyViewActionFilters, hasViewActions, resolveViewNavigationAction, resolveViewUrlAction, viewMenuActions, viewOriginProblem, viewVisualId } from '../build/test/dashboard-interactions.js';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const generated = await json('../src/fixtures.generated.json');
const sales = generated.find(f => f.id === 'renderable-sales');
const byId = id => sales.sheets[0].visuals.find(v => {
  const body = Object.values(v.definition)[0];
  return (body.VisualId ?? body.visualId) === id;
});
const clone = (id, overrides = {}, visualId) => {
  const v = structuredClone(byId(id));
  if (visualId) { const key = Object.keys(v.definition)[0]; v.definition[key] = { ...v.definition[key], VisualId: visualId }; }
  return { ...v, ...overrides };
};

const regionBar = overrides => clone('revenue-by-region', { path: 'test/region', rows: [{ region: 'East', revenue: 500 }, { region: 'West', revenue: 300 }], ...overrides });
const regionTable = overrides => clone('sales-table', { path: 'test/table', rows: [{ region: 'East', revenue: 100 }, { region: 'West', revenue: 200 }], ...overrides }, 'sales-table-target');
const selectFilter = { id: 'f1', name: 'Filter region', sourceField: 'region', targets: 'all', mappings: {}, activation: 'select' };
const menuFilter = { id: 'f2', name: 'Menu filter', sourceField: 'region', targets: 'all', mappings: {}, activation: 'menu' };
const east = { values: { region: 'East' } };

test('viewVisualId reads bundle VisualId, authored visualId, then falls back to path', () => {
  assert.equal(viewVisualId(byId('revenue-by-region')), 'revenue-by-region');
  const authored = clone('revenue-by-region', {}, undefined);
  const key = Object.keys(authored.definition)[0];
  delete authored.definition[key].VisualId;
  authored.definition[key] = { ...authored.definition[key], visualId: 'authored-1' };
  assert.equal(viewVisualId(authored), 'authored-1');
  assert.equal(viewVisualId({ ...authored, definition: {} }), authored.path);
});

test('hasViewActions and viewMenuActions split by activation', () => {
  const visual = regionBar({ filterActions: [selectFilter, menuFilter], urlActions: [{ id: 'u1', name: 'Open', sourceField: 'region', urlTemplate: 'https://example.com/{region}', activation: 'menu' }] });
  assert.equal(hasViewActions(visual), true);
  assert.equal(hasViewActions(byId('revenue-by-region')), false);
  assert.deepEqual(viewMenuActions(visual).map(a => a.id), ['f2', 'u1']);
  assert.deepEqual(viewMenuActions(byId('revenue-by-region')), []);
});

test('viewOriginProblem mirrors the author origin gate on the fixture definition', () => {
  assert.equal(viewOriginProblem(byId('revenue-by-region')), undefined);
  assert.match(viewOriginProblem(byId('total-revenue')), /KPI has no selectable dimension/);
  const broken = clone('revenue-by-region', { definition: { UnknownVisual: {} } });
  assert.match(viewOriginProblem(broken), /ACTION_ORIGIN_INVALID/);
});

test('resolveViewUrlAction interpolates and validates like the author path', () => {
  const action = { id: 'u1', name: 'Open', sourceField: 'region', urlTemplate: 'https://example.com/{region}' };
  assert.equal(resolveViewUrlAction(action, east).value, 'https://example.com/East');
  assert.match(resolveViewUrlAction(action, { values: {} }).problem, /URL_SELECTION_MISSING/);
  assert.match(resolveViewUrlAction({ ...action, urlTemplate: 'notaurl' }, east).problem, /URL_INVALID/);
  assert.match(resolveViewUrlAction(action, { values: { region: 'East' }, range: ['a', 'b'] }).problem, /URL_SELECTION_RANGE/);
});

test('resolveViewNavigationAction switches sheets and fails closed on mappings or unknown sheets', () => {
  const sheets = [{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }];
  const action = { id: 'n1', name: 'Go', sourceField: 'region', targetSheetId: 's2', parameterMappings: {} };
  assert.deepEqual(resolveViewNavigationAction(sheets, action, east).value, { targetSheetId: 's2' });
  assert.match(resolveViewNavigationAction(sheets, { ...action, targetSheetId: 'nope' }, east).problem, /NAVIGATION_TARGET_UNKNOWN/);
  assert.match(resolveViewNavigationAction(sheets, { ...action, parameterMappings: { region: 'p' } }, east).problem, /NAVIGATION_PARAMETERS_UNSUPPORTED/);
  assert.match(resolveViewNavigationAction(sheets, action, { values: {} }).problem, /NAVIGATION_SELECTION_MISSING/);
});

test('applyViewActionFilters filters target rows on select-activated actions', () => {
  const source = regionBar({ filterActions: [selectFilter] });
  const target = regionTable();
  const { visual, problems } = applyViewActionFilters(target, [source, target], { 'revenue-by-region': east }, {});
  assert.deepEqual(visual.rows, [{ region: 'East', revenue: 100 }]);
  assert.deepEqual(problems, {});
  // The source visual is never its own target.
  const self = applyViewActionFilters(source, [source, target], { 'revenue-by-region': east }, {});
  assert.equal(self.visual.rows.length, 2);
});

test('applyViewActionFilters honors targets lists and menu selections', () => {
  const source = regionBar({ filterActions: [selectFilter, menuFilter] });
  const target = regionTable();
  const other = clone('revenue-by-region', { path: 'test/other', rows: [{ region: 'East', revenue: 9 }] }, 'other-id');
  const scoped = { ...selectFilter, id: 'f3', targets: ['other-id'] };
  const scopedSource = regionBar({ path: 'test/scoped', filterActions: [scoped] });
  let result = applyViewActionFilters(target, [scopedSource, target, other], { 'revenue-by-region': east }, {});
  assert.equal(result.visual.rows.length, 2); // scoped to other-id: this target untouched
  result = applyViewActionFilters(other, [scopedSource, target, other], { 'revenue-by-region': east }, {});
  assert.deepEqual(result.visual.rows, [{ region: 'East', revenue: 9 }]);
  // Menu-activated filters apply from menuSelections only.
  result = applyViewActionFilters(target, [source, target], {}, { 'revenue-by-region': east });
  assert.deepEqual(result.visual.rows, [{ region: 'East', revenue: 100 }]);
  const menuOnly = regionBar({ path: 'test/menuonly', filterActions: [menuFilter] });
  result = applyViewActionFilters(target, [menuOnly, target], { 'revenue-by-region': east }, {});
  assert.equal(result.visual.rows.length, 2); // menu filter ignores plain selections
});

test('applyViewActionFilters maps columnName through bindings and fails closed when unmappable', () => {
  const trend = clone('revenue-trend', { path: 'test/trend', rows: [{ month: '2025-01', revenue: 400 }, { month: '2025-03', revenue: 0 }] });
  const monthFilter = { id: 'f4', name: 'Filter month', sourceField: 'order_date', targets: 'all', mappings: {}, activation: 'select' };
  const monthSource = clone('revenue-trend', { path: 'test/month-src', rows: [{ month: '2025-01', revenue: 1 }] }, 'month-src');
  monthSource.filterActions = [monthFilter];
  const { visual, problems } = applyViewActionFilters(trend, [monthSource, trend], { 'month-src': { values: { order_date: '2025-01' } } }, {});
  assert.deepEqual(visual.rows, [{ month: '2025-01', revenue: 400 }]); // bindings order_date -> month
  assert.deepEqual(problems, {});
  // The category pie has no region column: fail closed with a note, rows untouched.
  const pie = clone('share-by-category', { path: 'test/pie' });
  const source = regionBar({ filterActions: [selectFilter] });
  const failed = applyViewActionFilters(pie, [source, pie], { 'revenue-by-region': east }, {});
  assert.match(failed.problems.f1, /FILTER_COLUMN_UNMAPPED: region is not a pinned result column/);
  assert.equal(failed.visual.rows.length, 2);
  // No pinned rows at all: fail closed, never silently ignore.
  const rowless = clone('share-by-category', { path: 'test/rowless', rows: null });
  const failedRows = applyViewActionFilters(rowless, [source, rowless], { 'revenue-by-region': east }, {});
  assert.match(failedRows.problems.f1, /FILTER_ROWS_UNAVAILABLE/);
  assert.equal(failedRows.visual.rows, null);
});

test('applyViewActionFilters respects filter scope fields', () => {
  const scoped = { ...selectFilter, id: 'f5', scopeFields: ['category'] };
  const source = regionBar({ filterActions: [scoped] });
  const target = regionTable();
  const { visual } = applyViewActionFilters(target, [source, target], { 'revenue-by-region': east }, {});
  assert.equal(visual.rows.length, 2); // selection holds no category value: no-op, like author mode
});
