import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { assembleQsBundle, parseQsBundle, parseBundleJson, ZIP_LIMITS } from '@opensight/bundle-parser/browser';
import { parseQsBundle as parseNodeBundle } from '@opensight/bundle-parser';
import { importBundle, importBundleFile, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, validateDraft, loadDraft, saveDraft } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { AuthorCanvas } from '../build/test/Author.js';

const arn = 'arn:aws:quicksight:us-east-1:123456789012:dataset/imported-sales';
const member = resource => ({ path: `${resource.resourceType}/${resource.analysisId ?? resource.dashboardId ?? resource.dataSetId ?? resource.dataSourceId}.json`, resource });
function fixture() {
  let draft = emptyDraft();
  for (const kind of ['bar', 'line', 'pie', 'kpi', 'table', 'pivot']) draft = authorReducer(draft, { type: 'add', kind });
  draft = authorReducer(draft, { type: 'sheet-add' });
  draft = authorReducer(draft, { type: 'add', kind: 'bar' });
  const resource = serializeDraft(draft);
  resource.analysisId = 'synthetic-analysis'; resource.name = 'Round trip fixture';
  resource.definition.dataSetIdentifierDeclarations[0].dataSetArn = arn;
  resource.definition.calculatedFields = [{ name: 'Net', expression: '{revenue} - {profit}', dataSetIdentifier: 'sales_data', futureCalculation: { untouched: true } }];
  resource.definition.parameterDeclarations = [{ stringParameterDeclaration: { name: 'Region', parameterValueType: 'SINGLE_VALUED', defaultValues: { staticValues: ['East'] }, futureParameterOption: [1, null] } }];
  resource.futureEnvelope = { opaque: [null, { preserveCase: 'Exact' }] };
  resource.definition.options = { futureOption: 42 };
  const dashboard = structuredClone(resource);
  delete dashboard.analysisId; dashboard.resourceType = 'dashboard'; dashboard.dashboardId = 'synthetic-dashboard';
  return { members: [member(resource), member(dashboard), member({ resourceType: 'dataset', dataSetId: 'imported-sales', name: 'Sales', physicalTableMap: {}, importMode: 'SPICE', futurePrep: { exact: true } }), member({ resourceType: 'datasource', dataSourceId: 'source', name: 'Source', type: 'ATHENA', futureConnection: { readOnly: true } })] };
}
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const change = (draft, action) => authorReducer(draft, action);
const stripExtension = bundle => {
  const result = structuredClone(bundle);
  result.members.forEach(m => { delete m.resource.opensightRoundTrip; });
  return result;
};

test('synthetic .qs -> import -> export -> re-import is structurally identical across all four resources and six visual types', async () => {
  const original = fixture();
  const bytes = await assembleQsBundle(original);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  assert.deepEqual(await parseNodeBundle(bytes), original);
  const draft = importBundle(await parseQsBundle(bytes));
  assert.equal(draft.sheets.length, 4);
  assert.deepEqual(draft.sheets[0].visuals.map(v => v.kind), ['bar', 'line', 'pie', 'kpi', 'table', 'pivot']);
  assert.deepEqual(draft.sheets[0].visuals[0].measures, ['revenue']);
  assert.equal(draft.sheets[0].visuals[0].dimension, 'region');
  assert.deepEqual(exportBundle(draft), original);
  const again = await parseQsBundle(await downloadBundleBytes(draft));
  assert.deepEqual(again, original);
  assert.deepEqual(exportBundle(importBundle(again)), original);
  assert.deepEqual(original, fixture(), 'no input mutation');
});

test('sanitized real archive is identical through browser import/export, including unknown dependency JSON', async () => {
  const bytes = await readFile(new URL('../../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs', import.meta.url));
  const original = await parseNodeBundle(bytes);
  assert.deepEqual(await parseQsBundle(bytes), original);
  assert.deepEqual(await parseQsBundle(await downloadBundleBytes(importBundle(original))), original);
});

