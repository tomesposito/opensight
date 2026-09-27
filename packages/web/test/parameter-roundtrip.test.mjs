import test from 'node:test';
import assert from 'node:assert/strict';
import { authorReducer as reduce, emptyDraft, activeSheet, sheetParameters, serializeDraft, validateDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle, downloadBundleBytes, importedFilterProblem, withInheritedParameterFilters } from '../build/test/bundle-authoring.js';
import { parseQsBundle } from '@opensight/bundle-parser/browser';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
const wrap = resource => ({ members: [{ path: `analysis/${resource.analysisId}.json`, resource }] });
function authored() {
  let d = reduce(emptyDraft(), { type: 'add', kind: 'kpi' });
  for (const p of [
    { name: 'Region', type: 'string', multiple: true, values: ['East', 'West'] },
    { name: 'Scale', type: 'number', multiple: false, integer: false, values: [2] },
    { name: 'AsOf', type: 'datetime', multiple: false, values: ['2025-01-01T00:00:00Z'] },
    { name: 'Search', type: 'string', multiple: false, values: ['Hardware'] },
  ]) d = reduce(d, { type: 'parameter-add', parameter: { ...p, defaultValues: p.values } });
  for (const control of [
    { label: 'Region', kind: 'dropdown', parameterId: 'parameter-1', options: ['East', 'West'] },
    { label: 'Scale', kind: 'slider', parameterId: 'parameter-2', min: 0, max: 10, step: 0.5 },
    { label: 'As of', kind: 'date', parameterId: 'parameter-3' },
    { label: 'Search', kind: 'text', parameterId: 'parameter-4' },
    { label: 'Categories', kind: 'dropdown', parameterId: 'parameter-4', source: { columnName: 'category', dataSetIdentifier: 'sales_data', local: true }, cascade: [{ controlId: 'control-1', columnName: 'region' }] },
  ]) d = reduce(d, { type: 'control-add', control });
  d = reduce(d, { type: 'filter-parameter', columnName: 'region', parameterName: 'Region' });
  d = reduce(d, { type: 'calculation-add', field: { name: 'Scaled', expression: '{revenue} * ${Scale}', role: 'measure' } });
  return reduce(d, { type: 'assign', field: 'Scaled', well: 'values' });
}
const query = (d, sheet = activeSheet(d), visual = sheet.visuals[0]) => buildAuthorQuery(withInheritedParameterFilters(d, sheet, visual), d.calculatedFields, sheetParameters(d, sheet));
test('all controls and parameter references survive camelCase JSON and ZIP round trips as live features', async () => {
  const d = authored(), bundle = exportBundle(d), resource = bundle.members[0].resource;
  assert.deepEqual(resource.definition.sheets[0].parameterControls.map(c => Object.keys(c)[0]), ['dropdown', 'slider', 'dateTimePicker', 'textField', 'dropdown']);
  assert.equal(resource.definition.filterGroups[0].filters[0].categoryFilter.configuration.customFilterConfiguration.parameterName, 'Region');
  const imported = importBundle(await parseQsBundle(await downloadBundleBytes(d)));
  assert.equal(imported.sheets[0].controls.length, 5);
  assert.deepEqual(exportBundle(imported), bundle);
  assert.deepEqual(executeFixtureQuery(query(imported)).rows, [{ Scaled: 1800 }]);
  const changed = reduce(imported, { type: 'parameter-value', id: 'parameter-1', values: ['West'] });
  assert.deepEqual(executeFixtureQuery(query(changed)).rows, [{ Scaled: 800 }]);
  // Runtime selection does not rewrite declared defaults on export.
  assert.deepEqual(exportBundle(changed), bundle);
  assert.match(JSON.stringify(imported.bundle.report), /Control Categories.*live; bound to Search/);
});
test('explicit default, control order/removal/binding edits preserve opaque control display fields', () => {
  const original = exportBundle(authored());
  original.members[0].resource.definition.sheets[0].parameterControls[1].slider.displayOptions = { titleOptions: { visibility: 'VISIBLE' }, futureStyle: 'retained' };
  let d = importBundle(original);
  d = reduce(d, { type: 'parameter-default', id: 'parameter-2', values: [3] });
  d = reduce(d, { type: 'control-move', id: 'control-2', offset: -1 });
  d = reduce(d, { type: 'control-remove', id: 'control-3' });
  const exported = exportBundle(d), body = exported.members[0].resource;
  assert.deepEqual(body.definition.parameterDeclarations[1].decimalParameterDeclaration.defaultValues.staticValues, [3]);
  assert.deepEqual(body.definition.sheets[0].parameterControls[0].slider.displayOptions, original.members[0].resource.definition.sheets[0].parameterControls[1].slider.displayOptions);
  assert.equal(body.definition.sheets[0].parameterControls.length, 4);
  assert.deepEqual(body.opensightRoundTrip.originalResource, original.members[0].resource);
  const again = importBundle(exported); validateDraft(again); assert.deepEqual(exportBundle(again), exported);
});
test('numeric and datetime parameter filters round trip and recompute', () => {
  let d = authored();
  d = reduce(d, { type: 'filter-parameter', columnName: 'revenue', parameterName: 'Scale', operator: 'GREATER_THAN_OR_EQUAL_TO' });
  d = reduce(d, { type: 'filter-parameter', columnName: 'order_date', parameterName: 'AsOf', operator: 'EQUALS' });
  const b = exportBundle(d), imported = importBundle(b);
  assert.deepEqual(exportBundle(imported), b);
  assert.deepEqual(executeFixtureQuery(query(imported)).rows, [{ Scaled: 1200 }]);
  const changed = reduce(imported, { type: 'parameter-value', id: 'parameter-3', values: ['2025-04-01T00:00:00Z'] });
  assert.deepEqual(executeFixtureQuery(query(changed)).rows, [{ Scaled: 500 }]);
});
test('shared/all-sheet parameter filters apply to new visuals and edits split only one scope', () => {
  let base = reduce(authored(), { type: 'add', kind: 'kpi' });
  const resource = serializeDraft(base); resource.definition.filterGroups[0].scopeConfiguration = { allSheets: {} };
  let d = importBundle(wrap(resource));
  d = reduce(d, { type: 'parameter-value', id: 'parameter-1', values: ['West'] });
  assert.deepEqual(executeFixtureQuery(query(d, d.sheets[0], d.sheets[0].visuals[1])).rows, [{ revenue: 400 }]);
  d = reduce(d, { type: 'add', kind: 'kpi' });
  assert.equal(importedFilterProblem(d, activeSheet(d), activeSheet(d).visuals[2]), undefined);
  assert.deepEqual(executeFixtureQuery(query(d, d.sheets[0], d.sheets[0].visuals[2])).rows, [{ revenue: 400 }]);
  d = reduce(d, { type: 'select', id: 'visual-1' });
  d = reduce(d, { type: 'filter', columnName: 'region', values: ['East'] });
  const again = importBundle(exportBundle(d));
  assert.deepEqual(executeFixtureQuery(query(again)).rows, [{ Scaled: 1000 }]);
  assert.equal(again.sheets[0].visuals[1].filters[0].parameterName, 'Region');
  assert.equal(again.sheets[0].visuals[2].filters[0].parameterName, 'Region');
});
test('unsupported controls and unresolved/cyclic cascades are reported and preserved', () => {
  const b = exportBundle(authored()), controls = b.members[0].resource.definition.sheets[0].parameterControls;
  controls.push({ futureControl: { parameterControlId: 'future', opaque: { retained: true } } });
  controls[4].dropdown.cascadingControlConfiguration.sourceControls[0].sourceSheetControlId = 'missing';
  const d = importBundle(b);
  assert.equal(d.sheets[0].controls.length, 4);
  assert.match(JSON.stringify(d.bundle.report), /unsupported control type/);
  assert.match(JSON.stringify(d.bundle.report), /unresolved or cyclic cascade/);
  assert.deepEqual(exportBundle(d), b);
  const edited = reduce(d, { type: 'control-remove', id: 'control-1' });
  assert.deepEqual(exportBundle(edited).members[0].resource.definition.sheets[0].parameterControls.at(-1), controls.at(-1));
});
test('parameters with the same name in different bundle members keep independent bindings', () => {
  const a = serializeDraft(authored()), b = structuredClone(a); b.analysisId = 'second'; b.definition.parameterDeclarations[1].decimalParameterDeclaration.defaultValues.staticValues = [5];
  const bundle = { members: [...wrap(a).members, ...wrap(b).members] }, d = importBundle(bundle);
  assert.deepEqual(exportBundle(d), bundle);
  assert.deepEqual(executeFixtureQuery(query(d, d.sheets[0])).rows, [{ Scaled: 1800 }]);
  assert.deepEqual(executeFixtureQuery(query(d, d.sheets[1])).rows, [{ Scaled: 4500 }]);
});

