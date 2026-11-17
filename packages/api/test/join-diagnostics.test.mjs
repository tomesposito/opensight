import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, registration, upload } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { prepJoinDiagnostics, planSourceRead, withPrepMemory, diagnosePrepJoinDuckDb } from '@opensight/query-engine';
const columns = [{ name: 'id', type: 'INTEGER' }];
const pipeline = { version: 1, input: 'left', steps: [{ id: 'join', kind: 'join', config: { source: 'right', joinType: 'inner', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } }] };
async function fixture(t, values) {
  const f = await sourceFixture(t), context = await f.login();
  for (const id of ['left', 'right']) await f.sources.create(context, id, { ...registration(), columns });
  const calls = [];
  const data = new HostedData(f.sources, async (read, _connection, limits, sink, control) => {
    calls.push({ id: read.source.id, limits, control });
    assert.equal(limits.maxRows, 10000); assert.ok(control.executionMs <= 10000 && control.executionMs > 0);
    assert.match(planSourceRead(read, limits, 'postgres').sql, /LIMIT 10001$/);
    sink.start(columns);
    for (const id of values[read.source.id].slice(0, limits.maxRows + 1)) sink.row([id]);
  }, f.budgets);
  t.mock.method(data, 'table', async () => { throw Error('Full table loading is forbidden'); });
  return { ...f, context, data, prep: new HostedPrep(data), calls };
}
test('hosted diagnostics use bounded source SQL and exactly agree with local DuckDB on fan-out and NULLs', async t => {
  const values = { left: [1,1,2,null], right: [1,1,1,3,null] }, f = await fixture(t, values);
  const hosted = await f.prep.joinDiagnostics(f.context, 'draft', { pipeline, through: 'join' });
  const tables = Object.entries(values).map(([id, rows]) => ({ source: { id, table: id, columns, connectorId: 'file', security: 'unrestricted' }, rowCount: rows.length, value: r => rows[r] }));
  const local = await withPrepMemory(tables, c => diagnosePrepJoinDuckDb(c, pipeline, tables.map(t => t.source), 'join'));
  assert.deepEqual(hosted, local); assert.equal(hosted.matchedRows, 6); assert.equal(hosted.unmatchedLeft, 2); assert.equal(hosted.unmatchedRight, 2);
  assert.equal(hosted.maxLeftMultiplicity, 2); assert.equal(hosted.maxRightMultiplicity, 3); assert.equal(f.data.table.mock.callCount(), 0);
  assert.deepEqual(f.calls.map(c => c.id), ['left','right']);
  assert.ok(f.calls[1].control.executionMs <= f.calls[0].control.executionMs);
});
test('hosted source probes are staged boundedly and truncation survives a selective prefix', async t => {
  const f = await fixture(t, { left: Array.from({ length: 10030 }, (_, i) => i + 1), right: [1,1,10020] });
  const result = await f.prep.joinDiagnostics(f.context, 'draft', { pipeline, through: 'join' });
  assert.equal(result.leftRowsSampled, 10000); assert.equal(result.leftTruncated, true); assert.equal(result.matchedRows, 2); assert.equal(result.unmatchedRight, 1);
  assert.equal(f.budgets.snapshot(f.context.tenantId).sourceRows, 10004);
  const filtered = { ...pipeline, steps: [{ id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'id', values: [10020] }] } }, ...pipeline.steps] };
  const zero = await f.prep.joinDiagnostics(f.context, 'draft', { pipeline: filtered, through: 'join' });
  assert.equal(zero.leftRowsSampled, 0); assert.equal(zero.leftTruncated, true); assert.equal(zero.matchedRows, 0);
});
test('hosted diagnostics deny foreign, protected and invalid joins before source I/O', async t => {
  const f = await fixture(t, { left: [1], right: [1] });
  await f.sources.create(await f.login('two'), 'foreign', { ...registration(), columns });
  await f.sources.create(f.context, 'protected', { ...registration(), columns, policy: { rowLevel: true, rowRules: [] } });
  for (const [source, code] of [['foreign', 'RESOURCE_NOT_FOUND'], ['protected', 'PREP_SECURITY_REJECTED']]) {
    const p = structuredClone(pipeline); p.steps[0].config.source = source;
    await assert.rejects(f.prep.joinDiagnostics(f.context, 'draft', { pipeline: p, through: 'join' }), { code });
  }
  await assert.rejects(f.prep.joinDiagnostics(await f.login('one', 'other'), 'draft', { pipeline, through: 'join' }), { code: 'RESOURCE_NOT_FOUND' });
  const bad = structuredClone(pipeline); bad.steps[0].config.keys = [];
  await assert.rejects(f.prep.joinDiagnostics(f.context, 'draft', { pipeline: bad, through: 'join' }), { code: 'INVALID_PREP_PIPELINE' });
  assert.equal(f.calls.length, 0);
});
test('hosted file samples preserve fan-out and probes without opening the full payload', async t => {
  const f = await fixture(t, { left: [1], right: [1,1,1,3] });
  const file = await f.sources.upload(f.context, { ...upload(), base64: Buffer.from('id\n' + [1,1,...Array(10028).fill(2)].join('\n') + '\n').toString('base64') });
  const right = await f.sources.upload(f.context, { ...upload(), base64: Buffer.from('id\n1\n1\n1\n3\n').toString('base64') });
  const payload = t.mock.method(f.sources, 'payload', async () => { throw Error('Must not read full payload'); });
  const p = structuredClone(pipeline); p.input = file.id; p.steps[0].config.source = right.id;
  const result = await f.prep.joinDiagnostics(f.context, 'draft', { pipeline: p, through: 'join' });
  assert.equal(result.matchedRows, 6); assert.equal(result.fanOut, true);
  assert.equal(result.leftRowsSampled, 10000); assert.equal(result.leftTruncated, true); assert.equal(result.rightTruncated, false);
  assert.equal(payload.mock.callCount(), 0);
  const source = await f.sources.get(f.context, file.id), key = f.sources.key(f.context, 'secret', source.secretId + '_sample');
  const sample = await f.metadata.get(f.context, key);
  await f.metadata.put(f.context, key, { ...sample.body, ciphertext: (sample.body.ciphertext[0] === 'A' ? 'B' : 'A') + sample.body.ciphertext.slice(1) }, sample.version);
  await assert.rejects(f.prep.joinDiagnostics(f.context, 'draft', { pipeline: p, through: 'join' }), { code: 'SOURCE_SECRET_UNAVAILABLE' });
  assert.equal(payload.mock.callCount(), 0);
});
test('hosted bounded reader refuses a source that exceeds its contract; no partial counts escape', async t => {
  const f = await sourceFixture(t), context = await f.login();
  for (const id of ['left','right']) await f.sources.create(context, id, { ...registration(), columns });
  const data = new HostedData(f.sources, async (_r, _c, _l, sink) => { sink.start(columns); for (let i = 0; i < 10002; i++) sink.row([i]); }, f.budgets);
  await assert.rejects(new HostedPrep(data).joinDiagnostics(context, 'draft', { pipeline, through: 'join' }), { code: 'PREP_EXECUTION_FAILED' });
});
test('hosted diagnostics recheck revisions after sampling and withhold counts after source rotation', async t => {
  const f = await fixture(t, { left: [1], right: [1] });
  const original = f.data.boundedSample.bind(f.data);
  t.mock.method(f.data, 'boundedSample', async (...args) => {
    const result = await original(...args);
    await f.sources.rotate(f.context, 'left', { expectedVersion: 1, credentials: registration().credentials });
    return result;
  });
  await assert.rejects(f.prep.joinDiagnostics(f.context, 'draft', { pipeline, through: 'join' }), { code: 'METADATA_REVISED' });
});