test('unsupported visual types and each unknown feature are named and retained, including after title edits', () => {
  const bundle = fixture(), raw = bundle.members[0].resource.definition.sheets[0];
  raw.visuals.push({ radarChartVisual: { visualId: 'heatmap', chartConfiguration: { opaque: { a: [1, false] } }, customBody: 'kept' } });
  raw.visuals[0].barChartVisual.chartConfiguration.customAxis = { exact: true };
  raw.visuals[0].barChartVisual.actions = [{ customAction: { label: 'Inspect' } }];
  let draft = importBundle(bundle);
  const report = JSON.stringify(draft.bundle.report);
  assert.match(report, /Unsupported visual type: radarChartVisual/);
  assert.match(report, /customAxis/); assert.match(report, /actions/);
  assert.match(report, /futureEnvelope/); assert.match(report, /Parameter Region/);
  assert.deepEqual(exportBundle(draft), bundle);
  const visual = draft.sheets[0].visuals.at(-1);
  draft = change(draft, { type: 'select', id: visual.id });
  draft = change(draft, { type: 'title', title: 'Retitled unsupported visual' });
  const exported = exportBundle(draft), heat = exported.members[0].resource.definition.sheets[0].visuals.at(-1).radarChartVisual;
  assert.equal(heat.title.formatText.plainText, 'Retitled unsupported visual');
  assert.deepEqual(heat.chartConfiguration, raw.visuals.at(-1).radarChartVisual.chartConfiguration);
  assert.deepEqual(exported.members[0].resource.opensightRoundTrip.originalResource, bundle.members[0].resource);
});

test('unknown wells, non-SUM aggregation, targets and date granularities are explicitly reported', () => {
  const bundle = fixture();
  const config = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.chartConfiguration;
  const wells = config.fieldWells.barChartAggregatedFieldWells;
  wells.values[0].numericalMeasureField.aggregationFunction.simpleNumericalAggregation = 'AVG';
  wells.colors = structuredClone(wells.category);
  wells.values.push({ calculatedMeasureField: { fieldId: 'calculated', expression: 'sum({profit})' } });
  const draft = importBundle(bundle), report = JSON.stringify(draft.bundle.report);
  for (const name of ['AVG', 'colors', 'calculatedMeasureField']) assert.ok(report.includes(name), name);
  assert.deepEqual(exportBundle(draft), bundle);
  assert.equal(buildAuthorQuery(selected(change(draft, { type: 'remap', id: selected(draft).id }))), null);
});

test('unresolved binding never queries or borrows fixed sales rows and exposes a remap action', () => {
  const draft = importBundle(fixture()), visual = selected(draft);
  assert.equal(buildAuthorQuery(visual), null);
  assert.equal(buildAuthorPreview(visual).rows, null);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  assert.match(html, /Unresolved dataset/); assert.match(html, /Remap to local dataset/);
  assert.match(html, /Parameters/); assert.match(html, /Region/); assert.match(html, /Imported calculated fields/); assert.match(html, /Net/);
});

