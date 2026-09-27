import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  listZipMembers, loadQsBundle, parseQsBundle, parseBundleResource,
  summarizeQsBundle, ValidationError, ZIP_LIMITS,
} from '@opensight/bundle-parser';

const fixture = new URL('../../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs', import.meta.url);
const bytes = readFileSync(fixture);
// An independent ZIP implementation supplies raw member JSON for preservation checks.
const original = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([p, data]) => [p, JSON.parse(new TextDecoder().decode(data))]));
const ids = {
  analysis: '2f99f271-1f84-4a57-9843-31646734d5c9',
  dashboard: 'e0772d4e-bd69-444e-a421-cb3f165dbad8',
  dataset: '2b4bd673-99f3-4d18-a475-ac37d56af357',
  datasource: '8e5eb8e2-7430-4e3a-a4f7-940af71a93f6',
};
const memberPath = type => `${type}/${ids[type]}.json`;
const sample = type => structuredClone(original[memberPath(type)]);
const pack = (members, options) => zipSync(Object.fromEntries(Object.entries(members).map(([p, r]) => [p, strToU8(JSON.stringify(r))])), options);
const normalize = value => JSON.parse(JSON.stringify(value));

test('real fixture provenance checksum and example-only account/ARN hygiene', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'a6188dabf94a60e6413a6caaedebf6659d998d3197c217754250d1cd892bc0c9');
  const text = JSON.stringify(original);
  assert.deepEqual([...new Set(text.match(/\b\d{12}\b/gu))], ['123456789012']);
  const arns = text.match(/arn:[^"\s]+/gu);
  assert.equal(arns.length, 4);
  assert.ok(arns.every(arn => /^arn:aws:quicksight:us-east-2:123456789012:(analysis|dataset|datasource)\//u.test(arn)));
});

test('real ZIP inventory has exactly four members with observed resource types and IDs', async () => {
  const inventory = await listZipMembers(bytes);
  assert.deepEqual(inventory.map(m => m.path), ['dashboard', 'dataset', 'analysis', 'datasource'].map(memberPath));
  assert.deepEqual(inventory.map(m => m.uncompressedSize), [6619, 2405, 5414, 276]);
  assert.ok(inventory.every(m => !m.directory && m.compressedSize > 0));
  const bundle = await loadQsBundle(fixture);
  assert.deepEqual(bundle, await parseQsBundle(new Uint8Array(bytes)));
  const summary = summarizeQsBundle(bundle);
  assert.equal(summary.memberCount, 4);
  assert.deepEqual(summary.resourceCounts, { analysis: 1, dashboard: 1, dataset: 1, datasource: 1 });
  assert.deepEqual(Object.fromEntries(summary.members.map(m => [m.resourceType, m.id])), ids);
});

test('real analysis contains one camelCase sheet/pie with country and SUM(deaths) wells', async () => {
  const bundle = await loadQsBundle(fixture);
  const analysis = bundle.members.find(m => m.resource.resourceType === 'analysis').resource;
  assert.equal(analysis.name, 'Death By Countries');
  const def = analysis.definition;
  assert.deepEqual(def.dataSetIdentifierDeclarations, [{ identifier: 'us_simplified', dataSetArn: `arn:aws:quicksight:us-east-2:123456789012:dataset/${ids.dataset}` }]);
  assert.equal(def.sheets.length, 1);
  const sheet = def.sheets[0];
  assert.equal(sheet.sheetId, '9d289c46-2931-44ac-a4d1-ad28e3ad3d81');
  assert.equal(sheet.name, 'Sheet 1');
  assert.equal(sheet.visuals.length, 1);
  assert.deepEqual(Object.keys(sheet.visuals[0]), ['pieChartVisual']);
  const pie = sheet.visuals[0].pieChartVisual;
  assert.equal(pie.visualId, '371234b0-070d-4c97-8b7e-7aac3c8d8d68');
  const wells = pie.chartConfiguration.fieldWells.pieChartAggregatedFieldWells;
  assert.equal(wells.category.length, 1);
  assert.deepEqual(wells.category[0].categoricalDimensionField.column, { dataSetIdentifier: 'us_simplified', columnName: 'country' });
  assert.equal(wells.values.length, 1);
  assert.deepEqual(wells.values[0].numericalMeasureField.column, { dataSetIdentifier: 'us_simplified', columnName: 'deaths' });
  assert.equal(wells.values[0].numericalMeasureField.aggregationFunction.simpleNumericalAggregation, 'SUM');
  assert.equal(sheet.layouts[0].configuration.gridLayout.elements[0].elementId, pie.visualId);
  assert.deepEqual(analysis.validationStrategy, { mode: 'LENIENT' });
  assert.deepEqual([def.calculatedFields, def.parameterDeclarations, def.filterGroups], [[], [], []]);
  assert.equal(Object.hasOwn(def, 'Sheets'), false);
});

test('real dashboard/dataset/source dependency references and unmodeled data-prep graph survive', async () => {
  const resources = Object.fromEntries((await parseQsBundle(bytes)).members.map(m => [m.resource.resourceType, m.resource]));
  assert.deepEqual(resources.dashboard.linkEntities, [`arn:aws:quicksight:us-east-2:123456789012:analysis/${ids.analysis}`]);
  const dashboardSheet = resources.dashboard.definition.sheets[0];
  assert.equal(dashboardSheet.sheetId, `${ids.dashboard}_${resources.analysis.definition.sheets[0].sheetId}`);
  assert.equal(dashboardSheet.visuals[0].pieChartVisual.visualId, `${ids.dashboard}_${resources.analysis.definition.sheets[0].visuals[0].pieChartVisual.visualId}`);
  assert.equal(Object.hasOwn(resources.dashboard.definition, 'queryExecutionOptions'), false);
  assert.equal(resources.analysis.definition.queryExecutionOptions.queryExecutionMode, 'AUTO');
  assert.equal(resources.dataset.importMode, 'SPICE');
  const table = Object.values(resources.dataset.physicalTableMap)[0].relationalTable;
  assert.equal(table.dataSourceArn, `arn:aws:quicksight:us-east-2:123456789012:datasource/${ids.datasource}`);
  assert.equal(table.inputColumns.length, 6);
  assert.deepEqual(resources.dataset.dataPrepConfiguration, sample('dataset').dataPrepConfiguration);
  assert.deepEqual(resources.dataset.semanticModelConfiguration, sample('dataset').semanticModelConfiguration);
  assert.equal(resources.datasource.type, 'ATHENA');
  assert.equal(resources.datasource.dataSourceParameters.athenaParameters.workGroup, 'primary');
  assert.equal(resources.datasource.sslProperties.disableSsl, false);
});

test('all real members survive structural JSON serialization and ZIP repacking unchanged', async () => {
  const bundle = await parseQsBundle(bytes);
  const json = Object.fromEntries(bundle.members.map(m => [m.path, normalize(m.resource)]));
  assert.deepEqual(json, original);
  for (const level of [0, 6]) assert.deepEqual(await parseQsBundle(pack(json, { level })), bundle);
});

test('unobserved properties, variants and feature arrays survive without casing conversion', async () => {
  const raw = sample('analysis');
  raw.futureEnvelope = { PascalKey: [null, true] };
  raw.definition.calculatedFields = [{ dataSetIdentifier: 'us_simplified', name: 'future', expression: '{deaths}', futureCalculation: { preserve: true } }];
  raw.definition.parameterDeclarations = [{ futureParameterDeclaration: { preserve: true } }];
  raw.definition.filterGroups = [{ filterGroupId: 'future', crossDataset: 'SINGLE_DATASET',
    scopeConfiguration: { allSheets: {} }, filters: [{ futureFilter: { preserve: true } }],
  }];
  raw.definition.sheets[0].visuals.push({ futureVisual: { visualId: 'future', opaque: [null, 7] } });
  const wells = raw.definition.sheets[0].visuals[0].pieChartVisual.chartConfiguration.fieldWells.pieChartAggregatedFieldWells;
  wells.category.push({ futureDimension: { arbitrary: true } });
  wells.values[0].numericalMeasureField.futureMeasureProperty = { keep: true };
  const before = structuredClone(raw);
  assert.equal(parseBundleResource(raw), raw);
  const bundle = await parseQsBundle(pack({ [memberPath('analysis')]: raw }));
  assert.deepEqual(bundle.members[0].resource, before);
  const summary = summarizeQsBundle(bundle).members[0].definition;
  assert.equal(summary.visuals[1].kind, 'futureVisual');
  assert.equal(summary.calculatedFieldCount, 1);
  assert.equal(summary.parameterCount, 1);
  assert.equal(summary.filterGroupCount, 1);
  assert.equal(summary.parameters[0].supported, false);
  assert.equal(summary.filterGroups[0].filters[0].supported, false);
  assert.deepEqual(raw, before);
});

test('absent optional fields are not inserted or changed into empty arrays', async () => {
  const raw = { resourceType: 'analysis', analysisId: 'a', name: 'A', definition: { dataSetIdentifierDeclarations: [] } };
  const bundle = await parseQsBundle(pack({ 'analysis/a.json': raw }));
  assert.deepEqual(bundle.members[0].resource, raw);
  assert.deepEqual(summarizeQsBundle(bundle).members[0].definition, { dataSets: [], sheets: [], visuals: [], calculatedFields: [], parameters: [], filterGroups: [], calculatedFieldCount: 0, parameterCount: 0, filterGroupCount: 0, filterCount: 0 });
});

const piePath = ['definition', 'sheets', 0, 'visuals', 0, 'pieChartVisual'];
const wellsPath = [...piePath, 'chartConfiguration', 'fieldWells', 'pieChartAggregatedFieldWells'];
const tablePath = ['physicalTableMap', '842f915f-0624-41d3-9d2b-117a0622cfcf', 'relationalTable'];
const mutations = [
  ['analysis', ['resourceType'], 'Analysis'], ['analysis', ['analysisId'], 7],
  ['analysis', ['name'], null], ['analysis', ['definition'], []],
  ['analysis', ['definition', 'dataSetIdentifierDeclarations'], {}],
  ['analysis', ['definition', 'dataSetIdentifierDeclarations', 0, 'identifier'], ''],
  ['analysis', ['definition', 'dataSetIdentifierDeclarations', 0, 'dataSetArn'], false],
  ['analysis', ['definition', 'sheets'], {}],
  ['analysis', ['definition', 'sheets', 0, 'sheetId'], undefined],
  ['analysis', ['definition', 'sheets', 0, 'name'], 4],
  ['analysis', ['definition', 'sheets', 0, 'visuals', 0], {}],
  ['analysis', ['definition', 'sheets', 0, 'visuals', 0], { pieChartVisual: {}, futureVisual: {} }],
  ['analysis', [...piePath, 'visualId'], undefined],
  ['analysis', [...piePath, 'title', 'visibility'], false],
  ['analysis', [...piePath, 'subtitle'], null],
  ['analysis', [...piePath, 'actions'], {}],
  ['analysis', [...piePath, 'chartConfiguration'], []],
  ['analysis', [...piePath, 'chartConfiguration', 'fieldWells'], {}],
  ['analysis', [...wellsPath, 'category'], {}],
  ['analysis', [...wellsPath, 'category', 0, 'categoricalDimensionField', 'column', 'columnName'], null],
  ['analysis', [...wellsPath, 'values', 0, 'numericalMeasureField', 'fieldId'], undefined],
  ['analysis', [...wellsPath, 'values', 0, 'numericalMeasureField', 'aggregationFunction', 'simpleNumericalAggregation'], 2],
  ['analysis', ['definition', 'sheets', 0, 'layouts', 0], null],
  ['analysis', ['definition', 'calculatedFields'], {}],
  ['analysis', ['definition', 'parameterDeclarations'], false],
  ['analysis', ['definition', 'filterGroups'], null],
  ['analysis', ['definition', 'options'], []],
  ['analysis', ['validationStrategy', 'mode'], undefined],
  ['dashboard', ['dashboardId'], undefined], ['dashboard', ['linkEntities', 0], false],
  ['dashboard', ['dashboardPublishOptions'], []],
  ['dataset', ['dataSetId'], undefined], ['dataset', ['importMode'], 7],
  ['dataset', ['physicalTableMap'], []],
  ['dataset', [...tablePath, 'dataSourceArn'], undefined],
  ['dataset', [...tablePath, 'inputColumns', 0, 'name'], 7],
  ['dataset', [...tablePath, 'inputColumns', 0, 'id'], false],
  ['dataset', [...tablePath, 'inputColumns', 0, 'type'], null],
  ['dataset', ['dataPrepConfiguration'], []],
  ['datasource', ['dataSourceId'], undefined], ['datasource', ['type'], 7],
  ['datasource', ['dataSourceParameters', 'athenaParameters', 'workGroup'], false],
  ['datasource', ['sslProperties', 'disableSsl'], 'false'],
];
for (const [type, keys, replacement] of mutations) {
  test(`bundle validation locates ${type}.${keys.join('.')}`, async () => {
    const raw = sample(type);
    const parent = keys.slice(0, -1).reduce((v, k) => v[k], raw);
    if (replacement === undefined) delete parent[keys.at(-1)];
    else parent[keys.at(-1)] = replacement;
    const propertyPath = keys.map(k => typeof k === 'number' ? `[${k}]` : k.includes('-') ? `[${JSON.stringify(k)}]` : `.${k}`).join('');
    assert.throws(() => parseBundleResource(raw), { name: 'ValidationError', path: `$${propertyPath}` });
    await assert.rejects(parseQsBundle(pack({ [memberPath(type)]: raw })), error => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.path, `$[${JSON.stringify(memberPath(type))}]${propertyPath}`);
      return true;
    });
  });
}

