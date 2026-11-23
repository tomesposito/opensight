import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StoredTableFiles } from '../dist/stored-tables.js';
import { BlazeTable, blazeLimits } from '../dist/blaze.js';
import { resourceBytes } from '../dist/hosted-usage.js';

const columns = [{ name: 'id', type: 'INTEGER' }];
const dirFor = (root, key) => join(root, createHash('sha256').update(key).digest('hex'));
const fileFor = (root, key, generation) => join(dirFor(root, key), `${generation}.parquet`);
const exists = async path => { try { await stat(path); return true; } catch { return false; } };

async function write(files, key, rows) {
  const limits = blazeLimits(), table = new BlazeTable(limits);
  table.start(columns);
  for (const row of rows) table.row([row]);
  return files.write(key, table, 'stamp', limits.datasetBytes + 1024 * 1024);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'stored-tables-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, files: new StoredTableFiles(root) };
}

test('Issue #309 crash before the metadata swap: the uncommitted generation is recovered, the referenced one survives', async t => {
  const { root, files } = await fixture(t), key = 'tenant-a';
  const committed = await write(files, key, [1]);
  const pending = await write(files, key, [2, 3]); // written + fsynced, then the process "crashes" before committing metadata
  const removed = await files.reconcileKey(key, [committed.generation]);
  assert.equal(removed, pending.bytes);
  assert.equal(await exists(fileFor(root, key, pending.generation)), false);
  assert.equal(await exists(fileFor(root, key, committed.generation)), true);
  const read = await files.read(key, committed, blazeLimits());
  assert.equal(read.rowCount, 1);
});

test('Issue #309 crash after the metadata swap: the retired previous generation is recovered', async t => {
  const { root, files } = await fixture(t), key = 'tenant-b';
  const previous = await write(files, key, [1]);
  const current = await write(files, key, [2]); // metadata committed to current, then the process "crashes" before removing previous
  const removed = await files.reconcileKey(key, [current.generation]);
  assert.equal(removed, previous.bytes);
  assert.equal(await exists(fileFor(root, key, previous.generation)), false);
  assert.equal(await exists(fileFor(root, key, current.generation)), true);
});

test('Issue #309 startup sweep removes unknown-key directories and stale generations, preserving referenced ones', async t => {
  const { root, files } = await fixture(t);
  const kept = await write(files, 'known', [1]);
  const stale = await write(files, 'known', [2]);
  const orphan = await write(files, 'deleted-dataset', [3]);
  const removed = await files.sweep(new Map([['known', [kept.generation]]]));
  assert.equal(removed, stale.bytes + orphan.bytes);
  assert.equal(await exists(fileFor(root, 'known', kept.generation)), true);
  assert.equal(await exists(fileFor(root, 'known', stale.generation)), false);
  assert.equal(await exists(fileFor(root, 'deleted-dataset', orphan.generation)), false);
});

test('Issue #309 a leased generation is journaled durably, never unlinked early, and recovered by a fresh instance', async t => {
  const { root, files } = await fixture(t), key = 'tenant-c';
  const value = await write(files, key, [1]);
  files.readers.set(key, 1); // an active read lease (TS-private field, plain property in dist)
  await files.remove(key, value);
  assert.equal(await exists(fileFor(root, key, value.generation)), true, 'leased file must survive');
  const journal = JSON.parse(await readFile(join(dirFor(root, key), 'retired-generations.json'), 'utf8'));
  assert.deepEqual(journal, [value.generation], 'the deferral is persisted, not only in memory');
  // Reconciliation on the leased instance must not unlink it either.
  assert.equal(await files.reconcileKey(key, []), 0);
  assert.equal(await exists(fileFor(root, key, value.generation)), true);
  // A fresh instance (post-restart: in-memory lease/deferral state is gone)
  // recovers the journaled generation because no metadata references it.
  const restarted = new StoredTableFiles(root);
  assert.equal(await restarted.reconcileKey(key, []), value.bytes);
  assert.equal(await exists(fileFor(root, key, value.generation)), false);
  assert.equal(await exists(join(dirFor(root, key), 'retired-generations.json')), false, 'journal settles once the file is gone');
});

test('Issue #309 releasing the last lease deletes the retired generation and settles its journal entry', async t => {
  const { root, files } = await fixture(t), key = 'tenant-d';
  const old = await write(files, key, [1]);
  const current = await write(files, key, [2]);
  let journalDuringRead;
  const table = await files.readCurrent(key, async () => {
    await files.remove(key, old); // deferred: the read lease is active
    journalDuringRead = JSON.parse(await readFile(join(dirFor(root, key), 'retired-generations.json'), 'utf8'));
    return current;
  }, blazeLimits());
  assert.equal(table.rowCount, 1);
  assert.deepEqual(journalDuringRead, [old.generation]);
  assert.equal(await exists(fileFor(root, key, old.generation)), false);
  assert.deepEqual(await readdir(dirFor(root, key)), [`${current.generation}.parquet`]);
});

test('Issue #309 remove reports deferral and pendingBytes charges the journaled generation until unlink', async t => {
  const { root, files } = await fixture(t), key = 'tenant-e';
  const value = await write(files, key, [1]);
  files.readers.set(key, 1); // active lease
  assert.equal(await files.remove(key, value), false, 'deferred behind the lease');
  assert.equal(await files.pendingBytes(key), value.bytes);
  files.readers.delete(key);
  await files.release(key);
  assert.equal(await files.pendingBytes(key), 0);
  assert.equal(await exists(fileFor(root, key, value.generation)), false);
});

test('Issue #309 reconciliation is a no-op for deployments without a stored-files directory', async () => {
  const files = new StoredTableFiles(undefined);
  assert.equal(files.durable, false);
  assert.equal(await files.reconcileKey('anything', []), 0);
  assert.equal(await files.sweep(new Map()), 0);
  assert.equal(await files.pendingBytes('anything'), 0);
});

test('Issue #309 usage accounting counts the current generation and a pending reservation together', async () => {
  const body = JSON.stringify({ materialization: { bytes: 100 }, storedReservationBytes: 50 });
  const c = { query: async () => [{ kind: 'prepared-dataset', body }] };
  const bytes = await resourceBytes(c, { tenantId: 't', namespaceId: 'n' });
  assert.equal(bytes, Buffer.byteLength(body, 'utf8') + 150);
});
