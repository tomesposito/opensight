import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeployment, advance, rollback, failClosed } from '../ops/serverless/deploy-protocol.mjs';

const now = Date.now();
const manifest = { version: 1, source: 'a'.repeat(40), compatibility: 'b'.repeat(64) };
const manifestDigest = 'c'.repeat(64);
const current = { id: 'current-id', compatibility: 'b'.repeat(64) };
const approval = { version: 1, manifest: manifestDigest, source: 'a'.repeat(40), configuration: 'd'.repeat(64), current: 'current-id', expiresAt: now + 3600000 };

const fullRun = () => {
  let op = createDeployment({ manifest, manifestDigest, approval, current });
  op = advance(op, 'quiescing');
  op = advance(op, 'quiescent', { admissionBlocked: true, dispatchDisabled: true, quiescenceConfirmed: true });
  op = advance(op, 'migrating', { backupRef: 'bk-1', registryHead: { backupRef: 'bk-1' }, migrationLedger: [{ id: 'm1', checksum: 'x' }] });
  op = advance(op, 'promoting', { migrationComplete: true, schemaCompatible: true, aliasSet: ['live'] });
  op = advance(op, 'verifying');
  return advance(op, 'complete', { smokePassed: true, gateReopened: true });
};

test('deploy protocol walks the full phase sequence with evidence', () => {
  const done = fullRun();
  assert.equal(done.phase, 'complete');
  assert.ok(done.evidence.quiescent.quiescenceConfirmed);
});

test('each phase fails closed without its evidence', () => {
  let op = createDeployment({ manifest, manifestDigest, approval, current });
  op = advance(op, 'quiescing');
  assert.throws(() => advance(op, 'quiescent', { admissionBlocked: true }), /DEPLOY_EVIDENCE_MISSING/);
  op = advance(op, 'quiescent', { admissionBlocked: true, dispatchDisabled: true, quiescenceConfirmed: true });
  assert.throws(() => advance(op, 'migrating', { backupRef: 'bk-1' }), /DEPLOY_EVIDENCE_MISSING/);
  // Backup must be linked to the registry head.
  assert.throws(() => advance(op, 'migrating', { backupRef: 'bk-1', registryHead: { backupRef: 'bk-2' }, migrationLedger: [] }), /DEPLOY_BACKUP_UNLINKED/);
});

test('code rollback restores retained artifacts with schema acceptance', () => {
  let op = createDeployment({ manifest, manifestDigest, approval, current });
  op = advance(op, 'quiescing');
  const rolled = rollback(op, 'code', { retainedImage: 'sha256:x', retainedFrontend: 'manifest-y', schemaAccepted: true, aliasesRestored: true, smokePassed: true });
  assert.equal(rolled.rolledBack, 'code');
  assert.throws(() => rollback(op, 'code', { retainedImage: 'sha256:x' }), /DEPLOY_EVIDENCE_MISSING/);
  assert.throws(() => rollback(fullRun(), 'code', {}), /ROLLBACK_AFTER_COMPLETE/);
});

test('infrastructure rollback needs a reviewed corrective plan, never old state', () => {
  let op = createDeployment({ manifest, manifestDigest, approval, current });
  const rolled = rollback(op, 'infrastructure', { correctivePlanDigest: 'p'.repeat(64), planReviewed: true, stateReconciled: true });
  assert.equal(rolled.rolledBack, 'infrastructure');
  assert.throws(() => rollback(op, 'bogus', {}), /ROLLBACK_KIND_INVALID/);
});

test('data rollback is fail-closed: registry, keys, epoch, fences, review', () => {
  let op = createDeployment({ manifest, manifestDigest, approval, current });
  const evidence = { backupRef: 'bk-1', registryHead: { backupRef: 'bk-1' }, keyVersions: ['k1'], restoreApproval: 'ap-1', isolatedTarget: 'db-2', cutoverReviewed: true, epochAdvanced: true, fencesPreserved: true };
  const rolled = rollback(op, 'data', evidence);
  assert.equal(rolled.rolledBack, 'data');
  for (const drop of ['restoreApproval', 'epochAdvanced', 'fencesPreserved', 'keyVersions']) {
    const partial = { ...evidence }; delete partial[drop];
    assert.throws(() => rollback(createDeployment({ manifest, manifestDigest, approval, current }), 'data', partial), /DEPLOY_EVIDENCE_MISSING/);
  }
});

test('failure never reopens the gate automatically', () => {
  let op = createDeployment({ manifest, manifestDigest, approval, current });
  op = advance(op, 'quiescing');
  const failed = failClosed(op, 'SMOKE_FAILED');
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.gateOpen, false);
  assert.equal(failed.failureReason, 'SMOKE_FAILED');
});