test('rebinding an imported customFilterList replaces its selector union without stale parameter names', () => {
  const b = exportBundle(authored()), f = b.members[0].resource.definition.filterGroups[0].filters[0].categoryFilter;
  f.configuration.customFilterListConfiguration = f.configuration.customFilterConfiguration; delete f.configuration.customFilterConfiguration;
  let d = importBundle(b);
  d = reduce(d, { type: 'parameter-add', parameter: { name: 'Alternate', type: 'string', multiple: false, values: ['West'], defaultValues: ['West'], memberPath: 'analysis/authored-analysis.json' } });
  d = reduce(d, { type: 'filter-parameter', columnName: 'region', parameterName: 'Alternate' });
  const exported = exportBundle(d), configuration = exported.members[0].resource.definition.filterGroups[0].filters[0].categoryFilter.configuration;
  assert.deepEqual(Object.keys(configuration), ['customFilterConfiguration']);
  assert.equal(configuration.customFilterConfiguration.parameterName, 'Alternate');
  const again = importBundle(exported);
  assert.deepEqual(executeFixtureQuery(query(again)).rows, [{ Scaled: 800 }]);
});
test('new control IDs avoid opaque and imported original IDs', () => {
  const b = exportBundle(authored()), controls = b.members[0].resource.definition.sheets[0].parameterControls;
  controls[0].dropdown.parameterControlId = 'control-6';
  controls[4].dropdown.cascadingControlConfiguration.sourceControls[0].sourceSheetControlId = 'control-6';
  controls.push({ opaqueControl: { parameterControlId: 'control-7' } });
  let d = importBundle(b);
  d = reduce(d, { type: 'control-add', control: { label: 'New text', kind: 'text', parameterId: 'parameter-4' } });
  const exported = exportBundle(d), ids = exported.members[0].resource.definition.sheets[0].parameterControls.map(c => Object.values(c)[0].parameterControlId);
  assert.equal(new Set(ids).size, ids.length); assert.ok(ids.includes('control-8'));
});
test('number/date parameter filters can be removed with existing filter pills', () => {
  let d = authored();
  for (const [columnName, parameterName] of [['revenue', 'Scale'], ['order_date', 'AsOf']]) {
    d = reduce(d, { type: 'filter-parameter', columnName, parameterName });
    assert.ok(activeSheet(d).visuals[0].filters.some(f => f.columnName === columnName));
    d = reduce(d, { type: 'filter', columnName, values: null });
    assert.ok(!activeSheet(d).visuals[0].filters.some(f => f.columnName === columnName));
  }
});

