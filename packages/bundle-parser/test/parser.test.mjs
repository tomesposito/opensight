import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadBundle, loadSyntheticAnalysis, parseSyntheticAnalysis, summarizeBundle, ValidationError } from '@opensight/bundle-parser';

const fixture = new URL('../../../fixtures/sample-sales-analysis.json', import.meta.url);
const sample = () => JSON.parse(readFileSync(fixture, 'utf8'));
const minimal = () => ({ ResourceType: 'Analysis', AnalysisId: 'empty', Name: 'Empty', Definition: { DataSetIdentifierDeclarations: [] } });
const normalized = (value) => JSON.parse(JSON.stringify(value));

function setPath(value, path, replacement) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((object, key) => object[key], value);
  if (replacement === undefined) delete parent[last];
  else parent[last] = replacement;
}

const mutations = [
  ['ResourceType', 'Dashboard'], ['AnalysisId', 7], ['Name', null], ['Definition', []],
  ['Definition.DataSetIdentifierDeclarations', {}],
  ['Definition.DataSetIdentifierDeclarations.0', null],
  ['Definition.DataSetIdentifierDeclarations.0.Identifier', undefined],
  ['Definition.DataSetIdentifierDeclarations.0.DataSetArn', false],
  ['Definition.Sheets', {}], ['Definition.Sheets.0', null],
  ['Definition.Sheets.0.SheetId', undefined], ['Definition.Sheets.0.Name', 9],
  ['Definition.Sheets.0.Visuals', {}], ['Definition.Sheets.0.Visuals.0', {}],
  ['Definition.Sheets.0.Visuals.0', { BarChartVisual: {}, KPIVisual: {} }],
  ['Definition.Sheets.0.Visuals.0.KPIVisual', null],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.VisualId', undefined],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.Title', []],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.Title.Visibility', 'MAYBE'],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.Title.FormatText', null],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.Title.FormatText.PlainText', 4],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.Title.FormatText.RichText', {}],
  ['Definition.Sheets.0.Visuals.0.KPIVisual.Subtitle', 4],
  ['Definition.CalculatedFields', {}], ['Definition.CalculatedFields.0', null],
  ['Definition.CalculatedFields.0.DataSetIdentifier', undefined],
  ['Definition.CalculatedFields.0.Name', false], ['Definition.CalculatedFields.0.Expression', []],
  ['Definition.ParameterDeclarations', {}], ['Definition.ParameterDeclarations.0', null],
  ['Definition.ParameterDeclarations.0', {}],
  ['Definition.ParameterDeclarations.0', { StringParameterDeclaration: { Name: 's', ParameterValueType: 'SINGLE_VALUED' }, IntegerParameterDeclaration: { Name: 'i', ParameterValueType: 'SINGLE_VALUED' } }],
  ['Definition.ParameterDeclarations.0.StringParameterDeclaration', []],
  ['Definition.ParameterDeclarations.0.StringParameterDeclaration.Name', undefined],
  ['Definition.ParameterDeclarations.0.StringParameterDeclaration.ParameterValueType', undefined],
  ['Definition.ParameterDeclarations.0.StringParameterDeclaration.ParameterValueType', 'ANY'],
  ['Definition.FilterGroups', {}], ['Definition.FilterGroups.0', null],
  ['Definition.FilterGroups.0.FilterGroupId', undefined],
  ['Definition.FilterGroups.0.CrossDataset', undefined],
  ['Definition.FilterGroups.0.CrossDataset', 'ANY'],
  ['Definition.FilterGroups.0.Filters', undefined], ['Definition.FilterGroups.0.Filters.0', {}],
  ['Definition.FilterGroups.0.Filters.0.CategoryFilter.Column', null],
  ['Definition.FilterGroups.0.Filters.0.CategoryFilter.Column.ColumnName', false],
  ['Definition.FilterGroups.0.Filters.0.CategoryFilter.Configuration', undefined],
  ['Definition.FilterGroups.0.Filters.0.CategoryFilter.Configuration.CustomFilterConfiguration.ParameterName', []],
  ['Definition.FilterGroups.0.ScopeConfiguration', undefined],
  ['Definition.FilterGroups.0.ScopeConfiguration.SelectedSheets.SheetVisualScopingConfigurations.0.Scope', 'ANY'],
  ['Definition.FilterGroups.0.Status', 'MAYBE'],
];

