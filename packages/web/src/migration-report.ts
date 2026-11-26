import { migrationFinding, migrationCoverage, type ImportResult, type MigrationOutcome, type BundleResource, type BundleVisual } from '@opensight/bundle-parser/browser';
import { authorVisualProblem, type AuthorDraft, type AuthorVisual } from './authoring.js';
import { normalizeVisual } from './compiler.js';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

/** Coverage counts explicit import units, not JSON leaves or rendered data.
 * An unsupported parent blocks its children; opaque properties are never clean.
 * Diagnostic strings remain local; portable findings use fixed vocabulary only. */
export function completeImportResult(result: ImportResult, resource: BundleResource, draft: AuthorDraft): void {
  const findings = result.findings;
  const asset = (construct: string, outcome: MigrationOutcome, item = 0, code?: 'REMAP_REQUIRED') =>
    findings.push(migrationFinding(construct, 'asset', outcome, { item }, code));
  if (resource.resourceType !== 'analysis' && resource.resourceType !== 'dashboard') {
    asset('connection', 'failed-closed', 0, 'REMAP_REQUIRED');
    for (const key of Object.keys(resource)) if (!['resourceType', 'dataSetId', 'dataSourceId', 'name'].includes(key)) asset(key, 'failed-closed');
  } else {
    const definition = resource.definition;
    for (const key of Object.keys(resource)) if (!['resourceType', 'analysisId', 'dashboardId', 'name', 'definition'].includes(key)) asset(key, 'failed-closed');
    for (const [key, value] of Object.entries(definition)) {
      if (key === 'sheets') continue;
      const values = Array.isArray(value) ? value : [value];
      values.forEach((_, i) => {
        // Only a mapped parameter/calculation is counted clean. Unknown
        // definition options and foreign bindings remain explicitly blocked.
        const clean = key === 'parameterDeclarations' && draft.parameters.some(p => p.memberPath === result.path && p.name === obj(Object.values(obj(values[i]))[0]).name)
          || key === 'calculatedFields' && draft.calculatedFields.some(f => f.name === obj(values[i]).name && f.expression === obj(values[i]).expression);
        asset(key, clean ? 'clean' : 'failed-closed', i, key === 'dataSetIdentifierDeclarations' ? 'REMAP_REQUIRED' : undefined);
      });
    }
    for (const [si, sheet] of (definition.sheets ?? []).entries()) {
      const importedSheet = draft.sheets.find(s => s.imported?.memberPath === result.path && s.imported.sheetId === sheet.sheetId);
      for (const key of Object.keys(sheet)) if (!['sheetId', 'name', 'visuals'].includes(key)) {
        const items = Array.isArray(sheet[key]) ? sheet[key] as unknown[] : [sheet[key]];
        items.forEach((_, item) => findings.push(migrationFinding(key, 'asset', key === 'layouts' ? 'converted-differently' : 'failed-closed', { sheet: si, item })));
      }
      for (const [vi, raw] of (sheet.visuals ?? []).entries()) {
        const [variant, body] = Object.entries(raw)[0]!;
        const visual = importedSheet?.visuals.find(v => v.imported?.visualId === body?.visualId);
        const outcome = visualOutcome(raw, visual);
        const position = { sheet: si, visual: vi, item: 0 };
        findings.push(migrationFinding(variant, 'visual', outcome, position));
        // Computation wrappers have their own fingerprints: one unsupported
        // anomaly in many dashboards is a single kind, never generic failure.
        list(obj(body?.insightConfiguration).computations).forEach((computation, item) => {
          for (const key of Object.keys(obj(computation))) findings.push(migrationFinding(key, 'visual', outcome, { ...position, item }));
        });
        if (obj(body?.insightConfiguration).customNarrative !== undefined)
          findings.push(migrationFinding('customNarrative', 'visual', outcome, position));
        let field = 0;
        const walkFields = (value: unknown): void => {
          if (Array.isArray(value)) { value.forEach(walkFields); return; }
          for (const [key, child] of Object.entries(obj(value))) {
            if (/^(?:categorical|numerical|date|calculated)(?:Dimension|Measure)Field$/.test(key)) {
              findings.push(migrationFinding(key, 'field-well', outcome, { ...position, item: field++ }));
            } else walkFields(child);
          }
        };
        walkFields(obj(body?.chartConfiguration).fieldWells);
        walkFields(obj(body?.insightConfiguration).computations);
      }
    }
  }
  result.coverage = migrationCoverage(findings);
}

function visualOutcome(raw: BundleVisual, visual: AuthorVisual | undefined): MigrationOutcome {
  if (!visual?.imported) return 'failed-closed';
  try { normalizeVisual('bundle', raw); } catch { return 'failed-closed'; }
  // A source remap is reported separately. It must not make a supported visual
  // look unsupported, nor make any unsupported construct execute.
  if (authorVisualProblem({ ...visual, imported: { ...visual.imported, local: true } })) return 'failed-closed';
  // Retained unsupported JSON is a failure, even when the supported remainder
  // can run. Deliberate differences (such as grid projection) are counted at
  // their own construct, never inferred from an unsupported diagnostic.
  return visual.imported.issues.length ? 'failed-closed' : 'clean';
}
