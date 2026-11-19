import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual, parseDraft, aggregationSortValid } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { projectDefinition, convertDefinition } from '../build/test/definition-converter.js';
import { GroupColorOptions } from '../build/test/PropertiesSections.js';
import { fromArchive } from '../../api/dist/mapping.js';
import { baselineInputs } from './fixtures/aggregation-sort-inputs.mjs';

const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const draft = (kind = 'bar') => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind }), { type: 'assign', field: 'region' });
const config = visual => Object.values(visual)[0].chartConfiguration;
const wells = visual => Object.values(config(visual).fieldWells)[0];
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const sort = (aggregation = 'SUM', direction = 'DESC') => ({ aggregationSort: { fieldId: 'region', direction,
  column: { columnName: 'revenue', dataSetIdentifier: 'sales_data' },
  aggregationFunction: { numericalAggregationFunction: { simpleNumericalAggregation: aggregation } } } });
const draftSort = (aggregation = 'SUM', direction = 'DESC') => ({ fieldId: 'region', measureFieldId: 'revenue', aggregation, direction });
const input = (kind = 'bar', rows = [{ region: 'West', revenue: 10 }, { region: 'East', revenue: 20 }], sorts = [sort()]) => {
  const visual = selected(draft(kind));
  if (kind === 'combo') visual.measures = ['revenue', 'profit'];
  const result = { source: 'bundle', path: '$.aggregation', bindings: {}, rows, definition: serializeVisual(visual) };
  config(result.definition).sortConfiguration = { [kind === 'table' ? 'rowSort' : 'categorySort']: sorts };
  return result;
};
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const mutate = fn => { const value = sort(); fn(value.aggregationSort, value); return [value]; };
const malformed = [null, {}, 'sort', [null], [[]], [{}], [sort(), sort()], [sort(), { fieldSort: { fieldId: 'region' } }],
  mutate((s, w) => { w.fieldSort = { fieldId: 'region' }; }), mutate((s, w) => { w.extra = true; }),
  ...['extra', 'fieldId', 'direction', 'column', 'aggregationFunction'].flatMap(key => [mutate(s => { s[key] = null; })]),
  ...['', ' ', 'revenue', 'missing', 7].map(fieldId => mutate(s => { s.fieldId = fieldId; })),
  ...['asc', '', 1].map(direction => mutate(s => { s.direction = direction; })),
  ...[{}, [], { columnName: 'revenue' }, { dataSetIdentifier: 'sales_data' }, { dataSetIdentifier: 'other', columnName: 'revenue' },
    { dataSetIdentifier: 'sales_data', columnName: 'region' }, { dataSetIdentifier: 'sales_data', columnName: 'missing' },
    { dataSetIdentifier: 'sales_data', columnName: 'revenue', extra: true }].map(column => mutate(s => { s.column = column; })),
  ...[{}, [], { dateAggregationFunction: 'MAX' }, { categoricalAggregationFunction: 'COUNT' },
    { numericalAggregationFunction: {} }, { numericalAggregationFunction: [] },
    { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM', extra: true } },
    { numericalAggregationFunction: { simpleNumericalAggregation: 'SUM' }, extra: true },
    ...['AVG', 'MEDIAN', 'STDEV', null, 5].map(simpleNumericalAggregation => ({ numericalAggregationFunction: { simpleNumericalAggregation } }))
  ].map(aggregationFunction => mutate(s => { s.aggregationFunction = aggregationFunction; }))];

for (const source of ['bundle', 'api']) {
  test(`${source}: supported kinds resolve measure column to field ID and default direction`, () => {
    for (const kind of ['bar', 'bar100', 'pie', 'line', 'area', 'combo']) {
      const value = input(kind);
      const measure = wells(value.definition).values?.[0] ?? wells(value.definition).barValues[0];
      measure.numericalMeasureField.fieldId = 'measure-id';
      assert.deepEqual(normalize(dialect(value, source)).aggregationSort, { ...draftSort(), measureFieldId: 'measure-id' });
      delete config(value.definition).sortConfiguration.categorySort[0].aggregationSort.direction;
      assert.equal(normalize(dialect(value, source)).aggregationSort.direction, 'ASC');
    }
  });
  test(`${source}: malformed wrappers, directions, bindings, kinds and every aggregation nesting fail closed`, () => {
    for (const sorts of malformed) assert.throws(() => normalize(dialect(input('bar', [], sorts), source)), CompileError, JSON.stringify(sorts));
    for (const kind of ['table', 'pivot', 'radar', 'sankey', 'waterfall', 'treemap', 'funnel', 'kpi', 'heatmap', 'box', 'histogram', 'scatter', 'wordCloud', 'pointMap', 'filledMap', 'gauge', 'insight']) {
      assert.throws(() => normalize(dialect(input(kind), source)), CompileError, kind);
    }
  });
}

const data = [
  { region: 'A', revenue: 4 }, { region: 'B', revenue: 9 }, { region: 'C', revenue: 6 }, { region: 'Null', revenue: null },
  { region: 'A', revenue: 4 }, { region: 'C', revenue: 2 }, { region: 'D', revenue: 8 }, { region: 'A', revenue: 4 },
  { region: 'B', revenue: null }, { region: 'Null', revenue: null },
];
const asc = { SUM: ['C','D','B','A','Null'], AVERAGE: ['A','C','D','B','Null'], MIN: ['C','A','D','B','Null'],
  MAX: ['A','C','D','B','Null'], COUNT: ['B','D','C','A','Null'], DISTINCT_COUNT: ['A','B','D','C','Null'] };
const desc = { SUM: ['A','B','C','D','Null'], AVERAGE: ['B','D','A','C','Null'], MIN: ['B','D','A','C','Null'],
  MAX: ['B','D','C','A','Null'], COUNT: ['A','C','B','D','Null'], DISTINCT_COUNT: ['C','A','B','D','Null'] };
for (const aggregation of Object.keys(asc)) for (const direction of ['ASC', 'DESC']) for (const source of ['bundle', 'api']) {
  test(`${source}: ${aggregation} ${direction} groups multiple rows with stable ties and nulls last`, () => {
    const before = structuredClone(data);
    const value = input('bar', data, [sort(aggregation, direction)]);
    const result = compileVisual(dialect(value, source));
    const expected = (direction === 'ASC' ? asc : desc)[aggregation].flatMap(region => data.filter(row => row.region === region).map(row => [row.region, row.revenue]));
    assert.deepEqual(result.table.rows, expected);
    assert.deepEqual(result.option.xAxis.data, expected.map(row => row[0]));
    assert.deepEqual(result.option.series[0].data, expected.map(row => row[1]));
    assert.deepEqual(data, before);
  });
}
for (const kind of ['bar','bar100','pie','line','area','combo']) test(`${kind}: faceted ordering precedes category and facet limits`, () => {
  const data = [{ region:'A', category:'Z', revenue:1, profit:1 }, { region:'A', category:'A', revenue:20, profit:1 },
    { region:'B', category:'Z', revenue:9, profit:1 }, { region:'B', category:'A', revenue:2, profit:1 }];
  const value = input(kind, data);
  wells(value.definition).smallMultiples = [{ categoricalDimensionField: {fieldId:'category',column:{dataSetIdentifier:'sales_data',columnName:'category'}} }];
  assert.deepEqual(compileVisual(value).table.rows.map(row => row.slice(0,2)), [['B','Z'],['A','Z'],['A','A'],['B','A']]);
  config(value.definition).sortConfiguration.categoryItemsLimit = { itemsLimit:1, otherCategories:'EXCLUDE' };
  assert.deepEqual(compileVisual(value).table.rows.map(row => row.slice(0,2)), [['B','Z'],['A','A']]);
  config(value.definition).sortConfiguration.smallMultiplesLimitConfiguration = { itemsLimit:1, otherCategories:'EXCLUDE' };
  assert.deepEqual(compileVisual(value).table.rows.map(row => row.slice(0,2)), [['B','Z']]);
  config(value.definition).sortConfiguration.smallMultiplesSort = [{fieldSort:{fieldId:'category',direction:'ASC'}}];
  assert.deepEqual(compileVisual(value).table.rows.map(row => row.slice(0,2)), [['A','A']]);
});
test('top N keeps every row of retained categories, then optionally appends Other', () => {
  const value = input('bar', data);
  config(value.definition).sortConfiguration.categoryItemsLimit = {itemsLimit:1,otherCategories:'EXCLUDE'};
  assert.deepEqual(compileVisual(value).table.rows, [['A',4],['A',4],['A',4]]);
  config(value.definition).sortConfiguration.categoryItemsLimit.otherCategories = 'INCLUDE';
  assert.deepEqual(compileVisual(value).table.rows, [['A',4],['A',4],['A',4],['Other',25]]);
});
test('typed category keys stay distinct; empty and unavailable inputs work; overflow fails closed', () => {
  const value = input('bar', [{region:'1',revenue:1},{region:1,revenue:3},{region:null,revenue:2},{region:false,revenue:4}]);
  assert.deepEqual(compileVisual(value).table.rows.map(row => row[0]), [false,1,null,'1']);
  assert.equal(compileVisual(input('bar', [])).state, 'empty');
  assert.equal(compileVisual(input('bar', null)).state, 'unavailable');
  assert.throws(() => compileVisual(input('bar', [{region:'A',revenue:1e308},{region:'A',revenue:1e308}])), /aggregation sort result must be finite/);
  assert.throws(() => compileVisual(input('bar', [{region:'A',revenue:'bad'}])), CompileError);
});
test('tooltips, conditional formatting and view data retain the same ordered row identities', () => {
  const value = input();
  const body = Object.values(value.definition)[0];
  body.opensightFormatting = { rules:[{fieldId:'revenue',operator:'gt',threshold:15,color:'#ff0000',background:'#ffffff'}] };
  config(value.definition).tooltip = {selectedTooltipType:'DETAILED',fieldBasedTooltip:{aggregationVisibility:'VISIBLE',tooltipTitleType:'PRIMARY_VALUE'}};
  const result = compileVisual(value);
  assert.deepEqual(result.table.rows, [['East',20],['West',10]]);
  assert.equal(result.option.series[0].data[0].itemStyle.color, '#ff0000');
  assert.equal(result.option.series[0].data[1],10);
  const tip = result.option.tooltip.formatter({dataIndex:0,seriesIndex:0});
  assert.match(tip,/East/); assert.match(tip,/20/); assert.doesNotMatch(tip,/West/);
});
const baseline = JSON.parse(readFileSync(new URL('./fixtures/aggregation-sort-baseline.json', import.meta.url),'utf8'));
for (const [name, value] of Object.entries(baselineInputs())) test(`no aggregation sort matches master bytes: ${name}`, () => {
  assert.equal(createHash('sha256').update(JSON.stringify(compileVisual(value),(_,v)=>typeof v==='function'?v.toString():v)).digest('hex'), baseline.hashes[name]);
});

const sortedDraft = (kind = 'bar') => authorReducer(draft(kind),{type:'aggregation-sort',sort:draftSort()});
test('reducer and storage validate shape, membership, kind and mutual exclusion', () => {
  const valid = draftSort(), current = authorReducer(draft(),{type:'aggregation-sort',sort:valid});
  valid.direction='ASC'; assert.deepEqual(selected(current).aggregationSort,draftSort());
  assert.deepEqual(parseDraft(JSON.stringify(current)),current);
  const invalid = [null,{},[],{...draftSort(),extra:1},{...draftSort(),aggregation:'AVG'},{...draftSort(),direction:'DOWN'},
    {...draftSort(),fieldId:''},{...draftSort(),measureFieldId:'\0'}, {...draftSort(),fieldId:'revenue'},{...draftSort(),measureFieldId:'profit'}];
  for (const sort of invalid) {
    assert.deepEqual(selected(authorReducer(current,{type:'aggregation-sort',sort})),selected(current));
    const bad=structuredClone(current); selected(bad).aggregationSort=sort;
    assert.throws(()=>parseDraft(JSON.stringify(bad)));
  }
  for (const sort of invalid.slice(0,7)) assert.equal(aggregationSortValid(sort),false);
  const group=authorReducer(current,{type:'group-sort',sort:{fieldId:'region',direction:'ASC'}});
  assert.equal(selected(group).aggregationSort,undefined);
  assert.equal(selected(authorReducer(group,{type:'aggregation-sort',sort:draftSort()})).groupSort,undefined);
  const both=structuredClone(current); selected(both).groupSort={fieldId:'region',direction:'ASC'};
  assert.throws(()=>parseDraft(JSON.stringify(both)));
  assert.equal(selected(authorReducer(current,{type:'aggregation-sort',sort:undefined})).aggregationSort,undefined);
  for (const kind of ['line','area','combo','table','pivot']) {
    assert.equal(selected(authorReducer(current,{type:'kind',kind})).aggregationSort,undefined);
    assert.equal(selected(authorReducer(draft(kind),{type:'aggregation-sort',sort:draftSort()})).aggregationSort,undefined);
  }
});
test('well removal, replacement and visual/sheet remapping clear stale references', () => {
  for (const action of [{type:'unassign',field:'region'},{type:'unassign',field:'revenue'},{type:'assign',field:'category'}]) {
    assert.equal(selected(authorReducer(sortedDraft(),action)).aggregationSort,undefined);
  }
  assert.equal(selected(authorReducer(sortedDraft('pie'),{type:'assign',field:'profit'})).aggregationSort,undefined);
  for (const changed of ['dimension','measure']) for (const type of ['remap','sheet-remap']) {
    const imported=importBundle(exportBundle(sortedDraft())); const v=selected(imported);
    v.imported.local=false;
    if (changed==='dimension') {v.dimension='foreign';v.aggregationSort.fieldId='foreign';}
    else {v.measures=['foreign'];v.aggregationSort.measureFieldId='foreign';}
    const next=authorReducer(imported,{type,id:type==='remap'?v.id:activeSheet(imported).id});
    assert.equal(selected(next).aggregationSort,undefined);
    assert.doesNotThrow(()=>parseDraft(JSON.stringify(next)));
  }
});
for (const kind of ['bar','bar100','pie']) test(`${kind}: serialization, import, edit, clear and storage round-trip`, () => {
  for (const aggregation of Object.keys(asc)) {
    const current=authorReducer(draft(kind),{type:'aggregation-sort',sort:draftSort(aggregation)});
    assert.deepEqual(config(serializeVisual(selected(current))).sortConfiguration.categorySort,[sort(aggregation)]);
    const bundle=exportBundle(current), imported=importBundle(bundle);
    assert.deepEqual(selected(imported).aggregationSort,draftSort(aggregation));
    assert.deepEqual(selected(imported).imported.issues,[]);
    assert.deepEqual(exportBundle(imported),bundle);
    assert.deepEqual(parseDraft(JSON.stringify(imported)),JSON.parse(JSON.stringify(imported)));
    const edited=authorReducer(imported,{type:'aggregation-sort',sort:draftSort(aggregation,'ASC')});
    assert.deepEqual(selected(importBundle(exportBundle(edited))).aggregationSort,draftSort(aggregation,'ASC'));
    const cleared=authorReducer(imported,{type:'aggregation-sort',sort:undefined});
    assert.equal(selected(importBundle(exportBundle(cleared))).aggregationSort,undefined);
  }
});
const bundleVisual = bundle => bundle.members[0].resource.definition.sheets[0].visuals[0];
test('malformed imports retain diagnostics and original exports, including missing explicit direction', () => {
  for (const sorts of [...malformed,mutate(s=>{delete s.direction;})]) {
    const bundle=exportBundle(draft()); config(bundleVisual(bundle)).sortConfiguration={categorySort:sorts};
    const imported=importBundle(bundle);
    assert.equal(selected(imported).aggregationSort,undefined,JSON.stringify(sorts));
    assert.ok(selected(imported).imported.issues.length,JSON.stringify(sorts));
    assert.deepEqual(exportBundle(imported),bundle);
  }
});
test('import accepts different measure IDs and dataset identifiers but retains foreign category IDs', () => {
  const bundle=exportBundle(sortedDraft());
  const visual=bundleVisual(bundle);
  wells(visual).values[0].numericalMeasureField.fieldId='measure-id';
  assert.deepEqual(selected(importBundle(bundle)).aggregationSort,draftSort());
  assert.deepEqual(selected(importBundle(bundle)).imported.issues,[]);
  assert.deepEqual(exportBundle(importBundle(bundle)),bundle);
  const changed=JSON.parse(JSON.stringify(bundle).replaceAll('sales_data','other_data'));
  const edited=authorReducer(importBundle(changed),{type:'aggregation-sort',sort:draftSort('MAX')});
  assert.equal(config(bundleVisual(exportBundle(edited))).sortConfiguration.categorySort[0].aggregationSort.column.dataSetIdentifier,'other_data');
  wells(visual).category[0].categoricalDimensionField.fieldId='category-id';
  for (const fieldId of ['region','category-id']) {
    config(visual).sortConfiguration.categorySort[0].aggregationSort.fieldId=fieldId;
    const imported=importBundle(bundle);
    assert.equal(selected(imported).aggregationSort,undefined);
    assert.ok(selected(imported).imported.issues.length);
    assert.deepEqual(exportBundle(imported),bundle);
  }
});
for (const kind of ['line','area','combo']) test(`${kind}: valid imported sorts compile but stay retained read-only`, () => {
  const value=input(kind,[{region:'A',revenue:1,profit:2},{region:'B',revenue:9,profit:3}]);
  assert.equal(compileVisual(value).table.rows[0][0],'B');
  const bundle=exportBundle(draft(kind)); bundle.members[0].resource.definition.sheets[0].visuals[0]=value.definition;
  const imported=importBundle(bundle);
  assert.equal(selected(imported).aggregationSort,undefined);
  assert.ok(selected(imported).imported.issues.length);
  assert.deepEqual(exportBundle(imported),bundle);
});
test('native converter and API archive mapping round-trip the same nested sort object', () => {
  for (const aggregation of Object.keys(asc)) {
    const resource=exportBundle(authorReducer(draft('pie'),{type:'aggregation-sort',sort:draftSort(aggregation)})).members[0].resource;
    const native=projectDefinition(resource.definition), api=fromArchive(resource);
    assert.deepEqual(api.Definition.Sheets[0].Visuals[0].PieChartVisual.ChartConfiguration.SortConfiguration,native.Sheets[0].Visuals[0].PieChartVisual.ChartConfiguration.SortConfiguration);
    assert.deepEqual(convertDefinition(native),resource.definition);
    assert.deepEqual(projectDefinition(convertDefinition(native)),native);
    assert.deepEqual(convertDefinition(api.Definition).sheets[0].visuals[0].pieChartVisual.chartConfiguration.sortConfiguration,
      resource.definition.sheets[0].visuals[0].pieChartVisual.chartConfiguration.sortConfiguration);
  }
});
test('Properties measure mode defaults, edits, direction and field mode use validated reducer state', async t => {
  const oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let renderer,current,dispatch;
  function Harness() {
    [current,dispatch]=useReducer(authorReducer,authorReducer(draft(),{type:'assign',field:'profit'}));
    return createElement(GroupColorOptions,{visual:selected(current),dispatch});
  }
  await act(()=>{renderer=create(createElement(Harness));});
  t.after(async()=>{await act(()=>renderer.unmount());globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;});
  const control=label=>renderer.root.findByProps({'aria-label':label});
  const change=async(label,value)=>act(()=>control(label).props.onChange({target:{value}}));
  await change('Category sort mode','measure'); assert.deepEqual(selected(current).aggregationSort,draftSort());
  assert.deepEqual(control('Sort aggregation').findAllByType('option').map(o=>o.children[0]),['Sum','Average','Min','Max','Count','Distinct count']);
  await change('Sort measure','profit'); await change('Sort aggregation','AVERAGE');
  await act(()=>control('Sort ascending').props.onClick());
  assert.deepEqual(selected(current).aggregationSort,{...draftSort('AVERAGE','ASC'),measureFieldId:'profit'});
  const before=structuredClone(selected(current));
  await change('Sort measure','unbound'); await change('Sort aggregation','MEDIAN'); await change('Category sort mode','invalid');
  assert.deepEqual(selected(current),before);
  await change('Category sort mode','field');
  assert.equal(selected(current).aggregationSort,undefined); assert.deepEqual(selected(current).groupSort,{fieldId:'region',direction:'ASC'});
  await change('Sort slices by','revenue'); assert.equal(selected(current).groupSort.fieldId,'revenue');
  await change('Sort slices by',''); assert.equal(selected(current).groupSort,undefined);
  await act(()=>dispatch({type:'unassign',field:'revenue'})); await act(()=>dispatch({type:'unassign',field:'profit'}));
  assert.equal(renderer.root.findAllByProps({'aria-label':'Category sort mode'}).length,0);
});

test('remapping preserved sort fields rebinds their measure column with the wells', () => {
  const bundle=exportBundle(sortedDraft());
  const remote=JSON.parse(JSON.stringify(bundle).replaceAll('sales_data','remote_data'));
  const imported=importBundle(remote), v=selected(imported); v.imported.local=false;
  const remapped=authorReducer(imported,{type:'remap',id:v.id});
  assert.deepEqual(selected(remapped).aggregationSort,draftSort());
  const visual=bundleVisual(exportBundle(remapped));
  assert.equal(config(visual).sortConfiguration.categorySort[0].aggregationSort.column.dataSetIdentifier,
    wells(visual).values[0].numericalMeasureField.column.dataSetIdentifier);
  assert.doesNotThrow(()=>normalizeVisual('bundle',visual));
});
test('per-facet aggregates keep ties, nulls and row order independent, using resolved result aliases', () => {
  const value=input('bar',[
    {r:'A',f:'Z',m:1},{r:'B',f:'Y',m:4},{r:'B',f:'Z',m:5},{r:'A',f:'Y',m:null},
    {r:'A',f:'Z',m:7},{r:'B',f:'Y',m:4},{r:'B',f:'Z',m:3},{r:'A',f:'Y',m:null},
  ]);
  wells(value.definition).values[0].numericalMeasureField.fieldId='measure-id';
  wells(value.definition).smallMultiples=[{categoricalDimensionField:{fieldId:'category',column:{dataSetIdentifier:'sales_data',columnName:'category'}}}];
  value.bindings={region:'r',category:'f','measure-id':'m'};
  const result=compileVisual(value);
  assert.deepEqual(result.table.rows,[['A','Z',1],['A','Z',7],['B','Z',5],['B','Z',3],['B','Y',4],['B','Y',4],['A','Y',null],['A','Y',null]]);
});
test('invalid field-sort edits preserve a valid aggregation sort', () => {
  const current=sortedDraft();
  assert.deepEqual(selected(authorReducer(current,{type:'group-sort',sort:{fieldId:'unbound',direction:'ASC'}})),selected(current));
});