for (const [path, value] of mutations) {
  test(`rejects invalid ${path} = ${JSON.stringify(value)}`, () => {
    const raw = sample();
    setPath(raw, path, value);
    const jsonPath = `$.${path.replace(/\.(\d+)(?=\.|$)/g, '[$1]')}`;
    assert.throws(() => parseSyntheticAnalysis(raw), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.path === jsonPath || error.path.startsWith(`${jsonPath}.`), error.message);
      assert.ok(error.message.startsWith(`${error.path}:`));
      return true;
    });
  });
}

for (const raw of [null, [], 'analysis', 1]) {
  test(`rejects non-object root ${JSON.stringify(raw)}`, () => {
    assert.throws(() => parseSyntheticAnalysis(raw), { name: 'ValidationError', path: '$' });
  });
}

test('public package entry loads the expected inventory', () => {
  assert.equal(loadBundle, loadSyntheticAnalysis);
  const summary = summarizeBundle(loadBundle(fileURLToPath(fixture)));
  const expected = JSON.parse(readFileSync(new URL('../../../fixtures/sample-sales-analysis.summary.json', import.meta.url), 'utf8'));
  assert.deepEqual(normalized(summary), expected);
});

test('omitted optional fields are accepted and not inserted', () => {
  const raw = minimal();
  const before = structuredClone(raw);
  assert.equal(parseSyntheticAnalysis(raw), raw);
  assert.deepEqual(summarizeBundle(raw), { analysisId: 'empty', name: 'Empty', dataSets: [], sheets: [], visuals: [], calculatedFields: [], parameters: [], filterGroups: [] });
  assert.deepEqual(raw, before);
  raw.Definition.Sheets = [{ SheetId: 'empty-sheet' }];
  assert.deepEqual(summarizeBundle(raw).sheets, [{ sheetId: 'empty-sheet', name: undefined, visualCount: 0 }]);
});

test('all recognized parameter variants have explicit names and requirements', () => {
  const raw = minimal();
  raw.Definition.ParameterDeclarations = [
    { StringParameterDeclaration: { Name: 'string', ParameterValueType: 'MULTI_VALUED' } },
    { IntegerParameterDeclaration: { Name: 'integer', ParameterValueType: 'SINGLE_VALUED' } },
    { DecimalParameterDeclaration: { Name: 'decimal', ParameterValueType: 'SINGLE_VALUED' } },
    { DateTimeParameterDeclaration: { Name: 'date', TimeGranularity: 'DAY' } },
    { DateTimeParameterDeclaration: { Name: 'dateWithoutGranularity' } },
  ];
  assert.deepEqual(summarizeBundle(raw).parameters, ['string', 'integer', 'decimal', 'date', 'dateWithoutGranularity']);
  for (const kind of ['IntegerParameterDeclaration', 'DecimalParameterDeclaration']) {
    raw.Definition.ParameterDeclarations = [{ [kind]: { Name: 'missingValueType' } }];
    assert.throws(() => parseSyntheticAnalysis(raw), { path: `$.Definition.ParameterDeclarations[0].${kind}.ParameterValueType` });
  }
  for (const [body, property] of [[{}, 'Name'], [{ Name: 'date', TimeGranularity: 'FORTNIGHT' }, 'TimeGranularity']]) {
    raw.Definition.ParameterDeclarations = [{ DateTimeParameterDeclaration: body }];
    assert.throws(() => parseSyntheticAnalysis(raw), { path: `$.Definition.ParameterDeclarations[0].DateTimeParameterDeclaration.${property}` });
  }
  raw.Definition.ParameterDeclarations = [{ BooleanParameterDeclaration: { Name: 'future' } }];
  assert.throws(() => parseSyntheticAnalysis(raw), /unsupported parameter variant/);
});

test('rich-text title and its format survive summarization without rendering markup', () => {
  const raw = sample();
  const rich = '<visual-title><b>Revenue &amp; Profit</b></visual-title>';
  const body = raw.Definition.Sheets[0].Visuals[0].KPIVisual;
  body.Title.FormatText = { RichText: rich };
  const summary = summarizeBundle(parseSyntheticAnalysis(raw));
  assert.equal(summary.visuals[0].title, rich);
  assert.equal(summary.visuals[0].titleFormat, 'rich');
  assert.equal(body.Title.FormatText.RichText, rich);
  delete body.Title;
  assert.equal(summarizeBundle(raw).visuals[0].title, undefined);
  assert.equal(summarizeBundle(raw).visuals[0].titleFormat, undefined);
});

