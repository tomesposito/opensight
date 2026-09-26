/** Inventory of provisional, reconstructed JSON; no .qs ZIP or API-response loader. */
import { readFileSync } from 'node:fs';
import type { AnalysisDefinition, ParameterDeclaration, ResolvedVisual, SyntheticAnalysisDocument } from './types.js';
import { assertSyntheticAnalysis, singleVariant } from './validate.js';

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

function resolveVisuals(def: AnalysisDefinition): ResolvedVisual[] {
  return (def.Sheets ?? []).flatMap((sheet, sheetIndex) =>
    (sheet.Visuals ?? []).map((entry, index) => {
      const [kind] = singleVariant(entry, `$.Definition.Sheets[${sheetIndex}].Visuals[${index}]`);
      const body = entry[kind];
      // The validator guarantees this, and the guard also protects indexed access.
      if (!body) throw new Error('Validated visual body is missing');
      const format = body.Title?.FormatText;
      const title = format?.PlainText ?? format?.RichText;
      const titleFormat = format?.PlainText !== undefined ? 'plain' as const
        : format?.RichText !== undefined ? 'rich' as const : undefined;
      return { kind, visualId: body.VisualId, title, titleFormat,
        sheetId: sheet.SheetId, sheetName: sheet.Name };
    })
  );
}

function parameterName(p: ParameterDeclaration): string {
  if (p.StringParameterDeclaration !== undefined) return p.StringParameterDeclaration.Name;
  if (p.IntegerParameterDeclaration !== undefined) return p.IntegerParameterDeclaration.Name;
  if (p.DecimalParameterDeclaration !== undefined) return p.DecimalParameterDeclaration.Name;
  return p.DateTimeParameterDeclaration.Name;
}

/** Validate in place: unknown properties and omitted optional fields are retained. */
export function parseSyntheticAnalysis(raw: unknown): SyntheticAnalysisDocument {
  assertSyntheticAnalysis(raw);
  return raw;
}

/** Loads one synthetic UTF-8 JSON document, NOT a QuickSight export. */
export function loadSyntheticAnalysis(path: string): SyntheticAnalysisDocument {
  return parseSyntheticAnalysis(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** Historical Phase 0 name; only the synthetic document format is supported. */
export const loadBundle = loadSyntheticAnalysis;

export function summarizeBundle(bundle: SyntheticAnalysisDocument): BundleSummary {
  // Validate callers from JavaScript as well as documents loaded from disk.
  assertSyntheticAnalysis(bundle);
  const def = bundle.Definition;
  return {
    analysisId: bundle.AnalysisId,
    name: bundle.Name,
    dataSets: def.DataSetIdentifierDeclarations.map((d) => ({ identifier: d.Identifier, arn: d.DataSetArn })),
    sheets: (def.Sheets ?? []).map((s) => ({ sheetId: s.SheetId, name: s.Name, visualCount: s.Visuals?.length ?? 0 })),
    visuals: resolveVisuals(def),
    calculatedFields: (def.CalculatedFields ?? []).map((c) => ({
      dataSet: c.DataSetIdentifier, name: c.Name, expression: c.Expression,
    })),
    parameters: (def.ParameterDeclarations ?? []).map(parameterName),
    filterGroups: (def.FilterGroups ?? []).map((f) => f.FilterGroupId),
  };
}
