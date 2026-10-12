import test from 'node:test';
import assert from 'node:assert/strict';
import { approveRelease, configurationFingerprint, frontendFiles } from '../ops/serverless/release-safety.mjs';
import { gzipSync } from 'node:zlib';
import { unpack } from '../ops/serverless/extract-frontend.mjs';

test('SR4c approval rejects expiry, changed artifacts/configuration/current release and incompatible bytes', () => {
  const m={source:'a'.repeat(40),compatibility:'contract'},current={id:'old',compatibility:'contract'},now=1000;
  const a={version:1,manifest:'target',source:m.source,configuration:'config',current:'old',expiresAt:now+60000};
  approveRelease(a,m,'target','config',current,now);
  for(const change of [{manifest:'substituted'},{source:'other'},{configuration:'other'},{current:'replayed'},{expiresAt:now},{expiresAt:now+86400001}]) assert.throws(()=>approveRelease({...a,...change},m,'target','config',current,now),/RELEASE_APPROVAL_REQUIRED/);
  assert.throws(()=>approveRelease(a,{...m,compatibility:'changed'},'target','config',current,now));
});
test('SR4c runtime drift compares security and limits while excluding mutable code metadata',()=>{
  const c={Role:'synthetic-runtime',MemorySize:2048,Timeout:28,Environment:{Variables:{MODE:'pilot'}},RevisionId:'old',CodeSha256:'old',VpcConfig:{SubnetIds:['b','a'],SecurityGroupIds:['s']}};
  assert.equal(configurationFingerprint(c),configurationFingerprint({...c,RevisionId:'new',CodeSha256:'new',VpcConfig:{SubnetIds:['a','b'],SecurityGroupIds:['s']}}));
  for(const change of [{Role:'administrator'},{MemorySize:4096},{Timeout:120},{Environment:{Variables:{MODE:'other'}}}]) assert.notEqual(configurationFingerprint(c),configurationFingerprint({...c,...change}));
});
test('SR4c frontend manifest rejects traversal and invalid file digests before publication',()=>{
  const f={version:1,kind:'frontend',files:{'index.html':'a'.repeat(64)}};frontendFiles(f);
  for(const path of ['../state','/index.html','assets/./x','assets//x','assets/x\\y'])assert.throws(()=>frontendFiles({...f,files:{...f.files,[path]:'a'.repeat(64)}}));
  assert.throws(()=>frontendFiles({...f,files:{'index.html':'corrupt'}}));
});
function archive(entries) {
  const parts=[];
  for(const {name,type='0',content='x',size=Buffer.byteLength(content)} of entries) {
    const h=Buffer.alloc(512);h.write(name,0,100);h.write(size.toString(8).padStart(11,'0')+'\0',124);h.write(type,156);h.fill(32,148,156);
    h.write(h.reduce((a,v)=>a+v,0).toString(8).padStart(6,'0')+'\0 ',148);
    parts.push(h,Buffer.from(content),Buffer.alloc((512-Buffer.byteLength(content)%512)%512));
  }
  return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
}
test('SR4c archive extraction refuses links, traversal, duplicate, corrupt and excessive payloads',()=>{
  assert.equal(unpack(archive([{name:'./index.html'}])).get('index.html').toString(),'x');
  for(const entries of [[{name:'../outside'}],[{name:'link',type:'2'}],[{name:'index.html'},{name:'./index.html'}],[{name:'huge',size:64*1024*1024+1}],[{name:'/absolute'}],[{name:'a',type:'x'}]]) assert.throws(()=>unpack(archive(entries)));
  assert.throws(()=>unpack(Buffer.from('corrupt')));
});
