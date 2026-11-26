import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQsBundle, serializeImportReport, projectDefinition, convertDefinition } from '@opensight/bundle-parser';
import { importBundle, importBundleFile, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
const fixture = new URL('../../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs', import.meta.url);
test('the existing file-import path accepts extractor JSON and preserves all members', async () => {
  const source = await loadQsBundle(fixture), bytes = new TextEncoder().encode(JSON.stringify(source));
  const draft = await importBundleFile({ name: 'bundle.json', size: bytes.length, arrayBuffer: async () => bytes.buffer });
  assert.deepEqual(draft.bundle.original, source);
  assert.equal(draft.bundle.report.length, 4);
  assert.deepEqual(exportBundle(draft), source);
});
test('observed sanitized QuickSight export retains originals and reports structural per-asset coverage', async () => {
  const source = await loadQsBundle(fixture), draft = importBundle(source);
  const report = serializeImportReport(draft.bundle.report);
  assert.equal(report.schemaVersion, 1); assert.equal(report.assets.length, source.members.length);
  assert.deepEqual(exportBundle(draft), source);
  for (const a of report.assets) {
    assert.ok(a.coverage.total > 0);
    assert.equal(a.coverage.clean.count + a.coverage.convertedDifferently.count + a.coverage.failedClosed.count, a.coverage.total);
    assert.ok(Math.abs(a.coverage.clean.share + a.coverage.convertedDifferently.share + a.coverage.failedClosed.share - 1) < 1e-10);
    assert.ok(a.findings.every(f => f.kind === `${f.location}:${f.construct}`));
  }
  assert.doesNotMatch(JSON.stringify(report), /arn:|TotalDeath|DataSetArn|columnName/);
  assert.ok(report.assets.some(a => a.coverage.convertedDifferently.count > 0));
  assert.ok(report.assets.some(a => a.findings.some(f => f.code === 'REMAP_REQUIRED')));
});
test('Describe-shaped anomaly and unsupported narrative stay blocked with stable fingerprints', () => {
  const definition = { DataSetIdentifierDeclarations: [{ Identifier: 'foreign', DataSetArn: 'arn:example:dataset/synthetic' }], Sheets: [{ SheetId: 's', Visuals: [{ InsightVisual: { VisualId: 'v', DataSetIdentifier: 'foreign', InsightConfiguration: { Computations: [{ Anomaly: { ComputationId: 'a' } }], CustomNarrative: { Narrative: 'private-narrative' } } } }] }] };
  const resource = { resourceType: 'analysis', analysisId: 'synthetic', name: 'private-title', definition: convertDefinition(definition) };
  const source = { members: [{ path: 'analysis/synthetic.json', resource }] };
  const draft = importBundle(source), report = serializeImportReport(draft.bundle.report);
  const anomaly = report.assets[0].findings.find(f => f.kind === 'visual:anomaly');
  assert.equal(anomaly.outcome, 'failed-closed');
  assert.equal(report.assets[0].findings.find(f => f.kind === 'visual:customNarrative').outcome, 'failed-closed');
  assert.equal(buildAuthorQuery(draft.sheets[0].visuals[0]), null);
  assert.deepEqual(exportBundle(draft), source);
  assert.doesNotMatch(JSON.stringify(report), /private|foreign|arn:/);
  assert.deepEqual(convertDefinition(projectDefinition(resource.definition)), resource.definition);
});
test('new unsupported configuration constructs receive new kinds without copying keys or values', () => {
  const make = extra => ({ members: [{ path: 'analysis/a.json', resource: { resourceType: 'analysis', analysisId: 'a', name: 'Synthetic', definition: { dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', visuals: [{ barChartVisual: { visualId: 'v', chartConfiguration: { ...extra } } }] }] } } }] });
  const before = serializeImportReport(importBundle(make({})).bundle.report);
  const after = serializeImportReport(importBundle(make({ 'private-option-key': { payload: 'private-value' } })).bundle.report, { previous: before });
  const fresh = after.groups.filter(g => g.newKind);
  assert.equal(fresh.length, 1); assert.match(fresh[0].kind, /^visual:unknown-/);
  assert.equal(after.assets[0].findings.find(f => f.kind === fresh[0].kind).outcome, 'failed-closed');
  assert.doesNotMatch(JSON.stringify(after), /private-option-key|private-value|payload/);
});
