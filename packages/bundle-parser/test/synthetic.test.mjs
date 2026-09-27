import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseBundleResource, parseQsBundle, summarizeQsBundle, ValidationError } from '@opensight/bundle-parser';

const root = new URL('./fixtures/synthetic/', import.meta.url);
const fixtures = [
  { path: 'dashboard/automotive.json', sheets: [21, 16], parameters: 0, groups: 0, filters: 0, calcs: 1,
    kinds: { kpiVisual: 29, pieChartVisual: 3, lineChartVisual: 2, tableVisual: 1, comboChartVisual: 1, scatterPlotVisual: 1 } },
  { path: 'analysis/assets-as-code.json', sheets: [5, 2], parameters: 2, groups: 2, filters: 2, calcs: 1,
    kinds: { barChartVisual: 3, lineChartVisual: 2, tableVisual: 1, kpiVisual: 1 } },
  { path: 'analysis/orders-overview.json', sheets: [5], parameters: 0, groups: 0, filters: 0, calcs: 2,
    kinds: { kpiVisual: 2, barChartVisual: 1, lineChartVisual: 1, pieChartVisual: 1 } },
  { path: 'analysis/feature-variants.json', sheets: [5], parameters: 4, groups: 1, filters: 3, calcs: 3,
    kinds: { kpiVisual: 2, barChartVisual: 1, lineChartVisual: 1, pieChartVisual: 1 } },
];
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const pack = (path, resource) => zipSync({ [path]: strToU8(JSON.stringify(resource)) });
const summarize = (path, resource) => summarizeQsBundle({ members: [{ path, resource }] }).members[0].definition;
const featurePath = 'analysis/feature-variants.json';
const extended = () => read(featurePath);

test('every committed synthetic JSON member is covered and contains only sanitized camelCase structure', () => {
  const paths = ['analysis', 'dashboard'].flatMap(dir => readdirSync(new URL(`${dir}/`, root)).map(file => `${dir}/${file}`));
  assert.deepEqual(paths.sort(), fixtures.map(f => f.path).sort());
  const walk = value => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      assert.match(key, /^[a-z]/u, `unconverted key ${key}`);
      walk(child);
    }
  };
  for (const { path } of fixtures) {
    const raw = read(path);
    walk(raw);
    const text = JSON.stringify(raw);
    assert.deepEqual([...new Set(text.match(/(?<!\d)\d{12}(?!\d)/gu))], ['123456789012']);
    assert.ok(text.match(/arn:[^"\s]+/gu).every(arn => /^arn:aws:quicksight:us-east-1:123456789012:dataset\/[\w-]+$/u.test(arn)));
    assert.doesNotMatch(text, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|edu|gov|internal|local)\b/u);
  }
});

for (const fixture of fixtures) test(`${fixture.path}: archive round trip and independently counted inventory`, async () => {
  const raw = read(fixture.path);
  const before = structuredClone(raw);
  assert.equal(parseBundleResource(raw), raw);
  const bundle = await parseQsBundle(pack(fixture.path, raw));
  assert.deepEqual(bundle.members, [{ path: fixture.path, resource: raw }]);
  const summary = summarizeQsBundle(bundle).members[0].definition;
  assert.deepEqual(summary.sheets.map(s => s.visualCount), fixture.sheets);
  assert.equal(summary.visuals.length, fixture.sheets.reduce((a, b) => a + b, 0));
  assert.deepEqual(summary.visuals.reduce((counts, v) => ({ ...counts, [v.kind]: (counts[v.kind] ?? 0) + 1 }), {}), fixture.kinds);
  assert.equal(summary.parameterCount, fixture.parameters);
  assert.equal(summary.parameters.length, fixture.parameters);
  assert.equal(summary.filterGroupCount, fixture.groups);
  assert.equal(summary.filterGroups.length, fixture.groups);
  assert.equal(summary.filterCount, fixture.filters);
  assert.equal(summary.calculatedFieldCount, fixture.calcs);
  assert.equal(summary.calculatedFields.length, fixture.calcs);
  assert.deepEqual(summary.calculatedFields.map(c => c.expression), raw.definition.calculatedFields.map(c => c.expression));
  assert.deepEqual(summary.parameters.map(p => p.configuration), raw.definition.parameterDeclarations.map(p => Object.values(p)[0]));
  assert.deepEqual(summary.filterGroups.flatMap(g => g.filters.map(f => f.configuration)), raw.definition.filterGroups.flatMap(g => g.filters.map(f => Object.values(f)[0])));
  assert.ok(summary.parameters.every(p => p.supported && typeof p.name === 'string'));
  assert.ok(summary.filterGroups.every(g => g.filters.every(f => f.supported && f.column && f.filterId)));
  assert.deepEqual(raw, before);
});