test('opaque or malformed option semantics stay reported and never become active controls', () => {
  for (const mutate of [c => { c.dropdown.selectableValues.values = 'East'; }, c => { c.dropdown.minimumValue = 2; }, c => { c.dropdown.selectableValues = { linkToDataSetColumn: { columnName: 'region', dataSetIdentifier: 'sales_data', futureMode: 'REMOTE' } }; }]) {
    const b = exportBundle(authored()); mutate(b.members[0].resource.definition.sheets[0].parameterControls[0]);
    const d = importBundle(b);
    assert.ok(!d.sheets[0].controls.some(c => c.importedId === 'control-1'));
    assert.match(JSON.stringify(d.bundle.report), /display only; unsupported/);
    assert.deepEqual(exportBundle(d), b);
  }
});

test('new data-backed controls in imported analyses declare their local dataset binding', () => {
  const resource = serializeDraft(authored());
  resource.definition.sheets[0].parameterControls = [];
  const d = reduce(importBundle(wrap(resource)), { type: 'control-add', control: { label: 'Local options', kind: 'dropdown', parameterId: 'parameter-1', source: { columnName: 'region', dataSetIdentifier: 'sales_data', local: true } } });
  const exported = exportBundle(d), definition = exported.members[0].resource.definition;
  const source = definition.sheets[0].parameterControls[0].dropdown.selectableValues.linkToDataSetColumn;
  assert.equal(source.dataSetIdentifier, 'opensight_local_sales');
  assert.ok(definition.dataSetIdentifierDeclarations.some(ds => ds.identifier === source.dataSetIdentifier));
  assert.equal(importBundle(exported).sheets[0].controls[0].source.local, true);
});
