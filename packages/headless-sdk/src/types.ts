import type { BundleDefinition, BundleSheet, BundleVisual } from '@opensight/bundle-parser/browser';
export type { BundleDefinition, BundleSheet, BundleVisual } from '@opensight/bundle-parser/browser';

/**
 * Types for the OpenSight headless v1 API, mirroring
 * docs/api/openapi-v1.yaml 1:1. These describe the wire contract of the
 * *implemented* slices (datasets, querying, analyses) only.
 */

export type ColumnType = 'INTEGER' | 'DECIMAL' | 'STRING' | 'DATETIME' | 'BOOLEAN';

export interface Column {
  name: string;
  type: ColumnType;
}

export type ExecutionMode = 'DIRECT_QUERY' | 'BLAZE';

export interface DatasetExecution {
  mode: ExecutionMode;
  intervalMinutes?: number | null;
}

export interface DatasetSummary {
  id: string;
  name: string;
  version: number;
  execution: DatasetExecution;
}

export interface DatasetDescribe {
  id: string;
  name: string;
  version: number;
  execution: DatasetExecution;
  schema: { columns: Column[] };
  lineage: {
    sources: Array<{ id: string }>;
    datasets: Array<{ id: string }>;
    steps: number;
  };
  refresh: { supported: boolean; mode: string; intervalMinutes?: number | null };
}

export interface SaveDatasetBody {
  /** Prepared dataset name (<=512 chars) */
  name: string;
  /** PrepPipeline (version 1); see bundle-parser prep docs */
  pipeline: Record<string, unknown>;
  /** Optimistic-concurrency version; 0 on create */
  expectedVersion: number;
}

export interface DeleteDatasetResult {
  id: string;
  removed: true;
}

export interface LineageSource {
  id: string;
  connectorId?: string;
  version?: number;
  available: boolean;
  errorCode?: string;
}

export interface LineageDataset {
  id: string;
  name?: string;
  version?: number;
  available: boolean;
  errorCode?: string;
  inputs?: Array<{ kind: 'source' | 'dataset'; id: string }>;
}

export interface DatasetLineage {
  dataset: { id: string; name?: string; version?: number };
  steps: Array<{ id?: string; kind?: string; name?: string | null; from?: string | null }>;
  sources: LineageSource[];
  datasets: LineageDataset[];
  refresh: { mode?: string; intervalMinutes?: number | null; supported?: boolean };
}

export interface RefreshResult {
  datasetId: string;
  refreshed: true;
  mode?: string;
  state?: string;
}

export interface RefreshState {
  datasetId?: string;
  version?: number;
  mode?: string;
  intervalMinutes?: number | null;
  supported?: boolean;
}

export interface SourceSummary {
  id: string;
  version?: number;
  connectorId?: string;
  available: boolean;
  errorCode?: string;
}

export interface SourceDescribe {
  id: string;
  version?: number;
  connectorId?: string;
  columns: Column[];
}