test('parameter defaults, filter scopes and variant configurations are extracted intact', () => {
  const summary = summarize(featurePath, extended());
  assert.deepEqual(summary.parameters.map(p => [p.kind, p.name, p.configuration.defaultValues.staticValues]), [
    ['stringParameterDeclaration', 'Region', ['East', 'West']],
    ['dateTimeParameterDeclaration', 'AsOf', ['2025-01-01T00:00:00Z']],
    ['integerParameterDeclaration', 'Periods', [12]],
    ['decimalParameterDeclaration', 'MinimumRevenue', [100.5]],
  ]);
  const group = summary.filterGroups[0];
  assert.equal(group.scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations[0].visualIds.length, 5);
  assert.deepEqual(group.filters.map(f => f.kind), ['categoryFilter', 'numericRangeFilter', 'relativeDatesFilter']);
  assert.deepEqual(group.filters[1].configuration.rangeMinimum, { parameter: 'MinimumRevenue' });
  assert.deepEqual(group.filters[2].configuration.anchorDateConfiguration, { anchorOption: 'PARAMETER', parameterName: 'AsOf' });
  const source = summarize('analysis/assets-as-code.json', read('analysis/assets-as-code.json'));
  assert.equal(source.filterGroups[0].filters[0].configuration.configuration.filterListConfiguration.categoryValues.length, 5);
  assert.equal(source.filterGroups[1].filters[0].kind, 'timeRangeFilter');
});

test('calculation dependencies distinguish same-dataset calculations, columns and parameters', () => {
  const raw = extended();
  let fields = summarize(featurePath, raw).calculatedFields;
  assert.deepEqual(fields[0].dependencies, { columns: ['NET_PROFIT', 'NET_REVENUE'], calculatedFields: [], parameters: [] });
  assert.deepEqual(fields[2].dependencies, { columns: ['NET_REVENUE'], calculatedFields: ['Profit Margin'], parameters: ['MinimumRevenue'] });
  raw.definition.calculatedFields.push({ dataSetIdentifier: 'another-dataset', name: 'Elsewhere', expression: '{Profit Margin}' });
  fields = summarize(featurePath, raw).calculatedFields;
  assert.deepEqual(fields.at(-1).dependencies, { columns: ['Profit Margin'], calculatedFields: [], parameters: [] });
  const expression = String.raw`ifelse({Profit Margin} > 0, '{literal} '' {also literal}', "${'${ignored}'}", {NET_REVENUE} + {NET_REVENUE} + ${'${MinimumRevenue}'}) /* {comment} */ // ${'${comment}'}
    + {NET_PROFIT} + 'it\'s {quoted}'`;
  raw.definition.calculatedFields[2].expression = expression;
  fields = summarize(featurePath, raw).calculatedFields;
  assert.equal(fields[2].expression, expression);
  assert.deepEqual(fields[2].dependencies, { columns: ['NET_REVENUE', 'NET_PROFIT'], calculatedFields: ['Profit Margin'], parameters: ['MinimumRevenue'] });
});

