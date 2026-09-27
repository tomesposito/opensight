import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, validateDraft, loadDraft, saveDraft, calculationError, dataFields } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
const edit = (d, ...actions) => actions.reduce(authorReducer, d);
const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const visual = d => activeSheet(d).visuals.find(v => v.id === activeSheet(d).selectedId);
const storage = () => { let value = null; return { getItem: () => value, setItem: (_, next) => { value = next; } }; };

test('sheets add, rename, select and delete independently with globally unique visuals', () => {
  const first = add('bar');
  let d = edit(first, { type: 'sheet-add' }, { type: 'add', kind: 'pivot' }, { type: 'sheet-rename', id: 'sheet-2', name: '  Detail  ' });
  assert.equal(d.sheets[1].name, 'Detail');
  assert.equal(d.activeSheetId, 'sheet-2');
  assert.equal(visual(d).id, 'visual-2');
  assert.deepEqual(d.sheets[0], first.sheets[0]);
  d = edit(d, { type: 'sheet-select', id: 'sheet-1' }, { type: 'title', title: 'Summary' });
  assert.equal(d.sheets[1].visuals[0].title, '');
  d = edit(d, { type: 'sheet-delete', id: 'sheet-1' });
  assert.equal(d.activeSheetId, 'sheet-2');
  assert.equal(d.sheets.length, 1);
  assert.equal(authorReducer(d, { type: 'sheet-delete', id: 'sheet-2' }), d);
  assert.equal(authorReducer(d, { type: 'sheet-rename', id: 'sheet-2', name: '  ' }), d);
  validateDraft(d);
});

test('drag and resize positions persist per sheet through storage and camelCase analysis export', () => {
  let d = edit(add('bar'), { type: 'sheet-add' }, { type: 'add', kind: 'table' });
  const placement = { i: 'visual-1', x: 4, y: 3, w: 8, h: 10 };
  d = edit(d, { type: 'layout', sheetId: 'sheet-1', layout: [placement] }, { type: 'analysis-title', title: 'Revenue analysis' });
  assert.deepEqual(d.sheets[0].layout, [placement]);
  assert.deepEqual(d.sheets[1].layout, [{ i: 'visual-2', x: 0, y: 0, w: 6, h: 8 }]);
  const store = storage();
  assert.match(saveDraft(d, () => store), /Draft saved/);
  assert.deepEqual(loadDraft(() => store).draft, d);
  const resource = parseBundleResource(JSON.parse(JSON.stringify(serializeDraft(d))));
  assert.equal(resource.name, 'Revenue analysis');
  assert.equal(resource.definition.sheets.length, 2);
  assert.deepEqual(resource.definition.sheets[0].layouts[0].configuration.gridLayout.elements[0], {
    elementId: 'visual-1', elementType: 'VISUAL', columnIndex: 12, columnSpan: 24, rowIndex: 3, rowSpan: 10,
  });
  assert.doesNotMatch(JSON.stringify(resource), /selectedId|activeSheetId|"version"/);
});

test('layout guards reject missing IDs, nonfinite/fractional positions and off-grid widths', () => {
  const d = add('bar'), p = activeSheet(d).layout[0];
  for (const bad of [{ ...p, i: 'other' }, { ...p, x: -1 }, { ...p, x: NaN }, { ...p, y: Infinity }, { ...p, w: 13 }, { ...p, h: 0 }, { ...p, y: 0.5 }]) {
    assert.equal(authorReducer(d, { type: 'layout', sheetId: d.activeSheetId, layout: [bad] }), d);
    const corrupt = structuredClone(d); corrupt.sheets[0].layout = [bad];
    assert.throws(() => validateDraft(corrupt));
  }
  assert.equal(authorReducer(d, { type: 'layout', sheetId: d.activeSheetId, layout: [] }), d);
});

test('legacy drafts migrate wells, selection and order to a full-width first sheet', () => {
  const legacy = { version: 1, visuals: [
    { id: 'visual-2', kind: 'table', title: 'Old table', dimension: 'region', measures: ['revenue'], donut: false },
    { id: 'visual-1', kind: 'pie', title: '', dimension: null, measures: [], donut: true },
  ], selectedId: 'visual-1' };
  const restored = loadDraft(() => ({ getItem: () => JSON.stringify(legacy) }));
  assert.equal(restored.warning, undefined);
  assert.equal(restored.draft.version, 2);
  assert.equal(activeSheet(restored.draft).selectedId, 'visual-1');
  assert.deepEqual(activeSheet(restored.draft).visuals[0].rows, ['region']);
  assert.deepEqual(activeSheet(restored.draft).layout.map(p => [p.i, p.y, p.w]), [['visual-2', 0, 12], ['visual-1', 8, 12]]);
  legacy.visuals[0].rows = [];
  assert.match(loadDraft(() => ({ getItem: () => JSON.stringify(legacy) })).warning, /could not be restored/);
});

