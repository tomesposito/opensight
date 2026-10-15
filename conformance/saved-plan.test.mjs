import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPlan, planPolicy } from '../ops/serverless/saved-plan.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
test('saved plan binds binary, all inputs, exact state and bounded independent review time',()=>{
 const binary=Buffer.from('saved binary'),state='state',binding={publicCommit:'a'.repeat(40),configuration:'b'.repeat(64)},now=100000;
 const p={version:1,createdAt:now-1,expiresAt:now+1000,binding,binary:hash(binary),state:hash(state)};
 verifyPlan(p,binding,binary,state,now);
 for(const patch of [{version:2},{expiresAt:now},{createdAt:now+1},{expiresAt:now+86400000},{binary:'x'},{binding:{...binding,configuration:'changed'}}])assert.throws(()=>verifyPlan({...p,...patch},binding,binary,state,now));
 assert.throws(()=>verifyPlan(p,binding,Buffer.from('different'),state,now),/PLAN_INPUT_CHANGED/);assert.throws(()=>verifyPlan(p,binding,binary,'new state',now),/PLAN_STATE_CHANGED/);
});
test('saved plan denies delete/replacement, IAM escalation, secrets and paid capacity even if allowlisted',()=>{
 const make=(type,actions=['update'],after={})=>({format_version:'1.2',resource_changes:[{type,change:{actions,after}}]});
 assert.ok(planPolicy(make('aws_lambda_function'),['aws_lambda_function']));
 for(const actions of [['delete'],['delete','create'],['create','delete'],['forget']])assert.throws(()=>planPolicy(make('aws_lambda_function',actions),['aws_lambda_function']),/DESTRUCTIVE/);
 for(const type of ['aws_iam_role','aws_iam_role_policy','aws_kms_key','aws_secretsmanager_secret_version','aws_nat_gateway','aws_eip'])assert.throws(()=>planPolicy(make(type),[type]),/PRIVILEGED/);
 assert.throws(()=>planPolicy(make('aws_rds_cluster'),['aws_rds_cluster']),/CAPACITY/);
 assert.ok(planPolicy(make('aws_rds_cluster',['update'],{serverlessv2_scaling_configuration:[{min_capacity:0,max_capacity:2}]}),['aws_rds_cluster']));
});
