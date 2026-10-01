import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatasetExecution, ExecutionBadge } from '../build/test/DatasetExecution.js';
import { DatasetHeader } from '../build/test/DatasetHeader.js';
import { createApiClient } from '../build/test/api-client.js';
import { prepSchema } from '../build/test/data-prep.js';
const ready = { mode: 'BLAZE', intervalMinutes: null, state: 'ready', lastRefreshedAt: '2026-09-29T10:00:00.000Z', rowCount: 2, bytes: 400, nextRefreshAt: null, error: null };
const direct = { ...ready, mode: 'DIRECT_QUERY', state: 'direct', rowCount: null, lastRefreshedAt: null };
async function mount(t, props, component = DatasetExecution) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; await act(async () => { renderer = create(createElement(component, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  return { renderer, text: () => JSON.stringify(renderer.toJSON()), update: async next => act(async () => renderer.update(createElement(component, next))), click: async name => act(async () => { const b = renderer.root.findAllByType('button').find(b => b.props.children === name); assert.ok(b,name); assert.equal(!!b.props.disabled,false); await b.props.onClick(); }) };
}
test('offline execution controls and unsaved pipelines never pretend materialization is available', () => {
  const html = renderToStaticMarkup(createElement(DatasetExecution,{datasetId:'draft',saved:false}));
  assert.match(html,/Needs hosted API/); assert.match(html,/disabled=""[^>]*>Refresh Blaze/); assert.doesNotMatch(html,/Last successful refresh/);
  assert.equal(renderToStaticMarkup(createElement(ExecutionBadge, {})), '', 'Unsaved output must not claim a hosted execution mode');
});
test('mode switch, refresh, schedule and cached output preserve explicit freshness labels', async t => {
  let status = direct; const calls = [];
  const client = { getDatasetExecution:async()=>status, setDatasetExecution:async(id,settings)=>{ calls.push([id,settings]); return status={...status,...settings,state:'empty'}; }, refreshBlaze:async()=>status=ready, getPreparedRows:async()=>({ columns:[{name:'n',type:'INTEGER'}], rows:[{n:1}], rowCount:2, truncated:false, execution:{mode:'BLAZE',cached:true,refreshedAt:ready.lastRefreshedAt,cachedInputs:[]} }) };
  const ui = await mount(t,{client,datasetId:'prepared'});
  await act(async()=>ui.renderer.root.findByType('select').props.onChange({target:{value:'BLAZE'}}));
  assert.deepEqual(calls[0],['prepared',{mode:'BLAZE',intervalMinutes:null}]);
  await ui.click('Refresh Blaze'); assert.match(ui.text(),/2 rows/); assert.match(ui.text(),/2026-09-29T10:00/);
  await ui.click('View cached output'); assert.match(ui.text(),/Cached · refreshed/);
  await act(async()=>ui.renderer.root.findByType('input').props.onChange({target:{value:'5'}}));
  await act(async()=>ui.renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls.at(-1)[1].intervalMinutes,5);
});
test('failed refresh exposes named errors and removes readable cached output', async t => {
  let status=ready;
  const client={getDatasetExecution:async()=>status,setDatasetExecution:async()=>ready,refreshBlaze:async()=>{status={...ready,state:'error',rowCount:null,error:{code:'BLAZE_PIPELINE_INVALID',causeCode:'PREP_SOURCE_NOT_FOUND',message:'Repair source'}};throw new Error('BLAZE_PIPELINE_INVALID');},getPreparedRows:async()=>({columns:[],rows:[],rowCount:2,execution:{mode:'BLAZE',cached:true,refreshedAt:ready.lastRefreshedAt,cachedInputs:[]}})};
  const ui=await mount(t,{client,datasetId:'prepared'});await ui.click('View cached output');await ui.click('Refresh Blaze');
  assert.match(ui.text(),/BLAZE_PIPELINE_INVALID/);assert.match(ui.text(),/PREP_SOURCE_NOT_FOUND/);assert.match(ui.text(),/no readable snapshot/);assert.doesNotMatch(ui.text(),/cached rows/);
});
test('prepared data-panel header has a real mode control; late responses cannot label another dataset',async t=>{
  let finish;const client={getDatasetExecution:id=>id==='a'?new Promise(resolve=>finish=resolve):Promise.resolve(direct),setDatasetExecution:async()=>ready,refreshBlaze:async()=>ready,getPreparedRows:async()=>({})};
  const ui=await mount(t,{client,datasetId:'a',datasetName:'Prepared A'},DatasetHeader);
  await ui.update({client,datasetId:'b',datasetName:'Prepared B'});await act(async()=>finish(ready));
  assert.match(ui.text(),/Prepared B/);assert.doesNotMatch(ui.text(),/2026-09-29T10:00|2 rows|sample rows/);assert.equal(ui.renderer.root.findByType('select').props.value,'DIRECT_QUERY');
});
test('cached source schemas compile without expanding expired original inputs',()=>{
  const dataset={dataSetId:'cached',opensightPrep:{version:1,input:'expired',steps:[]}};
  const sources=[{id:'cached',ref:{dataset:'cached'},available:true,connectorId:'file',columns:[{name:'n',type:'INTEGER'}],execution:ready}];
  assert.deepEqual(prepSchema({version:1,input:{dataset:'cached'},steps:[]},sources,undefined,{datasets:[dataset]}),[{name:'n',type:'INTEGER'}]);
});
test('execution client uses resource endpoints and retains query cache provenance',async()=>{
  const calls=[],execution={mode:'BLAZE',cached:true,refreshedAt:ready.lastRefreshedAt,cachedInputs:[]};
  const client=createApiClient('/root',async(url,options)=>{calls.push([url,options]);return Response.json(url.endsWith('/query')?{columns:[{name:'sum',type:'number'}],rows:[{sum:2}],execution}:ready);});
  await client.getDatasetExecution('prepared');await client.setDatasetExecution('prepared',{mode:'BLAZE',intervalMinutes:3});await client.refreshBlaze('prepared');await client.getPreparedRows('prepared');
  assert.deepEqual(calls.map(c=>c[0]),['execution','execution','refresh','rows'].map(s=>`/root/api/datasets/prepared/${s}`));
  assert.deepEqual(JSON.parse(calls[1][1].body),{mode:'BLAZE',intervalMinutes:3});
  assert.deepEqual((await client.queryDataset('prepared',{dimensions:[],measures:[{fieldId:'sum',columnName:'n',aggregation:'SUM'}],filters:[]})).execution,execution);
});
test('mandatory materialization explains why direct query is disabled', async t => {
  const status = { ...ready, materializationReason: 'Cross-source joins require Blaze materialization.' };
  const ui = await mount(t, { datasetId: 'joined', client: { getDatasetExecution: async () => status } });
  assert.match(ui.text(), /Cross-source joins require Blaze materialization/);
  assert.equal(ui.renderer.root.findAllByType('option').find(o => o.props.value === 'DIRECT_QUERY').props.disabled, true);
  assert.equal(ui.renderer.root.findByType('select').props.value, 'BLAZE');
});


test('Issue #35: a first Blaze refresh gives a concrete action, then truthful progress', async t => {
  const client = { getDatasetExecution: async () => ({ ...ready, state: 'empty', rowCount: null, lastRefreshedAt: null }) };
  const ui = await mount(t, { client, datasetId: 'prepared' });
  assert.match(ui.text(), /Choose Refresh Blaze to prepare data for your charts/);
  assert.doesNotMatch(ui.text(), /No successful refresh recorded/);
  assert.equal(ui.renderer.root.findAllByType('button').find(b => b.props.children === 'Refresh Blaze').props.disabled, false);
  await ui.update({ client: { getDatasetExecution: async () => ({ ...ready, state: 'running', lastRefreshedAt: null }) }, datasetId: 'prepared' });
  assert.match(ui.text(), /Preparing cached data/);
  assert.doesNotMatch(ui.text(), /Choose Refresh Blaze/);
});
