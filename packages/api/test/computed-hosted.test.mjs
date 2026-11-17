import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { sourceFixture, upload } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { StoredTableFiles } from '../dist/stored-tables.js';
const settings = { mode: 'STORED', intervalMinutes: null };
async function fixture(t) {
  const f = await sourceFixture(t);
  const setup = () => {
    const data = new HostedData(f.sources, undefined, f.budgets); data.storedFiles = new StoredTableFiles(join(dirname(f.path), 'tables'));
    const prep = new HostedPrep(data); return { data, prep };
  };
  const source = await f.sources.upload(await f.login(), upload()), { data, prep } = setup();
  await prep.save(await f.login(), 'computed', { name: 'Computed', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
  await prep.configure(await f.login(), 'computed', { ...settings, expectedVersion: 1 });
  return { ...f, source, data, prep, setup, f };
}
test('hosted publish is durable, refresh errors retain rows, and source revisions label stale', async t => {
  const f = await fixture(t), { prep } = f;
  const first = await prep.execute(await f.login(), 'computed', 'publish');
  assert.equal(first.state, 'current'); assert.equal(first.rowCount, 3);
  const old = (await prep.execute(await f.login(), 'computed', 'rows')).rows;
  const load = prep.load.bind(prep); prep.load = async () => { throw Object.assign(new Error('Named source failure'), { code: 'PREP_SOURCE_NOT_FOUND' }); };
  await assert.rejects(prep.execute(await f.login(), 'computed', 'refresh'), { code: 'PREP_SOURCE_NOT_FOUND' });
  const failed = (await prep.get(await f.login(), 'computed')).execution;
  assert.equal(failed.state, 'refresh-failed'); assert.equal(failed.error.message, 'Named source failure'); assert.ok(failed.failedAt);
  assert.deepEqual((await prep.execute(await f.login(), 'computed', 'rows')).rows, old); prep.load = load;
  await prep.execute(await f.login(), 'computed', 'refresh');
  const c = await f.login(), source = await f.metadata.get(c, { kind: 'source', id: f.source.id, ownerId: c.userId });
  await f.metadata.put(c, { kind: 'source', id: f.source.id, ownerId: c.userId }, source.body, source.version);
  assert.equal((await prep.get(await f.login(), 'computed')).execution.state, 'stale');
  await f.f.restart();
  const restarted = f.setup();
  assert.deepEqual((await restarted.prep.execute(await f.f.login(), 'computed', 'rows')).rows, old);
});
test('hosted stored datasets feed other computed pipelines; foreign owners cannot read or refresh', async t => {
  const f = await fixture(t); await f.prep.execute(await f.login(), 'computed', 'publish');
  await f.prep.save(await f.login(), 'nested', { name: 'Nested', pipeline: { version: 1, input: { dataset: 'computed' }, steps: [] }, expectedVersion: 0 });
  await f.prep.configure(await f.login(), 'nested', { ...settings, expectedVersion: 1 });
  f.sources.payload = async () => assert.fail('A nested stored input must read its artifact');
  assert.equal((await f.prep.execute(await f.login(), 'nested', 'publish')).rowCount, 3);
  const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
  assert.deepEqual((await f.prep.execute(await f.login(), 'nested', 'query', query)).rows, [{ total: 60 }]);
  for (const context of [await f.login('one', 'other'), await f.login('two', 'admin')]) for (const action of ['rows', 'refresh', 'publish']) {
    await assert.rejects(f.prep.execute(context, 'computed', action), { code: 'RESOURCE_NOT_FOUND' });
  }
});
test('hosted storage admission uses the durable quota gauge and stops before pipeline execution', async t => {
  const { HostedUsage, initializeUsage } = await import('../dist/hosted-usage.js');
  const f = await fixture(t); await initializeUsage(f.db);
  const usage = new HostedUsage(f.db, { defaults: { apiCalls: 1000, computeAttempts: 1000, storageBytes: 1 }, tenants: {} });
  f.metadata.usage = usage;
  f.prep.load = async () => assert.fail('Over-quota publish must stop before pipeline execution');
  await assert.rejects(f.prep.execute(await f.login(), 'computed', 'publish'), error => {
    assert.equal(error.code, 'USAGE_LIMIT_EXCEEDED'); assert.equal(error.detail.limitBytes, 1); assert.ok(error.detail.overageBytes > 0); return true;
  });
  assert.equal((await f.prep.get(await f.login(), 'computed')).execution.state, 'empty');
});
test('download egress uses existing reservations, refuses known over-cap sizes before bytes, and records exact served bytes', async t => {
  const { HostedUsage, initializeUsage } = await import('../dist/hosted-usage.js');
  const { sendTableDownload } = await import('../dist/table-download.js');
  const { createServer } = await import('node:http'); const { once } = await import('node:events');
  const f = await fixture(t); await initializeUsage(f.db); await f.prep.execute(await f.login(), 'computed', 'publish');
  const c = await f.login(), download = await f.prep.download(c, 'computed', { format: 'csv' });
  const usage = new HostedUsage(f.db, { defaults: { apiCalls: 100, computeAttempts: 100, storageBytes: 100000000, egressBytes: download.bytes.length }, tenants: {} });
  const tooLarge = await usage.reserveEgress(c);
  await assert.rejects(usage.assertEgressSize(tooLarge, download.bytes.length + 1), { code: 'USAGE_LIMIT_EXCEEDED' }); await usage.releaseEgress(tooLarge);
  const server = createServer((_req, res) => void sendTableDownload(res, download, { usage, scope: c }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.close(); server.closeAllConnections(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}`); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), download.bytes);
  // Allow the async durable settlement at stream completion to finish.
  for (let i = 0; i < 50; i++) { const row = await f.db.transaction(db => db.query("SELECT admitted FROM h8_usage WHERE metric = 'egressBytes'")); if (Number(row[0]?.admitted) === download.bytes.length) break; await new Promise(r => setTimeout(r, 10)); }
  const row = await f.db.transaction(db => db.query("SELECT admitted FROM h8_usage WHERE metric = 'egressBytes'")); assert.equal(Number(row[0].admitted), download.bytes.length);
  await assert.rejects(usage.reserveEgress(c), { code: 'USAGE_LIMIT_EXCEEDED' });
  f.prep.downloadsEnabled = false; await assert.rejects(f.prep.download(c, 'computed', { format: 'csv' }), { code: 'DOWNLOADS_DISABLED' });
});
