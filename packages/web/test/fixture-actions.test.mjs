import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { buildApiPreview } from '../build/test/api-preview.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { fieldIds } from '../build/test/bundle-interactions.js';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const fixtures = await json('../src/fixtures.generated.json');
const sales = await json('../../../fixtures/renderable-sales/analysis.json');
const sample = () => ({ id: sales.AnalysisId, name: sales.Name, definition: convertDefinition(sales.Definition) });
const draft = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const visual = kind => activeSheet(draft(kind)).visuals[0];

const filter = { id: 'filter-1', name: 'Filter region', sourceField: 'region', targets: 'all', mappings: {} };
const url = { id: 'url-1', name: 'Open page', sourceField: 'region', urlTemplate: 'https://example.com/{region}' };
const nav = { id: 'nav-1', name: 'Go to sheet', sourceField: 'region', targetSheetId: 'sheet-2', parameterMappings: {} };

test('buildAuthorVisual threads action arrays from the author visual', () => {
  const item = { ...visual('bar'), filterActions: [filter], urlActions: [url], navigationActions: [nav] };
  const built = buildAuthorVisual(item);
  assert.deepEqual(built.filterActions, [filter]);
  assert.deepEqual(built.urlActions, [url]);
  assert.deepEqual(built.navigationActions, [nav]);
  // Copies, not aliases: mutating the built arrays must not touch the source visual.
  built.filterActions.push(filter);
  assert.equal(item.filterActions.length, 1);
});

test('buildAuthorVisual omits action keys when the author visual has none', () => {
  const built = buildAuthorVisual(visual('bar'));
  assert.ok(!('filterActions' in built) && !('urlActions' in built) && !('navigationActions' in built));
});

const firstBody = definition => {
  const def = definition.sheets[0].visuals[0];
  const body = def[Object.keys(def)[0]];
  const [fieldId] = [...fieldIds(body).keys()];
  return { body, fieldId, columnName: fieldIds(body).get(fieldId) };
};
const rawFilter = fieldId => ({
  customActionId: 'action-1', name: 'Filter it', status: 'ENABLED', trigger: 'DATA_POINT_CLICK',
  actionOperations: [{ filterOperation: {
    selectedFieldsConfiguration: { selectedFields: [fieldId] },
    targetVisualsConfiguration: { sameSheetTargetVisualConfiguration: { targetVisualOptions: 'ALL_VISUALS', targetVisuals: [] } },
  } }],
});
const rawUrl = () => ({
  customActionId: 'action-2', name: 'Open link', status: 'ENABLED', trigger: 'DATA_POINT_CLICK',
  actionOperations: [{ urlOperation: { URL: 'https://example.com/{region}', urlTarget: 'NEW_TAB' } }],
});
const rawNav = () => ({
  customActionId: 'action-3', name: 'Go', status: 'ENABLED', trigger: 'DATA_POINT_CLICK',
  actionOperations: [{ navigationOperation: { targetSheetId: 'sheet-2' } }],
});

test('buildApiPreview attaches valid filter, URL and navigation actions from live bodies', () => {
  const response = sample();
  const { body, fieldId, columnName } = firstBody(response.definition);
  body.actions = [rawFilter(fieldId), rawUrl(), rawNav()];
  const preview = buildApiPreview(response, 'analysis', fixtures);
  const v = preview.sheets[0].visuals[0];
  assert.equal(v.filterActions?.length, 1);
  assert.equal(v.filterActions[0].id, 'action-1');
  assert.equal(v.filterActions[0].sourceField, columnName);
  assert.equal(v.filterActions[0].targets, 'all');
  assert.equal(v.urlActions?.length, 1);
  assert.equal(v.urlActions[0].target, '_blank');
  assert.equal(v.navigationActions?.length, 1);
  assert.equal(v.navigationActions[0].targetSheetId, 'sheet-2');
  assert.doesNotMatch(preview.notice, /unrecognized action/);
});

test('buildApiPreview omits unrecognized actions and says so in the notice', () => {
  const response = sample();
  const { body } = firstBody(response.definition);
  body.actions = [{ customActionId: 'bad-1', name: 'Nope', status: 'DISABLED', trigger: 'DATA_POINT_CLICK', actionOperations: [] }];
  const preview = buildApiPreview(response, 'analysis', fixtures);
  const v = preview.sheets[0].visuals[0];
  assert.ok(!('filterActions' in v) && !('urlActions' in v) && !('navigationActions' in v));
  assert.match(preview.notice, /1 unrecognized action definition\(s\) were omitted from previews/);
});

test('buildApiPreview drops duplicate action identities fail-closed', () => {
  const response = sample();
  const { body, fieldId } = firstBody(response.definition);
  body.actions = [rawFilter(fieldId), { ...rawFilter(fieldId), name: 'Copy' }];
  const preview = buildApiPreview(response, 'analysis', fixtures);
  const v = preview.sheets[0].visuals[0];
  assert.ok(!('filterActions' in v));
  assert.match(preview.notice, /2 unrecognized action definition\(s\) were omitted from previews/);
});