test('remap matches local fields by name, clears unmatched fields, and uses local sales query only afterward', () => {
  const bundle = fixture(), raw = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual;
  raw.chartConfiguration.fieldWells.barChartAggregatedFieldWells.values.push({ numericalMeasureField: { fieldId: 'unknown', column: { dataSetIdentifier: 'sales_data', columnName: 'foreign_margin' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
  let draft = importBundle(bundle);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  const visual = selected(draft);
  assert.deepEqual(visual.measures, ['revenue']); assert.deepEqual(visual.imported.unmappedFields, ['foreign_margin']);
  assert.deepEqual(buildAuthorQuery(visual).measures, [{ fieldId: 'revenue', columnName: 'revenue', aggregation: 'SUM' }]);
  const exported = exportBundle(draft), d = exported.members[0].resource.definition;
  assert.equal(d.dataSetIdentifierDeclarations.at(-1).identifier, 'opensight_local_sales');
  assert.equal(d.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.values[0].numericalMeasureField.column.dataSetIdentifier, 'opensight_local_sales');
  assert.equal(selected(importBundle(exported)).imported.local, true);
  assert.deepEqual(exported.members[0].resource.opensightRoundTrip.originalResource, bundle.members[0].resource);
});

test('manual wells after remap remain editable and export with the local declaration', () => {
  const bundle = fixture(), raw = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual;
  raw.chartConfiguration.fieldWells.barChartAggregatedFieldWells.category[0].categoricalDimensionField.column.columnName = 'Country';
  let draft = importBundle(bundle);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  assert.equal(selected(draft).dimension, null); assert.equal(buildAuthorQuery(selected(draft)), null);
  draft = change(draft, { type: 'assign', well: 'dimension', field: 'region' });
  assert.ok(buildAuthorQuery(selected(draft)));
  const again = importBundle(exportBundle(draft));
  assert.equal(selected(again).dimension, 'region'); assert.ok(buildAuthorQuery(selected(again)));
});

test('multiple dataset references are never collapsed on an untouched round trip', () => {
  const bundle = fixture(), d = bundle.members[0].resource.definition;
  d.dataSetIdentifierDeclarations.push({ identifier: 'second', dataSetArn: `${arn}-second` });
  d.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.values[0].numericalMeasureField.column.dataSetIdentifier = 'second';
  assert.deepEqual(exportBundle(importBundle(bundle)), bundle);
});

test('KPI wrapped wells survive unchanged and can be edited after remapping', () => {
  const bundle = fixture(), body = bundle.members[0].resource.definition.sheets[0].visuals[3].kpiVisual;
  body.chartConfiguration.fieldWells = { kpiFieldWells: body.chartConfiguration.fieldWells };
  let draft = importBundle(bundle);
  assert.deepEqual(exportBundle(draft), bundle);
  const v = draft.sheets[0].visuals[3];
  assert.deepEqual(v.imported.issues, []);
  draft = change(draft, { type: 'select', id: v.id });
  draft = change(draft, { type: 'remap', id: v.id });
  draft = change(draft, { type: 'assign', field: 'profit', well: 'values' });
  assert.deepEqual(selected(importBundle(exportBundle(draft))).measures, ['revenue']); // active selection is UI-only
  assert.deepEqual(importBundle(exportBundle(draft)).sheets[0].visuals[3].measures, ['profit']);
});

function categoryGroup() {
  return { filterGroupId: 'region-filter', crossDataset: 'SINGLE_DATASET', status: 'ENABLED',
    scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{ sheetId: 'sheet-1', scope: 'SELECTED_VISUALS', visualIds: ['visual-1'] }] } },
    filters: [{ categoryFilter: { filterId: 'region', column: { dataSetIdentifier: 'sales_data', columnName: 'region' }, configuration: { filterListConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', categoryValues: ['East'] } } } }], opaque: { keep: true } };
}
test('compatible category filters populate editable pills and preserve unknown group JSON while editing', () => {
  const bundle = fixture(); bundle.members[0].resource.definition.filterGroups = [categoryGroup()];
  let draft = importBundle(bundle);
  assert.deepEqual(selected(draft).filters, [{ columnName: 'region', values: ['East'] }]);
  assert.deepEqual(exportBundle(draft), bundle);
  draft = change(draft, { type: 'filter', columnName: 'region', values: ['West'] });
  const exported = exportBundle(draft), group = exported.members[0].resource.definition.filterGroups[0];
  assert.deepEqual(group.filters[0].categoryFilter.configuration.filterListConfiguration.categoryValues, ['West']);
  assert.deepEqual(group.opaque, { keep: true });
  draft = change(draft, { type: 'filter', columnName: 'region', values: null });
  assert.deepEqual(exportBundle(draft).members[0].resource.definition.filterGroups, []);
});

test('shared filter scopes and unsupported filters are display-only, named, preserved and block misleading queries', () => {
  const bundle = fixture(), group = categoryGroup(); group.scopeConfiguration = { allSheets: {} };
  bundle.members[0].resource.definition.filterGroups = [group, { ...group, filterGroupId: 'future-group', filters: [{ futureFilter: { body: 'retained' } }] }];
  let draft = importBundle(bundle);
  assert.deepEqual(selected(draft).filters, []);
  assert.match(JSON.stringify(draft.bundle.report), /futureFilter/);
  assert.deepEqual(exportBundle(draft), bundle);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  assert.equal(buildAuthorQuery(selected(draft)), null);
});

test('edited sheets, visual deletion, additions and layouts survive re-import with source IDs intact', () => {
  let draft = importBundle(fixture());
  draft = change(draft, { type: 'sheet-rename', id: draft.sheets[0].id, name: 'Edited sheet' });
  draft = change(draft, { type: 'layout', sheetId: draft.sheets[0].id, layout: draft.sheets[0].layout.map((p, i) => i ? p : { ...p, x: 2, w: 8 }) });
  draft = change(draft, { type: 'remove', id: draft.sheets[0].visuals[1].id });
  draft = change(draft, { type: 'add', kind: 'kpi' });
  const exported = exportBundle(draft), sheet = exported.members[0].resource.definition.sheets[0];
  assert.equal(sheet.sheetId, 'sheet-1'); assert.equal(sheet.name, 'Edited sheet');
  assert.equal(sheet.visuals.length, 6);
  const again = importBundle(exported);
  assert.equal(again.sheets[0].layout[0].x, 2); assert.equal(again.sheets[0].layout[0].w, 8);
  assert.deepEqual(stripExtension(exportBundle(again)), stripExtension(exported));
});

test('single JSON member imports, no-server Blob payloads, resource-only bundles and absent optional fields', async () => {
  const resource = { resourceType: 'analysis', analysisId: 'a', name: 'A', definition: { dataSetIdentifierDeclarations: [] } };
  const bytes = strToU8(JSON.stringify(resource));
  assert.deepEqual(parseBundleJson(bytes), { members: [member(resource)] });
  const draft = await importBundleFile({ name: 'a.json', size: bytes.length, arrayBuffer: async () => bytes.buffer });
  assert.deepEqual(exportBundle(draft), { members: [member(resource)] });
  const blob = new Blob([await downloadBundleBytes(draft)]);
  assert.deepEqual(await parseQsBundle(new Uint8Array(await blob.arrayBuffer())), { members: [member(resource)] });
  const resources = { members: fixture().members.slice(2) };
  assert.deepEqual(exportBundle(importBundle(resources)), resources);
});

test('ZIP member filenames and directories agree with IDs and invalid exports are blocked before ZIP creation', async () => {
  const bundle = fixture(), files = unzipSync(await assembleQsBundle(bundle));
  assert.deepEqual(Object.keys(files), bundle.members.map(m => m.path));
  for (const path of ['analysis/wrong.json', 'dashboard/synthetic-analysis.json', '../analysis/synthetic-analysis.json']) {
    const bad = structuredClone(bundle); bad.members[0].path = path;
    await assert.rejects(assembleQsBundle(bad), /match|unsupported/);
  }
  const duplicate = structuredClone(bundle); duplicate.members.push(duplicate.members[0]);
  await assert.rejects(assembleQsBundle(duplicate), /duplicate/);
  const bad = structuredClone(bundle); bad.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.visualId = '';
  await assert.rejects(assembleQsBundle(bad), /visualId/);
  const draft = importBundle(bundle); draft.bundle.original.members[0].resource.name = '';
  assert.throws(() => exportBundle(draft), /name/);
});

test('malformed ZIP, member JSON and unsupported resource paths surface exact parser errors', async () => {
  const good = await assembleQsBundle(fixture());
  for (const bytes of [strToU8('not a ZIP'), good.subarray(0, good.length - 5)]) await assert.rejects(parseQsBundle(bytes), /invalid ZIP/);
  for (const data of [strToU8('{broken'), new Uint8Array([255, 254])]) await assert.rejects(parseQsBundle(zipSync({ 'analysis/a.json': data })), /analysis\/a.json.*valid UTF-8 JSON/);
  await assert.rejects(parseQsBundle(zipSync({ 'theme/x.json': strToU8('{}') })), /unsupported bundle member path/);
  await assert.rejects(parseQsBundle(zipSync({})), /no resource members/);
});

test('browser ZIP reader rejects unsafe paths, duplicate members, CRC, encryption and unsupported compression', async () => {
  const resource = fixture().members[0].resource;
  for (const path of ['../analysis/a.json', '/analysis/a.json', 'analysis\\a.json', './analysis/a.json', 'analysis//a.json', 'analysis/\0a.json']) await assert.rejects(parseQsBundle(zipSync({ [path]: strToU8(JSON.stringify(resource)) })), /unsafe/);
  const packed = Buffer.from(await assembleQsBundle(fixture()));
  const central = packed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  for (const [offset, width, value, pattern] of [[16, 4, 0, /CRC32/], [8, 2, 1, /encrypted/], [10, 2, 99, /compression/], [24, 4, ZIP_LIMITS.memberBytes + 1, /member byte limit/], [24, 4, 1, /size mismatch/]]) {
    const corrupt = Buffer.from(packed); corrupt.writeUIntLE(value, central + offset, width);
    await assert.rejects(parseQsBundle(corrupt), pattern);
  }
  const dup = Buffer.from(zipSync({ 'analysis/a.json': strToU8('{}'), 'analysis/b.json': strToU8('{}') }));
  for (let offset = dup.indexOf('analysis/b.json'); offset !== -1; offset = dup.indexOf('analysis/b.json')) dup.write('analysis/a.json', offset);
  await assert.rejects(parseQsBundle(dup), /duplicate ZIP member path/);
});

test('all ZIP_LIMITS apply before reading oversized files and before inflating metadata-sized bombs', async () => {
  let read = false;
  await assert.rejects(importBundleFile({ name: 'big.qs', size: ZIP_LIMITS.archiveBytes + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }), /archive byte limit/);
  assert.equal(read, false);
  await assert.rejects(importBundleFile({ name: 'big.json', size: ZIP_LIMITS.memberBytes + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }), /member byte limit/);
  assert.equal(read, false);
  await assert.rejects(parseQsBundle(new Uint8Array(ZIP_LIMITS.archiveBytes + 1)), /archive byte limit/);
  const many = zipSync(Object.fromEntries(Array.from({ length: ZIP_LIMITS.members + 1 }, (_, i) => [`${i}/`, new Uint8Array()])));
  await assert.rejects(parseQsBundle(many), /member count limit/);
  const bomb = Buffer.from(zipSync(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`analysis/${i}.json`, strToU8('{}')]))));
  let offset = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (offset >= 0) {
    const local = bomb.readUInt32LE(offset + 42);
    bomb.writeUInt32LE(ZIP_LIMITS.memberBytes, offset + 24); bomb.writeUInt32LE(ZIP_LIMITS.memberBytes, local + 22);
    offset = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset + 4);
  }
  await assert.rejects(parseQsBundle(bomb), /total uncompressed byte limit/);
});

test('draft storage preserves original unknown JSON and imported binding metadata', () => {
  const draft = importBundle(fixture()); let value;
  const storage = { getItem: () => value, setItem: (_, next) => { value = next; } };
  validateDraft(draft); assert.match(saveDraft(draft, () => storage), /Draft saved/);
  const restored = loadDraft(() => storage);
  assert.equal(restored.warning, undefined); assert.deepEqual(exportBundle(restored.draft), fixture());
});

test('deleting an imported visual removes its scoped filters while archiving the complete original group', () => {
  const bundle = fixture(); bundle.members[0].resource.definition.filterGroups = [categoryGroup()];
  let draft = importBundle(bundle);
  draft = change(draft, { type: 'remove', id: selected(draft).id });
  const result = exportBundle(draft).members[0].resource;
  assert.deepEqual(result.definition.filterGroups, []);
  assert.deepEqual(result.opensightRoundTrip.originalResource.definition.filterGroups, [categoryGroup()]);
});

test('new visual and sheet IDs do not collide with original bundle IDs', () => {
  const bundle = fixture(), d = bundle.members[0].resource.definition;
  d.sheets[0].sheetId = 'sheet-5'; d.sheets[0].visuals[0].barChartVisual.visualId = 'visual-15';
  let draft = importBundle(bundle);
  draft = change(draft, { type: 'add', kind: 'kpi' });
  assert.notEqual(selected(draft).id, 'visual-15');
  draft = change(draft, { type: 'sheet-add' });
  assert.notEqual(draft.activeSheetId, 'sheet-5');
  assert.doesNotThrow(() => exportBundle(draft));
});

for (const [name, corrupt] of [
  ['missing source resource', d => { d.sheets[0].imported.memberPath = 'analysis/missing.json'; }],
  ['missing source visual', d => { d.sheets[0].visuals[0].imported.visualId = 'missing'; }],
  ['malformed baseline', d => { d.sheets[0].visuals[0].imported.baseline.measures = null; }],
  ['malformed report', d => { d.bundle.report[0].messages = 42; }],
  ['unsupported baseline kind', d => { d.sheets[0].visuals[0].imported.baseline.kind = 'future'; }],
]) test(`untrusted imported storage rejects ${name}`, () => {
  const draft = importBundle(fixture()); corrupt(draft);
  assert.throws(() => validateDraft(draft));
  assert.match(loadDraft(() => ({ getItem: () => JSON.stringify(draft) })).warning, /could not be restored/);
});

test('empty imported definitions retain absent sheets, but explicit sheet additions and renames export', () => {
  const resource = { resourceType: 'analysis', analysisId: 'empty', name: 'Empty', definition: { dataSetIdentifierDeclarations: [] } };
  const draft = importBundle({ members: [member(resource)] });
  assert.deepEqual(exportBundle(draft).members[0].resource, resource);
  const added = change(draft, { type: 'sheet-add' });
  assert.equal(exportBundle(added).members[0].resource.definition.sheets.length, 1);
  const renamed = change(draft, { type: 'sheet-rename', id: draft.activeSheetId, name: 'New sheet' });
  assert.equal(exportBundle(renamed).members[0].resource.definition.sheets[0].name, 'New sheet');
});

test('new calculations in imported local visuals are declared for the visual dataset identifier', () => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }));
  let draft = importBundle({ members: [member(resource)] });
  draft = change(draft, { type: 'calculation-add', field: { name: 'Net', expression: '{revenue} - {profit}', role: 'measure' } });
  draft = change(draft, { type: 'assign', field: 'Net', well: 'values' });
  const d = exportBundle(draft).members[0].resource.definition;
  const identifier = d.sheets[0].visuals[0].kpiVisual.chartConfiguration.fieldWells.values[0].numericalMeasureField.column.dataSetIdentifier;
  assert.ok(d.calculatedFields.some(c => c.name === 'Net' && c.dataSetIdentifier === identifier));
});