import { Readable } from 'node:stream';
import { HostedDataRoutes } from '../dist/hosted-data-routes.js';
import { adaptGatewayRequest } from '../dist/runtime-ingress.js';
import { serverlessDataPath } from '../dist/serverless-application.js';
import { runtimeEnv, event } from './runtime-helpers.mjs';
test('hosted join diagnostics route rechecks before publication and uses the read result adapter', async t => {
  for (const revoke of [false, true]) {
    const f = await fixture(t, { left: [1], right: [1] });
    let finished = false, published = false, adapted = 0;
    const routes = new HostedDataRoutes(f.data, undefined, async (_request, _context, status, body) => { adapted++; return { status, body }; });
    const original = routes.prep.joinDiagnostics.bind(routes.prep);
    t.mock.method(routes.prep, 'joinDiagnostics', async (...args) => { const result = await original(...args); finished = true; return result; });
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({ pipeline, through: 'join' }))]), { method: 'POST', headers: { 'content-type': 'application/json' } });
    const response = { writeHead() { published = true; }, end() {} };
    const run = routes.route(request, response, '/api/datasets/draft/prep/join-diagnostics', f.context, async () => {
      if (revoke && finished) await f.sources.rotate(f.context, 'left', { expectedVersion: 1, credentials: registration().credentials });
    });
    if (revoke) { await assert.rejects(run, { code: 'METADATA_REVISED' }); assert.equal(published, false); assert.equal(adapted, 0); }
    else { assert.equal(await run, true); assert.equal(published, true); assert.equal(adapted, 1); }
  }
});
test('runtime ingress and serverless allowlists admit only the POST diagnostics operation', () => {
  for (const scope of ['', 'namespaces/one/']) {
    const path = `/api/${scope}datasets/draft/prep/join-diagnostics`;
    assert.equal(serverlessDataPath(path), true);
    assert.equal(adaptGatewayRequest(event(`/api${path}`, 'POST'), runtimeEnv()).path, path);
    assert.throws(() => adaptGatewayRequest(event(`/api${path}`, 'GET'), runtimeEnv()), { code: 'HOSTED_REQUEST_INVALID' });
    assert.equal(serverlessDataPath(`${path}/unexpected`), false);
  }
});

