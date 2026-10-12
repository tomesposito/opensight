import { randomUUID } from 'node:crypto';
import { validatePromotion, operationTransition } from './promotion-gate.mjs';

/**
 * Local deploy-protocol state machine. Implements the D-25/D-36 deployment,
 * migration, and rollback protocol as pure logic with no AWS calls: the
 * caller supplies evidence for each phase, and every transition is
 * fail-closed. Tests and offline validation drive this directly; the private
 * release controller performs the same checks against live AWS.
 *
 * Phases: prepared -> quiescing -> quiescent -> migrating -> promoting ->
 *          verifying -> complete | failed
 * Rollback kinds: code (retained image/frontend), infrastructure (corrective
 * plan), data (registered backup + registry head + explicit approval).
 */

const PHASES = ['prepared', 'quiescing', 'quiescent', 'migrating', 'promoting', 'verifying', 'complete', 'failed'];

export function createDeployment({ manifest, manifestDigest, approval, current }) {
  const operation = {
    version: 1,
    operationId: randomUUID(),
    targetDigest: manifestDigest,
    configurationDigest: approval?.configuration,
    phase: 'prepared',
    etag: randomUUID(),
    at: Date.now(),
  };
  validatePromotion({ manifest, manifestDigest, approval, current, operation });
  return operation;
}

function requireEvidence(evidence, fields) {
  for (const field of fields) {
    if (evidence?.[field] === undefined || evidence[field] === null || evidence[field] === false) {
      throw Error('DEPLOY_EVIDENCE_MISSING');
    }
  }
}

export function advance(operation, phase, evidence = {}) {
  if (!PHASES.includes(phase)) throw Error('DEPLOY_PHASE_INVALID');
  const next = operationTransition(operation, operation.etag, phase);
  switch (phase) {
    case 'quiescing':
      break; // entry is the intent; quiescence is confirmed on exit
    case 'quiescent':
      // D-25: block admission, disable dispatch/mappings, wait for invocation
      // exit or hard deadline + 10s quarantine. Evidence: confirmed quiescence.
      requireEvidence(evidence, ['admissionBlocked', 'dispatchDisabled', 'quiescenceConfirmed']);
      break;
    case 'migrating':
      // Evidence: backup registered with registry linkage BEFORE any DDL.
      requireEvidence(evidence, ['backupRef', 'registryHead', 'migrationLedger']);
      if (evidence.backupRef !== evidence.registryHead.backupRef) throw Error('DEPLOY_BACKUP_UNLINKED');
      break;
    case 'promoting':
      // Evidence: migration ledger complete, schema compatibility verified.
      requireEvidence(evidence, ['migrationComplete', 'schemaCompatible', 'aliasSet']);
      break;
    case 'verifying':
      break;
    case 'complete':
      // Evidence: smoke checks passed, gate reopened on CAS.
      requireEvidence(evidence, ['smokePassed', 'gateReopened']);
      break;
    case 'failed':
      break;
    default:
      break;
  }
  return { ...next, evidence: { ...(operation.evidence ?? {}), [phase]: evidence } };
}

/**
 * Rollback. Never an automatic down-migration or old-writer startup.
 * - code: prior release accepts current schema; restore retained image/frontend/aliases.
 * - infrastructure: corrective plan against actual resources; never restore old state.
 * - data: forward repair preferred; explicit restore into an isolated target
 *   with registry/object/key verification and separately reviewed cutover.
 */
export function rollback(operation, kind, evidence = {}) {
  if (!['code', 'infrastructure', 'data'].includes(kind)) throw Error('ROLLBACK_KIND_INVALID');
  if (operation.phase === 'complete') throw Error('ROLLBACK_AFTER_COMPLETE');
  const base = { ...operation, rollbackKind: kind, at: Date.now() };
  if (kind === 'code') {
    requireEvidence(evidence, ['retainedImage', 'retainedFrontend', 'schemaAccepted', 'aliasesRestored', 'smokePassed']);
    return { ...base, phase: 'complete', rolledBack: 'code' };
  }
  if (kind === 'infrastructure') {
    // Corrective plan, reviewed; never "restore old state as if it undid AWS changes".
    requireEvidence(evidence, ['correctivePlanDigest', 'planReviewed', 'stateReconciled']);
    return { ...base, phase: 'complete', rolledBack: 'infrastructure' };
  }
  // data
  requireEvidence(evidence, ['backupRef', 'registryHead', 'keyVersions', 'restoreApproval', 'isolatedTarget', 'cutoverReviewed']);
  if (evidence.backupRef !== evidence.registryHead.backupRef) throw Error('DEPLOY_BACKUP_UNLINKED');
  // The registry head and deployment epoch stay outside the restored database.
  requireEvidence(evidence, ['epochAdvanced', 'fencesPreserved']);
  return { ...base, phase: 'complete', rolledBack: 'data' };
}

/** A failed or cancelled workflow never reopens the gate automatically. */
export function failClosed(operation, reason) {
  if (!reason) throw Error('DEPLOY_EVIDENCE_MISSING');
  return { ...operationTransition(operation, operation.etag, 'failed'), failureReason: reason, gateOpen: false };
}