test('inflated size is enforced even when local and central size declarations both lie', async () => {
  const packed = Buffer.from(zipSync({ 'analysis/a.json': new Uint8Array(1024 * 1024) }));
  const central = packed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  packed.writeUInt32LE(1, 22); packed.writeUInt32LE(1, central + 24);
  await assert.rejects(parseQsBundle(packed), /inflated member size mismatch/);
});

test('future visual variants with prototype-like names are opaque JSON, not executable object keys', () => {
  const bundle = fixture();
  bundle.members[0].resource.definition.sheets[0].visuals.push(JSON.parse('{"__proto__":{"visualId":"prototype","opaque":true}}'));
  const draft = importBundle(bundle);
  assert.match(JSON.stringify(draft.bundle.report), /Unsupported visual type: __proto__/);
  assert.deepEqual(exportBundle(draft), bundle);
});


test('imported visual type changes use existing v1 controls and retain the original incompatible configuration', () => {
  const bundle = fixture(); let draft = importBundle(bundle);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  draft = change(draft, { type: 'kind', kind: 'kpi' });
  const exported = exportBundle(draft), resource = exported.members[0].resource;
  assert.ok(resource.definition.sheets[0].visuals[0].kpiVisual);
  assert.deepEqual(resource.opensightRoundTrip.originalResource, bundle.members[0].resource);
  const again = importBundle(exported);
  assert.equal(selected(again).kind, 'kpi'); assert.equal(selected(again).imported.local, true);
  assert.ok(buildAuthorQuery(selected(again)));
});