test('PascalCase synthetic/API envelopes are not accepted as real bundle members', () => {
  for (const raw of [null, [], { ResourceType: 'Analysis', AnalysisId: 'a', Name: 'A', Definition: { DataSetIdentifierDeclarations: [] } }, { AnalysisId: 'a', Definition: {} }]) {
    assert.throws(() => parseBundleResource(raw), ValidationError);
  }
});

test('path/envelope mismatches and unsupported members fail instead of disappearing', async () => {
  const raw = sample('analysis');
  await assert.rejects(parseQsBundle(pack({ [`dashboard/${ids.analysis}.json`]: raw })), /does not match member directory/u);
  await assert.rejects(parseQsBundle(pack({ 'analysis/wrong.json': raw })), /resource ID does not match/u);
  for (const path of ['theme/future.json', 'manifest.json', 'analysis/nested/a.json', 'analysis/a.txt']) {
    await assert.rejects(parseQsBundle(pack({ [path]: raw })), /unsupported bundle member path/u);
  }
});

test('directory entries are listed but do not become resources', async () => {
  const archive = zipSync({ 'analysis/': new Uint8Array(), [memberPath('analysis')]: strToU8(JSON.stringify(sample('analysis'))) });
  assert.equal((await listZipMembers(archive))[0].directory, true);
  assert.equal((await parseQsBundle(archive)).members.length, 1);
  await assert.rejects(parseQsBundle(zipSync({})), /no resource members/u);
  await assert.rejects(parseQsBundle(zipSync({ 'analysis/': new Uint8Array() })), /no resource members/u);
});

