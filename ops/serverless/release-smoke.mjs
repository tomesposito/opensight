import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
const c = JSON.parse(process.env.OPENSIGHT_SMOKE_CONFIG ?? '{}');
if (!c.tester || !/^https:\/\/[a-z0-9.-]+$/.test(c.origin ?? '') || !Array.isArray(c.foreignPaths)) throw Error('SMOKE_CONFIGURATION_REQUIRED');
const timer = setTimeout(() => { console.error('SMOKE_DEADLINE'); process.exit(1); }, 300000);
const pause = ms => new Promise(r => setTimeout(r, ms));
let token, lastStep = -1;
async function raw(path, method = 'GET', body, authenticated = true, extra = {}) {
  const response = await fetch(c.origin + '/api' + path, { method, redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(authenticated && token ? { authorization: 'Bearer '+token } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); let value; try { value = JSON.parse(text); } catch { throw Error('SMOKE_JSON_REQUIRED'); }
  return { status: response.status, body: value };
}
async function authenticate() {
  let step = Math.floor(Date.now()/30000);
  if (step <= lastStep) { await pause(30000-Date.now()%30000+200); step=Math.floor(Date.now()/30000); }
  const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',Buffer.from(c.tester.totpSecret,'base64')).update(bytes).digest(), offset=mac[19]&15;
  const code=String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');lastStep=step;
  const {email,password,tenantId}=c.tester;
  const response=await raw('/api/auth/login','POST',{email,password,tenantId,code},false);
  if(response.status!==200 || typeof response.body.token!=='string')throw Error('SMOKE_AUTHENTICATION_FAILED');({token}=response.body);
}
async function call(path,method='GET',body,expected=200,extra={}) {
  let r=await raw(path,method,body,true,extra);
  if(r.status===401){await authenticate();r=await raw(path,method,body,true,extra);}
  if(r.status!==expected)throw Error('SMOKE_HTTP_'+r.status+'_'+String(r.body.errorCode??'UNEXPECTED').replace(/[^A-Z0-9_]/g,''));
  return r.body;
}
try {
  const page=await fetch(c.origin,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(page.status!==200 || !(await page.text()).includes('OpenSight'))throw Error('SMOKE_FRONTEND_FAILED');
  let ready=false;
  for(let attempt=0;attempt<6;attempt++){
    const r=await raw('/api/startup','POST',{},false);
    if(r.status===200 && r.body.state==='ready'){ready=true;break;}
    if(r.status!==503 || r.body.errorCode!=='WORKSPACE_STARTING')throw Error('SMOKE_STARTUP_FAILED');
    await pause(5000);
  }
  if(!ready)throw Error('SMOKE_STARTUP_TIMEOUT');await authenticate();
  const session=await call('/api/session');assert.equal(session.tenantId,c.tester.tenantId);
  for(const path of c.foreignPaths){const r=await raw(path);if(![403,404].includes(r.status))throw Error('SMOKE_ISOLATION_FAILED');}
  if((await raw('/api/session','GET',undefined,false)).status!==401)throw Error('SMOKE_ANONYMOUS_ACCESS');
  const bytes=Buffer.from('region,amount\nEast,1\nWest,2\nEast,3\n');
  const reservation=await call('/api/uploads/reservations','POST',{byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('base64'),mediaType:'text/csv',config:{format:'csv'},expiresAt:new Date(Date.now()+3600000).toISOString(),policy:{rowLevel:false,rowRules:[]}},201,{'idempotency-key':randomUUID()});
  const put=await fetch(reservation.put.url,{method:'PUT',headers:reservation.put.headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(25000)});
  if(put.status!==200 || !put.headers.get('x-amz-version-id'))throw Error('SMOKE_UPLOAD_FAILED');
  const accepted=await call('/api/uploads/reservations/'+reservation.id+'/complete','POST',{versionId:put.headers.get('x-amz-version-id')},202,{'idempotency-key':randomUUID()});
  let operation;
  for(let attempt=0;attempt<40;attempt++){
    await pause(2000);operation=await call('/api/operations/'+accepted.id);
    if(operation.state==='completed')break;
    if(!['queued','running'].includes(operation.state))throw Error('SMOKE_INGESTION_FAILED');
  }
  if(operation?.state!=='completed')throw Error('SMOKE_INGESTION_TIMEOUT');
  const sourceId=operation.sourceId,datasetId='ci_'+randomUUID().replaceAll('-','');
  await call('/api/datasets/'+datasetId+'/prep','PUT',{name:'Synthetic release check',expectedVersion:0,pipeline:{version:1,input:sourceId,steps:[{id:'aggregate',kind:'aggregate',config:{groupBy:['region'],measures:[{column:'amount',name:'revenue',aggregation:'SUM'}]}}]}});
  const refreshed=await call('/api/datasets/'+datasetId+'/refresh','POST',{});assert.equal(refreshed.state,'ready');
  const query=await call('/api/datasets/'+datasetId+'/query','POST',{dimensions:[{fieldId:'region',columnName:'region'}],measures:[{fieldId:'total',columnName:'revenue',aggregation:'SUM'}],filters:[]});
  assert.deepEqual(Object.fromEntries(query.rows.map(r=>[r.region,r.total])),{East:4,West:2});
  const prep=await call('/api/datasets/'+datasetId+'/prep');
  await call('/api/datasets/'+datasetId+'/prep','DELETE',{expectedVersion:prep.version});
  const source=await call('/api/sources/'+sourceId+'/policy');
  await call('/api/sources/'+sourceId,'DELETE',{expectedVersion:source.version});
  console.log('PUBLIC_HTTPS_AUTH_UPLOAD_INGESTION_REFRESH_QUERY_ISOLATION_VERIFIED');
} catch (error) { console.error(/^SMOKE_[A-Z0-9_]+$/.test(error.message) ? error.message : 'SMOKE_FAILED');process.exitCode=1; }
finally { clearTimeout(timer); }