test('new cards do not bypass imported read-only all-sheet filters', () => {
  const bundle = fixture(), group = categoryGroup(); group.scopeConfiguration = { allSheets: {} };
  bundle.members[0].resource.definition.filterGroups = [group];
  const draft = change(importBundle(bundle), { type: 'add', kind: 'bar' });
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  assert.match(html, /Unsupported filter groups: region-filter/);
});

test('successive edits retain opaque JSON introduced between imports in flat resource snapshots', () => {
  let draft = importBundle(fixture());
  draft = change(draft, { type: 'title', title: 'First edit' });
  const edited = exportBundle(draft);
  const wells = edited.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells;
  wells.values[0].numericalMeasureField.futureExternalChange = { opaque: 'new since first import' };
  draft = importBundle(edited);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  const extension = exportBundle(draft).members[0].resource.opensightRoundTrip;
  assert.equal(extension.priorResources.length, 1);
  assert.equal(extension.priorResources[0].opensightRoundTrip, undefined);
  assert.deepEqual(extension.priorResources[0].definition.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.values[0].numericalMeasureField.futureExternalChange, { opaque: 'new since first import' });
});

test('conflicting local calculated names across resources are named and cannot execute another resource expression', () => {
  const a = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }));
  a.definition.calculatedFields = [{ dataSetIdentifier: 'sales_data', name: 'Net', expression: '{revenue} - {profit}' }];
  a.definition.sheets[0].visuals[0].kpiVisual.chartConfiguration.fieldWells.values[0].numericalMeasureField.column.columnName = 'Net';
  const b = structuredClone(a); b.analysisId = 'second'; b.definition.calculatedFields[0].expression = '{revenue} * 0.5';
  const bundle = { members: [member(a), member(b)] }, draft = importBundle(bundle);
  assert.deepEqual(exportBundle(draft), bundle);
  assert.match(JSON.stringify(draft.bundle.report), /Calculated field Net: display only/);
  assert.ok(buildAuthorQuery(draft.sheets[0].visuals[0], draft.calculatedFields));
  assert.equal(buildAuthorQuery(draft.sheets[1].visuals[0], draft.calculatedFields), null);
});