import { fixture as s3Fixture, registration as s3Registration } from './source-s3-helpers.mjs';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable as Stream } from 'node:stream';
test('hosted S3 uploads use their persisted bounded sample, with fan-out and no later S3/full payload read', async t => {
  const f = await s3Fixture(t), context = await f.login();
  const sdk = t.mock.method(S3Client.prototype, 'send', async () => ({ Body: Stream.from([Buffer.from('id\n1\n1\n2\n')]) }));
  await f.sources.create(context, 's3-left', s3Registration());
  await f.sources.create(context, 's3-right', s3Registration());
  const before = sdk.mock.callCount();
  t.mock.method(f.sources, 'payload', async () => { throw Error('Full payload forbidden'); });
  const p = structuredClone(pipeline); p.input = 's3-left'; p.steps[0].config.source = 's3-right';
  const result = await new HostedPrep(new HostedData(f.sources, undefined, f.budgets)).joinDiagnostics(context, 'draft', { pipeline: p, through: 'join' });
  assert.equal(result.matchedRows, 5); assert.equal(result.fanOut, true); assert.equal(result.leftRowsSampled, 3); assert.equal(result.leftTruncated, false);
  assert.equal(sdk.mock.callCount(), before);
});

import { mkdtemp, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { StoredTableFiles } from '../dist/stored-tables.js';
import { BlazeTable, blazeLimits } from '../dist/blaze.js';
for (const mode of ['BLAZE', 'STORED']) test(`Issue #288 hosted nested ${mode} keeps snapshot semantics, probes and fan-out`, async t => {
  const f = await sourceFixture(t), context = await f.login(), dir = await mkdtemp(join(tmpdir(), 'bounded-hosted-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await f.sources.create(context, 'left', { ...registration(), columns });
  let current = [1,1,...Array(10028).fill(2)], reads = 0;
  const data = new HostedData(f.sources, async (_r, _c, _l, sink) => { reads++; sink.start(columns); for (const id of current) sink.row([id]); }, f.budgets);
  data.storedFiles = new StoredTableFiles(dir); const prep = new HostedPrep(data);
  await prep.save(context, 'snapshot', { name: 'Snapshot', pipeline: { version: 1, input: 'left', steps: [] }, expectedVersion: 0 });
  await prep.configure(context, 'snapshot', { mode, intervalMinutes: null, expectedVersion: 1 });
  await prep.save(context, 'wrapper', { name: 'Wrapper', pipeline: { version: 1, input: { dataset: 'snapshot' }, steps: [] }, expectedVersion: 0 });
  await prep.execute(context, 'snapshot', mode === 'STORED' ? 'publish' : 'refresh');
  current = [9]; const before = reads;
  t.mock.method(data, 'raw', () => { throw Error('Recipe recomputation forbidden'); });
  t.mock.method(data, 'table', () => { throw Error('Recipe recomputation forbidden'); });
  t.mock.method(data.cache, 'read', () => { throw Error('Full cache read forbidden'); });
  t.mock.method(data.storedFiles, 'read', () => { throw Error('Full stored read forbidden'); });
  const p = structuredClone(pipeline); p.input = { dataset: 'wrapper' }; p.steps[0].config.source = { dataset: 'wrapper' };
  const result = await prep.joinDiagnostics(context, 'draft', { pipeline: p, through: 'join' });
  assert.equal(result.matchedRows, 4 + 9998 ** 2); assert.equal(result.fanOut, true);
  assert.equal(result.leftRowsSampled, 10000); assert.equal(result.leftTruncated, true); assert.equal(result.rightTruncated, true); assert.equal(reads, before);
});
test('Issue #288 stored sample corruption, generation replacement and legacy artifacts fail closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bounded-stored-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const files = new StoredTableFiles(dir), limits = blazeLimits(), table = new BlazeTable(limits); table.start(columns); table.row([1]); table.row([1]);
  const value = await files.write('snapshot', table, 'stamp', limits.datasetBytes), legacy = { ...value }; delete legacy.sample;
  t.mock.method(files, 'read', () => { throw Error('Full read forbidden'); });
  await assert.rejects(files.boundedSample('snapshot', async () => legacy, limits, () => {}), { code: 'UNSUPPORTED_PREP_STEP' });
  let calls = 0;
  await assert.rejects(files.boundedSample('snapshot', async () => ++calls === 1 ? value : { ...value, stamp: 'changed' }, limits, () => {}), { code: 'STORED_DEFINITION_CHANGED' });
  const path = join(dir, createHash('sha256').update('snapshot').digest('hex'), `${value.generation}.parquet`), file = await open(path, 'r+');
  try { await file.write(Buffer.from('!'), 0, 1, value.sample.offset); } finally { await file.close(); }
  await assert.rejects(files.boundedSample('snapshot', async () => value, limits, () => {}), { code: 'STORED_ARTIFACT_INVALID' });
});