test('supported filter variants include static and parameter ranges, list selectors, relative dates and null-only bounds', () => {
  for (const change of [
    d => { d.filterGroups[0].scopeConfiguration = { allSheets: {} }; },
    d => { d.filterGroups[0].filters[0].categoryFilter.configuration = { customFilterListConfiguration: { matchOperator: 'DOES_NOT_EQUAL', categoryValues: ['West'], nullOption: 'ALL_VALUES' } }; },
    d => { d.filterGroups[0].filters[0].categoryFilter.configuration = { customFilterConfiguration: { matchOperator: 'EQUALS', categoryValue: 'East', nullOption: 'ALL_VALUES' } }; },
    d => { d.filterGroups[0].filters[1].numericRangeFilter.rangeMinimum = { staticValue: 0 }; },
    d => { const f = d.filterGroups[0].filters[1].numericRangeFilter; delete f.rangeMinimum; delete f.rangeMaximum; f.nullOption = 'NULLS_ONLY'; },
    d => { const f = d.filterGroups[0].filters[2].relativeDatesFilter; delete f.parameterName; f.relativeDateValue = 3; f.anchorDateConfiguration = { anchorOption: 'NOW' }; },
    d => { const f = d.filterGroups[0].filters[2].relativeDatesFilter; delete f.parameterName; f.relativeDateType = 'THIS'; },
  ]) {
    const raw = extended(); change(raw.definition);
    assert.equal(summarize(featurePath, raw).filterCount, 3);
  }
});

