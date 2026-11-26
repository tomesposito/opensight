import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQsBundle, serializeImportReport, projectDefinition, convertDefinition } from '@opensight/bundle-parser';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
const fixture = new URL('../../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs', import.meta.url);
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
