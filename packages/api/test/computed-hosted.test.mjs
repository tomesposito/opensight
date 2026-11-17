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
