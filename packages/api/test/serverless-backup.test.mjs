import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coordinationFixture } from './coordination-helpers.mjs';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { snapshotServerless,validateRecovery,restoreServerless } from '../dist/serverless-backup.js';
import { checksum } from '../dist/metadata-operator.js';
async function fixture(t){
 const f=await coordinationFixture(t,{migrate:false}),env={...f.env,OPENSIGHT_ENTITLEMENTS:JSON.stringify(f.entitlements)};
 await migrateServerless(f.db,env,'sqlite');
 const snapshot=await snapshotServerless(f.db,'test',randomUUID(),Date.now()+3600000,['a'.repeat(32)],'sqlite');
 const registry={version:1,revision:1,epoch:2,fence:snapshot.fence,completeThroughEpoch:1,backups:{[snapshot.id]:checksum(snapshot)},deletedTenants:[],retiredKeyVersions:[]};
 const dir=await mkdtemp(join(tmpdir(),'opensight-restore-')),target=new SqliteMetadataDatabase(join(dir,'target.sqlite'));
 await migrateServerless(target,env,'sqlite');t.after(async()=>{await target.close();await rm(dir,{recursive:true});});
 return {...f,env,snapshot,registry,target};
}
test('serverless backup restores a held target with advanced epoch, no old memberships, work or usage authority',async t=>{
 const f=await fixture(t);const result=await restoreServerless(f.target,f.snapshot,f.registry,'sqlite');assert.equal(result.state,'held');assert.equal(result.epoch,2);
 const rows=table=>f.target.transaction(c=>c.query('SELECT * FROM '+table));
 assert.ok((await rows('h1_tenants')).every(x=>x.state==='suspended'));assert.ok((await rows('h2_memberships')).every(x=>x.status==='removed'));
 assert.equal((await rows('sr_control'))[0].state,'maintenance');assert.equal((await rows('h8_recovery')).length,2);
 assert.ok((await rows('h8_usage')).every(x=>x.admitted===Number.MAX_SAFE_INTEGER));
 await assert.rejects(restoreServerless(f.target,f.snapshot,f.registry,'sqlite'),{code:'RESTORE_TARGET_NOT_EMPTY'});
});
test('serverless recovery rejects later tenant deletion, retired keys, missing registration/history and stale epochs before target writes',async t=>{
 const f=await fixture(t);
 for(const patch of [{deletedTenants:['tenant-one']},{retiredKeyVersions:['a'.repeat(32)]},{backups:{}},{completeThroughEpoch:0},{epoch:1},{fence:-1}]) {
  await assert.rejects(restoreServerless(f.target,f.snapshot,{...f.registry,...patch},'sqlite'));
  assert.equal((await f.target.transaction(c=>c.query('SELECT * FROM h1_tenants'))).length,0);
 }
 assert.throws(()=>validateRecovery({...f.snapshot,tables:{...f.snapshot.tables,foreign:[]}},f.registry));
});
test('serverless recovery rolls back imported rows and holds the target when a late fence write fails',async t=>{
 const f=await fixture(t),db={transaction:work=>f.target.transaction(c=>work({query:(s,v)=>{if(s.startsWith('UPDATE sr_claim'))throw Error('injected fence failure');return c.query(s,v);}}))};
 await assert.rejects(restoreServerless(db,f.snapshot,f.registry,'sqlite'),/injected fence failure/);
 assert.equal((await f.target.transaction(c=>c.query('SELECT * FROM h1_tenants'))).length,0);
 assert.equal((await f.target.transaction(c=>c.query('SELECT * FROM sr_control')))[0].epoch,1);
});

test('serverless restore advances a retained real claim beyond its independent fence high-water mark',async t=>{
 const f=await fixture(t);const {DurableCoordinator}=await import('../dist/coordination.js');
 await f.open();const coordinator=new DurableCoordinator(f.db,f.metadata,'test','sqlite');
 const input=await f.input(0,true);input.claim={kind:'source',id:f.uploaded[0].id,expectedVersion:1};
 const handle=await coordinator.admit(f.contexts[0],input);await coordinator.release(handle);
 await f.db.transaction(c=>c.query("UPDATE sr_control SET state='maintenance'"));
 const snapshot=await snapshotServerless(f.db,'test',randomUUID(),Date.now()+3600000,['a'.repeat(32)],'sqlite');
 const registry={...f.registry,fence:27,backups:{[snapshot.id]:checksum(snapshot)}};
 await restoreServerless(f.target,snapshot,registry,'sqlite');
 const claims=await f.target.transaction(c=>c.query('SELECT * FROM sr_claim'));assert.equal(claims.length,1);assert.equal(claims[0].fence,28);assert.equal(claims[0].attempt_id,null);
 await assert.rejects(new DurableCoordinator(f.target,f.metadata,'test','sqlite').renew(handle));
});

