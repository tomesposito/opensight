import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { privateDirectory } from './operator.mjs';
// Invoke an independently approved, already-created numeric maintenance runner.
// This workflow cannot create/update functions, change targets or fetch secrets.
process.umask(0o077);
const [mode,selected]=process.argv.slice(2),root=privateDirectory(process.env.OPENSIGHT_OPERATOR_DIR);
if(!['snapshot','restore','migrate'].includes(mode)||!/^[a-f0-9]{64}$/.test(selected??''))throw Error('MAINTENANCE_SELECTION_INVALID');
const read=path=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.mode&0o077)throw Error('PRIVATE_FILE_UNSAFE');return readFileSync(path);};
const c=JSON.parse(read(join(root,'maintenance-config.json'))),hash=b=>createHash('sha256').update(b).digest('hex');
const run=args=>{try{return JSON.parse(execFileSync('aws',[...args,'--region',c.region,'--no-cli-pager','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024})||'{}');}catch{throw Error('MAINTENANCE_AWS_FAILED');}};
const aws=(s,a,input)=>run([s,a,'--cli-input-json',JSON.stringify(input)]);
const get=key=>{const path=join(root,randomUUID());const meta=run(['s3api','get-object','--bucket',c.operationsBucket,'--key',key,path]);return {bytes:read(path),meta};};
const selectedObject=get(`maintenance/invocations/${selected}.json`);if(hash(selectedObject.bytes)!==selected)throw Error('MAINTENANCE_SELECTION_CHANGED');
const input=JSON.parse(selectedObject.bytes),approval=JSON.parse(get(`maintenance/approvals/${selected}.json`).bytes),identity=aws('sts','get-caller-identity',{});
if(identity.Account!==c.account||!identity.Arn.includes(`:assumed-role/${c.deployment}-ci-${mode==='restore'?'restore':'maintenance'}/`))throw Error('MAINTENANCE_ROLE_REQUIRED');
if(input.version!==1||input.mode!==mode||input.configuration!==hash(read(join(root,'maintenance-config.json')))||!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=Date.now()||input.expiresAt>Date.now()+86400000
 ||approval.version!==1||approval.selection!==selected||approval.expiresAt<=Date.now()||approval.expiresAt>input.expiresAt
 ||!new RegExp(`^arn:aws:lambda:${c.region}:${c.account}:function:${c.deployment}-[a-z0-9-]+:[1-9][0-9]*$`).test(input.runner??''))throw Error('MAINTENANCE_APPROVAL_REQUIRED');
const active=get('ci/operations/active.json'),lock=JSON.parse(active.bytes);
if(lock.operationId!==input.operationId||lock.planDigest!==input.planDigest||lock.phase!=='quiescent')throw Error('MAINTENANCE_OPERATION_REQUIRED');
const configuration=aws('lambda','get-function-configuration',{FunctionName:input.runner});
if(configuration.CodeSha256!==input.codeSha256||configuration.State!=='Active'||configuration.LastUpdateStatus!=='Successful'||configuration.Timeout>120||hash(JSON.stringify(configuration.Environment?.Variables??{}))!==input.environmentDigest)throw Error('MAINTENANCE_RUNNER_CHANGED');
// The fixed function plan independently rejects a production restore target and
// checks registry/key/object authority. Approval may not substitute booleans.
const payload=JSON.stringify({command:mode}),response=join(root,randomUUID());
const result=run(['lambda','invoke','--function-name',input.runner,'--cli-binary-format','raw-in-base64-out','--payload',payload,'--cli-read-timeout','150',response]);
const body=JSON.parse(read(response));if(result.FunctionError||body.state!==(mode==='restore'?'held':mode==='migrate'?'migrated':'registered'))throw Error('MAINTENANCE_INVOCATION_FAILED');
console.log(mode==='restore'?'RESTORE_HELD_FOR_MEMBERSHIP_REVIEW':mode==='migrate'?'MIGRATION_RECEIPT_VERIFIED':'BACKUP_REGISTERED');