test('invalid UTF-8 and malformed JSON errors identify the member', async () => {
  for (const data of [strToU8('{bad'), new Uint8Array([0xff, 0xfe])]) {
    await assert.rejects(parseQsBundle(zipSync({ 'analysis/a.json': data })), { name: 'ValidationError', path: '$["analysis/a.json"]' });
  }
});

test('ZIP corruption, unsafe names and duplicate paths are rejected', async () => {
  for (const archive of [strToU8('not a zip'), bytes.subarray(0, bytes.length - 15)]) {
    await assert.rejects(parseQsBundle(archive), /invalid ZIP/u);
  }
  for (const path of ['../analysis/a.json', '/analysis/a.json', 'analysis\\a.json', './analysis/a.json', 'analysis//a.json', 'analysis/\0a.json']) {
    await assert.rejects(parseQsBundle(pack({ [path]: sample('analysis') })), ValidationError);
  }
  const duplicate = Buffer.from(pack({ 'analysis/a.json': { ...sample('analysis'), analysisId: 'a' }, 'analysis/b.json': { ...sample('analysis'), analysisId: 'b' } }));
  for (let offset = duplicate.indexOf('analysis/b.json'); offset !== -1; offset = duplicate.indexOf('analysis/b.json')) {
    duplicate.write('analysis/a.json', offset);
  }
  await assert.rejects(parseQsBundle(duplicate), /duplicate ZIP member path/u);
});