test('serverless backup pins actual nonempty object versions and restores the exact inventory',async t=>{
 const f=await fixture(t);await f.open();
 const {DurableDispatch}=await import('../dist/dispatch.js'),{ObjectLedger}=await import('../dist/object-ledger.js');
 const context=await f.metadata.authenticate(null,async()=>({namespaceId:'one',userId:'admin'}));
 const dispatch=new DurableDispatch(f.db,f.metadata,'test',{recover:async()=>{},dispatch:async()=>{}},'sqlite'),ledger=new ObjectLedger(f.metadata,'test');
 const digest=Buffer.alloc(32,1).toString('base64'),plan=ledger.plan(context,{capacityBytes:128,purpose:'raw-upload',mediaType:'text/csv',checksum:digest});
 const revisions=await f.metadata.revisions(context),handle=await dispatch.prepare(context,{kind:'upload-reserve',revisions,requestDigest:'a'.repeat(64),idempotencyKey:randomUUID()});
 await dispatch.commit(handle,async(c,now)=>{await ledger.reserve(c,context,revisions,handle.intentId,[plan],now,now+60000);await ledger.bind(c,context,plan.id,{version:'exact-version',bytes:32,checksum:digest});return {receipt:{id:plan.id,revision:1},events:[]};});
 await f.db.transaction(c=>c.query("UPDATE sr_control SET state='maintenance'"));
 const expires=Date.now()+3600000,snapshot=await snapshotServerless(f.db,'test',randomUUID(),expires,['a'.repeat(32)],'sqlite');
 assert.deepEqual(snapshot.objects,[{key:plan.key,version:'exact-version',checksum:digest,bytes:32}]);
 assert.equal(snapshot.tables.sr_object_pin[0].expires_at,expires);
 const registry={...f.registry,backups:{[snapshot.id]:checksum(snapshot)}};await restoreServerless(f.target,snapshot,registry,'sqlite');
 const row=(await f.target.transaction(c=>c.query('SELECT * FROM sr_object')))[0];assert.equal(row.object_version,'exact-version');assert.equal(row.checksum,digest);
});

test('registered migration preserves retained metadata and receipts, and refuses post-backup writes',async t=>{
 const f=await fixture(t),{migrateRegistered}=await import('../dist/serverless-backup.js');
 const registry={...f.registry,epoch:1},operation=randomUUID();
 assert.equal((await migrateRegistered(f.db,f.env,f.snapshot,registry,operation,'sqlite')).replayed,false);
 assert.equal((await migrateRegistered(f.db,f.env,f.snapshot,registry,operation,'sqlite')).replayed,true);
 await f.db.transaction(c=>c.query("UPDATE h1_namespaces SET name='changed' WHERE namespace_id='one'"));
 await assert.rejects(migrateRegistered(f.db,f.env,f.snapshot,registry,randomUUID(),'sqlite'),{code:'MIGRATION_PRESERVATION_FAILED'});
 assert.equal((await f.db.transaction(c=>c.query('SELECT state FROM sr_control')))[0].state,'maintenance');
});

test('fixed backup plans reject a production restore target, expired plans and resource overrides before AWS',async()=>{
 const {backupPlan}=await import('../dist/serverless-backup-lambda.js');
 const env={OPENSIGHT_DEPLOYMENT:'synthetic',OPENSIGHT_DB_NAME:'os_restore_test'};
 const p={version:1,operationId:randomUUID(),deployment:'synthetic',mode:'restore',backupId:randomUUID(),sourceDatabase:'source',targetDatabase:'os_restore_test',expiresAt:Date.now()+3600000,epoch:2,keyVersions:['a'.repeat(32)],snapshotVersion:'exact-version',snapshotDigest:'b'.repeat(64)};
 assert.equal(backupPlan(p,env).mode,'restore');
 for(const patch of [{sourceDatabase:'os_restore_test'},{targetDatabase:'production'},{expiresAt:Date.now()-1},{epoch:1},{snapshotVersion:null},{sql:'SELECT 1'},{mode:'reopen'}])assert.throws(()=>backupPlan({...p,...patch},env));
});

test('Issue #146: registered pre-naming backups migrate idempotently and restore with NULL labels', async t => {
 const f=await fixture(t);
 // Reconstruct a pre-naming database through a separate owner connection;
 // foreign keys are disabled only while restoring this historical schema.
 const legacy=new DatabaseSync(f.path);
 try { legacy.exec(`PRAGMA foreign_keys=OFF; BEGIN;
  DROP TABLE h2_login_selections;
  CREATE TABLE legacy_tenants (tenant_id TEXT PRIMARY KEY,state TEXT NOT NULL,version INTEGER NOT NULL,tombstone TEXT,placement TEXT,limit_policy TEXT);
  INSERT INTO legacy_tenants SELECT tenant_id,state,version,tombstone,placement,limit_policy FROM h1_tenants;
  DROP TABLE h1_tenants;
  ALTER TABLE legacy_tenants RENAME TO h1_tenants;
  COMMIT;`); } finally { legacy.close(); }
 const snapshot=await snapshotServerless(f.db,'test',randomUUID(),Date.now()+3600000,['a'.repeat(32)],'sqlite');
 assert.equal('h2_login_selections' in snapshot.tables,false);
 assert.ok(snapshot.tables.h1_tenants.every(row=>!('display_name' in row)));
 const registry={...f.registry,epoch:1,backups:{[snapshot.id]:checksum(snapshot)}};
 const {migrateRegistered}=await import('../dist/serverless-backup.js'),id=randomUUID();
 assert.equal((await migrateRegistered(f.db,f.env,snapshot,registry,id,'sqlite')).replayed,false);
 assert.equal((await migrateRegistered(f.db,f.env,snapshot,registry,id,'sqlite')).replayed,true);
 assert.ok((await f.db.transaction(c=>c.query('SELECT display_name,slug FROM h1_tenants'))).every(row=>row.display_name===null&&row.slug===null));
 await restoreServerless(f.target,snapshot,{...registry,epoch:2},'sqlite');
 assert.ok((await f.target.transaction(c=>c.query('SELECT display_name,slug FROM h1_tenants'))).every(row=>row.display_name===null&&row.slug===null));
});
