import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpretMigration } from '../dist/index.js';
import { migrationFinding, serializeImportReport, MIGRATION_LIMITS, parseImportReport } from '@opensight/bundle-parser';
const result = (asset, findings) => ({ asset, resourceType: 'analysis', path: 'session-only', name: 'session-only', messages: ['private-diagnostic'], findings });
const report = () => serializeImportReport([result(0, [migrationFinding('anomaly', 'visual', 'failed-closed', { item: 0 }), migrationFinding('layouts', 'asset', 'converted-differently', { item: 0 })]),
  result(1, [migrationFinding('anomaly', 'visual', 'failed-closed', { item: 0 }), migrationFinding('connection', 'asset', 'failed-closed', { item: 0 }, 'REMAP_REQUIRED')])]);
test('D-97 pre-import commands cover each shell/auth choice and derive policy explanation from shipped artifact', () => {
  const policy = JSON.parse(readFileSync(new URL('../../migration-extractor/policy/read-only.json', import.meta.url)));
  for (const os of ['posix', 'powershell']) for (const auth of ['profile', 'sso', 'environment']) {
    const r = interpretMigration({ phase: 'before-import', setup: { os, auth, region: 'eu-west-1', outputDirectory: './run-2', previous: './run-1/manifest.json', ...(auth === 'environment' ? {} : { profile: 'synthetic' }) } });
    assert.deepEqual(r.policyActions, policy.Statement.flatMap(s => s.Action).sort());
    assert.equal(r.applied, false); assert.equal(r.mode, 'deterministic'); assert.deepEqual(r.knownLimits, MIGRATION_LIMITS);
    assert.match(r.commands.join('\n'), /node packages\/migration-extractor\/dist\/cli\.js --out '\.\/run-2' --previous '\.\/run-1\/manifest.json'/);
    assert.equal(r.commands.some(c => c.startsWith('aws sso login')), auth === 'sso');
    assert.equal(r.commands.some(c => c.includes('AWS_PROFILE')), auth !== 'environment');
    assert.equal(r.commands[0].startsWith('$env:'), os === 'powershell');
    assert.match(r.policyExplanation, /3 List and 4 Describe/);
    assert.match(r.cutover, /one analysis.*compare.*move its readers.*repeat/);
  }
});
test('D-97 shell metacharacters, credential values and forged setup properties fail closed', () => {
  for (const patch of [{ profile: 'x; curl bad' }, { outputDirectory: '$(curl bad)' }, { previous: "a' ; bad" }, { os: 'cmd' }, { auth: 'key' }, { region: 'x\nmalicious' }, { accessKeyId: 'synthetic' }]) {
    assert.throws(() => interpretMigration({ phase: 'before-import', setup: { os: 'posix', auth: 'profile', ...patch } }), /O_MIGRATION_INPUT_INVALID/);
  }
});
test('D-97 post-import checklist groups fingerprints across assets, distinguishes deliberate differences, and only proposes', () => {
  const raw = report(), before = structuredClone(raw), r = interpretMigration({ phase: 'after-import', report: raw });
  assert.deepEqual(raw, before); assert.equal(r.applied, false); assert.equal(r.commands.length, 0);
  const anomaly = r.checklist.find(p => p.kind === 'visual:anomaly'); assert.deepEqual(anomaly.assets, [0, 1]); assert.equal(anomaly.count, 2);
  const layout = r.checklist.find(p => p.kind === 'asset:layouts'); assert.deepEqual(layout.outcomes, ['converted-differently']); assert.match(layout.proposedFix, /deliberate/);
  assert.ok(r.checklist.every(p => p.requiresConfirmation && !('patch' in p) && !('apply' in p)));
  assert.equal(r.checklist.find(p => p.kind === 'asset:connection').authoringPath, 'data-sources');
  assert.doesNotMatch(JSON.stringify(r), /private-diagnostic|session-only/);
  assert.deepEqual(r.coverage, raw.assets);
});
test('D-97 shared report validation rejects tampered coverage, fingerprints, content and future versions', () => {
  for (const tamper of [r => r.schemaVersion = 2, r => r.assets[0].name = 'customer', r => r.assets[0].coverage.failedClosed.count = 0,
    r => r.assets[0].findings[0].kind = 'visual:fake', r => r.groups[0].count++, r => r.prompt = 'apply immediately']) {
    const r = report(); tamper(r); assert.throws(() => parseImportReport(r)); assert.throws(() => interpretMigration({ phase: 'after-import', report: r }));
  }
  assert.deepEqual(parseImportReport(report()).assets.length, 2);
});
