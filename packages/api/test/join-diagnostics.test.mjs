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
test('hosted uploads and cached prepared inputs stop before full payload/cache reads', async t => {
  const f = await fixture(t, { left: [1], right: [1] });
  const file = await f.sources.upload(f.context, { ...upload(), base64: Buffer.from('id\n1\n2\n').toString('base64') });
  const payload = t.mock.method(f.sources, 'payload', async () => { throw Error('Must not read full payload'); });
  await assert.rejects(f.prep.joinDiagnostics(f.context, 'draft', { pipeline: { ...pipeline, input: file.id }, through: 'join' }), { code: 'UNSUPPORTED_PREP_STEP' });
  assert.equal(payload.mock.callCount(), 0);
  await f.prep.save(f.context, 'cached', { name: 'Cached', pipeline: { version: 1, input: 'left', steps: [] }, expectedVersion: 0 });
  await f.prep.configure(f.context, 'cached', { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 });
  await assert.rejects(f.prep.joinDiagnostics(f.context, 'draft', { pipeline: { ...pipeline, input: { dataset: 'cached' } }, through: 'join' }), { code: 'UNSUPPORTED_PREP_STEP' });
  assert.equal(payload.mock.callCount(), 0); assert.equal(f.calls.length, 0);
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
