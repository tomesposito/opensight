import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { sourceFixture, upload } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { StoredTableFiles } from '../dist/stored-tables.js';
import { BlazeTable } from '../dist/blaze.js';
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
const storedKey = (context, id) => ({ kind: 'prepared-dataset', id, ownerId: context.userId });
async function nestedFixture(t) {
  const f = await fixture(t), c = await f.login();
  await f.prep.execute(c, 'computed', 'publish');
  await f.prep.save(c, 'nested', { name: 'Nested', pipeline: { version: 1, input: { dataset: 'computed' }, steps: [] }, expectedVersion: 0 });
  await f.prep.configure(c, 'nested', { ...settings, expectedVersion: 1 });
  return { ...f, c };
}
// Complete a competing refresh without acquiring this request's compute slot:
// write a real immutable artifact, atomically swap its pointer, retire G1.
async function replaceChild(f) {
  const { c, data, metadata } = f, previous = await metadata.get(c, storedKey(c, 'computed'));
  const table = new BlazeTable(data.limits(c)); table.start(previous.body.materialization.columns); table.row(['new', 99, 'generation-two']);
  const key = JSON.stringify([c.tenantId, c.namespaceId, c.userId, 'prep', 'computed']);
  const value = await data.storedFiles.write(key, table, previous.body.materialization.stamp, data.limits(c).datasetBytes + 1024 * 1024);
  await metadata.materialization(c, 'computed', previous.version, { value, reserve: 0 });
  await data.storedFiles.remove(key, previous.body.materialization);
  return value;
}
test('load captures the generation selected under the stored-child read lease (#306)', async t => {
  const f = await nestedFixture(t), { c, prep, data } = f;
  const first = (await f.metadata.get(c, storedKey(c, 'computed'))).body.materialization;
  const read = data.storedFiles.read.bind(data.storedFiles);
  let replacement, consumed;
  data.storedFiles.read = async (key, value, limits) => {
    if (!replacement && JSON.parse(key).at(-1) === 'computed') replacement = await replaceChild(f);
    return read(key, value, limits);
  };
  const load = prep.load.bind(prep);
  prep.load = async (...args) => { consumed = await load(...args); return consumed; };
  const preview = await prep.preview(c, 'nested', {});
  assert.ok(replacement); assert.notEqual(replacement.generation, first.generation);
  assert.deepEqual([...consumed], [['computed', first.generation]]);
  assert.deepEqual(preview.rows.map(row => row.amount), [10, 20, 30]);
  assert.deepEqual((await prep.execute(c, 'computed', 'rows')).rows.map(row => row.amount), [99]);
});
test('stored parents stamp only generations actually read and detect subsequent refreshes (#306)', async t => {
  const f = await nestedFixture(t), { c, prep } = f;
  await prep.execute(c, 'nested', 'publish');
  const child = (await f.metadata.get(c, storedKey(c, 'computed'))).body.materialization;
  const parent = (await f.metadata.get(c, storedKey(c, 'nested'))).body.materialization;
  assert.deepEqual(JSON.parse(parent.stamp)[2], [['computed', 2, child.generation]]);
  assert.equal((await prep.get(c, 'nested')).execution.state, 'current');
  await prep.save(c, 'outer', { name: 'Outer', pipeline: { version: 1, input: { dataset: 'nested' }, steps: [] }, expectedVersion: 0 });
  await prep.configure(c, 'outer', { ...settings, expectedVersion: 1 });
  const read = f.data.storedFiles.read.bind(f.data.storedFiles), reads = [];
  f.data.storedFiles.read = async (...args) => { reads.push(JSON.parse(args[0]).at(-1)); return read(...args); };
  await prep.execute(c, 'outer', 'publish');
  assert.deepEqual(reads, ['nested']);
  const outer = (await f.metadata.get(c, storedKey(c, 'outer'))).body.materialization;
  assert.deepEqual(JSON.parse(outer.stamp)[2], [['nested', 2, parent.generation], ['computed', 2, null]]);
  assert.equal((await prep.get(c, 'outer')).execution.state, 'current');
  const replacement = await replaceChild(f);
  assert.notEqual(replacement.generation, child.generation);
  assert.equal((await prep.get(c, 'nested')).execution.state, 'stale');
  assert.deepEqual((await prep.execute(c, 'nested', 'rows')).rows.map(row => row.amount), [10, 20, 30]);
});
for (const action of ['publish', 'refresh']) for (const point of ['read', 'load', 'publication']) {
  test(`parent ${action} rejects a child refresh at ${point} and cleans up (#306)`, async t => {
    const f = await nestedFixture(t), { c, prep, data, metadata } = f;
    if (action === 'refresh') await prep.execute(c, 'nested', 'publish');
    const before = (await metadata.get(c, storedKey(c, 'nested'))).body.materialization;
    const first = (await metadata.get(c, storedKey(c, 'computed'))).body.materialization;
    let replacement, candidate, rows;
    const read = data.storedFiles.read.bind(data.storedFiles);
    data.storedFiles.read = async (key, value, limits) => {
      if (point === 'read' && !replacement && JSON.parse(key).at(-1) === 'computed') replacement = await replaceChild(f);
      return read(key, value, limits);
    };
    const load = prep.load.bind(prep);
    prep.load = async (...args) => {
      const consumed = await load(...args);
      if (args[1] === 'nested') {
        rows = args[3].rows();
        if (point === 'load' && !replacement) replacement = await replaceChild(f);
      }
      return consumed;
    };
    const materialization = metadata.materialization.bind(metadata);
    metadata.materialization = async (context, id, version, update, expected) => {
      if (id === 'nested' && update.value?.state === 'current') {
        candidate = update.value;
        if (point === 'publication' && !replacement) replacement = await replaceChild(f);
      }
      return materialization(context, id, version, update, expected);
    };
    await assert.rejects(prep.execute(c, 'nested', action), { code: 'STORED_GENERATION_CHANGED' });
    assert.ok(replacement); assert.notEqual(replacement.generation, first.generation);
    assert.deepEqual(rows.map(row => row.amount), [10, 20, 30]);
    assert.deepEqual(JSON.parse(candidate.stamp)[2], [['computed', 2, first.generation]]);
    const after = (await metadata.get(c, storedKey(c, 'nested'))).body;
    assert.equal(Number(after.storedReservationBytes), 0);
    if (before) {
      assert.equal(after.materialization.generation, before.generation);
      assert.equal(after.materialization.state, 'refresh-failed');
      assert.equal(after.materialization.error.code, 'STORED_GENERATION_CHANGED');
      assert.ok(after.materialization.failedAt);
      assert.deepEqual((await prep.execute(c, 'nested', 'rows')).rows.map(row => row.amount), [10, 20, 30]);
    } else assert.equal(after.materialization, undefined);
    const key = JSON.stringify([c.tenantId, c.namespaceId, c.userId, 'prep', 'nested']);
    await assert.rejects(read(key, candidate, data.limits(c)), { code: 'STORED_ARTIFACT_INVALID' });
    // Retry consumes G2 and can publish; neither the reservation nor the
    // per-dataset refresh exclusion leaked out of the rejected attempt.
    assert.equal((await prep.execute(c, 'nested', action)).state, 'current');
    const retried = (await metadata.get(c, storedKey(c, 'nested'))).body.materialization;
    assert.deepEqual(JSON.parse(retried.stamp)[2], [['computed', 2, replacement.generation]]);
    assert.deepEqual((await prep.execute(c, 'nested', 'rows')).rows.map(row => row.amount), [99]);
    assert.equal((await prep.get(c, 'nested')).execution.state, 'current');
  });
}
test('materialization checks dependency definitions and generations in its publication transaction (#306)', async t => {
  const f = await nestedFixture(t), { c, prep, metadata } = f;
  await prep.execute(c, 'nested', 'publish');
  const parent = await metadata.get(c, storedKey(c, 'nested')), child = await metadata.get(c, storedKey(c, 'computed'));
  const dependency = { id: 'computed', version: child.version, generation: child.body.materialization.generation };
  for (const [change, code] of [
    [{ generation: '00000000-0000-4000-8000-000000000000' }, 'STORED_GENERATION_CHANGED'],
    [{ version: child.version + 1 }, 'STORED_DEFINITION_CHANGED'],
    [{ id: 'missing' }, 'STORED_DEFINITION_CHANGED'],
  ]) {
    await assert.rejects(metadata.materialization(c, 'nested', parent.version, {
      value: parent.body.materialization, reserve: 123, expectedDependencies: [{ ...dependency, ...change }],
    }), { code });
    assert.deepEqual((await metadata.get(c, storedKey(c, 'nested'))).body, parent.body);
  }
  await metadata.materialization(c, 'nested', parent.version, { value: parent.body.materialization, expectedDependencies: [dependency] });
});
for (const kind of ['direct-recipe', 'append', 'join']) {
  test(`stored generations are captured through ${kind} references (#306)`, async t => {
    const f = await nestedFixture(t), { c, prep, metadata } = f;
    let pipeline;
    if (kind === 'direct-recipe') {
      await prep.save(c, 'bridge', { name: 'Bridge', pipeline: { version: 1, input: { dataset: 'computed' }, steps: [] }, expectedVersion: 0 });
      assert.equal((await prep.get(c, 'bridge')).execution.mode, 'DIRECT_QUERY');
      pipeline = { version: 1, input: { dataset: 'bridge' }, steps: [] };
    } else {
      const config = kind === 'append' ? { source: f.source.id }
        : { source: { dataset: 'computed' }, joinType: 'inner', keys: [{ left: 'region', right: 'region' }], prefix: 'r_' };
      pipeline = { version: 1, input: kind === 'append' ? { dataset: 'computed' } : f.source.id, steps: [{ id: 'step', kind, config }] };
    }
    await prep.save(c, 'nested', { name: 'Nested', pipeline, expectedVersion: 2 });
    await prep.execute(c, 'nested', 'publish');
    const child = (await metadata.get(c, storedKey(c, 'computed'))).body.materialization;
    const parent = (await metadata.get(c, storedKey(c, 'nested'))).body.materialization;
    const dependencies = JSON.parse(parent.stamp)[2];
    assert.deepEqual(dependencies.filter(([, , generation]) => generation !== null), [['computed', 2, child.generation]]);
    assert.equal(parent.rowCount, kind === 'append' ? 6 : kind === 'join' ? 5 : 3);
    assert.equal((await prep.get(c, 'nested')).execution.state, 'current');
    await replaceChild(f);
    assert.equal((await prep.get(c, 'nested')).execution.state, 'stale');
  });
}
test('publication fails closed if execution omits a stored dependency generation (#306)', async t => {
  const f = await nestedFixture(t), { c, prep, metadata } = f;
  const load = prep.load.bind(prep);
  prep.load = async (...args) => { await load(...args); return new Map(); };
  await assert.rejects(prep.execute(c, 'nested', 'publish'), { code: 'STORED_GENERATION_CHANGED' });
  const parent = (await metadata.get(c, storedKey(c, 'nested'))).body;
  assert.equal(parent.materialization, undefined);
  assert.equal(Number(parent.storedReservationBytes), 0);
});
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
test('materialization value writes are generation compare-and-swap (#305)', async t => {
  const f = await fixture(t); await f.prep.execute(await f.login(), 'computed', 'publish');
  const c = await f.login(), key = { kind: 'prepared-dataset', id: 'computed', ownerId: c.userId };
  const resource = await f.metadata.get(c, key), current = resource.body.materialization;
  const stale = { ...current, state: 'stale' };
  await assert.rejects(f.metadata.materialization(c, 'computed', resource.version, { value: stale, expectedGeneration: '00000000-0000-4000-8000-000000000000' }), { code: 'STORED_GENERATION_CHANGED' });
  const after = await f.metadata.get(c, key);
  assert.equal(after.body.materialization.generation, current.generation); assert.equal(after.body.materialization.state, 'current');
  await f.metadata.materialization(c, 'computed', resource.version, { value: stale, expectedGeneration: current.generation });
  const marked = await f.metadata.get(c, key);
  assert.equal(marked.body.materialization.state, 'stale'); assert.equal(marked.body.materialization.generation, current.generation);
});
test('a delayed stale marking cannot restore a generation a refresh replaced (#305)', async t => {
  const f = await fixture(t), { prep } = f;
  await prep.execute(await f.login(), 'computed', 'publish');
  const rows = (await prep.execute(await f.login(), 'computed', 'rows')).rows;
  const c = await f.login(), key = { kind: 'prepared-dataset', id: 'computed', ownerId: c.userId };
  const firstGeneration = (await f.metadata.get(c, key)).body.materialization.generation;
  // Mutate the source so the published generation's stamp no longer matches:
  // the next status request will try to mark that generation stale.
  const source = await f.metadata.get(c, { kind: 'source', id: f.source.id, ownerId: c.userId });
  await f.metadata.put(c, { kind: 'source', id: f.source.id, ownerId: c.userId }, source.body, source.version);
  // Interleave: while the status request is paused before persisting its stale
  // marking, a refresh publishes a new generation and removes the old file.
  const metadata = f.metadata, original = metadata.materialization.bind(metadata);
  let interleaved = false, refreshedGeneration;
  metadata.materialization = async (context, id, version, update, expected) => {
    if (!interleaved && update.value?.state === 'stale' && update.expectedGeneration) {
      interleaved = true;
      await prep.execute(await f.login(), 'computed', 'refresh');
      refreshedGeneration = (await f.metadata.get(await f.login(), key)).body.materialization.generation;
    }
    return original(context, id, version, update, expected);
  };
  const status = await prep.get(await f.login(), 'computed');
  metadata.materialization = original;
  assert.equal(interleaved, true); assert.ok(refreshedGeneration); assert.notEqual(refreshedGeneration, firstGeneration);
  assert.equal(status.execution.state, 'current');
  const pointer = (await f.metadata.get(c, key)).body.materialization;
  assert.equal(pointer.generation, refreshedGeneration); assert.equal(pointer.state, 'current');
  assert.deepEqual((await prep.execute(await f.login(), 'computed', 'rows')).rows, rows);
});
test('a failed refresh against a superseded generation still releases its reservation (#305)', async t => {
  const f = await fixture(t), { prep } = f;
  await prep.execute(await f.login(), 'computed', 'publish');
  const c = await f.login(), key = { kind: 'prepared-dataset', id: 'computed', ownerId: c.userId };
  const snapshot = await prep.stored(c, 'computed'); // generation G1, captured before the next refresh
  await prep.execute(await f.login(), 'computed', 'refresh'); // publishes G2
  const current = (await f.metadata.get(c, key)).body;
  assert.notEqual(current.materialization.generation, snapshot.materialization.generation);
  assert.equal(Number(current.storedReservationBytes ?? 0), 0);
  // A refresh that started from the G1 snapshot now fails: its failure record
  // must not overwrite G2, and its capacity reservation must not leak.
  const load = prep.load.bind(prep), stored = prep.stored.bind(prep);
  prep.load = async () => { throw Object.assign(new Error('Named source failure'), { code: 'PREP_SOURCE_NOT_FOUND' }); };
  prep.stored = async () => snapshot;
  await assert.rejects(prep.execute(await f.login(), 'computed', 'refresh'), { code: 'PREP_SOURCE_NOT_FOUND' });
  prep.load = load; prep.stored = stored;
  const after = (await f.metadata.get(c, key)).body;
  assert.equal(after.materialization.generation, current.materialization.generation);
  assert.equal(after.materialization.state, 'current');
  assert.equal(Number(after.storedReservationBytes ?? 0), 0);
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
