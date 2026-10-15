import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { manifestFixture } from './manifest-helpers.mjs';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateObjects } from '../dist/object-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedUsage } from '../dist/hosted-usage.js';
import { describeStorage, formatBytes, quotaExceededSummary, validateMaintenanceAdjustment, nextReclamationAt } from '../dist/storage-breakdown.js';

const digest = Buffer.alloc(32, 1).toString('base64');
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'storage-inspect-cli.js');
async function fixture(t) {
  const f = await manifestFixture(t);
  await migrateDispatch(f.db, 'test', 'frozen', 'sqlite'); await migrateObjects(f.db, 'test', 'frozen', 'sqlite');
  const usage = new HostedUsage(f.db, f.entitlements, Date.now, 'test'), metadata = new TenantMetadata(f.db, f.db, usage);
  const contexts = await Promise.all(['one', 'two'].map(namespaceId => metadata.authenticate(null, async () => ({ namespaceId, userId: 'admin' }))));
  const dispatch = new DurableDispatch(f.db, metadata, 'test', { recover: async () => {}, dispatch: async () => {} }, 'sqlite'), ledger = new ObjectLedger(metadata, 'test');
  await f.open();
  return { ...f, metadata, contexts, usage, dispatch, ledger,
    plan: (capacityBytes = 200000, index = 0) => ledger.plan(contexts[index], { capacityBytes, purpose: 'raw-upload', mediaType: 'text/csv', checksum: digest }),
    async reserve(plans, index = 0) {
      const ctx = contexts[index], revisions = await metadata.revisions(ctx), handle = await dispatch.prepare(ctx, { kind: 'upload-reserve', revisions, requestDigest: 'a'.repeat(64), idempotencyKey: randomUUID() });
      await dispatch.commit(handle, async (c, now) => {
        await ledger.reserve(c, ctx, revisions, handle.intentId, plans, now, now + 600000, now + 60000);
        return { receipt: { id: plans[0].id, revision: 1 }, events: [] };
      }); return handle;
    },
    breakdown: (index = 0, now) => f.db.transaction(c => describeStorage(c, { deployment: 'test', tenantId: contexts[index].tenantId, namespaceId: contexts[index].namespaceId, ...(now === undefined ? {} : { now }) })),
  };
}

test('#91 fresh namespace reports zeros and no pending cleanup', async t => {
  const f = await fixture(t), b = await f.breakdown(1);
  assert.equal(b.limitBytes, 1000000); assert.equal(b.liveBytes, 0); assert.equal(b.reservedBytes, 0);
  assert.equal(b.pendingCleanupBytes, 0); assert.deepEqual(b.pendingCleanup, []); assert.equal(b.nextReclamationAt, null); assert.equal(b.overdueCount, 0);
});

test('#91 failed reservation stays charged and visible with its reclamation time', async t => {
  const f = await fixture(t);
  await f.reserve([f.plan(600000)]);
  const rejected = await f.reserve([f.plan(600000)]).then(() => null, e => e);
  assert.equal(rejected.code, 'USAGE_LIMIT_EXCEEDED');
  const b = await f.breakdown();
  assert.equal(b.reservedBytes, 600000); assert.equal(b.pendingCleanupBytes, 600000);
  assert.equal(b.pendingCleanup.length, 1); assert.equal(b.pendingCleanup[0].state, 'reserved');
  assert.ok(b.pendingCleanup[0].nextReclamationAt > Date.now());
  assert.equal(b.nextReclamationAt, b.pendingCleanup[0].nextReclamationAt);
  assert.equal(b.overdueCount, 0);
});

test('#91 quota error explains live, reserved, pending and next reclamation', async t => {
  const f = await fixture(t);
  await f.reserve([f.plan(600000)]);
  const rejected = await f.reserve([f.plan(600000)]).then(() => null, e => e);
  assert.equal(rejected.code, 'USAGE_LIMIT_EXCEEDED'); assert.equal(rejected.status, 429);
  const summary = String(rejected.detail?.summary ?? '');
  assert.ok(summary.includes('Storage limit'), 'names the limit');
  assert.ok(summary.includes('reserved'), 'names retained reservations');
  assert.ok(summary.includes('24-hour'), 'names the 24-hour retention rule');
  assert.equal(rejected.detail.breakdown.reservedBytes, 600000);
  assert.equal(rejected.detail.breakdown.pendingCleanupCount, 1);
  assert.equal(rejected.detail.breakdown.limitBytes, 1000000);
  assert.equal(rejected.detail.requestedBytes, 600000);
});

test('#91 retiring past reclamation is flagged overdue; exact-version deletion clears the charge', async t => {
  const f = await fixture(t), ctx = f.contexts[0], plan = f.plan(200000);
  await f.reserve([plan]);
  await f.db.transaction(c => f.ledger.bind(c, ctx, plan.id, { version: 'exact-version', bytes: 12000, checksum: digest }));
  const later = Date.now() + 86500000;
  await f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, later));
  const b = await f.breakdown(0, later);
  assert.equal(b.liveBytes, 12000); assert.equal(b.overdueCount, 1);
  assert.ok(b.pendingCleanup[0].overdue, 'retiring past its reclamation time is overdue');
  await assert.rejects(f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'wrong-version')), { code: 'OBJECT_BINDING_CONFLICT' });
  const still = await f.breakdown(0, later);
  assert.equal(still.liveBytes, 12000, 'wrong version proves nothing; charge retained');
  await f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'exact-version'));
  await f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'exact-version')); // duplicate cleanup is idempotent
  const done = await f.breakdown(0, later);
  assert.equal(done.liveBytes, 0); assert.equal(done.pendingCleanup.length, 0); assert.equal(done.overdueCount, 0);
});