export interface DeleteSourceResult {
  id: string;
  retired: true;
  version?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Named machine-readable error body — every v1 route returns one. */
export interface ApiErrorBody {
  errorCode: string;
  message?: string;
  path?: string;
  Errors?: AnalysisDiagnostic[];
}

// ---- InteractiveQuery (visual query model, no raw SQL) ----

export interface QueryDimension {
  fieldId: string;
  columnName: string;
  granularity?: string;
}

export type MeasureAggregation = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'DISTINCT_COUNT';

export interface QueryMeasure {
  fieldId: string;
  columnName: string;
  aggregation: MeasureAggregation;
}

export type QueryFilter =
  | { columnName: string; value: string }
  | { columnName: string; values: string[] }
  | {
      columnName: string;
      parameterName: string;
      operator?: 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO';
    };

export type QueryParameterType = 'string' | 'number' | 'datetime';

export interface QueryParameter {
  name: string;
  type: QueryParameterType;
  multiple: boolean;
  integer?: boolean;
}

/**
 * The query body the UI sends: dimensions, measures, filters, optional
 * calculated fields and parameter declarations/bindings. Arbitrary SQL,
 * identity assertions and unknown properties are rejected by the API.
 */
export interface InteractiveQuery {
  dimensions: QueryDimension[];
  measures: QueryMeasure[];
  filters: QueryFilter[];
  calculatedFields?: Array<{ name: string; expression: string }>;
  parameterDeclarations?: QueryParameter[];
  parameterBindings?: Record<string, Array<string | number>>;
}

export interface QueryResultColumn {
  name: string;
  type: 'string' | 'number';
}

export type QueryCell = string | number | null;

export interface QueryResult {
  columns: QueryResultColumn[];
  /** Objects keyed by column name; one cell per column, matching the column type or null */
  rows: Array<Record<string, QueryCell>>;
  execution?: { mode: 'BLAZE'; cached: true };
}

// ---- Analyses (camelCase writes, PascalCase descriptions) ----

export type DatasetBinding = { kind: 'dataset' | 'prepared-dataset'; id: string };
export type DatasetBindings = Record<string, DatasetBinding>;
export interface AnalysisSummary { kind: 'analysis'; id: string; name: string }
export interface AnalysisDiagnostic { errorCode: string; message: string; path: string }
export interface AnalysisDescribe {
  AnalysisId: string;
  Name: string;
  /** Existing QuickSight PascalCase projection, not the camelCase write shape. */
  Definition: Record<string, unknown>;
  Errors: AnalysisDiagnostic[];
}
export interface UpdateAnalysisBody {
  name: string;
  definition: BundleDefinition;
  datasetBindings: DatasetBindings;
}
export interface CreateAnalysisBody extends UpdateAnalysisBody { analysisId: string }
export interface DeleteAnalysisResult { id: string; removed: true }
/** HTTP metadata is separate from the unchanged response body. */
export interface VersionedResult<T> { value: T; etag: string | null }
export type AnalysisLayouts = NonNullable<BundleSheet['layouts']>;
export type AnalysisCalculatedFields = NonNullable<BundleDefinition['calculatedFields']>;
export interface AnalysisFilterGroup extends Record<string, unknown> { filterGroupId: string; filters: unknown[] }

// ---- Published dashboards ----
export interface PublishAnalysisBody { dashboardId?: string }
export interface PublishAnalysisResult { DashboardId: string; Version: number; PublishedAt: string; Errors: AnalysisDiagnostic[] }
export interface DashboardSummary { kind: 'dashboard'; id: string; name: string; version: number; publishedAt: string; sourceAnalysisId: string }
export interface DashboardVersionSummary { version: number; publishedAt: string; publishedBy: string }
export interface DashboardDescribe { DashboardId: string; Name: string; Definition: Record<string, unknown>; Errors: AnalysisDiagnostic[]; Version: number; PublishedAt: string; SourceAnalysisId: string }
export type DashboardShare = AssetShare;
export interface DashboardQueryBody { controlValues?: Record<string, Array<string | number>> }
export interface DashboardExportBody { version?: number; format: 'csv' | 'pdf' }
export interface DashboardExportArtifact { bytes: Uint8Array; contentType: string; contentDisposition: string | null; etag: string | null }
export interface DashboardRemoved { id: string; version?: number; removed: true }

/** D-55 explicitly retains lowercase discovery summaries and pagination. */
export type AssetKind = 'analyses' | 'dashboards' | 'datasets';
export type TransferAssetKind = 'analyses' | 'dashboards';
export interface AssetSummary { kind: AssetKind; id: string; name: string; folderId: string | null }
export interface AssetSearch { query: string; kinds?: AssetKind[] }
export interface AssetMove { folderId: string | null }
export interface AssetCopy { newId: string; name?: string; folderId?: string | null }
export interface AssetTransfer { Kind: TransferAssetKind; Id: string; Name: string; FolderId: string | null }
export interface AssetPrincipal { type: 'user' | 'group'; id: string }
export type AssetRole = 'viewer' | 'co-owner';
export interface AssetShare { Principal: { Type: 'user' | 'group'; Id: string }; Role: AssetRole }
export interface AssetGrantWrite { principal: AssetPrincipal; role: AssetRole }
export interface FolderDescribe { Id: string; Name: string; Version: number }
export interface FolderPermissions { InheritedFrom: string; Grants: AssetShare[] | null }

export interface MetricFormat {
  style: 'number' | 'percent' | 'currency';
  decimalPlaces: number;
  currency?: string;
}
export interface MetricDefinition {
  name: string;
  expression: string;
  defaultAggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'DISTINCT_COUNT';
  format: MetricFormat;
  description: string;
  synonyms: string[];
}
export interface PublishedMetric extends MetricDefinition { id: string; version: number }
export interface MetricVersion {
  version: number;
  state: 'draft' | 'published';
  definition: MetricDefinition;
  actor: string;
  at: string;
}
export interface MetricView {
  id: string;
  dataset: { kind: 'dataset' | 'prepared-dataset'; id: string; ownerId?: string };
  version: number;
  publishedVersion: number | null;
  provenance?: { kind: 'dataset-calculation'; datasetVersion: number; calculationId: string; name: string; expression: string };
  createdBy: string;
  state: 'draft' | 'published';
  definition: MetricDefinition;
  published: PublishedMetric | null;
  permissions: { edit: boolean; publish: boolean };
}

/** Existing generative question contract; execute an interpretation separately. */
export interface AskQuestionBody { question: string; datasetId: string }
export interface QuestionAnswer {
  interpretations: QuestionInterpretation[];
  errors: { code: string; message: string }[];
  question: string;
}
export interface QuestionInterpretation {
  measure: string | null;
  aggregation: MeasureAggregation;
  dimensions: string[];
  filters: { field: string; operator: 'equals' | 'year'; value: string | number }[];
  granularity: 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY' | null;
  topN: number | null;
  suggestedVisualType: 'bar' | 'line' | 'pie' | 'table' | 'kpi';
  confidence: number;
  explanation: string;
  grounding: {
    fieldsUsed: string[];
    synonymsMatched: { term: string; field: string }[];
    unmatchedTerms: string[];
    metricsUsed?: { id: string; name: string; version: number }[];
  };
}

/** A tenant-scoped audit event. v1 actor is the delegating member's userId. */
export interface WorkspaceAuditEntry {
  eventId: string;
  createdAt: string;
  actor: string;
  action: string;
  tenantId: string;
  subject: string | null;
  detail: unknown;
}

export type { MigrationImportReport } from '@opensight/bundle-parser';
export interface BundleImportBody {
  importId: string;
  bundle: import('@opensight/bundle-parser').QsBundle | import('@opensight/bundle-parser').BundleResource;
  manifest?: import('@opensight/bundle-parser').ExtractionManifest;
  previousImportId?: string;
  bindings?: { asset: number; datasetBindings: CreateAnalysisBody['datasetBindings'] }[];
}
export interface BundleImportResult {
  importId: string;
  report: import('@opensight/bundle-parser').MigrationImportReport;
  targets: { asset: number; state: 'staged' | 'imported'; analysisId?: string }[];
}
