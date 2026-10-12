import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory } from './operator.mjs';
import { ciConfig } from './ci-policy.mjs';
import { digest, validateManifest } from './release-manifest.mjs';
process.umask(0o077);
const [operation, source] = process.argv.slice(2), root = privateDirectory(process.env.OPENSIGHT_OPERATOR_DIR);
if (!['approve','approve-rollback-exercise','preflight','deploy'].includes(operation) || !/^[a-f0-9]{40}$/.test(source ?? '')) throw Error('CI_RELEASE_COMMAND_INVALID');
const configPath=join(root,'ci-config.json'),stat=lstatSync(configPath);
if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077||stat.uid!==process.getuid())throw Error('PRIVATE_CONFIG_UNSAFE');
const c=ciConfig(JSON.parse(readFileSync(configPath,'utf8'))), dir=join(root,'ci-release-'+source);
mkdirSync(dir,{recursive:true,mode:0o700});
function run(bin,args){try{return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});}catch{throw Error('CI_RELEASE_COMMAND_FAILED');}}
const gh=args=>run(process.env.OPENSIGHT_GH_BINARY??'gh',args);
const aws=(s,a,input={},extra=[])=>JSON.parse(run('aws',[s,a,'--region',c.region,'--no-cli-pager','--output','json','--cli-input-json',JSON.stringify(input),...extra])||'{}');
const identity=aws('sts','get-caller-identity');
if(identity.Account!==c.account||/:assumed-role\/[^/]*-ci-(read|deploy)\//.test(identity.Arn))throw Error('INDEPENDENT_OPERATOR_REQUIRED');
gh(['release','download','build-'+source,'--repo',c.publicRepository,'--pattern','release.json','--dir',dir,'--clobber']);
const path=join(dir,'release.json'),bytes=readFileSync(path),m=validateManifest(JSON.parse(bytes));
if(m.source!==source||m.repository!==c.publicRepository)throw Error('RELEASE_SOURCE_MISMATCH');
gh(['attestation','verify',path,'--repo',c.publicRepository,'--signer-workflow',c.publicRepository+'/.github/workflows/ci.yml','--signer-digest',source,'--source-digest',source,'--source-ref','refs/heads/master','--deny-self-hosted-runners']);
const manifest=digest(bytes);
if(operation.startsWith('approve')){
  const currentPath=join(dir,'current.json');aws('s3api','get-object',{Bucket:c.operationsBucket,Key:'ci/releases/current.json'},[currentPath]);
  const current=JSON.parse(readFileSync(currentPath));
  if(current.compatibility!==m.compatibility)throw Error('COMPATIBILITY_REVIEW_REQUIRED');
  // This explicit operator action is the independent approval; CI has no write
  // permission to this prefix. Human review must include semantic compatibility.
  const approval={version:1,source,manifest,configuration:digest(readFileSync(configPath)),current:current.id,expiresAt:Date.now()+4*3600000,...(operation==='approve-rollback-exercise'?{exerciseRollback:true}:{})};
  const approvalPath=join(dir,'approval.json');writeFileSync(approvalPath,JSON.stringify(approval)+'\n',{mode:0o600});
  aws('s3api','put-object',{Bucket:c.operationsBucket,Key:'ci/approvals/'+manifest+'.json',ServerSideEncryption:'aws:kms',SSEKMSKeyId:c.kmsKey,BucketKeyEnabled:true},['--body',approvalPath]);
  console.log('APPROVED_MANIFEST '+manifest+' (expires in four hours)');
}else{
  gh(['workflow','run','deploy.yml','--repo',c.privateRepository,'--ref','master','--field','mode='+operation,'--field','source='+source,'--field','manifest='+manifest]);
  console.log('PRIVATE_'+operation.toUpperCase()+'_DISPATCHED');
}
