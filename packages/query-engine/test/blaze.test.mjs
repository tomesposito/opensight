import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadStaging, queryPrepared, withPrepMemory, streamPrepDuckDb, compilePrep } from '../dist/index.js';
const limits = { maxRows: 1000, cellChars: 100 };
function sink() { return { columns: [], rows: [], start(columns) { this.columns = columns; }, row(values) { this.rows.push(values); }, oversized() { throw new Error('OVERSIZE'); } }; }
test('full materialization exceeds preview size, feeds cached joins and shares query calculation semantics', async () => {
  const staging = await UploadStaging.create();
  try {
    const upload = await staging.ingest({ config: { format: 'csv' }, data: Buffer.from('id,amount\n' + Array.from({ length: 600 }, (_, i) => `${i},2`).join('\n')) });
    const pipeline = { version: 1, input: upload.id, steps: [] }, result = sink();
    await staging.streamPrep(pipeline, {}, limits, result);
    assert.equal(result.rows.length, 600);
    const cached = { id: 'cache', connectorId: 'file', table: '__cache', security: 'unrestricted', columns: result.columns };
    const broken = { id: 'saved', pipeline: { version: 1, input: 'expired-source', steps: [] }, materialized: cached };
    const joined = { version: 1, input: { dataset: 'saved' }, steps: [{ id: 'join', kind: 'join', config: { source: { dataset: 'saved' }, joinType: 'inner', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } }] };
    const output = sink();
    await withPrepMemory([{ source: cached, rowCount: 600, value: (r,c) => result.rows[r][c] }], c => streamPrepDuckDb(c, joined, [cached], { datasets: [broken] }, limits, output));
    assert.equal(output.rows.length, 600); assert.deepEqual(output.rows[0].slice(1,2), [2]);
    const query = { dimensions: [], measures: [{ fieldId: 'sum', columnName: 'doubled', aggregation: 'SUM' }], filters: [], calculatedFields: [{ name: 'doubled', expression: '{amount} * 2' }] };
    assert.deepEqual(queryPrepared(result.columns, result.rows.length, (r,c) => result.rows[r][c], query).rows, [{ sum: 2400 }]);
    assert.doesNotMatch(compilePrep(joined, [], { datasets: [broken] }).sql, /expired-source/);
  } finally { staging.close(); }
});
test('source guards reject large text before passing rows to the materializer', async () => {
  const staging = await UploadStaging.create();
  try {
    const upload = await staging.ingest({ config: { format: 'csv' }, data: Buffer.from('name\n' + 'x'.repeat(101) + '\n') });
    const result = sink();
    await assert.rejects(staging.streamPrep({ version: 1, input: upload.id, steps: [] }, {}, limits, result), /OVERSIZE/);
    assert.equal(result.rows.length, 0);
    const again = sink(); await staging.streamPrep({ version: 1, input: upload.id, steps: [] }, {}, { ...limits, cellChars: 200 }, again); assert.equal(again.rows.length, 1);
  } finally { staging.close(); }
});
import { Client } from 'pg';
import { streamPrepPostgres } from '../dist/index.js';
test('Postgres materialization drains bounded cursor batches under read-only UTC execution and preserves consumer refusal', async t => {
  const variable='OPENSIGHT_TEST_BLAZE_CONNECTION',old=process.env[variable];process.env[variable]='postgres://localhost/synthetic';
  t.after(()=>{if(old===undefined)delete process.env[variable];else process.env[variable]=old;});
  const calls=[];let batches=0;
  t.mock.method(Client.prototype,'connect',async()=>{});const end=t.mock.method(Client.prototype,'end',async()=>{});
  // Single mock only: calling t.mock.method twice on the same prototype method
  // leaves the mock installed after the test (node:test restore bug), which
  // breaks postgres-live.test.mjs when files share a process (--test-isolation=none).
  const queryMock=t.mock.method(Client.prototype,'query',async arg=>{calls.push(arg);if(arg==='SELECT pg_backend_pid() AS pid')return {rows:[{pid:1234}]};if(typeof arg==='object'&&arg.text.startsWith('FETCH')){batches++;return {rows:Array.from({length:batches===1?32:2},()=>['3','f'])};}return {rows:[]};});
  const source={id:'source',connectorId:'postgresql',schema:'public',table:'source',columns:[{name:'n',type:'INTEGER'}],security:'unrestricted'},pipeline={version:1,input:'source',steps:[]};
  const result=sink();await streamPrepPostgres(pipeline,[source],{connectionEnv:variable},{},limits,result);
  assert.equal(result.rows.length,34);assert.deepEqual(calls.slice(0,4),['SELECT pg_backend_pid() AS pid','BEGIN READ ONLY',"SET LOCAL TIME ZONE 'UTC'","SET LOCAL statement_timeout = '10000ms'"]);assert.match(calls[4].text,/DECLARE blaze_cursor.*CASE WHEN/);assert.match(calls[4].text,/LIMIT 1001/);assert.equal(calls.at(-1),'COMMIT');assert.equal(end.mock.callCount(),1);
  queryMock.mock.mockImplementation(async arg=>({rows:arg==='SELECT pg_backend_pid() AS pid'?[{pid:1234}]:typeof arg==='object'&&arg.text.startsWith('FETCH')?[[null,'t']]:[]}));
  await assert.rejects(streamPrepPostgres(pipeline,[source],{connectionEnv:variable},{},limits,sink()),/OVERSIZE/);assert.equal(end.mock.callCount(),2);
});
test('memory queries use shared datetime, filters, table and level-aware calculations',()=>{
  const columns=[{name:'region',type:'STRING'},{name:'amount',type:'DECIMAL'},{name:'at',type:'DATETIME'}],rows=[['East',2,'2026-09-01T00:00:00.000Z'],['West',3,'2026-09-02T00:00:00.000Z'],['East',5,'2026-09-03T00:00:00.000Z']];
  const query={dimensions:[{fieldId:'region',columnName:'region'}],measures:[{fieldId:'share',columnName:'share',aggregation:'SUM'}],filters:[{columnName:'region',value:'East'}],calculatedFields:[{name:'share',expression:'sum({amount}) / min(sumOver({amount}, [], PRE_FILTER))'}]};
  assert.deepEqual(queryPrepared(columns,rows.length,(r,c)=>rows[r][c],query).rows,[{region:'East',share:0.7}]);
  const monthly={dimensions:[{fieldId:'month',columnName:'at',granularity:'MONTH'}],measures:[{fieldId:'total',columnName:'amount',aggregation:'SUM'}],filters:[]};
  assert.deepEqual(queryPrepared(columns,rows.length,(r,c)=>rows[r][c],monthly).rows,[{month:'2026-09',total:10}]);
});
