/**
 * Bundle parsing: load a QuickSight analysis-bundle JSON file and summarize it.
 *
 * Phase 0 spike. Validates the top-level shape, resolves visuals (each visual
 * object carries a single type key like "BarChartVisual"), and extracts the
 * asset inventory a renderer or conformance test needs: sheets, visuals,
 * calculated fields, parameters, filter groups.
 */
import { readFileSync } from 'node:fs';
import {
  AnalysisBundle,
  AnalysisDefinition,
  ResolvedVisual,
} from './types.js';

export interface BundleSummary {
  analysisId: string;
  name: string;
  dataSets: { identifier: string; arn: string }[];
  sheets: { sheetId: string; name?: string; visualCount: number }[];
  visuals: ResolvedVisual[];
  calculatedFields: { dataSet: string; name: string; expression: string }[];
  parameters: string[];
  filterGroups: string[];
}

function assertBundleShape(raw: unknown): asserts raw is AnalysisBundle {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Bundle is not a JSON object');
  }
  const b = raw as Record<string, unknown>;
  if (b['ResourceType'] !== 'Analysis') {
    throw new Error(`Unsupported ResourceType: ${String(b['ResourceType'])}`);
  }
  if (typeof b['AnalysisId'] !== 'string' || typeof b['Name'] !== 'string') {
    throw new Error('Bundle missing AnalysisId or Name');
  }
  const def = b['Definition'] as AnalysisDefinition | undefined;
  if (!def || !Array.isArray(def.DataSetIdentifierDeclarations) || !Array.isArray(def.Sheets)) {
    throw new Error('Bundle Definition missing DataSetIdentifierDeclarations or Sheets');
  }
}

function resolveVisuals(def: AnalysisDefinition): ResolvedVisual[] {
  const out: ResolvedVisual[] = [];
  for (const sheet of def.Sheets) {
    for (const entry of sheet.Visuals ?? []) {
      const keys = Object.keys(entry);
      if (keys.length !== 1) {
        throw new Error(
          `Visual on sheet ${sheet.SheetId} has ${keys.length} type keys; expected exactly 1`
        );
      }
      const kind = keys[0];
      const body = entry[kind];
      out.push({
        kind,
        visualId: body.VisualId,
        title: body.Title?.FormatText?.PlainText,
        sheetId: sheet.SheetId,
        sheetName: sheet.Name,
      });
    }
  }
  return out;
}

export function loadBundle(path: string): AnalysisBundle {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assertBundleShape(raw);
  return raw;
}

export function summarizeBundle(bundle: AnalysisBundle): BundleSummary {
  const def = bundle.Definition;
  const visuals = resolveVisuals(def);
  return {
    analysisId: bundle.AnalysisId,
    name: bundle.Name,
    dataSets: def.DataSetIdentifierDeclarations.map((d) => ({
      identifier: d.Identifier,
      arn: d.DataSetArn,
    })),
    sheets: def.Sheets.map((s) => ({
      sheetId: s.SheetId,
      name: s.Name,
      visualCount: s.Visuals?.length ?? 0,
    })),
    visuals,
    calculatedFields: (def.CalculatedFields ?? []).map((c) => ({
      dataSet: c.DataSetIdentifier,
      name: c.Name,
      expression: c.Expression,
    })),
    parameters: (def.ParameterDeclarations ?? []).map((p) => {
      const key = Object.keys(p)[0];
      return (p as Record<string, { Name: string }>)[key].Name;
    }),
    filterGroups: (def.FilterGroups ?? []).map((f) => f.FilterGroupId),
  };
}
