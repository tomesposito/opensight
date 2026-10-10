import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorReducer, emptyDraft, activeSheet, validateDraft,
  layoutSettingsValid, DEFAULT_LAYOUT_SETTINGS,
  serializeDraft as serializeAnalysis,
} from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { withActionFilters, toggleSelection } from '../build/test/interactions.js';
import { buildControlQuery } from '../build/test/author-query.js';

const edit = (draft, ...actions) => actions.reduce(authorReducer, draft);
const withVisual = () => edit(emptyDraft(), { type: 'assign-with-no-selection', field: 'region', well: 'rows' });
const withObject = () => edit(emptyDraft(), { type: 'object-add', kind: 'text' });

test('sheet-duplicate creates an independent copy with fresh ids and selects it', () => {
  const before = withVisual();
  const source = activeSheet(before);
  const draft = authorReducer(before, { type: 'sheet-duplicate', id: source.id });
  assert.equal(draft.sheets.length, 2);
  const copy = draft.sheets[1];
  assert.equal(copy.name, `${source.name} (copy)`);
  assert.notEqual(copy.id, source.id);
  assert.equal(draft.activeSheetId, copy.id);
  // Visual ids are fresh.
  assert.equal(copy.visuals.length, 1);
  assert.notEqual(copy.visuals[0].id, source.visuals[0].id);
  // Layout placements point at the new ids.
  assert.deepEqual(copy.layout.map(p => p.i), copy.visuals.map(v => v.id));
  validateDraft(draft);
});

test('sheet-duplicate copies are independent: edits to the copy never touch the original', () => {
  const before = withObject();
  const sourceId = activeSheet(before).id;
  const draft = authorReducer(before, { type: 'sheet-duplicate', id: sourceId });
  const copyId = draft.sheets[1].id;
  // Rename the copy, add a visual, change the title object text.
  const renamed = authorReducer(draft, { type: 'sheet-rename', id: copyId, name: 'Renamed copy' });
  const withAdded = authorReducer(renamed, { type: 'add', kind: 'line' });
  const copyObjectId = withAdded.sheets[1].objects[0].id;
  const edited = authorReducer(withAdded, { type: 'object-text', id: copyObjectId, content: 'Changed' });
  const original = edited.sheets[0];
  assert.equal(original.name, 'Sheet 1');
  assert.equal(original.visuals.length, 0);
  assert.equal(original.objects[0].content, 'Add text');
  assert.equal(edited.sheets[1].name, 'Renamed copy');
  assert.equal(edited.sheets[1].visuals.length, 1);
  validateDraft(edited);
});

test('sheet-duplicate remaps navigation targets that pointed at the source sheet', () => {
  let draft = edit(emptyDraft(), { type: 'sheet-add' });
  const firstId = draft.sheets[0].id, secondId = draft.sheets[1].id;
  // Give the first sheet a visual with a navigation action targeting the second sheet.
  draft = authorReducer({ ...draft, activeSheetId: firstId },
    { type: 'assign-with-no-selection', field: 'region', well: 'rows' });
  const visualId = activeSheet(draft).visuals[0].id;
  draft = {
    ...draft,
    sheets: draft.sheets.map(s => s.id === firstId
      ? { ...s, visuals: s.visuals.map(v => v.id === visualId ? { ...v, navigationActions: [{ id: 'nav-1', name: 'Go', sourceField: 'region', targetSheetId: secondId, parameterMappings: {} }] } : v) }
      : s),
  };
  const duplicated = authorReducer(draft, { type: 'sheet-duplicate', id: secondId });
  const copy = duplicated.sheets[2];
  // The copy's own visuals (none here) are irrelevant; the first sheet's nav still targets the original second sheet.
  assert.equal(duplicated.sheets[0].visuals[0].navigationActions[0].targetSheetId, secondId);
  assert.equal(copy.name, 'Sheet 2 (copy)');
  validateDraft(duplicated);
});

test('sheet-duplicate on a missing sheet id leaves the draft unchanged', () => {
  const before = emptyDraft();
  assert.deepEqual(authorReducer(before, { type: 'sheet-duplicate', id: 'sheet-999' }), before);
});

