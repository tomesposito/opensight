import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, validateDraft, saveDraft, loadDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { importUrlAction, importNavigationAction, serializeUrlAction, serializeNavigationAction } from '../build/test/bundle-interactions.js';
import { resolveUrlAction, resolveNavigationAction, navigationActionProblem, urlActionProblem } from '../build/test/interactions.js';
import { parseQsBundle } from '@opensight/bundle-parser/browser';
const bundle = resource => ({ members: [{ path: 'analysis/authored-analysis.json', resource }] });
const body = resource => resource.definition.sheets[0].visuals[0].tableVisual;
const url = { id: 'url', name: 'Details', sourceField: 'region', urlTemplate: 'https://example.com/{region}', target: '_self' };
const nav = { id: 'nav', name: 'Go', sourceField: 'region', targetSheetId: 'sheet-2', parameterMappings: { region: 'Region' } };
const fields = new Map([['native-region', 'region']]);
function fixture() {
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'table' });
  d = authorReducer(d, { type: 'parameter-add', parameter: { name: 'Region', type: 'string', multiple: false, values: ['East'], defaultValues: ['East'] } });
  d = authorReducer(d, { type: 'filter-actions', actions: [{ id: 'filter', name: 'Filter', sourceField: 'region', targets: 'all', mappings: {} }] });
  d = authorReducer(d, { type: 'url-actions', actions: [url] });
  d = authorReducer(d, { type: 'sheet-add' });
  d = authorReducer(d, { type: 'sheet-select', id: 'sheet-1' });
  return authorReducer(d, { type: 'navigation-actions', actions: [nav] });
}
test('URL and navigation serialization import back to the exact model, including optional targets and mappings', () => {
  assert.deepEqual(importUrlAction(serializeUrlAction(url), fields), url);
  assert.deepEqual(importNavigationAction(serializeNavigationAction(nav), fields), nav);
  const noTarget = { ...url }; delete noTarget.target;
  assert.deepEqual(importUrlAction(serializeUrlAction(noTarget), fields), noTarget);
  assert.deepEqual(importNavigationAction(serializeNavigationAction({ ...nav, parameterMappings: {} }), fields), { ...nav, parameterMappings: {} });
  const native = { customActionId: 'native-url', name: 'Native', status: 'ENABLED', trigger: 'DATA_POINT_CLICK', actionOperations: [{ urlOperation: { URL: 'https://example.com/{region}' } }] };
  assert.deepEqual(importUrlAction(native, fields), { id: 'native-url', name: 'Native', sourceField: 'region', urlTemplate: 'https://example.com/{region}' });
  native.actionOperations[0].urlOperation = { url: 'https://example.com/{region}', urlTarget: 'NEW_TAB' };
  assert.equal(importUrlAction(native, fields).target, '_blank');
  const nativeNavigation = { customActionId: 'native-nav', name: 'Native', status: 'ENABLED', trigger: 'DATA_POINT_CLICK', actionOperations: [{ navigationOperation: { targetSheetId: 'details' } }] };
  assert.deepEqual(importNavigationAction(nativeNavigation, fields).parameterMappings, {});
});
test('all three action kinds round-trip through JSON, ZIP, local storage and repeated bundle imports', async () => {
  const draft = fixture(), resource = serializeDraft(draft), original = bundle(resource);
  const imported = importBundle(original); validateDraft(imported);
  const source = activeSheet(imported).visuals[0], before = activeSheet(draft).visuals[0];
  for (const kind of ['urlActions', 'navigationActions', 'filterActions']) assert.deepEqual(source[kind], before[kind]);
  assert.deepEqual(source.imported.issues, []);
  assert.deepEqual(exportBundle(imported), original);
  assert.deepEqual(await parseQsBundle(await downloadBundleBytes(imported)), original);
  assert.deepEqual(activeSheet(importBundle(exportBundle(imported))).visuals[0].navigationActions, before.navigationActions);
  let saved; saveDraft(imported, () => ({ setItem: (_, value) => { saved = value; } }));
  assert.deepEqual(loadDraft(() => ({ getItem: () => saved })).draft, JSON.parse(JSON.stringify(imported)));
  assert.equal(resolveUrlAction(source, source.urlActions[0], { values: { region: 'West' } }).value, 'https://example.com/West');
  assert.equal(resolveNavigationAction(imported, source, source.navigationActions[0], { values: { region: 'West' } }).value.targetSheetId, 'sheet-2');
});
test('native sheet identities resolve in the same resource and export edits retain untouched native URL shapes', () => {
  const resource = serializeDraft(fixture()), raw = body(resource);
  resource.definition.sheets[0].sheetId = 'native-source';
  resource.definition.sheets[1].sheetId = 'native-details';
  raw.actions[2].actionOperations[0].navigationOperation.targetSheetId = 'native-details';
  raw.actions[1].actionOperations[0].urlOperation = { url: url.urlTemplate, urlTarget: 'SAME_TAB' };
  delete raw.actions[1].opensightSourceField;
  let d = importBundle(bundle(resource));
  const source = activeSheet(d).visuals[0];
  assert.equal(source.navigationActions[0].targetSheetId, 'sheet-2');
  assert.deepEqual(exportBundle(d), bundle(resource));
  d = authorReducer(d, { type: 'navigation-actions', actions: [{ ...source.navigationActions[0], name: 'Edited' }] });
  const exported = exportBundle(d), out = body(exported.members[0].resource);
  assert.deepEqual(out.actions[1], raw.actions[1]);
  assert.equal(out.actions[2].actionOperations[0].navigationOperation.targetSheetId, 'native-details');
  assert.equal(out.actions[2].name, 'Edited');
  assert.deepEqual(activeSheet(importBundle(exported)).visuals[0].navigationActions, activeSheet(d).visuals[0].navigationActions);
  assert.deepEqual(activeSheet(importBundle(exported)).visuals[0].imported.issues, []);
});
test('unresolved native sheet IDs cannot alias local IDs or sheets in another analysis', () => {
  const resource = serializeDraft(fixture());
  resource.definition.sheets[1].sheetId = 'native-details';
  const d = importBundle(bundle(resource)), source = activeSheet(d).visuals[0];
  assert.equal(source.navigationActions[0].targetSheetId, 'unresolved:sheet-2');
  assert.match(navigationActionProblem(d, source, source.navigationActions[0]), /NAVIGATION_TARGET_UNKNOWN/);
  assert.deepEqual(exportBundle(d), bundle(resource));
  const other = structuredClone(resource); other.analysisId = 'other'; other.definition.sheets[1].sheetId = 'sheet-2';
  const multi = importBundle({ members: [...bundle(resource).members, { path: 'analysis/other.json', resource: other }] });
  assert.equal(activeSheet(multi).visuals[0].navigationActions[0].targetSheetId, 'unresolved:sheet-2');
  assert.equal(multi.sheets[2].visuals[0].navigationActions[0].targetSheetId, 'sheet-4');
  assert.deepEqual(multi.sheets[2].visuals[0].imported.issues, []);
});
test('unknown operation shapes stay unrecognized and survive supported action edits and deletion', () => {
  const resource = serializeDraft(fixture()), raw = body(resource);
  const unknown = [
    { ...serializeUrlAction(url), customActionId: 'future-url', actionOperations: [{ urlOperation: { URL: 'https://example.com', futureOption: true } }] },
    { ...serializeNavigationAction(nav), customActionId: 'future-nav', actionOperations: [{ navigationOperation: { navigationTarget: { dashboardId: 'foreign', sheetId: 'remote' } } }] },
    { ...serializeNavigationAction(nav), customActionId: 'future-mapping', actionOperations: [{ navigationOperation: { targetSheetId: 'sheet-2', parameterMappings: { region: { parameter: 'Region' } } } }] },
    { ...serializeUrlAction(url), customActionId: 'multi', actionOperations: [{ urlOperation: { URL: 'https://example.com' } }, { futureOperation: {} }] },
    { ...serializeUrlAction(url), customActionId: 'mixed', actionOperations: [{ urlOperation: { URL: 'https://example.com' }, futureOperation: {} }] },
    { ...serializeUrlAction(url), customActionId: 'disabled', status: 'DISABLED' },
    { ...serializeUrlAction(url), customActionId: 'trigger', trigger: 'DATA_POINT_MENU' },
    { ...serializeUrlAction(url), customActionId: 'future-action', unknown: true },
    { ...serializeUrlAction(url), customActionId: 'window', actionOperations: [{ urlOperation: { url: 'https://example.com', urlTarget: 'NEW_WINDOW' } }] },
  ];
  for (const action of unknown) {
    assert.equal(importUrlAction(action, fields), undefined);
    assert.equal(importNavigationAction(action, fields), undefined);
  }
  raw.actions.push(...unknown);
  let d = importBundle(bundle(resource));
  assert.equal(activeSheet(d).visuals[0].urlActions.length, 1);
  assert.equal(activeSheet(d).visuals[0].navigationActions.length, 1);
  assert.match(JSON.stringify(d.bundle.report), /actions/);
  assert.deepEqual(exportBundle(d), bundle(resource));
  d = authorReducer(d, { type: 'url-actions', actions: [{ ...url, name: 'New name' }] });
  d = authorReducer(d, { type: 'navigation-actions', actions: [] });
  const out = body(exportBundle(d).members[0].resource).actions;
  assert.deepEqual(out.slice(2), unknown);
  assert.equal(out[1].name, 'New name');
});
test('invalid recognized configurations retain named editor diagnostics and duplicate IDs stay opaque', () => {
  const resource = serializeDraft(fixture()), raw = body(resource);
  raw.actions[1].actionOperations[0].urlOperation.URL = 'javascript:alert(1)';
  raw.actions[2].actionOperations[0].navigationOperation.parameterMappings = { region: 'Unknown' };
  let d = importBundle(bundle(resource)), source = activeSheet(d).visuals[0];
  assert.match(urlActionProblem(source, source.urlActions[0]), /URL_INVALID/);
  assert.match(navigationActionProblem(d, source, source.navigationActions[0]), /NAVIGATION_PARAMETER_UNKNOWN/);
  assert.deepEqual(exportBundle(d), bundle(resource));
  raw.actions[2].customActionId = raw.actions[1].customActionId;
  d = importBundle(bundle(resource)); source = activeSheet(d).visuals[0];
  assert.equal(source.urlActions, undefined); assert.equal(source.navigationActions, undefined);
  assert.deepEqual(exportBundle(d), bundle(resource));
});
