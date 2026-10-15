import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptancePlan } from '../ops/serverless/cloud-delivery-check.mjs';
const nonce='a'.repeat(12),deployment='os-accept-'+nonce;
const environment=()=>({OPENSIGHT_ACCEPTANCE_PLAN:JSON.stringify({version:1,nonce,deployment,database:'os_accept_'+nonce,recipient:'approved@example.test',expiresAt:Date.now()+3600000}),OPENSIGHT_DEPLOYMENT:deployment,OPENSIGHT_DB_NAME:'os_accept_'+nonce,OPENSIGHT_SCHEDULER_GROUP:deployment,...Object.fromEntries(['WORK','RECOVERY','SCHEDULER_DLQ'].map(x=>['OPENSIGHT_'+x+'_QUEUE_ARN',deployment+'-'+x.toLowerCase()]))});
test('cloud fixture refuses production databases, resource overrides and expired approval plans before AWS',()=>{
 const env=environment();env.OPENSIGHT_SCHEDULER_DLQ_ARN=deployment+'-dead';
 assert.equal(acceptancePlan(env).deployment,deployment);
 for(const key of ['OPENSIGHT_DB_NAME','OPENSIGHT_DEPLOYMENT','OPENSIGHT_WORK_QUEUE_ARN','OPENSIGHT_RECOVERY_QUEUE_ARN','OPENSIGHT_SCHEDULER_GROUP'])assert.throws(()=>acceptancePlan({...env,[key]:'production'}));
 const p=JSON.parse(env.OPENSIGHT_ACCEPTANCE_PLAN);
 for(const patch of [{expiresAt:Date.now()-1},{expiresAt:Date.now()+90000000},{sql:'SELECT 1'},{recipient:'x\r\nBcc: someone@example.test'}])assert.throws(()=>acceptancePlan({...env,OPENSIGHT_ACCEPTANCE_PLAN:JSON.stringify({...p,...patch})}));
});