test('sheet-duplicate remaps filter action targets and mappings to the copied visuals', () => {
  let draft = edit(emptyDraft(), { type: 'add', kind: 'bar' }, { type: 'add', kind: 'table' });
  const sheet = activeSheet(draft), [source, target] = sheet.visuals;
  draft = { ...draft, sheets: draft.sheets.map(s => s.id === sheet.id ? { ...s, visuals: s.visuals.map(v => v.id === source.id
    ? { ...v, filterActions: [{ id: 'action-1', name: 'Filter', sourceField: 'region', targets: [target.id], mappings: { [target.id]: 'region' } }] } : v) } : s) };
  const duplicated = authorReducer(draft, { type: 'sheet-duplicate', id: sheet.id });
  const copy = duplicated.sheets[1], [copiedSource, copiedTarget] = copy.visuals;
  // Targets and mappings point at the copied target, never the original.
  assert.deepEqual(copiedSource.filterActions[0].targets, [copiedTarget.id]);
  assert.deepEqual(copiedSource.filterActions[0].mappings, { [copiedTarget.id]: 'region' });
  // The original sheet keeps its original references.
  assert.deepEqual(duplicated.sheets[0].visuals[0].filterActions[0].targets, [target.id]);
  // A selection on the copy's source filters the copy's target only.
  const state = toggleSelection({}, copiedSource.id, { values: { region: 'West' } });
  assert.equal(withActionFilters(copy, copiedTarget, state).interactionFilters?.length, 1);
  const original = duplicated.sheets[0];
  assert.equal(withActionFilters(original, original.visuals[1], state).interactionFilters?.length ?? 0, 0);
  validateDraft(duplicated);
});

const cascadingDraft = () => {
  let draft = emptyDraft();
  for (const parameter of [
    { name: 'Region', type: 'string', multiple: false, values: ['East'], defaultValues: ['East'] },
    { name: 'Category', type: 'string', multiple: false, values: ['Hardware'], defaultValues: ['Hardware'] },
  ]) draft = authorReducer(draft, { type: 'parameter-add', parameter });
  draft = authorReducer(draft, { type: 'control-add', control: { label: 'Region', kind: 'dropdown', parameterId: 'parameter-1', source: { columnName: 'region', dataSetIdentifier: 'sales_data', local: true } } });
  return authorReducer(draft, { type: 'control-add', control: { label: 'Category', kind: 'dropdown', parameterId: 'parameter-2', source: { columnName: 'category', dataSetIdentifier: 'sales_data', local: true }, cascade: [{ controlId: 'control-1', columnName: 'region' }] } });
};

test('sheet-duplicate remaps cascading control references to the copied controls', () => {
  const draft = cascadingDraft(), sheet = activeSheet(draft);
  const duplicated = authorReducer(draft, { type: 'sheet-duplicate', id: sheet.id });
  const copy = duplicated.sheets[1], [copiedParent, copiedChild] = copy.controls;
  assert.notEqual(copiedParent.id, 'control-1');
  assert.deepEqual(copiedChild.cascade, [{ controlId: copiedParent.id, columnName: 'region' }]);
  // The original sheet is untouched.
  assert.deepEqual(duplicated.sheets[0].controls[1].cascade, [{ controlId: 'control-1', columnName: 'region' }]);
  // The copied cascade resolves to the copied parent's parameter when executed.
  const query = buildControlQuery(copiedChild, copy.controls, duplicated.parameters);
  assert.ok(query);
  assert.deepEqual(query.filters, [{ columnName: 'region', parameterName: 'Region' }]);
  validateDraft(duplicated);
});

test('sheet-duplicate clears imported control identities so export assigns distinct control ids', () => {
  let draft = cascadingDraft();
  const sheet = activeSheet(draft);
  // The parent came from an imported bundle, so it carries the bundle identity.
  draft = { ...draft, sheets: draft.sheets.map(s => s.id === sheet.id ? { ...s, controls: s.controls.map(c => c.id === 'control-1' ? { ...c, importedId: 'imported-control-1' } : c) } : s) };
  const duplicated = authorReducer(draft, { type: 'sheet-duplicate', id: sheet.id });
  const copy = duplicated.sheets[1];
  assert.ok(copy.controls.every(c => c.importedId === undefined));
  validateDraft(duplicated);
  const resource = serializeAnalysis(duplicated);
  const controlIds = resource.definition.sheets.flatMap(s => (s.parameterControls ?? []).map(variant => Object.values(variant)[0].parameterControlId));
  assert.equal(controlIds.length, 4);
  assert.equal(new Set(controlIds).size, controlIds.length);
});

test('sheet-title adds a styled title object at the top and shifts the canvas down', () => {
  const before = withVisual();
  const existing = activeSheet(before).layout[0];
  const draft = authorReducer(before, { type: 'sheet-title' });
  const sheet = activeSheet(draft);
  assert.equal(sheet.objects.length, 1);
  const title = sheet.objects[0];
  assert.equal(title.kind, 'text');
  assert.equal(title.content, 'Sheet 1');
  assert.equal(title.style.fontSize, 24);
  assert.equal(title.style.bold, true);
  // Title sits at the top, full width; the visual shifted down by the title height.
  assert.deepEqual(sheet.layout.find(p => p.i === title.id), { i: title.id, x: 0, y: 0, w: 12, h: 4 });
  assert.deepEqual(sheet.layout.find(p => p.i === existing.i), { ...existing, y: existing.y + 4 });
  assert.equal(sheet.selectedId, title.id);
  validateDraft(draft);
});