test('pivot pills append once, move a dimension between axes and remove only the targeted well', () => {
  let d = edit(add('pivot'), { type: 'assign', field: 'category', well: 'rows' }, { type: 'assign', field: 'category', well: 'rows' });
  assert.deepEqual(visual(d).rows, ['region', 'category']);
  d = edit(d, { type: 'assign', field: 'category', well: 'columns' }, { type: 'assign', field: 'profit', well: 'values' });
  assert.deepEqual(visual(d).rows, ['region']);
  assert.deepEqual(visual(d).columns, ['category']);
  assert.deepEqual(buildAuthorQuery(visual(d)).dimensions.map(f => f.columnName), ['region', 'category']);
  d = edit(d, { type: 'unassign', field: 'category', well: 'columns' }, { type: 'unassign', field: 'revenue', well: 'values' });
  assert.deepEqual(visual(d).columns, []);
  assert.deepEqual(visual(d).measures, ['profit']);
  validateDraft(d);
});

test('calculated field create → assign → storage → export → query preserves exact expressions and dependencies', () => {
  const expression = '({revenue} - {profit}) * 0.9';
  let d = edit(add('table'), { type: 'calculation-add', field: { name: 'Net revenue', expression, role: 'measure' } },
    { type: 'calculation-add', field: { name: 'Area', expression: '{region}', role: 'dimension' } },
    { type: 'assign', field: 'Net revenue', well: 'values' }, { type: 'assign', field: 'Area', well: 'rows' });
  assert.equal(dataFields(d.calculatedFields).find(f => f.name === 'Net revenue').type, 'DECIMAL');
  const store = storage(); saveDraft(d, () => store); d = loadDraft(() => store).draft;
  const exported = parseBundleResource(serializeDraft(d));
  assert.equal(exported.definition.calculatedFields[0].expression, expression);
  const query = buildAuthorQuery(visual(d), d.calculatedFields);
  assert.deepEqual(query.calculatedFields, [{ name: 'Net revenue', expression }, { name: 'Area', expression: '{region}' }]);
  assert.deepEqual(query.measures.map(m => m.columnName), ['revenue', 'Net revenue']);
  assert.deepEqual(query.dimensions.map(m => m.columnName), ['region', 'Area']);
  assert.equal(buildAuthorPreview(visual(d)).rows, null);
});

test('calculation validation blocks blank, duplicate and dangerous inputs while preserving unsupported formulas', () => {
  const base = { name: 'Net', expression: '{revenue} * 0.9', role: 'measure' };
  for (const field of [{ ...base, name: '' }, { ...base, name: ' Revenue ' }, ...['', '   ', 'eval(1)', 'fetch("x")', '1; DROP TABLE sales', '<script>x</script>', '1 -- comment', '/*x*/ 1', 'window.location', 'x => x'].map(expression => ({ ...base, expression }))]) {
    assert.ok(calculationError(field, dataFields()));
    assert.equal(authorReducer(emptyDraft(), { type: 'calculation-add', field }).calculatedFields.length, 0);
  }
  assert.equal(calculationError({ ...base, expression: 'ifelse({revenue} > 0, {revenue}, 0)' }, dataFields()), undefined);
});

test('category filters stay scoped to one visual; multi-select and select-none are explicit query predicates', () => {
  let d = edit(add('bar'), { type: 'filter', columnName: 'region', values: ['West', 'East', 'West'] }, { type: 'add', kind: 'kpi' });
  assert.deepEqual(buildAuthorQuery(visual(d)).filters, []);
  const filtered = d.sheets[0].visuals[0];
  assert.deepEqual(buildAuthorQuery(filtered).filters, [{ columnName: 'region', values: ['West', 'East'] }]);
  assert.equal(buildAuthorPreview(filtered).rows, null);
  const exported = parseBundleResource(serializeDraft(d));
  assert.deepEqual(exported.definition.filterGroups[0].scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations[0], { sheetId: 'sheet-1', scope: 'SELECTED_VISUALS', visualIds: ['visual-1'] });
  d = edit(d, { type: 'select', id: 'visual-1' }, { type: 'filter', columnName: 'region', values: [] });
  assert.deepEqual(buildAuthorQuery(visual(d)).filters, [{ columnName: 'region', values: [] }]);
  d = edit(d, { type: 'filter', columnName: 'region', values: null });
  assert.deepEqual(buildAuthorQuery(visual(d)).filters, []);
  assert.notEqual(buildAuthorPreview(visual(d)).rows, null);
});
