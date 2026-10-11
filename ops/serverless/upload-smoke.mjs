import assert from 'node:assert/strict';
import { InvocationScope } from './packages/api/dist/runtime-scope.js';
import { TenantBudgets } from './packages/api/dist/budgets.js';
import { containedWork } from './packages/api/dist/contained-work.js';
import { BlazeTable } from './packages/api/dist/blaze.js';
import { ArtifactTransfer } from './packages/api/dist/artifact-transfer.js';
// Run on stdin in the immutable runtime image with --memory 2g and no network.
  const rows = 1024, maximum = 8388608, header = 'region,amount,padding\n';
  const prefixes = Array.from({ length: rows }, (_, i) => i % 2 ? 'West,2,' : 'East,1,');
  const fixed = Buffer.byteLength(header) + prefixes.reduce((total, prefix) => total + Buffer.byteLength(prefix) + 1, 0);
  const pad = Math.floor((maximum - fixed) / rows), remainder = maximum - fixed - pad * rows;
  const csv = header + prefixes.map((prefix, i) => { const count = pad + (i < remainder ? 1 : 0); return prefix + '漢'.repeat(Math.floor(count / 3)) + 'x'.repeat(count % 3) + '\n'; }).join('');
  const bytes = Buffer.from(csv); assert.equal(bytes.length, maximum);

const tenant = { running:1,queued:4,executionMs:30000,queueMs:30000,sourceRows:100000,resultBytes:1048576,workingBytes:67108864,cacheBytes:67108864,workerRssBytes:1073741824,workerHeapMb:512,duckdbMemoryMb:64,cellChars:16384 };
const limits={encodedBytes:tenant.workingBytes,decodedBytes:tenant.workingBytes,rows:tenant.sourceRows,columns:256,cellChars:tenant.cellChars};
const scope=new InvocationScope(Date.now()+110000), budgets=new TenantBudgets({defaults:tenant,tenants:{},node:{...tenant,running:3,queued:12,refreshSlots:1,workingBytes:67108864,cacheBytes:67108864,workerRssBytes:1610612736}},()=>{}),context={tenantId:'synthetic'};
try { await scope.run(async()=>budgets.run(context,false,async()=>{},async()=>{
 const work=budgets.current(context); work.memory(bytes.length+3*65536);
 const parsed=await containedWork(work,{kind:'upload',request:{config:{format:'csv'},data:bytes}},{maxRows:limits.rows,cellChars:limits.cellChars,maxBytes:limits.decodedBytes,datasetBytes:limits.decodedBytes});
 assert.equal(parsed.rows.length, rows);
 const table=new BlazeTable({maxRows:limits.rows,cellChars:limits.cellChars,maxBytes:limits.decodedBytes,datasetBytes:limits.decodedBytes});table.start(parsed.columns);for(const row of parsed.rows)table.row(row);work.memory(table.bytes);
 const transfer=new ArtifactTransfer();const local=await transfer.encode(work,table,limits);assert.equal(local.descriptor.rowCount, rows); console.log(JSON.stringify({ rows, inputBytes: bytes.length, workingBytes: work.workingBytes, peakWorkerRssBytes: budgets.snapshot(context.tenantId).peakWorkerRssBytes }));await local.close();
},scope.signal)); } catch(e){console.log(JSON.stringify({name:e.name,code:e.code,status:e.status,message:e.message}));process.exitCode=1;}finally{await budgets.shutdown();}