test('editing a rich title exports one valid plain-text title variant and archives the rich original', () => {
  const bundle = fixture(), raw = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual;
  raw.title = { visibility: 'VISIBLE', formatText: { richText: '<b>Original</b>' }, futureStyle: 'retained' };
  let draft = importBundle(bundle);
  draft = change(draft, { type: 'title', title: 'Edited plain title' });
  const resource = exportBundle(draft).members[0].resource;
  assert.deepEqual(resource.definition.sheets[0].visuals[0].barChartVisual.title.formatText, { plainText: 'Edited plain title' });
  assert.equal(resource.definition.sheets[0].visuals[0].barChartVisual.title.futureStyle, 'retained');
  assert.deepEqual(resource.opensightRoundTrip.originalResource.definition.sheets[0].visuals[0].barChartVisual.title, raw.title);
});

test('sheet remap changes only unresolved visuals on the chosen sheet and preserves other resources', () => {
  const draft = importBundle(fixture());
  const remapped = change(draft, { type: 'sheet-remap', id: draft.activeSheetId });
  assert.ok(remapped.sheets[0].visuals.every(v => v.imported.local));
  assert.ok(remapped.sheets.slice(1).every(s => s.visuals.every(v => !v.imported.local)));
  assert.ok(remapped.sheets[0].visuals.every(v => buildAuthorQuery(v)));
  const again = importBundle(exportBundle(remapped));
  assert.ok(again.sheets[0].visuals.every(v => v.imported.local));
  assert.deepEqual(exportBundle(remapped).members.slice(1), fixture().members.slice(1));
});

