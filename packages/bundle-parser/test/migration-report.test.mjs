import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationFinding, migrationCoverage, serializeImportReport, diffExtraction, parseExtractionManifest, MIGRATION_LIMITS, MIGRATION_VERSION, MIGRATION_PRODUCER } from '../dist/index.js';
const hash = c => c.repeat(64);
const asset = (key = hash('a'), digest = hash('b')) => ({ key, digest, resourceType: 'analysis', state: 'extracted', bytes: 12, constructs: { analysis: 1 } });
const manifest = (assets = [asset()]) => ({ schemaVersion: MIGRATION_VERSION, producer: MIGRATION_PRODUCER, artifact: 'extraction-manifest', generatedAt: '2026-11-25T00:00:00.000Z', assets, knownLimits: MIGRATION_LIMITS, diff: diffExtraction(assets) });
test('fingerprints ignore asset identities and positions; coverage separates all three outcomes', () => {
  const a = migrationFinding('anomaly', 'visual', 'failed-closed', { sheet: 0, visual: 1, item: 0 });
  assert.equal(a.kind, migrationFinding('anomaly', 'visual', 'failed-closed', { sheet: 5, visual: 8, item: 0 }).kind);
  assert.notEqual(a.kind, migrationFinding('anomaly', 'field-well', 'failed-closed', { item: 0 }).kind);
  assert.deepEqual(migrationCoverage([a, migrationFinding('layouts', 'asset', 'converted-differently', { item: 0 }), migrationFinding('pieChartVisual', 'visual', 'clean', { item: 0 })]), {
    total: 3, clean: { count: 1, share: 1 / 3 }, convertedDifferently: { count: 1, share: 1 / 3 }, failedClosed: { count: 1, share: 1 / 3 },
  });
  assert.equal(migrationCoverage([]).clean.share, 0);
});
test('shared serializer excludes local messages, source names, paths and property values', () => {
  const result = { asset: 0, resourceType: 'analysis', path: 'private-path', name: 'private-title', messages: ['private-value'], findings: [migrationFinding('private-key', 'visual', 'failed-closed', { item: 0 })] };
  const report = serializeImportReport([result], { manifest: manifest() });
  assert.doesNotMatch(JSON.stringify(report), /private/);
  assert.deepEqual(report.assets[0].coverage.failedClosed, { count: 1, share: 1 });
  const next = serializeImportReport([result, { ...result, asset: 1, findings: [migrationFinding('anomaly', 'visual', 'failed-closed', { item: 0 })] }], { previous: report });
  assert.equal(next.groups.find(g => g.kind === 'visual:anomaly').newKind, true);
  assert.equal(next.groups.find(g => g.kind.startsWith('visual:unknown-')).newKind, false);
});
test('reruns detect additions, removals, content changes, failures and recovery', () => {
  const before = manifest([asset(), asset(hash('c'))]);
  const current = [asset(hash('a'), hash('d')), asset(hash('e'))];
  assert.deepEqual(diffExtraction(current, before), { baseline: true, added: [hash('e')], changed: [hash('a')], unchanged: [], removed: [hash('c')] });
  assert.deepEqual(diffExtraction([asset()], manifest()).unchanged, [hash('a')]);
  assert.deepEqual(diffExtraction([{ key: hash('a'), resourceType: 'analysis', state: 'failed-closed', code: 'DESCRIBE_FAILED', bytes: 0, constructs: {} }], manifest()).changed, [hash('a')]);
});
test('previous manifest or import snapshot is validated, never copied as arbitrary JSON', () => {
  const value = manifest();
  assert.deepEqual(parseExtractionManifest(value), value);
  assert.deepEqual(parseExtractionManifest(serializeImportReport([], { manifest: value })), value);
  for (const bad of [ { ...value, schemaVersion: 2 }, { ...value, producer: 'future' }, { ...value, credentials: 'no' }, { ...value, assets: [...value.assets, ...value.assets] }, { ...value, assets: [{ ...asset(), name: 'private' }] }, { ...value, assets: [{ ...asset(), constructs: { 'private-key': 1 } }] }, { ...value, assets: [{ ...asset(), digest: 'private' }] }, { ...value, diff: { ...value.diff, removed: [hash('a')] } } ]) assert.throws(() => parseExtractionManifest(bad), /MIGRATION_MANIFEST_INVALID/);
});