test('#91 pinned live references block retire; breakdown stays namespace-scoped', async t => {
  const f = await fixture(t), ctx = f.contexts[0], plan = f.plan(200000);
  await f.reserve([plan]);
  const later = Date.now() + 86500000;
  await f.db.transaction(c => c.query('INSERT INTO sr_object_pin VALUES (?,?,?,?,?,?,?)', ['test', ctx.tenantId, ctx.namespaceId, ctx.userId, plan.id, 'backup', later + 100000]));
  await assert.rejects(f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, later)), { code: 'OBJECT_RETENTION_REQUIRED' });
  const b = await f.breakdown();
  assert.equal(b.pendingCleanup.length, 1); assert.equal(b.overdueCount, 0, 'pinned object is not an overdue obligation');
  const other = await f.breakdown(1);
  assert.equal(other.pendingCleanup.length, 0, 'namespace two sees none of namespace one');
});

test('#91 read-only diagnostic CLI prints the breakdown as JSON', async t => {
  const f = await fixture(t);
  await f.reserve([f.plan(600000)]);
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [cli, '--deployment', 'test', '--tenant', f.contexts[0].tenantId, '--namespace', 'one'],
    { env: { ...process.env, OPENSIGHT_METADATA_DATABASE: f.path, OPENSIGHT_METADATA_POSTGRES: '' } });
  const b = JSON.parse(stdout);
  assert.equal(b.reservedBytes, 600000); assert.equal(b.limitBytes, 1000000);
  assert.equal(b.pendingCleanup.length, 1); assert.equal(b.pendingCleanup[0].state, 'reserved');
  const usage = await run(process.execPath, [cli], { env: process.env }).then(() => null, e => e);
  assert.equal(usage.code, 1); assert.match(usage.stderr, /STORAGE_INSPECT_USAGE/);
});

test('#91 maintenance adjustment is specified and validated before any implementation', async t => {
  const scope = { deployment: 'test', tenantId: 'tenant-one', namespaceId: 'one' };
  const plan = validateMaintenanceAdjustment({ action: 'recompute-gauge', ...scope,
    ledgerReservedBytes: 600000, ledgerLiveBytes: 12000, currentReservedBytes: 612000, currentLiveBytes: 12000 });
  assert.equal(plan.action, 'recompute-gauge');
  assert.deepEqual(plan.writes, { reservedBytes: 600000, liveBytes: 12000,
    auditEvent: 'storage.maintenance.recompute-gauge:test/tenant-one/one:reserved=600000:live=12000' });
  assert.throws(() => validateMaintenanceAdjustment({ action: 'adjust-quota', ...scope, ledgerReservedBytes: 0, ledgerLiveBytes: 0, currentReservedBytes: 1, currentLiveBytes: 0 }),
    { code: 'MAINTENANCE_ACTION_INVALID' }, 'only the bounded recompute action is valid');
  assert.throws(() => validateMaintenanceAdjustment({ action: 'recompute-gauge', ...scope, ledgerReservedBytes: -1, ledgerLiveBytes: 0, currentReservedBytes: 0, currentLiveBytes: 0 }),
    { code: 'MAINTENANCE_ADJUSTMENT_INVALID' }, 'negative ledger values rejected');
  assert.throws(() => validateMaintenanceAdjustment({ action: 'recompute-gauge', ...scope, ledgerReservedBytes: 0, ledgerLiveBytes: 0, currentReservedBytes: 0, currentLiveBytes: 0 }),
    { code: 'MAINTENANCE_NOOP' }, 'no-op adjustments rejected');
  assert.throws(() => validateMaintenanceAdjustment({ action: 'recompute-gauge', deployment: 'test', tenantId: 'tenant one!', namespaceId: 'one',
    ledgerReservedBytes: 0, ledgerLiveBytes: 0, currentReservedBytes: 1, currentLiveBytes: 0 }), 'scope identifiers validated');
});

test('#91 formatBytes and nextReclamationAt helpers', () => {
  assert.equal(formatBytes(256 * 1024 * 1024), '256 MiB');
  assert.equal(formatBytes(600000), '586 KiB');
  assert.equal(nextReclamationAt(0, 1000, 0), 86400000, '24h minimum hold dominates');
  assert.equal(quotaExceededSummary({ limitBytes: 1, metadataBytes: 0, liveBytes: 0, reservedBytes: 0, totalBytes: 0,
    pendingCleanupBytes: 0, nextReclamationAt: null, overdueCount: 0, pendingCleanup: [], deployment: 't', tenantId: 't', namespaceId: 'n', at: '' }, 1).includes('no pending objects'), true);
});
