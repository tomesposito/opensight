import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { privateDirectory } from './operator.mjs';
process.umask(0o077);
const selected=process.argv[2],root=privateDirectory(process.env.OPENSIGHT_OPERATOR_DIR);
if(!/^[a-f0-9]{64}$/.test(selected??''))throw Error('MAINTENANCE_SELECTION_INVALID');
const read=p=>{const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.mode&0o077||s.uid!==process.getuid())throw Error('PRIVATE_FILE_UNSAFE');return readFileSync(p);};
const bytes=read(join(root,'maintenance-config.json')),c=JSON.parse(bytes),hash=b=>createHash('sha256').update(b).digest('hex');
const run=args=>{try{return JSON.parse(execFileSync('aws',[...args,'--region',c.region,'--no-cli-pager','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})||'{}');}catch{throw Error('MAINTENANCE_AWS_FAILED');}};
const identity=run(['sts','get-caller-identity']);
if(identity.Account!==c.account||/:assumed-role\/[^/]*-ci-[^/]+\//.test(identity.Arn))throw Error('INDEPENDENT_OPERATOR_REQUIRED');
const path=join(root,randomUUID());run(['s3api','get-object','--bucket',c.operationsBucket,'--key',`maintenance/invocations/${selected}.json`,path]);
const record=read(path);if(hash(record)!==selected)throw Error('MAINTENANCE_SELECTION_CHANGED');
const input=JSON.parse(record);
if(input.version!==1||!['snapshot','migrate','restore'].includes(input.mode)||input.configuration!==hash(bytes)||input.expiresAt<=Date.now()||input.expiresAt>Date.now()+86400000)throw Error('MAINTENANCE_INPUT_INVALID');
// This explicit local operation is the independent approval; workflow roles
// receive only GetObject on the approval prefix, never PutObject.
const approval=join(root,randomUUID());writeFileSync(approval,JSON.stringify({version:1,selection:selected,expiresAt:Math.min(input.expiresAt,Date.now()+4*3600000)}),{mode:0o600});
run(['s3api','put-object','--bucket',c.operationsBucket,'--key',`maintenance/approvals/${selected}.json`,'--body',approval,'--if-none-match','*','--server-side-encryption','aws:kms','--ssekms-key-id',c.kmsKey,'--bucket-key-enabled']);
console.log('MAINTENANCE_APPROVED '+selected);
