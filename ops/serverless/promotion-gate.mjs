import { approveRelease } from './release-safety.mjs';

/**
 * Plan envelope: the digest-bound record of a reviewed infrastructure plan.
 * Stored encrypted in restricted operational storage, never in git.
 */
export function validatePlanEnvelope(envelope, now = Date.now()) {
  const e = envelope ?? {};
  if (e.version !== 1) throw Error('PLAN_ENVELOPE_INVALID');
  for (const field of ['digest', 'publicCommit', 'privateCommit', 'backend', 'stateLineage', 'stateSerial', 'releaseDigest', 'configurationRevision']) {
    if (typeof e[field] !== 'string' || !e[field]) throw Error('PLAN_ENVELOPE_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(e.digest)) throw Error('PLAN_ENVELOPE_INVALID');
  if (!/^[a-f0-9]{40}$/.test(e.publicCommit) || !/^[a-f0-9]{40}$/.test(e.privateCommit)) throw Error('PLAN_ENVELOPE_INVALID');
  if (!/^[a-f0-9]{64}$/.test(e.releaseDigest)) throw Error('PLAN_ENVELOPE_INVALID');
  if (!Number.isSafeInteger(e.createdAt) || !Number.isSafeInteger(e.expiresAt)) throw Error('PLAN_ENVELOPE_INVALID');
  // Proposed validity is 24 hours (D-36).
  if (e.expiresAt <= e.createdAt || e.expiresAt > e.createdAt + 86400000) throw Error('PLAN_ENVELOPE_INVALID');
  if (e.expiresAt <= now) throw Error('PLAN_ENVELOPE_EXPIRED');
  if (e.moduleLocks !== undefined && typeof e.moduleLocks !== 'object') throw Error('PLAN_ENVELOPE_INVALID');
  if (e.toolLocks !== undefined && typeof e.toolLocks !== 'object') throw Error('PLAN_ENVELOPE_INVALID');
  return e;
}

/**
 * Immutable promotion: a release moves forward only through a recorded
 * approval binding the exact manifest digest, with compatibility against the
 * live deployment and a fresh (non-expired) approval.
 */
export function validatePromotion({ manifest, manifestDigest, approval, current, operation }, now = Date.now()) {
  if (!manifest || !approval || !current || !operation) throw Error('PROMOTION_RECORD_INVALID');
  if (!/^[a-f0-9]{64}$/.test(manifestDigest ?? '')) throw Error('PROMOTION_RECORD_INVALID');
  // The release-safety approval check: manifest/approval/source/configuration
  // binding, expiry, and compatibility with the current deployment.
  approveRelease(approval, manifest, operation.targetDigest, operation.configurationDigest, current, now);
  if (operation.targetDigest !== manifestDigest) throw Error('PROMOTION_DIGEST_MISMATCH');
  if (operation.phase !== 'prepared' && operation.phase !== 'approved') throw Error('PROMOTION_PHASE_INVALID');
  return { manifest: operation.targetDigest, approved: true };
}

/**
 * Deployment serialization record: conditional-write semantics for the
 * operation record (If-None-Match on create, If-Match on update).
 * Pure logic; the S3 conditional writes happen in the controller.
 */
export function operationTransition(record, expectedEtag, phase) {
  if (!record || typeof record.operationId !== 'string' || !record.operationId) throw Error('OPERATION_RECORD_INVALID');
  if (record.etag !== expectedEtag) throw Error('OPERATION_CONFLICT');
  const phases = ['prepared', 'approved', 'quiescing', 'quiescent', 'migrating', 'promoting', 'verifying', 'complete', 'failed'];
  if (!phases.includes(phase) || phases.indexOf(phase) < phases.indexOf(record.phase)) throw Error('OPERATION_PHASE_INVALID');
  return { ...record, phase, at: Date.now() };
}
