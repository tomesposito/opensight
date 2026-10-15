import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { privateDirectory } from './operator.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error(code); };
export function planPolicy(plan, allowedTypes) {
  if (plan?.errored || !plan?.format_version || !Array.isArray(plan.resource_changes) || !Array.isArray(allowedTypes) || !allowedTypes.length) fail('PLAN_INVALID');
  for (const r of plan.resource_changes) {
    const actions=r.change?.actions;
    if(!Array.isArray(actions)||actions.some(a=>!['no-op','read','create','update'].includes(a)))fail('PLAN_DESTRUCTIVE_CHANGE');
    if(actions.every(a=>['no-op','read'].includes(a)))continue;
    // Bootstrap, trust, keys, permanent credentials and paid egress remain under
    // separate operator custody, even if an input allowlist accidentally names them.
    if(!allowedTypes.includes(r.type)||/^aws_(iam_|kms_|secretsmanager_secret_version|nat_gateway|eip$)/.test(r.type))fail('PLAN_PRIVILEGED_CHANGE');
    if(r.type==='aws_rds_cluster'&&(r.change.after?.serverlessv2_scaling_configuration?.[0]?.min_capacity!==0||r.change.after?.serverlessv2_scaling_configuration?.[0]?.max_capacity>2))fail('PLAN_CAPACITY_INVALID');
    if(r.type==='aws_lambda_provisioned_concurrency_config')fail('PLAN_CAPACITY_INVALID');
  }
  return true;
}
export function verifyPlan(envelope, binding, binary, state, now=Date.now()) {
  if(envelope?.version!==1||!Number.isSafeInteger(envelope.createdAt)||!Number.isSafeInteger(envelope.expiresAt)||envelope.createdAt>now||envelope.expiresAt<=now||envelope.expiresAt-envelope.createdAt>86400000)fail('PLAN_EXPIRED');
  if(JSON.stringify(envelope.binding)!==JSON.stringify(binding)||envelope.binary!==hash(binary))fail('PLAN_INPUT_CHANGED');
  if(envelope.state!==hash(state))fail('PLAN_STATE_CHANGED');
}
export async function savedPlanMain(args=process.argv.slice(2), env=process.env) {
  process.umask(0o077);
  const [command,selected]=args;
  if(!['plan','approve','apply'].includes(command)||command!=='plan'&&!/^[a-f0-9]{64}$/.test(selected??''))fail('PLAN_COMMAND_INVALID');
  const root=privateDirectory(env.OPENSIGHT_OPERATOR_DIR), configPath=join(root,'maintenance-config.json');
  const privateRead=path=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.mode&0o077||s.uid!==process.getuid())fail('PRIVATE_FILE_UNSAFE');return readFileSync(path);};
  const configBytes=privateRead(configPath), c=JSON.parse(configBytes), repo=resolve(env.OPENSIGHT_PUBLIC_CHECKOUT??'.');
  if(c.version!==1||!/^ops\/serverless\/[a-z][a-z0-9/-]+$/.test(c.root??'')||c.root.split('/').includes('..')||!/^\d{12}$/.test(c.account??'')||!/^us-[a-z]+-\d$/.test(c.region??''))fail('MAINTENANCE_CONFIG_INVALID');
  if(Object.keys(env).some(k=>k.startsWith('TF_CLI_ARGS')||k.startsWith('TF_VAR_')))fail('UNBOUND_TOFU_ARGUMENT');
  const output=join(root,'saved-plans');mkdirSync(output,{recursive:true,mode:0o700});
  const run=(bin,args,options={})=>{try{return execFileSync(bin,args,{cwd:repo,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe'],...options});}catch{fail('MAINTENANCE_COMMAND_FAILED');}};
  const aws=(service,action,input={},extra=[])=>JSON.parse(run('aws',[service,action,'--region',c.region,'--output','json','--no-cli-pager',...(service==='s3api'&&action==='get-object'?['--bucket',c.operationsBucket,'--key',input.Key]:['--cli-input-json',JSON.stringify(input)]),...extra])||'{}');
  const get=key=>{const path=join(output,randomUUID());const meta=aws('s3api','get-object',{Key:key},[path]);return {bytes:privateRead(path),meta};};
  const put=(key,bytes,condition={})=>{const path=join(output,randomUUID());writeFileSync(path,bytes,{mode:0o600});return aws('s3api','put-object',{Bucket:c.operationsBucket,Key:key,ServerSideEncryption:'aws:kms',SSEKMSKeyId:c.kmsKey,BucketKeyEnabled:true,...condition},['--body',path]);};
  const json=(key,value,condition)=>put(key,JSON.stringify(value),condition);
  const identity=aws('sts','get-caller-identity');if(identity.Account!==c.account)fail('ACCOUNT_MISMATCH');
  const role=identity.Arn.match(/:assumed-role\/([^/]+)\//)?.[1];
  if(command==='approve') {
    if(role?.startsWith(c.deployment+'-ci-'))fail('INDEPENDENT_OPERATOR_REQUIRED');
    const e=get(`maintenance/plans/${selected}/envelope.json`);if(hash(e.bytes)!==selected)fail('PLAN_DIGEST_MISMATCH');
    const envelope=JSON.parse(e.bytes);if(envelope.expiresAt<=Date.now())fail('PLAN_EXPIRED');
    json(`maintenance/approvals/${selected}.json`,{version:1,plan:selected,configuration:hash(configBytes),expiresAt:Math.min(envelope.expiresAt,Date.now()+4*3600000)},{IfNoneMatch:'*'});
    console.log('SAVED_PLAN_APPROVED '+selected);return;
  }
  if(role!==`${c.deployment}-ci-${command}`)fail('SEPARATE_PLAN_APPLY_ROLE_REQUIRED');
  if(run('git',['status','--porcelain']).trim()||run('git',['rev-parse','HEAD']).trim()!==c.publicCommit||!/^[a-f0-9]{40}$/.test(c.privateCommit??'')||env.OPENSIGHT_PRIVATE_COMMIT!==c.privateCommit)fail('SOURCE_COMMIT_MISMATCH');
  const tofu=env.OPENSIGHT_TOFU_BINARY??'tofu', resolvedTofu=run('/usr/bin/which',[tofu]).trim();
  if(hash(readFileSync(resolvedTofu))!==c.tofuSha256)fail('TOOL_DIGEST_MISMATCH');
  const varPath=join(root,'maintenance.tfvars.json'),backendPath=join(root,'maintenance.backend.hcl'),lockPath=join(repo,c.root,'.terraform.lock.hcl');
  const backend=privateRead(backendPath),variables=privateRead(varPath),provider=readFileSync(lockPath);
  for(const line of [/^\s*use_lockfile\s*=\s*true\s*$/m,/^\s*encrypt\s*=\s*true\s*$/m,/^\s*kms_key_id\s*=\s*"[^"\n]+"\s*$/m])if(!line.test(backend.toString()))fail('ENCRYPTED_NATIVE_LOCK_REQUIRED');
  const files=run('git',['ls-files','-z','ops/serverless']).split('\0').filter(p=>p.endsWith('.tf')||p.endsWith('.terraform.lock.hcl'));
  const binding={publicCommit:c.publicCommit,privateCommit:c.privateCommit,configuration:hash(configBytes),root:c.root,modules:hash(JSON.stringify(files.map(p=>[p,hash(readFileSync(join(repo,p)))]))),variables:hash(variables),backend:hash(backend),provider:hash(provider),tool:c.tofuSha256,release:c.release};
  if(!/^[a-f0-9]{64}$/.test(c.release??''))fail('RELEASE_DIGEST_REQUIRED');
  const tofuEnv={...env,TF_IN_AUTOMATION:'1',TF_DATA_DIR:join(root,'tofu-maintenance')};
  const tf=args=>run(tofu,[`-chdir=${join(repo,c.root)}`,...args],{env:tofuEnv});
  if(JSON.parse(run(tofu,['version','-json'])).terraform_version!=='1.13.1')fail('TOOL_VERSION_MISMATCH');
  const operationId=randomUUID(),key='ci/operations/active.json';
  let operation={version:1,operationId,kind:command,phase:'prepared',plan:selected??null,at:Date.now()},etag=json(key,operation,{IfNoneMatch:'*'}).ETag,startedApply=false;
  const phase=name=>{operation={...operation,phase:name,at:Date.now()};etag=json(key,operation,{IfMatch:etag}).ETag;};
  try {
    tf(['init','-input=false','-reconfigure',`-backend-config=${backendPath}`]);if(hash(readFileSync(lockPath))!==binding.provider)fail('PROVIDER_LOCK_CHANGED');
    const state=Buffer.from(tf(['state','pull'])),parsed=JSON.parse(state);if(!parsed.lineage||!Number.isSafeInteger(parsed.serial))fail('STATE_INVALID');
    const planPath=join(output,operationId+'.tfplan');
    if(command==='plan') {
      tf(['plan','-input=false','-lock-timeout=30s',`-var-file=${varPath}`,`-out=${planPath}`]);
      const readable=JSON.parse(tf(['show','-json',planPath]));planPolicy(readable,c.allowedResourceTypes);
      const bytes=privateRead(planPath),createdAt=Date.now(),envelope={version:1,createdAt,expiresAt:createdAt+86400000,binding,state:hash(state),lineage:parsed.lineage,serial:parsed.serial,binary:hash(bytes)};
      const encoded=Buffer.from(JSON.stringify(envelope)),id=hash(encoded);
      put(`maintenance/plans/${id}/plan.tfplan`,bytes,{IfNoneMatch:'*'});put(`maintenance/plans/${id}/review.json`,JSON.stringify(readable),{IfNoneMatch:'*'});put(`maintenance/plans/${id}/envelope.json`,encoded,{IfNoneMatch:'*'});
      console.log('SAVED_PLAN '+id);
    } else {
      const encoded=get(`maintenance/plans/${selected}/envelope.json`).bytes;if(hash(encoded)!==selected)fail('PLAN_DIGEST_MISMATCH');
      const envelope=JSON.parse(encoded),bytes=get(`maintenance/plans/${selected}/plan.tfplan`).bytes,approval=JSON.parse(get(`maintenance/approvals/${selected}.json`).bytes);
      verifyPlan(envelope,binding,bytes,state);
      if(approval.version!==1||approval.plan!==selected||approval.configuration!==hash(configBytes)||approval.expiresAt<=Date.now()||approval.expiresAt>Date.now()+86400000)fail('PLAN_APPROVAL_REQUIRED');
      writeFileSync(planPath,bytes,{mode:0o600});planPolicy(JSON.parse(tf(['show','-json',planPath])),c.allowedResourceTypes);
      const drift=spawnSync(tofu,[`-chdir=${join(repo,c.root)}`,'plan','-refresh-only','-detailed-exitcode','-input=false','-lock-timeout=30s',`-var-file=${varPath}`,`-out=${join(output,operationId+'-drift.tfplan')}`],{env:tofuEnv,stdio:['ignore','pipe','pipe'],timeout:300000});
      if(drift.status!==0)fail('RESOURCE_DRIFT_REPLAN_REQUIRED');
      if(hash(tf(['state','pull']))!==envelope.state)fail('PLAN_STATE_CHANGED');
      // One immutable consumption record. An interrupted apply is not retried.
      json(`maintenance/consumed/${selected}.json`,{operationId,at:Date.now()},{IfNoneMatch:'*'});
      phase('applying');startedApply=true;tf(['apply','-input=false','-lock-timeout=30s',planPath]);
      const final=JSON.parse(tf(['state','pull']));if(final.lineage!==envelope.lineage||final.serial<envelope.serial)fail('STATE_REGRESSED');
      json(`maintenance/receipts/${selected}.json`,{version:1,operationId,plan:selected,stateSerial:final.serial,at:Date.now()},{IfNoneMatch:'*'});
      console.log('SAVED_PLAN_APPLIED '+selected);
    }
    phase('complete');json(`ci/operations/${operationId}.json`,operation,{IfNoneMatch:'*'});aws('s3api','delete-object',{Bucket:c.operationsBucket,Key:key,IfMatch:etag});
  } catch(error) {
    phase(startedApply?'apply-uncertain':'refused');json(`ci/operations/${operationId}.json`,operation,{IfNoneMatch:'*'});
    if(!startedApply)aws('s3api','delete-object',{Bucket:c.operationsBucket,Key:key,IfMatch:etag});
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) savedPlanMain().catch(e=>{console.error(e.message);process.exitCode=1;});