test('unmodeled nested category filter features are named and block execution without losing editable values', () => {
  const bundle = fixture(), group = categoryGroup();
  group.filters[0].categoryFilter.configuration.filterListConfiguration.futureSelector = { mode: 'UNKNOWN' };
  bundle.members[0].resource.definition.filterGroups = [group];
  let draft = importBundle(bundle);
  assert.match(JSON.stringify(draft.bundle.report), /futureSelector/);
  assert.deepEqual(selected(draft).filters, [{ columnName: 'region', values: ['East'] }]);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  assert.equal(buildAuthorQuery(selected(draft)), null);
  draft = change(draft, { type: 'kind', kind: 'kpi' });
  assert.equal(buildAuthorQuery(selected(draft)), null);
  assert.deepEqual(exportBundle(draft).members[0].resource.definition.filterGroups[0].filters[0].categoryFilter.configuration.filterListConfiguration.futureSelector, { mode: 'UNKNOWN' });
});

test('unresolved filter scopes block the entire resource including newly authored cards', () => {
  const bundle = fixture(), group = categoryGroup();
  group.scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations[0].visualIds = ['missing-visual'];
  bundle.members[0].resource.definition.filterGroups = [group];
  let draft = importBundle(bundle);
  assert.match(JSON.stringify(draft.bundle.report), /unresolved scope/);
  draft = change(draft, { type: 'sheet-remap', id: draft.activeSheetId });
  assert.ok(draft.sheets[0].visuals.every(v => buildAuthorQuery(v) === null));
  draft = change(draft, { type: 'add', kind: 'kpi' });
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  assert.match(html, /Unsupported filter groups: region-filter/);
  assert.deepEqual(exportBundle(draft).members[0].resource.definition.filterGroups, [group]);
});

test('choosing the current visual type does not discard unsupported imported semantics', () => {
  const bundle = fixture();
  bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.values[0].numericalMeasureField.aggregationFunction.simpleNumericalAggregation = 'AVG';
  let draft = importBundle(bundle);
  draft = change(draft, { type: 'kind', kind: 'bar' });
  assert.deepEqual(exportBundle(draft), bundle);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  assert.equal(buildAuthorQuery(selected(draft)), null);
});