test('sheet-description adds a description object below the title position', () => {
  const draft = authorReducer(emptyDraft(), { type: 'sheet-description' });
  const sheet = activeSheet(draft);
  assert.equal(sheet.objects.length, 1);
  const desc = sheet.objects[0];
  assert.equal(desc.kind, 'text');
  assert.equal(desc.content, 'Add description');
  assert.equal(desc.style.fontSize, 14);
  assert.equal(desc.style.bold, false);
  assert.deepEqual(sheet.layout.find(p => p.i === desc.id), { i: desc.id, x: 0, y: 0, w: 12, h: 4 });
  validateDraft(draft);
});

test('layoutSettingsValid accepts the defaults and rejects out-of-range values', () => {
  assert.equal(layoutSettingsValid(DEFAULT_LAYOUT_SETTINGS()), true);
  assert.equal(layoutSettingsValid({ rowHeight: 42, margin: 12 }), true);
  assert.equal(layoutSettingsValid({ rowHeight: 19, margin: 12 }), false);
  assert.equal(layoutSettingsValid({ rowHeight: 121, margin: 12 }), false);
  assert.equal(layoutSettingsValid({ rowHeight: 42, margin: -1 }), false);
  assert.equal(layoutSettingsValid({ rowHeight: 42, margin: 49 }), false);
  assert.equal(layoutSettingsValid({ rowHeight: 42.5, margin: 12 }), false);
  assert.equal(layoutSettingsValid(null), false);
  assert.equal(layoutSettingsValid({}), false);
});

test('sheet-layout-settings applies valid settings and ignores invalid ones', () => {
  const before = emptyDraft();
  const id = activeSheet(before).id;
  const applied = authorReducer(before, { type: 'sheet-layout-settings', id, settings: { rowHeight: 60, margin: 4 } });
  assert.deepEqual(activeSheet(applied).layoutSettings, { rowHeight: 60, margin: 4 });
  const rejected = authorReducer(applied, { type: 'sheet-layout-settings', id, settings: { rowHeight: 10, margin: 4 } });
  assert.deepEqual(activeSheet(rejected).layoutSettings, { rowHeight: 60, margin: 4 });
  const missing = authorReducer(applied, { type: 'sheet-layout-settings', id: 'sheet-999', settings: { rowHeight: 60, margin: 4 } });
  assert.deepEqual(missing, applied);
  validateDraft(applied);
});

test('layout settings survive a bundle round-trip', () => {
  const before = emptyDraft();
  const id = activeSheet(before).id;
  const draft = authorReducer(before, { type: 'sheet-layout-settings', id, settings: { rowHeight: 60, margin: 4 } });
  const resource = serializeAnalysis(draft);
  const sheetDef = resource.definition.sheets[0];
  assert.deepEqual(sheetDef.opensightLayoutSettings, { rowHeight: 60, margin: 4 });
  const imported = importBundle({ members: [{ path: `analysis/${resource.analysisId}.json`, resource }] });
  assert.deepEqual(imported.sheets[0].layoutSettings, { rowHeight: 60, margin: 4 });
});

test('layout settings edits survive export of an imported analysis (issue #76)', () => {
  const before = emptyDraft();
  const id = activeSheet(before).id;
  const draft = authorReducer(before, { type: 'sheet-layout-settings', id, settings: { rowHeight: 60, margin: 4 } });
  const resource = serializeAnalysis(draft);
  const imported = importBundle({ members: [{ path: `analysis/${resource.analysisId}.json`, resource }] });
  const edited = authorReducer(imported, {
    type: 'sheet-layout-settings', id: imported.sheets[0].id, settings: { rowHeight: 80, margin: 8 },
  });
  const exported = exportBundle(edited);
  const rawSheet = exported.members[0].resource.definition.sheets[0];
  assert.deepEqual(rawSheet.opensightLayoutSettings, { rowHeight: 80, margin: 8 });
  const reimported = importBundle(exported);
  assert.deepEqual(reimported.sheets[0].layoutSettings, { rowHeight: 80, margin: 8 });
});

test('layout settings export for an imported analysis with no original settings (issue #76)', () => {
  const resource = serializeAnalysis(emptyDraft());
  assert.equal(resource.definition.sheets[0].opensightLayoutSettings, undefined);
  const imported = importBundle({ members: [{ path: `analysis/${resource.analysisId}.json`, resource }] });
  const edited = authorReducer(imported, {
    type: 'sheet-layout-settings', id: imported.sheets[0].id, settings: { rowHeight: 60, margin: 4 },
  });
  const exported = exportBundle(edited);
  const rawSheet = exported.members[0].resource.definition.sheets[0];
  assert.deepEqual(rawSheet.opensightLayoutSettings, { rowHeight: 60, margin: 4 });
  const reimported = importBundle(exported);
  assert.deepEqual(reimported.sheets[0].layoutSettings, { rowHeight: 60, margin: 4 });
});