const mutations = [
  ['parameter null', d => { d.parameterDeclarations[0] = null; }],
  ['ambiguous parameter', d => { Object.assign(d.parameterDeclarations[0], d.parameterDeclarations[1]); }],
  ['missing name', d => { delete d.parameterDeclarations[0].stringParameterDeclaration.name; }],
  ['wrong cardinality', d => { d.parameterDeclarations[0].stringParameterDeclaration.parameterValueType = 'ANY'; }],
  ['string default type', d => { d.parameterDeclarations[0].stringParameterDeclaration.defaultValues.staticValues = [3]; }],
  ['datetime default type', d => { d.parameterDeclarations[1].dateTimeParameterDeclaration.defaultValues.staticValues = [false]; }],
  ['datetime multiple defaults', d => { d.parameterDeclarations[1].dateTimeParameterDeclaration.defaultValues.staticValues.push('2026-01-01'); }],
  ['integer fraction', d => { d.parameterDeclarations[2].integerParameterDeclaration.defaultValues.staticValues = [1.5]; }],
  ['decimal string', d => { d.parameterDeclarations[3].decimalParameterDeclaration.defaultValues.staticValues = ['1.5']; }],
  ['single-valued multiple defaults', d => { d.parameterDeclarations[2].integerParameterDeclaration.defaultValues.staticValues = [1, 2]; }],
  ['dynamic defaults malformed', d => { d.parameterDeclarations[0].stringParameterDeclaration.defaultValues.dynamicValue = {}; }],
  ['group primitive', d => { d.filterGroups[0] = false; }],
  ['filters not array', d => { d.filterGroups[0].filters = {}; }],
  ['empty filters', d => { d.filterGroups[0].filters = []; }],
  ['missing group scope', d => { delete d.filterGroups[0].scopeConfiguration; }],
  ['scope missing visuals', d => { d.filterGroups[0].scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations[0].visualIds = []; }],
  ['category missing configuration', d => { delete d.filterGroups[0].filters[0].categoryFilter.configuration; }],
  ['category missing selector', d => { delete d.filterGroups[0].filters[0].categoryFilter.configuration.customFilterConfiguration.parameterName; }],
  ['category conflicting selectors', d => { d.filterGroups[0].filters[0].categoryFilter.configuration.customFilterConfiguration.categoryValue = 'East'; }],
  ['numeric column malformed', d => { d.filterGroups[0].filters[1].numericRangeFilter.column.columnName = null; }],
  ['numeric wrong bound type', d => { d.filterGroups[0].filters[1].numericRangeFilter.rangeMaximum.staticValue = '100'; }],
  ['numeric empty bound', d => { d.filterGroups[0].filters[1].numericRangeFilter.rangeMinimum = {}; }],
  ['numeric ambiguous bound', d => { d.filterGroups[0].filters[1].numericRangeFilter.rangeMinimum.staticValue = 0; }],
  ['numeric reversed range', d => { d.filterGroups[0].filters[1].numericRangeFilter.rangeMinimum = { staticValue: 100001 }; }],
  ['numeric inclusion wrong type', d => { d.filterGroups[0].filters[1].numericRangeFilter.includeMinimum = 'true'; }],
  ['relative missing anchor parameter', d => { delete d.filterGroups[0].filters[2].relativeDatesFilter.anchorDateConfiguration.parameterName; }],
  ['relative invalid granularity', d => { d.filterGroups[0].filters[2].relativeDatesFilter.timeGranularity = 'CENTURY'; }],
  ['relative missing count', d => { delete d.filterGroups[0].filters[2].relativeDatesFilter.parameterName; }],
  ['relative negative count', d => { const f = d.filterGroups[0].filters[2].relativeDatesFilter; delete f.parameterName; f.relativeDateValue = -1; }],
  ['calculation missing expression', d => { delete d.calculatedFields[0].expression; }],
  ['calculation object expression', d => { d.calculatedFields[0].expression = {}; }],
  ['calculation duplicate', d => { d.calculatedFields.push(d.calculatedFields[0]); }],
  ['parameter duplicate', d => { d.parameterDeclarations.push(d.parameterDeclarations[0]); }],
  ['sheet duplicate', d => { d.sheets.push(d.sheets[0]); }],
  ['visual duplicate', d => { d.sheets[0].visuals.push(d.sheets[0].visuals[0]); }],
  ['filter duplicate', d => { d.filterGroups[0].filters.push(d.filterGroups[0].filters[0]); }],
  ['KPI direct field wells malformed', d => { d.sheets[0].visuals[0].kpiVisual.chartConfiguration.fieldWells.values = null; }],
  ['KPI field column missing', d => { delete d.sheets[0].visuals[0].kpiVisual.chartConfiguration.fieldWells.values[0].numericalMeasureField.column; }],
  ['line date field malformed', d => { d.sheets[0].visuals.find(v => v.lineChartVisual).lineChartVisual.chartConfiguration.fieldWells.lineChartAggregatedFieldWells.category[0].dateDimensionField.fieldId = 5; }],
];
for (const [name, mutate] of mutations) test(`malformed ${name} gives typed errors in parse, ZIP and summary`, async () => {
  const raw = extended(); mutate(raw.definition);
  const check = error => {
    assert.ok(error instanceof ValidationError, String(error));
    assert.match(error.path, /definition\./u);
    return true;
  };
  assert.throws(() => parseBundleResource(raw), check);
  assert.throws(() => summarize(featurePath, raw), check);
  await assert.rejects(parseQsBundle(pack(featurePath, raw)), check);
});

test('table and wrapped KPI wells validate known field bodies', () => {
  for (const kind of ['tableVisual', 'kpiVisual']) {
    const raw = read('analysis/assets-as-code.json');
    const visual = raw.definition.sheets.flatMap(s => s.visuals).find(v => v[kind])[kind];
    const wells = Object.values(visual.chartConfiguration.fieldWells)[0];
    wells.values[0].numericalMeasureField.fieldId = null;
    assert.throws(() => parseBundleResource(raw), ValidationError);
  }
});

test('non-JSON number values and sparse arrays fail with typed errors for JavaScript callers', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const raw = extended(); raw.definition.parameterDeclarations[3].decimalParameterDeclaration.defaultValues.staticValues[0] = value;
    assert.throws(() => summarize(featurePath, raw), ValidationError);
  }
  const raw = extended(); delete raw.definition.calculatedFields[0];
  assert.throws(() => summarize(featurePath, raw), ValidationError);
});
