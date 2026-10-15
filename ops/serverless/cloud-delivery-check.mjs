/** D-79 private, temporary acceptance runner. Never shipped as a public handler.
 * Its fixed deployment plan and temporary database/queues are operator-created.
 * No SQL, identity, recipient or resource override is accepted in an invocation.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { InvocationScope } from '../../packages/api/dist/runtime-scope.js';
import { InvocationAws, awsEnvironment, databaseUrl } from '../../packages/api/dist/runtime-aws.js';
import { invocationDatabases } from '../../packages/api/dist/runtime-postgres.js';
import { migrateServerless } from '../../packages/api/dist/serverless-migration.js';
import { TenantMetadata } from '../../packages/api/dist/metadata.js';
import { insertResource } from '../../packages/api/dist/metadata-resources.js';
import { DurableDispatch } from '../../packages/api/dist/dispatch.js';
import { serverlessTransport } from '../../packages/api/dist/serverless-application.js';
import { JobStore } from '../../packages/api/dist/job-store.js';
import { DurableJobs } from '../../packages/api/dist/durable-jobs.js';
import { JobRenderer } from '../../packages/api/dist/job-renderer.js';
import { HostedSources } from '../../packages/api/dist/hosted-sources.js';
import { EmbedSources } from '../../packages/api/dist/embed-sources.js';
import { HostedData } from '../../packages/api/dist/hosted-data.js';
import { EmbedContent } from '../../packages/api/dist/embed-content.js';
import { loadBudgets } from '../../packages/api/dist/budget-store.js';
import { serverlessMail } from '../../packages/api/dist/serverless-mail.js';
import { ObjectLedger } from '../../packages/api/dist/object-ledger.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash,randomUUID } from 'node:crypto';
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

export function acceptancePlan(env, now = Date.now()) {
  const p = JSON.parse(env.OPENSIGHT_ACCEPTANCE_PLAN ?? '{}');
  assert.deepEqual(Object.keys(p).sort(), ['database','deployment','expiresAt','nonce','recipient','version']);
  assert.equal(p.version, 1); assert.match(p.nonce, /^[a-f0-9]{12}$/);
  assert.equal(p.database, 'os_accept_' + p.nonce); assert.equal(p.deployment, 'os-accept-' + p.nonce);
  assert.equal(env.OPENSIGHT_DB_NAME, p.database); assert.equal(env.OPENSIGHT_DEPLOYMENT, p.deployment);
  assert.match(p.recipient, /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/);
  assert.ok(Number.isSafeInteger(p.expiresAt) && p.expiresAt > now && p.expiresAt <= now + 24 * 3600000);
  for (const name of ['OPENSIGHT_WORK_QUEUE_ARN','OPENSIGHT_RECOVERY_QUEUE_ARN','OPENSIGHT_SCHEDULER_DLQ_ARN']) assert.ok(env[name]?.split(':').at(-1).startsWith(p.deployment + '-'));
  assert.equal(env.OPENSIGHT_SCHEDULER_GROUP, p.deployment);
  return p;
}
const commands = ['init','prepare-restore','freeze-backup','object-backup','complete-object-backup','report','alert','alert-refresh','before-commit','after-commit','dispatch-receipt','child-dispatch','revoke-recipient','revoke-owner','revoke-tenant','ambiguity','replay','inspect','destroy'];
const definition = { DashboardId: 'dashboard', Name: 'Synthetic delivery acceptance', Definition: {
  DataSetIdentifierDeclarations: [{Identifier:'data',DataSetArn:'urn:opensight:dataset'}],
  Sheets:[{SheetId:'sheet',Name:'Synthetic',Visuals:[{KPIVisual:{VisualId:'total',ChartConfiguration:{FieldWells:{Values:[{NumericalMeasureField:{FieldId:'amount',Column:{DataSetIdentifier:'data',ColumnName:'amount'},AggregationFunction:{SimpleNumericalAggregation:'SUM'}}}]}}}}]}]
} };

async function bootstrap(aws, env, plan) {
  const login = await aws.secret(env.OPENSIGHT_BOOTSTRAP_SECRET_ARN, ['username','password']);
  const c = new Client({connectionString:databaseUrl({...env,OPENSIGHT_DB_NAME:'postgres'},login), ssl:{ca:env.OPENSIGHT_POSTGRES_CA,rejectUnauthorized:true}, connectionTimeoutMillis:20000, statement_timeout:20000});
  await c.connect();
  try {
    const found = (await c.query('SELECT shobj_description(oid,\'pg_database\') AS marker FROM pg_database WHERE datname=$1',[plan.database])).rows;
    const marker = 'opensight-acceptance:' + plan.nonce;
    if (found.length) assert.equal(found[0].marker, marker, 'FOREIGN_DATABASE');
    if (!found.length) { await c.query(`CREATE DATABASE "${plan.database}"`); await c.query(`COMMENT ON DATABASE "${plan.database}" IS '${marker}'`); }
    for (const kind of ['operator','tenant']) {
      const s = await aws.secret(env[kind === 'operator' ? 'OPENSIGHT_OPERATOR_SECRET_ARN' : 'OPENSIGHT_TENANT_SECRET_ARN'], kind==='operator'?['username','password','operatorKey','signingKey','encryptionKey','ingressKeys']:['username','password']);
      assert.equal(s.username, `os_accept_${plan.nonce}_${kind}`);
      const existing = (await c.query("SELECT rolcanlogin,rolbypassrls,rolsuper,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",[s.username])).rows;
      const roleMarker = `opensight:${plan.deployment}:${kind}`;
      if(existing.length && existing[0].marker===null && !existing[0].rolcanlogin && !existing[0].rolsuper && !existing[0].rolbypassrls) { await c.query(`DROP ROLE "${s.username}"`);existing.length=0; }
      if(existing.length) assert.equal(existing[0].marker,roleMarker,'FOREIGN_ROLE');
      const quote = (await c.query('SELECT quote_literal($1) AS q',[s.password])).rows[0].q;
      if(!existing.length) await c.query(`CREATE ROLE "${s.username}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION ${kind==='operator'?'BYPASSRLS':'NOBYPASSRLS'} CONNECTION LIMIT 4 PASSWORD ${quote}`);
      await c.query(`COMMENT ON ROLE "${s.username}" IS '${roleMarker}'`);
    }
  } finally { await c.end(); }
}

export async function handler(raw, context) {
  const plan = acceptancePlan(process.env);
  assert.ok(raw && typeof raw==='object' && !Array.isArray(raw) && Object.keys(raw).join()==='command' && commands.includes(raw.command),'ACCEPTANCE_COMMAND_INVALID');
  const command = raw.command;
  return new InvocationScope(Date.now() + Math.min(110000,context.getRemainingTimeInMillis()-5000)).run(async scope => {
    const aws = new InvocationAws(scope,process.env);
    const base = {...process.env,OPENSIGHT_POSTGRES_CA:await readFile('/var/task/ops/serverless/rds-ca.pem','utf8')};
    if(command==='destroy'){await destroyFixture(aws,base,plan);return {state:'fixture-databases-and-roles-deleted'};}
    if(command==='prepare-restore') return prepareRestore(aws,base,plan,scope);
    if(command==='init') await bootstrap(aws,base,plan);
    const env = await awsEnvironment(aws,base,true), databases = invocationDatabases(scope,env,20000), rawDb = databases.membership;
    if(command==='init') {
      await migrateServerless(rawDb,env);
      await rawDb.transaction(async c=> {
        await c.query('CREATE TABLE acceptance_receipts (command TEXT PRIMARY KEY, body TEXT NOT NULL)');
        await c.query("UPDATE sr_control SET state='open' WHERE deployment=?",[plan.deployment]);
      });
      return {state:'initialized'};
    }
    const sql = (s,v=[])=>rawDb.transaction(c=>c.query(s,v));
    if(command==='freeze-backup') {await sql("UPDATE sr_control SET state='maintenance', epoch=2 WHERE deployment=? AND epoch=1",[plan.deployment]);return {state:'frozen',epoch:2};}
    if(command==='inspect') return {state:'inspected',receipts:await sql('SELECT * FROM acceptance_receipts ORDER BY command'),deliveries:await sql('SELECT state,error_code FROM h7_deliveries ORDER BY delivery_id')};
    // A failed/running receipt cannot be retried implicitly, especially after SMTP.
    await sql("INSERT INTO acceptance_receipts VALUES (?,?)",[command,JSON.stringify({state:'running'})]);
    const faults = {}, sent = [], calls = [];
    const db = {durable:true,close:async()=>{},transaction:async(work,identity)=>{
      const result=await rawDb.transaction(async c=>{
        const out=await work({query:async(s,v)=>{await faults.query?.(s,v);return c.query(s,v);}});
        await faults.beforeCommit?.();return out;
      },identity);await faults.afterCommit?.();return result;
    }};
    const metadata = new TenantMetadata(databases.tenant,db), budgets = await loadBudgets(db,metadata);
    scope.own({close:()=>budgets.shutdown(),force:()=>budgets.close()});
    const transport = serverlessTransport(aws,env);
    const dispatch = new DurableDispatch(db,metadata,plan.deployment,{
      recover:async e=>{await transport.recover(e);calls.push({recover:e});},
      dispatch:async(e,event)=>{await faults.dispatch?.();await transport.dispatch(e,event);calls.push({event:e});}
    });
    const sources = new HostedSources(metadata,env.OPENSIGHT_AUTH_ENCRYPTION_KEY,[]);
    const content = new EmbedContent(new HostedData(new EmbedSources(metadata,env.OPENSIGHT_AUTH_ENCRYPTION_KEY,[]),undefined,budgets));
    const renderer = new JobRenderer(new HostedData(sources,undefined,budgets),content);
    const store = new JobStore(db,metadata,()=>new Date(),dispatch), realMail=serverlessMail(aws,env);
    const mail = {configured:realMail.configured,send:async(message,authorize)=>{
      assert.deepEqual(message.to,[plan.recipient]);assert.ok(sent.length<2,'MAIL_BOUND');
      assert.ok(message.html.includes('>40<')||message.html.includes('amount = 40'),'RECIPIENT_RLS');assert.ok(!message.html.includes('>60<')&&!message.html.includes('amount = 60'),'OWNER_VALUE_DISCLOSED');
      await faults.beforeMail?.(); await realMail.send(message,authorize);sent.push({dedupeKey:message.dedupeKey});
    }};
    const jobs=new DurableJobs(store,renderer,mail);
    const ns=command==='replay'?'ambiguity':command==='complete-object-backup'?'object-backup':command,tenant='tenant-'+ns;
    const contextFor = user=>metadata.authenticate(null,async()=>({namespaceId:ns,userId:user}));
    if(!['replay','complete-object-backup'].includes(command)) {
      await sql("INSERT INTO h1_tenants VALUES (?,'active',1,NULL,NULL,NULL)",[tenant]);
      await sql('INSERT INTO h1_namespaces VALUES (?,?,?)',[ns,tenant,ns]);
      await sql('INSERT INTO h1_revisions VALUES (?,?,1,1,1)',[tenant,ns]);
      for(const user of ['owner','reader']) {
        await rawDb.transaction(c=>insertResource(c,{tenantId:tenant,namespaceId:ns},{kind:'user',id:user},{name:user,role:user==='owner'?'administrator':'reader'}));
        const subject = user==='reader'?'approved-reader':ns+'-'+user;
        await sql("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'active') ON CONFLICT (subject) DO NOTHING",[subject,user==='reader'?plan.recipient:`${ns}-owner@example.test`]);
        await sql("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,?,'active')",[subject,tenant,ns,user]);
      }
      const owner=await contextFor('owner');
      const source=await sources.upload(owner,{config:{format:'csv'},base64:Buffer.from('region,amount,private\neast,10,a\nwest,20,b\neast,30,c\n').toString('base64'),expiresAt:new Date(plan.expiresAt).toISOString(),policy:{rowLevel:true,rowRules:[{id:'owner',principals:[{type:'user',id:'owner'}],predicate:{column:'region',operator:'in',values:['east','west']}},{id:'reader',principals:[{type:'user',id:'reader'}],predicate:{column:'region',operator:'eq',value:'east'}}],protectedColumns:['private'],columnGrants:[{id:'owner',column:'private',effect:'allow',principals:[{type:'user',id:'owner'}]}]}});
      await metadata.put(await contextFor('owner'),{kind:'dataset',id:'dataset'},{definition:{DataSet:{DataSetId:'dataset'}},sources:[{kind:'source',id:source.id,ownerId:'owner'}]});
      await metadata.put(await contextFor('owner'),{kind:'dashboard',id:'dashboard'},{definition,datasets:[{kind:'dataset',id:'dataset'}],folderId:null});
      const denied=structuredClone(definition);denied.DashboardId='cls-denied';denied.Definition.Sheets[0].Visuals[0].KPIVisual.ChartConfiguration.FieldWells.Values[0].NumericalMeasureField.Column.ColumnName='private';
      await metadata.put(await contextFor('owner'),{kind:'dashboard',id:'cls-denied'},{definition:denied,datasets:[{kind:'dataset',id:'dataset'}],folderId:null});
      await assert.rejects(renderer.authorize(await contextFor('reader'),{kind:'report',dashboardId:'cls-denied',recipients:['reader'],enabled:true,schedule:{kind:'interval',minutes:1440,timeZone:'UTC'}}),{code:'COLUMN_ACCESS_DENIED'});
    }
    const owner=await contextFor('owner'),spec=command.startsWith('alert')?{kind:'alert',enabled:true,datasetId:'dataset',dashboardId:'dashboard',visualId:'total',fieldId:'amount',dimensions:{},condition:{kind:'above',threshold:30},recipients:['reader']}:{kind:'report',dashboardId:'dashboard',recipients:['reader'],enabled:true,schedule:{kind:'interval',minutes:1440,timeZone:'UTC'}};
    const put=()=>store.put(owner,'job',spec,0,(c,s)=>renderer.authorize(c,s));
    const event=async kind=>{const rows=await sql('SELECT * FROM sr_outbox WHERE namespace_id=? AND kind=? ORDER BY due_at DESC',[ns,kind]);assert.ok(rows.length);return {version:1,deploymentEpoch:Number(rows[0].control_epoch),eventId:rows[0].event_id,kind:'execute'};};
    const outcome = {state:'passed',checks:[],smtpAccepted:0};
    if(['object-backup','complete-object-backup'].includes(command)) {
      const data=Buffer.from('synthetic retained object\n'),digest=createHash('sha256').update(data).digest('base64'),ledger=new ObjectLedger(metadata,plan.deployment);
      const object=command==='complete-object-backup'?await db.transaction(async c=>ledger.read(c,owner,(await c.query('SELECT object_id FROM sr_object WHERE namespace_id=?',[ns]))[0].object_id)):ledger.plan(owner,{purpose:'raw-upload',capacityBytes:128,mediaType:'text/plain',checksum:digest}),revisions=await metadata.revisions(owner);
      if(command==='object-backup') { const intent=await dispatch.prepare(owner,{kind:'upload-reserve',revisions,requestDigest:createHash('sha256').update('backup-object').digest('hex'),idempotencyKey:randomUUID()});
      await dispatch.commit(intent,async(c,now)=>{await ledger.reserve(c,owner,revisions,intent.intentId,[object],now,now+3600000);return {receipt:{id:object.id,revision:1},events:[]};}); }
      const response=await aws.call(signal=>aws.s3.send(new PutObjectCommand({Bucket:env.OPENSIGHT_ARTIFACT_BUCKET,Key:object.key,Body:data,ContentLength:data.length,ChecksumSHA256:digest,ServerSideEncryption:'AES256',IfNoneMatch:'*'}),{abortSignal:signal}));
      assert.ok(response.VersionId);await db.transaction(c=>ledger.bind(c,owner,object.id,{version:response.VersionId,bytes:data.length,checksum:digest}));
      outcome.checks.push('real-versioned-object-bound');
    } else if(command==='before-commit') {
      faults.query=s=>{if(s.startsWith('INSERT INTO sr_outbox'))throw Error('INJECT_BEFORE_COMMIT');};
      await assert.rejects(put());delete faults.query;
      assert.equal((await sql('SELECT * FROM h7_jobs WHERE namespace_id=?',[ns])).length,0);outcome.checks.push('business-rollback-after-real-recovery-ack');
    } else if(command==='after-commit'||command==='dispatch-receipt') {
      if(command==='after-commit') {let committed=false;faults.query=s=>{if(s.includes("SET state = 'committed'"))committed=true;};faults.afterCommit=()=>{if(committed){delete faults.afterCommit;throw Error('INJECT_COMMIT_ACK');}};await assert.rejects(put());}
      else {faults.query=s=>{if(s.includes("SET state = 'dispatched'"))throw Error('INJECT_DISPATCH_ACK');};await put();}
      delete faults.query;await dispatch.recover(calls.find(x=>x.recover).recover);
      assert.ok((await sql('SELECT state FROM sr_outbox WHERE namespace_id=?',[ns])).every(x=>x.state==='dispatched'));outcome.checks.push('recovered-original-outbox');
    } else {
      if(command!=='replay') {await put();
        if(command.startsWith('alert')) {
          const refresh={kind:'refresh',target:{kind:'dataset',id:'dataset'},enabled:true,schedule:{kind:'interval',minutes:1440,timeZone:'UTC'}};
          await store.put(owner,'refresh',refresh,0,(c,s)=>renderer.authorize(c,s));await store.enqueue(owner,'refresh');await jobs.run(await event('job-execute'));
        } else await store.enqueue(owner,'job');
        if(command==='child-dispatch') {faults.dispatch=()=>{throw Error('INJECT_CHILD_DISPATCH');};await assert.rejects(jobs.run(await event('job-execute')));delete faults.dispatch;}
        await jobs.run(await event('job-execute'));
      }
      const delivery=await event('job-deliver');
      if(command.startsWith('revoke-')) faults.beforeMail=async()=>{
        if(command==='revoke-tenant')await sql("UPDATE h1_tenants SET state='suspended' WHERE tenant_id=?",[tenant]);
        else await sql("UPDATE h2_memberships SET status='removed' WHERE namespace_id=? AND user_id=?",[ns,command==='revoke-owner'?'owner':'reader']);
      };
      if(command==='ambiguity') {
        faults.query=s=>{if(s.includes("SET state = 'sent'"))throw Error('INJECT_SMTP_RECEIPT');};
        await assert.rejects(jobs.run(delivery));delete faults.query;assert.equal(sent.length,1);outcome.checks.push('smtp-accepted-receipt-lost');
      } else if(command==='replay') {
        await assert.rejects(jobs.run(delivery),{code:'DELIVERY_AMBIGUOUS'});
        await assert.rejects(jobs.replay(delivery),{code:'DELIVERY_AMBIGUOUS'});
        await jobs.replay(delivery,true);await jobs.run(delivery);assert.equal(sent.length,1);outcome.checks.push('explicit-ambiguous-replay');
      } else {await jobs.run(delivery);await jobs.run(delivery);assert.equal(sent.length,command.startsWith('revoke-')?0:1);outcome.checks.push(command.startsWith('revoke-')?'revoked-before-data':'recipient-render-and-duplicate-ack');}
      // Inspect real SQS receipt for the exact delivery identifier. This queue is
      // exclusively owned by this bounded fixture; no production receive/delete.
      let received=false;
      for(let i=0;i<20&&!received;i++) {
        const r=await aws.call(signal=>aws.sqs.send(new ReceiveMessageCommand({QueueUrl:env.OPENSIGHT_WORK_QUEUE_URL,MaxNumberOfMessages:10,WaitTimeSeconds:1}),{abortSignal:signal}));
        for(const m of r.Messages??[]) {if(JSON.parse(m.Body).eventId===delivery.eventId)received=true;await aws.call(signal=>aws.sqs.send(new DeleteMessageCommand({QueueUrl:env.OPENSIGHT_WORK_QUEUE_URL,ReceiptHandle:m.ReceiptHandle}),{abortSignal:signal}));}
      }
      assert.ok(received,'SQS_DELIVERY_MISSING');outcome.checks.push('real-sqs-delivery');
    }
    outcome.smtpAccepted=sent.length;outcome.messageIds=sent.map(x=>x.dedupeKey);
    if(command==='replay') {const prior=JSON.parse((await sql("SELECT body FROM acceptance_receipts WHERE command='ambiguity'"))[0].body);assert.deepEqual(outcome.messageIds,prior.messageIds,'AMBIGUOUS_MESSAGE_ID_CHANGED');}
    await sql('UPDATE acceptance_receipts SET body=? WHERE command=?',[JSON.stringify(outcome),command]);
    return outcome;
  });
}

async function destroyFixture(aws,base,plan) {
  const login=await aws.secret(base.OPENSIGHT_BOOTSTRAP_SECRET_ARN,['username','password']);
  const client=new Client({connectionString:databaseUrl({...base,OPENSIGHT_DB_NAME:'postgres'},login),ssl:{ca:base.OPENSIGHT_POSTGRES_CA,rejectUnauthorized:true},connectionTimeoutMillis:20000,statement_timeout:20000});
  await client.connect();
  try {
    // Validate every marker before the first destructive statement. Names come
    // only from the expiring fixed fixture plan, never from invocation input.
    const databases=[[plan.database,'opensight-acceptance:'+plan.nonce],['os_restore_'+plan.nonce,'opensight-restore:'+plan.nonce]],existingDatabases=[];
    for(const [name,marker] of databases) {
      const rows=(await client.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",[name])).rows;
      if(rows.length){assert.equal(rows[0].marker,marker,'FOREIGN_DATABASE');existingDatabases.push(name);}
    }
    const roles=['operator','tenant'].map(kind=>[plan.database+'_'+kind,kind]).concat(['owner','operator','tenant'].map(kind=>['os_restore_'+plan.nonce+'_'+kind,kind])),existingRoles=[];
    for(const [name,kind] of roles) {
      const rows=(await client.query("SELECT shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",[name])).rows;
      if(rows.length){assert.equal(rows[0].marker,`opensight:${plan.deployment}:${kind}`,'FOREIGN_ROLE');existingRoles.push(name);}
    }
    for(const name of existingDatabases)await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    for(const name of existingRoles)await client.query(`DROP ROLE "${name}"`);
  } finally {await client.end();}
}

async function prepareRestore(aws,base,plan,scope) {
  const database='os_restore_'+plan.nonce,login=await aws.secret(base.OPENSIGHT_BOOTSTRAP_SECRET_ARN,['username','password']);
  const client=new Client({connectionString:databaseUrl({...base,OPENSIGHT_DB_NAME:'postgres'},login),ssl:{ca:base.OPENSIGHT_POSTGRES_CA,rejectUnauthorized:true},connectionTimeoutMillis:20000,statement_timeout:20000});
  const secrets={};await client.connect();
  try {
    for(const kind of ['owner','operator','tenant']) {
      const arn=base['OPENSIGHT_RESTORE_'+kind.toUpperCase()+'_SECRET_ARN'];
      const secret=await aws.secret(arn,kind==='operator'?['username','password','operatorKey','signingKey','encryptionKey','ingressKeys']:['username','password']);secrets[kind]=arn;
      assert.equal(secret.username,database+'_'+kind);
      assert.equal((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[secret.username])).rows.length,0,'RESTORE_ROLE_EXISTS');
      const quote=(await client.query('SELECT quote_literal($1) AS q',[secret.password])).rows[0].q;
      await client.query(`CREATE ROLE "${secret.username}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION ${kind==='tenant'?'NOBYPASSRLS':'BYPASSRLS'} CONNECTION LIMIT 4 PASSWORD ${quote}`);
      await client.query(`COMMENT ON ROLE "${secret.username}" IS 'opensight:${plan.deployment}:${kind}'`);
    }
    assert.equal((await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rows.length,0,'RESTORE_DATABASE_EXISTS');
    await client.query(`CREATE DATABASE "${database}"`);
    await client.query(`COMMENT ON DATABASE "${database}" IS 'opensight-restore:${plan.nonce}'`);
  } finally {await client.end();}
  const admin=new Client({connectionString:databaseUrl({...base,OPENSIGHT_DB_NAME:database},login),ssl:{ca:base.OPENSIGHT_POSTGRES_CA,rejectUnauthorized:true},connectionTimeoutMillis:20000});await admin.connect();
  try {await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');await admin.query(`GRANT ALL ON SCHEMA public TO "${database}_owner" WITH GRANT OPTION`);}finally{await admin.end();}
  const env=await awsEnvironment(aws,{...base,OPENSIGHT_DB_NAME:database,OPENSIGHT_BOOTSTRAP_SECRET_ARN:secrets.owner,OPENSIGHT_OPERATOR_SECRET_ARN:secrets.operator,OPENSIGHT_TENANT_SECRET_ARN:secrets.tenant},true);
  await migrateServerless(invocationDatabases(scope,env,20000).membership,env);return {state:'restore-target-prepared'};
}
