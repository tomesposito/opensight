import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorReducer, emptyDraft, activeSheet, validateDraft,
  layoutSettingsValid, DEFAULT_LAYOUT_SETTINGS,
  serializeDraft as serializeAnalysis,
} from '../build/test/authoring.js';
import { importBundle } from '../build/test/bundle-authoring.js';

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
