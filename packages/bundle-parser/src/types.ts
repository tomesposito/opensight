/**
 * QuickSight analysis-bundle type definitions.
 *
 * Mirrors the shapes returned by QuickSight's DescribeAnalysisDefinition /
 * asset-bundle export format (see SOLUTION_DESIGN.md D5: the bundle format is
 * the canonical model). This is a deliberately small subset covering the
 * Phase 0 spike; it grows as real exports are studied.
 */

/** Top-level bundle file for an Analysis asset. */
export interface AnalysisBundle {
  ResourceType: 'Analysis';
  AnalysisId: string;
  Name: string;
  Definition: AnalysisDefinition;
}

export interface AnalysisDefinition {
  DataSetIdentifierDeclarations: DataSetIdentifierDeclaration[];
  Sheets: Sheet[];
  CalculatedFields?: CalculatedField[];
  ParameterDeclarations?: ParameterDeclaration[];
  FilterGroups?: FilterGroup[];
}

export interface DataSetIdentifierDeclaration {
  Identifier: string;
  DataSetArn: string;
}

export interface Sheet {
  SheetId: string;
  Name?: string;
  /** Each entry is an object with a single key like "BarChartVisual". */
  Visuals?: Record<string, VisualBody>[];
}

export interface VisualBody {
  VisualId: string;
  Title?: { Visibility?: string; FormatText?: { PlainText?: string } };
  Subtitle?: { Visibility?: string; FormatText?: { PlainText?: string } };
  // Visual-type-specific configuration lives here; intentionally untyped
  // until real exports pin down the shapes.
  [key: string]: unknown;
}

/** A visual with its QuickSight visual-type key resolved, e.g. "BarChartVisual". */
export interface ResolvedVisual {
  kind: string;
  visualId: string;
  title?: string;
  sheetId: string;
  sheetName?: string;
}

export interface CalculatedField {
  DataSetIdentifier: string;
  Name: string;
  Expression: string;
}

export type ParameterDeclaration =
  | { StringParameterDeclaration: { Name: string; ParameterValueType?: string } }
  | { IntegerParameterDeclaration: { Name: string; ParameterValueType?: string } }
  | { DecimalParameterDeclaration: { Name: string; ParameterValueType?: string } }
  | { DateTimeParameterDeclaration: { Name: string; ParameterValueType?: string } };

export interface FilterGroup {
  FilterGroupId: string;
  Filters?: Record<string, unknown>[];
  ScopeConfiguration?: Record<string, unknown>;
}