test('ZIP reader rejects CRC mismatches, encryption, unsupported compression and size budgets', async () => {
  const originalZip = Buffer.from(pack({ [memberPath('analysis')]: sample('analysis') }));
  const central = originalZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0);
  const mutations = [
    [16, 4, 0, /CRC32 mismatch/u],
    [8, 2, 1, /encrypted ZIP/u],
    [10, 2, 99, /unsupported ZIP compression/u],
    [24, 4, ZIP_LIMITS.memberBytes + 1, /member byte limit/u],
    [24, 4, 1, /invalid ZIP/u],
  ];
  for (const [offset, width, value, message] of mutations) {
    const data = Buffer.from(originalZip);
    data.writeUIntLE(value, central + offset, width);
    await assert.rejects(parseQsBundle(data), message);
  }
  await assert.rejects(parseQsBundle(new Uint8Array(ZIP_LIMITS.archiveBytes + 1)), /archive byte limit/u);
  const many = zipSync(Object.fromEntries(Array.from({ length: ZIP_LIMITS.members + 1 }, (_, i) => [`${i}/`, new Uint8Array()])));
  await assert.rejects(listZipMembers(many), /member count limit/u);
});

test('summary and CLI match the independently derived real fixture inventory', async t => {
  const expected = readFileSync(new URL('../../../fixtures/real-bundle-sample/summary.json', import.meta.url), 'utf8');
  assert.deepEqual(normalize(summarizeQsBundle(await loadQsBundle(fixture))), JSON.parse(expected));
  const dir = mkdtempSync(join(tmpdir(), 'opensight-qs-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'output.txt');
  const fd = openSync(outputPath, 'w');
  try {
    const cli = fileURLToPath(new URL('../dist/summarize.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, fileURLToPath(fixture)], { stdio: ['ignore', fd, fd] });
    assert.ifError(result.error);
    assert.equal(result.status, 0, readFileSync(outputPath, 'utf8'));
    assert.equal(readFileSync(outputPath, 'utf8'), expected);
  } finally { closeSync(fd); }
});

test('archive summary revalidates JavaScript callers', async () => {
  const bundle = await parseQsBundle(bytes);
  bundle.members.find(m => m.resource.resourceType === 'analysis').resource.definition.sheets = {};
  assert.throws(() => summarizeQsBundle(bundle), ValidationError);
});