test('editing a free-form layout replaces the layout variant and retains the original snapshot', () => {
  const bundle = fixture(), sheet = bundle.members[0].resource.definition.sheets[0];
  sheet.layouts = [{ configuration: { freeFormLayout: { elements: [{ elementId: 'visual-1', futurePosition: 'opaque' }] } } }];
  let draft = importBundle(bundle);
  assert.deepEqual(exportBundle(draft), bundle);
  draft = change(draft, { type: 'layout', sheetId: draft.activeSheetId, layout: draft.sheets[0].layout.map(p => ({ ...p, x: 1 })) });
  const resource = exportBundle(draft).members[0].resource;
  assert.deepEqual(Object.keys(resource.definition.sheets[0].layouts[0].configuration), ['gridLayout']);
  assert.deepEqual(resource.opensightRoundTrip.originalResource.definition.sheets[0].layouts, sheet.layouts);
});

test('successive filter additions after re-import have distinct IDs and preserved values', async () => {
  let draft = change(importBundle(fixture()), { type: 'sheet-remap', id: 'sheet-1' });
  draft = change(draft, { type: 'filter', columnName: 'region', values: ['East'] });
  draft = importBundle(exportBundle(draft));
  draft = change(draft, { type: 'filter', columnName: 'category', values: ['Office'] });
  const exported = await parseQsBundle(await downloadBundleBytes(draft));
  const groups = exported.members[0].resource.definition.filterGroups;
  assert.equal(groups.length, 2);
  assert.equal(new Set(groups.map(g => g.filterGroupId)).size, 2);
  assert.deepEqual(selected(importBundle(exported)).filters, [{ columnName: 'region', values: ['East'] }, { columnName: 'category', values: ['Office'] }]);
});

test('conflicting calculation dependencies block transitive dependents across resources', () => {
  const a = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }));
  a.definition.calculatedFields = [{ dataSetIdentifier: 'sales_data', name: 'Net', expression: '{revenue} - {profit}' }];
  const b = structuredClone(a); b.analysisId = 'second';
  b.definition.calculatedFields = [
    { dataSetIdentifier: 'sales_data', name: 'Net', expression: '{revenue} * 0.5' },
    { dataSetIdentifier: 'sales_data', name: 'DoubleNet', expression: '{Net} * 2' },
  ];
  b.definition.sheets[0].visuals[0].kpiVisual.chartConfiguration.fieldWells.values[0].numericalMeasureField.column.columnName = 'DoubleNet';
  const draft = importBundle({ members: [member(a), member(b)] });
  assert.equal(buildAuthorQuery(draft.sheets[1].visuals[0], draft.calculatedFields), null);
  assert.ok(!draft.calculatedFields.some(c => c.name === 'DoubleNet'));
  assert.match(JSON.stringify(draft.bundle.report), /depends on unsupported calculated field Net/);
});

test('imported dataset dependencies do not inherit the local connection from a coincident example ARN', () => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }));
  const dataset = { resourceType: 'dataset', dataSetId: 'renderable-sales', name: 'Imported protected sales', importMode: 'SPICE', physicalTableMap: {}, rowLevelPermissionDataSet: { arn: 'remote-policy' } };
  const bundle = { members: [member(resource), member(dataset)] };
  let draft = importBundle(bundle);
  assert.equal(buildAuthorQuery(selected(draft)), null);
  assert.match(JSON.stringify(draft.bundle.report), /rowLevelPermissionDataSet/);
  assert.deepEqual(exportBundle(draft), bundle);
  draft = change(draft, { type: 'remap', id: selected(draft).id });
  assert.ok(buildAuthorQuery(selected(draft)));
  const exported = exportBundle(draft);
  assert.equal(exported.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.category[0].categoricalDimensionField.column.dataSetIdentifier, 'opensight_local_sales');
  assert.deepEqual(exported.members[1].resource, dataset);
  assert.ok(buildAuthorQuery(selected(importBundle(exported))));
});

test('local ZIP header checksum disagreement is rejected before member parsing', async () => {
  const packed = Buffer.from(await assembleQsBundle(fixture()));
  packed.writeUInt32LE((packed.readUInt32LE(14) ^ 1) >>> 0, 14);
  await assert.rejects(parseQsBundle(packed), /local\/central CRC32 mismatch/);
});
