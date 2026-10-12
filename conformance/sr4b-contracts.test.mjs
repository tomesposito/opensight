import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanEnvelope, validatePromotion, operationTransition } from '../ops/serverless/promotion-gate.mjs';
import { checkSource } from '../ops/serverless/ci-check.mjs';

const now = Date.now();
const envelope = (patch = {}) => ({
  version: 1,
  digest: 'a'.repeat(64),
  publicCommit: 'b'.repeat(40),
  privateCommit: 'c'.repeat(40),
  backend: 's3://example-state/pilot.tfstate',
  stateLineage: 'd'.repeat(32),
  stateSerial: '42',
  releaseDigest: 'e'.repeat(64),
  configurationRevision: 'f'.repeat(40),
  createdAt: now - 3600000,
  expiresAt: now + 82800000,
  ...patch,
});

test('plan envelopes require complete bindings and a 24h validity window', () => {
  const valid = envelope();
  assert.equal(validatePlanEnvelope(valid), valid);
  for (const patch of [
    { version: 2 }, { digest: 'zz' }, { publicCommit: 'master' }, { releaseDigest: 'latest' },
    { expiresAt: now - 1 }, { expiresAt: now + 86400001 }, { createdAt: now, expiresAt: now },
  ]) assert.throws(() => validatePlanEnvelope(envelope(patch)), /PLAN_ENVELOPE_(INVALID|EXPIRED)/);
});

test('promotion requires an approval binding the exact manifest digest', () => {
  const manifest = { version: 1, source: 'a'.repeat(40), compatibility: 'b'.repeat(64) };
  const manifestDigest = 'c'.repeat(64);
  const current = { id: 'current-id', compatibility: 'b'.repeat(64) };
  const approval = { version: 1, manifest: manifestDigest, source: 'a'.repeat(40), configuration: 'd'.repeat(64), current: 'current-id', expiresAt: now + 3600000 };
  const operation = { targetDigest: manifestDigest, configurationDigest: 'd'.repeat(64), phase: 'prepared' };
  assert.deepEqual(validatePromotion({ manifest, manifestDigest, approval, current, operation }), { manifest: manifestDigest, approved: true });
  // Wrong digest, wrong phase, expired approval, incompatible manifest all fail.
  assert.throws(() => validatePromotion({ manifest, manifestDigest: 'f'.repeat(64), approval, current, operation }), /PROMOTION_DIGEST_MISMATCH/);
  assert.throws(() => validatePromotion({ manifest, manifestDigest, approval, current, operation: { ...operation, phase: 'complete' } }), /PROMOTION_PHASE_INVALID/);
  assert.throws(() => validatePromotion({ manifest: { ...manifest, compatibility: 'z'.repeat(64) }, manifestDigest, approval, current, operation }), /RELEASE_APPROVAL_REQUIRED/);
  assert.throws(() => validatePromotion({ manifest, manifestDigest, approval: { ...approval, expiresAt: now - 1 }, current, operation }), /RELEASE_APPROVAL_REQUIRED/);
});

test('operation records serialize on etag and move forward only', () => {
  const record = { operationId: 'op-1', phase: 'prepared', etag: 'etag-1' };
  const next = operationTransition(record, 'etag-1', 'quiescing');
  assert.equal(next.phase, 'quiescing');
  assert.throws(() => operationTransition(record, 'wrong-etag', 'quiescing'), /OPERATION_CONFLICT/);
  assert.throws(() => operationTransition(next, next.etag, 'prepared'), /OPERATION_PHASE_INVALID/);
  assert.throws(() => operationTransition(next, next.etag, 'bogus'), /OPERATION_PHASE_INVALID/);
});

test('ci-check rejects terraform workdirs, crash logs, and plan JSON', () => {
  checkSource([{ path: 'docs/example.md', text: 'synthetic only' }]);
  for (const path of ['ops/serverless/validation/.terraform/modules/modules.json', 'crash.log', 'x.tfplan.json', 'plan.tfplan']) {
    assert.throws(() => checkSource([{ path, text: '' }]), /PRIVATE_CONFIGURATION_IN_GIT|TERRAFORM_WORKDIR_IN_GIT|CRASH_LOG_IN_GIT/);
  }
  // Existing protections still hold.
  assert.throws(() => checkSource([{ path: '.env', text: '' }]), /PRIVATE_CONFIGURATION_IN_GIT/);
  assert.throws(() => checkSource([{ path: 'notes.md', text: 'AKIA' + '0'.repeat(16) }]), /CREDENTIAL_PATTERN_IN_GIT/);
});

test('license inventory gates releases on the D-27 policy', async () => {
  const { licenseInventory } = await import('../ops/serverless/license-inventory.mjs');
  const sbom = components => ({ components });
  const lib = (name, license) => ({ type: 'library', name, version: '1.0.0', licenses: [{ license: { name: license } }] });
  const os = (name, license) => ({ type: 'operating-system', name, version: '1', licenses: [{ license: { name: license } }] });
  const { digest } = licenseInventory(sbom([lib('a', 'MIT'), lib('b', 'Apache-2.0'), lib('tslib', '0BSD'), os('glibc', 'LGPLv2')]));
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.throws(() => licenseInventory(sbom([lib('evil', 'GPL-3.0')])), /LICENSE_POLICY_VIOLATION/);
  assert.throws(() => licenseInventory(sbom([lib('mystery', 'MIT'), { type: 'library', name: 'nol', version: '1' }])), /LICENSE_MISSING/);
  assert.throws(() => licenseInventory(sbom([os('bad', 'Commercial')])), /LICENSE_POLICY_VIOLATION/);
  assert.throws(() => licenseInventory({}), /LICENSE_SBOM_INVALID/);
});