test('unknown properties and visual kinds survive a structural JSON round trip', () => {
  const raw = sample();
  raw.Future = { nested: [null, { keep: true }] };
  raw.Definition.Options = { unknown: 'preserved' };
  raw.Definition.Sheets[0].Visuals.push({ FutureVisual: { VisualId: 'future', Config: { preserve: [1, 2] } } });
  raw.Definition.ParameterDeclarations[0].StringParameterDeclaration.FutureOption = { keep: true };
  const before = structuredClone(raw);
  const loaded = parseSyntheticAnalysis(raw);
  assert.equal(summarizeBundle(loaded).visuals.find((visual) => visual.visualId === 'future').kind, 'FutureVisual');
  assert.deepEqual(normalized(loaded), before);
});

test('loadBundle validates file contents, and malformed JSON fails', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'opensight-parser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'input.json');
  writeFileSync(file, '{bad');
  assert.throws(() => loadBundle(file), SyntaxError);
  writeFileSync(file, JSON.stringify({ ...minimal(), Definition: { DataSetIdentifierDeclarations: [{}] } }));
  assert.throws(() => loadBundle(file), { path: '$.Definition.DataSetIdentifierDeclarations[0].Identifier' });
  assert.throws(() => loadBundle(join(dir, 'missing.json')), { code: 'ENOENT' });
});

test('API definition responses are not synthetic documents', () => {
  const response = sample();
  delete response.ResourceType;
  response.RequestId = 'synthetic-api-request';
  assert.throws(() => parseSyntheticAnalysis(response), { path: '$.ResourceType' });
});

test('CLI summary matches the checked-in sample and requires a path', (t) => {
  const cli = fileURLToPath(new URL('../dist/summarize.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'opensight-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function run(args) {
    const file = join(dir, 'output.txt');
    const output = openSync(file, 'w');
    try {
      // File descriptors also work in sandboxes that restrict child-process pipes.
      const result = spawnSync(process.execPath, [cli, ...args], { stdio: ['ignore', output, output] });
      assert.ifError(result.error);
      return { status: result.status, text: readFileSync(file, 'utf8') };
    } finally { closeSync(output); }
  }
  const result = run([fileURLToPath(fixture)]);
  assert.equal(result.status, 0, result.text);
  assert.equal(result.text, readFileSync(new URL('../../../fixtures/sample-sales-analysis.summary.txt', import.meta.url), 'utf8'));
  const missing = run([]);
  assert.equal(missing.status, 1);
  assert.match(missing.text, /Usage:/);
});

test('summarizeBundle revalidates JavaScript callers at the public boundary', () => {
  const raw = sample();
  raw.Definition.CalculatedFields = {};
  assert.throws(() => summarizeBundle(raw), { name: 'ValidationError', path: '$.Definition.CalculatedFields' });
});

test('filter configuration values and unions are validated without discarding opaque variants', () => {
  const raw = sample();
  const filter = raw.Definition.FilterGroups[0].Filters[0].CategoryFilter;
  const custom = filter.Configuration.CustomFilterConfiguration;
  custom.CategoryValue = 'East';
  assert.throws(() => parseSyntheticAnalysis(raw), /mutually exclusive/);
  delete custom.CategoryValue;
  filter.Configuration = {};
  assert.throws(() => parseSyntheticAnalysis(raw), /exactly one variant/);
  filter.Configuration = { FilterListConfiguration: { MatchOperator: 'EQUALS', CategoryValues: [7] } };
  assert.throws(() => parseSyntheticAnalysis(raw), /CategoryValues\[0\]/);
  filter.Configuration = { FilterListConfiguration: { MatchOperator: 'EQUALS', CategoryValues: ['East'], NullOption: 'MAYBE' } };
  assert.throws(() => parseSyntheticAnalysis(raw), /NullOption/);
  raw.Definition.FilterGroups[0].Filters = [{ FutureFilter: { opaque: [1, 2] } }];
  const before = structuredClone(raw);
  parseSyntheticAnalysis(raw);
  assert.deepEqual(raw, before);
});
