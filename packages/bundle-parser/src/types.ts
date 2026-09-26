/**
 * PROVISIONAL, reconstructed-from-docs inventory types.
 *
 * SyntheticAnalysisDocument is an OpenSight test envelope, NOT a .qs archive
 * member or a DescribeAnalysisDefinition response. API response envelopes and
 * archive member schemas are separate contracts; observed camelCase archive types
 * live in bundle-types.ts. See docs/research/bundle-format.md for the mapping.
 * Only the inventory subset below is validated. Opaque properties are preserved,
 * not certified as executable QuickSight configurations.
 */
export interface UnknownProperties {
  [key: string]: unknown;
}

export interface SyntheticAnalysisDocument extends UnknownProperties {
  ResourceType: 'Analysis';
  AnalysisId: string;
  Name: string;
  Definition: AnalysisDefinition;
}

/** @deprecated Phase 0 synthetic envelope only; use SyntheticAnalysisDocument. */
export type AnalysisBundle = SyntheticAnalysisDocument;

/** Inventory subset of the documented definition object, not an API response. */
export interface AnalysisDefinition extends UnknownProperties {
  DataSetIdentifierDeclarations: DataSetIdentifierDeclaration[];
  Sheets?: Sheet[];
  CalculatedFields?: CalculatedField[];
  ParameterDeclarations?: ParameterDeclaration[];
  FilterGroups?: FilterGroup[];
}

export interface DataSetIdentifierDeclaration extends UnknownProperties {
  Identifier: string;
  DataSetArn: string;
}

export interface Sheet extends UnknownProperties {
  SheetId: string;
  Name?: string;
  /** Exactly one visual-type key per entry; unknown visual kinds remain inventoryable. */
  Visuals?: Record<string, VisualBody>[];
}

export interface VisualTitle extends UnknownProperties {
  Visibility?: 'VISIBLE' | 'HIDDEN';
  FormatText?: { PlainText?: string; RichText?: string } & UnknownProperties;
}

export interface VisualBody extends UnknownProperties {
  VisualId: string;
  Title?: VisualTitle;
  Subtitle?: VisualTitle;
  // Field wells, layouts and visual-specific options remain opaque in this spike.
}

export interface ResolvedVisual {
  kind: string;
  visualId: string;
  /** Rich text is retained verbatim, never interpreted as HTML by this library. */
  title?: string;
  titleFormat?: 'plain' | 'rich';
  sheetId: string;
  sheetName?: string;
}

export interface CalculatedField extends UnknownProperties {
  DataSetIdentifier: string;
  Name: string;
  Expression: string;
}

export type ParameterValueType = 'SINGLE_VALUED' | 'MULTI_VALUED';
export interface ValueParameterBody extends UnknownProperties {
  Name: string;
  ParameterValueType: ParameterValueType;
}
export interface DateTimeParameterBody extends UnknownProperties {
  Name: string;
  TimeGranularity?: 'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY' |
    'HOUR' | 'MINUTE' | 'SECOND' | 'MILLISECOND';
}

interface ParameterBodies {
  StringParameterDeclaration: ValueParameterBody;
  IntegerParameterDeclaration: ValueParameterBody;
  DecimalParameterDeclaration: ValueParameterBody;
  DateTimeParameterDeclaration: DateTimeParameterBody;
}

/** Exactly one recognized variant, including at the TypeScript boundary. */
export type ParameterDeclaration = {
  [Kind in keyof ParameterBodies]: { [Key in Kind]: ParameterBodies[Key] } &
    { [Other in Exclude<keyof ParameterBodies, Kind>]?: never }
}[keyof ParameterBodies];

export interface FilterGroup extends UnknownProperties {
  FilterGroupId: string;
  CrossDataset: 'ALL_DATASETS' | 'SINGLE_DATASET';
  Filters: Record<string, UnknownProperties>[];
  /** Opaque union body: preservation does not imply execution support. */
  ScopeConfiguration: Record<string, UnknownProperties>;
  Status?: 'ENABLED' | 'DISABLED';
}
