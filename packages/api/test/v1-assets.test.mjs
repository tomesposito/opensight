import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApiServer } from '../dist/index.js';
import { authFixture } from './hosted-helpers.mjs';
import { serving } from './v1-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { upload } from './source-helpers.mjs';
const at = v => ({ 'If-Match': `"${v}"` });
const input = (id, name = id) => ({ analysisId: id, name, definition: { dataSetIdentifierDeclarations: [], sheets: [], calculatedFields: [], filterGroups: [], opaque: { KeepCase: ['unchanged'] } }, datasetBindings: {} });
function good(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.body)); return r; }
function error(r, status, code) { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.errorCode, code); }
async function local(t, authenticated = true) {
  const directory = await mkdtemp(join(tmpdir(), 'opensight-assets-')), root = join(directory, 'data'), securityPath = join(directory, 'security.json');
  await cp(resolve('../../fixtures/renderable-sales'), root, { recursive: true });
  const users = ['admin','author','peer','reader'].map(id => ({ id, namespaceId: 'default', name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' }));
  const security = { storePath: securityPath, authenticate: async req => ({ namespaceId: 'default', userId: String(req.headers.authorization ?? 'Bearer author').slice(7) }), initialState: { version: 1, namespaces: [{ id: 'default', name: 'Default' }], users, groups: [{ namespaceId: 'default', id: 'team', name: 'Team', userIds: ['author','peer'] }], datasets: [], folders: [
    { namespaceId: 'default', id: 'shared', name: 'Shared' },
    { namespaceId: 'default', id: 'private', name: 'Private', grants: [{ principal: { type: 'user', id: 'admin' }, role: 'co-owner' }] },
    { namespaceId: 'default', id: 'view-only', name: 'View', grants: [{ principal: { type: 'user', id: 'author' }, role: 'viewer' }] },
  ] } };
  let server;
  const close = async () => { if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); };
  const start = async () => { server = await createApiServer({ dataRoot: root, prepStorePath: join(directory, 'prep.json'), ...(authenticated ? { security } : {}) }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); };
  await start(); t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { method = 'GET', body, headers = {}, user = 'author' } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { ...(authenticated ? { Authorization: `Bearer ${user}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(bytes);
  });
  return { request, restart: async () => { await close(); await start(); }, state: async () => JSON.parse(await readFile(securityPath, 'utf8')) };
}
async function hosted(t, env = {}) {
  const f = await authFixture(t), call = await serving(t, f, env), metadata = new TenantMetadata(f.db, f.db);
  let token = (await f.login()).token;
  const identity = await f.auth.verify(token), context = () => metadata.authenticate(null, async () => identity);
  const request = (p,o = {}) => call(p, { token, ...o }), renew = async () => { token = (await f.login()).token; };
  return { ...f, request, metadata, context, identity, renew, restart: async () => {} };
}
async function create(f,id,name) { return good(await f.request('/api/v1/analyses', { method: 'POST', body: input(id,name) }), 201); }
const asset = (id, action, kind = 'analyses') => `/api/v1/assets/${kind}/${id}/${action}`;
const share = (id, user = 'peer', kind = 'analyses') => `/api/v1/${kind}/${id}/shares/user/${user}`;
for (const [plane, fixture] of [['local',local], ['local-open',t => local(t,false)], ['hosted',hosted]]) {
  test(`v1 assets ${plane}: list, search, pagination, durable copy, opaque definition and retry conflict`, async t => {
    const f = await fixture(t); await create(f,'first','QA Quarterly SALES'); await create(f,'second','QA Sales forecast');
    const list = good(await f.request('/api/v1/assets/analyses', { headers: { Limit: '1' } })).body;
    assert.equal(list.items.length,1); assert.equal(typeof list.nextCursor,'string'); assert.deepEqual(Object.keys(list.items[0]).sort(),['folderId','id','kind','name']);
    const next = good(await f.request('/api/v1/assets/analyses', { headers: { Cursor: list.nextCursor } })).body; assert.ok(next.items.every(x => x.id !== list.items[0].id));
    const search = good(await f.request('/api/v1/assets/search', { method: 'POST', body: { query: 'qA ', kinds: ['analyses'] }, headers: { Limit:'1' } })).body;
    assert.equal(search.items[0].id,'second');
    const rest = good(await f.request('/api/v1/assets/search', { method: 'POST', body: { query: 'qA ', kinds: ['analyses'] }, headers: { Limit:'1', Cursor:search.nextCursor } })).body;
    assert.equal(rest.items[0].id,'first'); assert.equal(rest.nextCursor,null);
    for (const kind of ['dashboards','datasets']) assert.equal(good(await f.request(`/api/v1/assets/${kind}`)).body.nextCursor,null);
    error(await f.request('/api/v1/assets', { headers: { Limit:'0' } }),400,'INVALID_PAGINATION');
    const options = { method:'POST', body:{newId:'copy'}, headers:{'Idempotency-Key':'copy-once'} };
    const copies = await Promise.all([f.request(asset('first','copy'),options), f.request(asset('first','copy'),options)]); copies.forEach(r => good(r,201)); assert.deepEqual(copies[0].body,copies[1].body);
    assert.equal(copies[1].headers['idempotent-replayed'],'true');
    error(await f.request(asset('first','copy'),{...options,body:{newId:'different'}}),409,'IDEMPOTENCY_CONFLICT');
    error(await f.request(asset('first','copy'),{method:'POST',body:{newId:'copy'}}),409,'ASSET_ID_CONFLICT');
    assert.deepEqual(good(await f.request('/api/v1/analyses/copy')).body.Definition, good(await f.request('/api/v1/analyses/first')).body.Definition);
    await f.restart(); assert.equal(good(await f.request('/api/v1/analyses/copy')).body.Name,'QA Quarterly SALES');
    error(await f.request(asset('copy','move','datasets'),{method:'POST',body:{folderId:null}}),409,'ASSET_KIND_UNSUPPORTED');
  });
}

test('v1 assets: readable set, reader copy, co-owner grants, namespace principals and both-must-allow folders', async t => {
  const f = await local(t); await create(f,'owned','Secret name');
  assert.ok(!good(await f.request('/api/v1/assets',{user:'peer'})).body.items.some(a => a.id === 'owned'));
  assert.equal(good(await f.request('/api/v1/assets/search',{user:'peer',method:'POST',body:{query:'Secret name'}})).body.items.length,0);
  const original = good(await f.request('/api/v1/analyses/owned')).body.Definition;
  error(await f.request(share('owned'),{method:'PUT',body:{role:'viewer'}}),428,'V1_IF_MATCH_REQUIRED');
  error(await f.request(share('owned'),{method:'PUT',body:{role:'viewer'},headers:at(999)}),412,'ASSET_PRECONDITION_FAILED');
  good(await f.request(share('owned'),{method:'PUT',body:{role:'viewer'},headers:at(1)}));
  for (const method of ['GET','PUT','DELETE']) error(await f.request(share('owned'),{user:'peer',method,...(method==='PUT'?{body:{role:'co-owner'},headers:at(2)}:{})}),403,'METADATA_WRITE_FORBIDDEN');
  error(await f.request(asset('owned','move'),{user:'peer',method:'POST',body:{folderId:null}}),403,'METADATA_WRITE_FORBIDDEN');
  good(await f.request(asset('owned','copy'),{user:'peer',method:'POST',body:{newId:'peer-copy'}}),201);
  assert.deepEqual((await f.state()).assets.find(a=>a.id==='peer-copy').grants,[{principal:{type:'user',id:'peer'},role:'co-owner'}]);
  error(await f.request(asset('owned','move'),{method:'POST',body:{folderId:'private'}}),403,'ASSET_FOLDER_FORBIDDEN');
  error(await f.request(asset('owned','move'),{method:'POST',body:{folderId:'missing'}}),409,'ASSET_FOLDER_NOT_FOUND');
  error(await f.request(share('owned','unknown'),{method:'PUT',body:{role:'viewer'},headers:at(2)}),400,'ASSET_PRINCIPAL_NOT_FOUND');
  const move = {method:'POST',body:{folderId:'shared'},headers:{'Idempotency-Key':'move-once'}};
  good(await f.request(asset('owned','move'),move)); assert.equal(good(await f.request(asset('owned','move'),move)).headers['idempotent-replayed'],'true');
  assert.deepEqual(good(await f.request('/api/v1/analyses/owned')).body.Definition,original);
  good(await f.request(asset('owned','move'),{method:'POST',body:{folderId:'view-only'}}));
  error(await f.request(asset('owned','move'),{method:'POST',body:{folderId:null}}),403,'METADATA_WRITE_FORBIDDEN');
  good(await f.request(asset('owned','move'),{user:'admin',method:'POST',body:{folderId:null}}));
});

test('v1 assets: folder rename, permissions CAS, empty delete, inherited access and retries', async t => {
  const f=await local(t); await create(f,'a');
  good(await f.request(asset('a','move'),{method:'POST',body:{folderId:'shared'}}));
  error(await f.request('/api/v1/folders/shared',{method:'DELETE'}),409,'FOLDER_NOT_EMPTY');
  assert.equal(good(await f.request('/api/v1/folders/shared/assets')).body.items[0].id,'a');
  error(await f.request('/api/v1/folders/shared',{method:'PUT',body:{name:'Renamed'}}),428,'V1_IF_MATCH_REQUIRED');
  const options={method:'PUT',body:{name:'Renamed'},headers:{...at(1),'Idempotency-Key':'rename'}};
  good(await f.request('/api/v1/folders/shared',options)); assert.equal(good(await f.request('/api/v1/folders/shared',options)).headers['idempotent-replayed'],'true');
  assert.equal(good(await f.request('/api/v1/folders/shared')).body.Name,'Renamed');
  error(await f.request('/api/v1/folders/shared/permissions',{method:'PUT',body:{grants:null},headers:at(1)}),412,'ASSET_PRECONDITION_FAILED');
  const grant={principal:{type:'user',id:'author'},role:'co-owner'};
  error(await f.request('/api/v1/folders/shared/permissions',{method:'PUT',body:{grants:[grant,grant]},headers:at(2)}),400,'ASSET_DUPLICATE_PRINCIPAL');
  good(await f.request('/api/v1/folders/shared/permissions',{method:'PUT',body:{grants:[grant]},headers:at(2)}));
  assert.equal(good(await f.request('/api/v1/folders/shared/permissions')).body.Grants.length,1);
  good(await f.request('/api/v1/folders/shared/permissions',{method:'PUT',body:{grants:null},headers:at(3)}));
  good(await f.request(asset('a','move'),{method:'POST',body:{folderId:null}}));
  const del={method:'DELETE',headers:{'Idempotency-Key':'delete-folder'}};
  good(await f.request('/api/v1/folders/shared',del)); assert.equal(good(await f.request('/api/v1/folders/shared',del)).headers['idempotent-replayed'],'true');
  good(await f.request(share('a','author'),{method:'DELETE',headers:{'Idempotency-Key':'clear-last'}}));
  assert.equal(good(await f.request(share('a','author'),{method:'DELETE',headers:{'Idempotency-Key':'clear-last'}})).headers['idempotent-replayed'],'true');
  assert.ok(good(await f.request('/api/v1/assets',{user:'peer'})).body.items.some(a=>a.id==='a'));
  await f.restart(); assert.ok(good(await f.request('/api/v1/assets',{user:'peer'})).body.items.some(a=>a.id==='a'));
});

for (const [plane,fixture] of [['local',local],['hosted',hosted]]) test(`v1 assets ${plane}: copy frozen dashboard, share revision, deletes preserve publications and sever republish`,async t=>{
  const f=await fixture(t); await create(f,'source','Frozen');
  const published=good(await f.request('/api/v1/analyses/source/publish',{method:'POST',body:{}}),201).body.DashboardId;
  const frozen=good(await f.request(`/api/v1/dashboards/${published}/versions/1`)).body;
  const {analysisId,...update}=input('source','Live draft'); good(await f.request('/api/v1/analyses/source',{method:'PUT',body:update,headers:at(1)}));
  good(await f.request(asset(published,'copy','dashboards'),{method:'POST',body:{newId:'frozen-copy'}}),201);
  const copied=good(await f.request('/api/v1/dashboards/frozen-copy')).body;
  assert.equal(copied.Name,'Frozen'); assert.deepEqual(copied.Definition,frozen.Definition);
  const target=plane==='local'?'author':f.identity.userId;
  const shares=share(published,target,'dashboards');
  good(await f.request(shares,{method:'PUT',body:{role:'co-owner'},headers:at(1)}));
  error(await f.request(shares,{method:'PUT',body:{role:'co-owner'},headers:at(1)}),412,'ASSET_PRECONDITION_FAILED');
  assert.deepEqual(good(await f.request(`/api/v1/dashboards/${published}/versions/1`)).body,frozen);
  assert.equal(good(await f.request(`/api/v1/dashboards/${published}`)).headers.etag,'"2"');
  error(await f.request('/api/v1/analyses/source',{method:'DELETE'}),428,'V1_IF_MATCH_REQUIRED');
  const del={method:'DELETE',headers:{...at(2),'Idempotency-Key':'delete-source'}};
  good(await f.request('/api/v1/analyses/source',del)); assert.equal(good(await f.request('/api/v1/analyses/source',del)).headers['idempotent-replayed'],'true');
  assert.deepEqual(good(await f.request(`/api/v1/dashboards/${published}/versions/1`)).body,frozen);
  await create(f,'source'); error(await f.request('/api/v1/analyses/source/publish',{method:'POST',body:{dashboardId:published}}),409,'DASHBOARD_SOURCE_MISMATCH');
  error(await f.request(`/api/v1/dashboards/${published}`,{method:'DELETE'}),428,'V1_IF_MATCH_REQUIRED');
  const current=good(await f.request(`/api/v1/dashboards/${published}`)).headers.etag;
  good(await f.request(`/api/v1/dashboards/${published}`,{method:'DELETE',headers:{'If-Match':current}}));
  error(await f.request(shares),404,'RESOURCE_NOT_FOUND');
});

test('v1 assets hosted: dataset reference guard is fail-closed and owner scoped',async t=>{
  const f=await hosted(t);
  const source=good(await f.request('/api/uploads',{method:'POST',body:upload()}),201); await f.renew();
  good(await f.request('/api/datasets/prepared/prep',{method:'PUT',body:{name:'Prepared',pipeline:{version:1,input:source.body.id,steps:[]},expectedVersion:0}})); await f.renew();
  const body=input('bound'); body.definition.dataSetIdentifierDeclarations=[{identifier:'data',dataSetArn:'urn:synthetic:dataset'}]; body.datasetBindings={data:{kind:'prepared-dataset',id:'prepared'}};
  good(await f.request('/api/v1/analyses',{method:'POST',body}),201);
  assert.equal(good(await f.request('/api/v1/datasets/prepared')).headers.etag,'"1"');
  error(await f.request('/api/v1/datasets/prepared',{method:'DELETE',headers:at(1)}),409,'DATASET_DELETE_BLOCKED_BY_ANALYSIS');
  good(await f.request('/api/v1/analyses/bound',{method:'DELETE',headers:at(1)}));
  const del={method:'DELETE',headers:{...at(1),'Idempotency-Key':'dataset-delete'}};
  good(await f.request('/api/v1/datasets/prepared',del)); if (f.renew) await f.renew(); assert.equal(good(await f.request('/api/v1/datasets/prepared',del)).headers['idempotent-replayed'],'true');
});

test('v1 assets: mere dashboard reader copies frozen definition with only creator grant and no prepared-data delegation',async t=>{
  const f=await local(t); await create(f,'a');
  const id=good(await f.request('/api/v1/analyses/a/publish',{method:'POST',body:{}}),201).body.DashboardId;
  good(await f.request(share(id,'reader','dashboards'),{method:'PUT',body:{role:'viewer'},headers:at(1)}));
  const copy=good(await f.request(asset(id,'copy','dashboards'),{user:'reader',method:'POST',body:{newId:'reader-copy'}}),201);
  assert.equal(copy.body.Id,'reader-copy');
  const state=await f.state(); assert.deepEqual(state.assets.find(a=>a.id==='reader-copy').grants,[{principal:{type:'user',id:'reader'},role:'co-owner'}]);
  for(const method of ['GET','PUT','DELETE']) error(await f.request(share('reader-copy','reader','dashboards'),{user:'reader',method,...(method==='PUT'?{body:{role:'viewer'},headers:at(1)}:{})}),403,'METADATA_WRITE_FORBIDDEN');
  error(await f.request('/api/v1/dashboards/reader-copy',{user:'reader',method:'DELETE',headers:at(1)}),403,'METADATA_WRITE_FORBIDDEN');
});

test('v1 assets hosted: author co-owner changes shares and folders, read-only copies retain owner pins',async t=>{
  const {readerMember}=await import('./embed-content-helpers.mjs');
  const f=await hosted(t), peer=await readerMember(f); await f.renew();
  const member=await f.metadata.get(await f.context(),{kind:'user',id:peer.identity.userId});
  await f.metadata.put(await f.context(),{kind:'user',id:member.id},{...member.body,role:'author'},member.version); await f.renew();
  const token=(await peer.login()).token, call=await serving(t,f);
  await create(f,'a');
  const principal=peer.identity.userId;
  good(await f.request(share('a',principal),{method:'PUT',body:{role:'co-owner'},headers:at(1)}));
  const co=(path,opts={})=>call(path,{token,...opts});
  good(await co(share('a',principal)));
  const context=await f.context();
  await f.metadata.put(context,{kind:'folder',id:'work'},{name:'Work'}); await f.renew();
  const renewed=(await peer.login()).token;
  good(await call(asset('a','move'),{token:renewed,method:'POST',body:{folderId:'work'}}));
  good(await call('/api/v1/folders/work',{token:renewed,method:'PUT',body:{name:'Team work'},headers:at(1)}));
  good(await call(share('a',principal),{token:renewed,method:'PUT',body:{role:'viewer'},headers:at(3)}));
  error(await call(share('a',principal),{token:renewed}),403,'METADATA_WRITE_FORBIDDEN');
  good(await call(asset('a','copy'),{token:renewed,method:'POST',body:{newId:'peer-owned'}}),201);
  const copied=await f.metadata.get(await f.context(),{kind:'analysis',id:'peer-owned'});
  assert.deepEqual(copied.body.grants,[{principal:{type:'user',id:principal},role:'co-owner'}]);
});

test('v1 assets: concurrent share CAS admits one writer and replay rechecks revocation',async t=>{
  const f=await local(t); await create(f,'a');
  const responses=await Promise.all(['peer','reader'].map(user=>f.request(share('a',user),{method:'PUT',body:{role:'co-owner'},headers:at(1)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,412]);
  const move={method:'POST',body:{folderId:null},headers:{'Idempotency-Key':'movable'}};
  good(await f.request(asset('a','move'),move));
  good(await f.request(share('a','author'),{user:'admin',method:'DELETE'}));
  error(await f.request(asset('a','move'),move),403,'METADATA_WRITE_FORBIDDEN');
  error(await f.request(asset('a','copy'),{method:'POST',body:{newId:'bad',tenantId:'other'}}),400,'METADATA_INVALID');
  error(await f.request('/api/v1/assets',{headers:{'X-User-Id':'forged'}}),403,'FORGED_PRINCIPAL');
});

test('v1 assets: all routes share the tenant rate limit and reserved scope rejects explicitly',async t=>{
  const f=await hosted(t,{OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE:'1'});
  error(await f.request('/api/v1/assets/search',{method:'POST',body:{query:'',scope:{folderId:null}}}),422,'ASSET_SCOPE_UNSPECIFIED');
  for(const [method,path,body] of [
    ['GET','/api/v1/assets'],...['analyses','dashboards','datasets'].map(k=>['GET',`/api/v1/assets/${k}`]),
    ['POST','/api/v1/assets/search',{query:''}],['POST',asset('a','move'),{folderId:null}],['POST',asset('a','copy'),{newId:'b'}],
    ...['GET','PUT','DELETE'].map(m=>[m,share('a'),m==='PUT'?{role:'viewer'}:undefined]),
    ...['analyses','dashboards','datasets'].map(k=>['DELETE',`/api/v1/${k}/a`]),
    ['GET','/api/v1/folders'],['GET','/api/v1/folders/f/assets'],['GET','/api/v1/folders/f/permissions'],['PUT','/api/v1/folders/f/permissions',{grants:null}],
    ['GET','/api/v1/folders/f'],['PUT','/api/v1/folders/f',{name:'Name'}],['DELETE','/api/v1/folders/f'],
  ]) { const r=await f.request(path,{method,body,headers:at(1)}); error(r,429,'RATE_LIMIT_EXCEEDED'); assert.ok(Number(r.headers['retry-after'])>0); }
});

test('v1 assets local: prepared deletion uses durable store, current version and all analysis references',async t=>{
  const f=await local(t);
  const uploaded=good(await f.request('/api/uploads',{method:'POST',body:{config:{format:'csv'},base64:Buffer.from('amount\n2\n').toString('base64')}}),201);
  good(await f.request('/api/datasets/prepared/prep',{method:'PUT',body:{name:'Prepared',pipeline:{version:1,input:uploaded.body.id,steps:[]}}}),201);
  const body=input('bound'); body.definition.dataSetIdentifierDeclarations=[{identifier:'data',dataSetArn:'urn:synthetic:prepared'}]; body.datasetBindings={data:{kind:'prepared-dataset',id:'prepared'}};
  good(await f.request('/api/v1/analyses',{method:'POST',body}),201);
  error(await f.request('/api/v1/datasets/prepared',{method:'DELETE',headers:at(1)}),409,'DATASET_DELETE_BLOCKED_BY_ANALYSIS');
  good(await f.request('/api/v1/analyses/bound',{method:'DELETE',headers:at(1)}));
  error(await f.request('/api/v1/datasets/prepared',{method:'DELETE',headers:at(99)}),412,'ASSET_PRECONDITION_FAILED');
  const del={method:'DELETE',headers:{...at(1),'Idempotency-Key':'local-prep-delete'}};
  good(await f.request('/api/v1/datasets/prepared',del)); if (f.renew) await f.renew(); assert.equal(good(await f.request('/api/v1/datasets/prepared',del)).headers['idempotent-replayed'],'true');
  await f.restart(); assert.equal(good(await f.request('/api/v1/assets/datasets')).body.items.length,0);
});

test('v1 assets hosted: published copy preserves another owner pin and grants never authorize their prepared data',async t=>{
  const {readerMember}=await import('./embed-content-helpers.mjs');
  const f=await hosted(t), peer=await readerMember(f); await f.renew();
  const source=good(await f.request('/api/uploads',{method:'POST',body:upload()}),201); await f.renew();
  good(await f.request('/api/datasets/prepared/prep',{method:'PUT',body:{name:'Prepared',pipeline:{version:1,input:source.body.id,steps:[]},expectedVersion:0}})); await f.renew();
  const body=input('bound'); body.definition.dataSetIdentifierDeclarations=[{identifier:'data',dataSetArn:'urn:synthetic:dataset'}]; body.datasetBindings={data:{kind:'prepared-dataset',id:'prepared'}};
  good(await f.request('/api/v1/analyses',{method:'POST',body}),201);
  const id=good(await f.request('/api/v1/analyses/bound/publish',{method:'POST',body:{}}),201).body.DashboardId;
  good(await f.request(share(id,peer.identity.userId,'dashboards'),{method:'PUT',body:{role:'viewer'},headers:at(1)}));
  const token=(await peer.login()).token, call=await serving(t,f);
  good(await call(asset(id,'copy','dashboards'),{token,method:'POST',body:{newId:'reader-copy'}}),201);
  error(await call('/api/v1/dashboards/reader-copy/versions/1/visuals/total/query',{token,method:'POST',body:{}}),403,'DASHBOARD_DATASET_ACCESS_DENIED');
  assert.equal(good(await call('/api/v1/assets/datasets',{token})).body.items.length,0);
  const stored=await f.metadata.get(await f.context(),{kind:'dashboard',id:'reader-copy'});
  assert.equal(stored.body.published.versions[0].bindingOwnerId,f.identity.userId);
  assert.equal(stored.body.datasets[0].ownerId,f.identity.userId);
});
