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

export type MeasureAggregation = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';

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
export interface PublishAnalysisResult { DashboardId: string; Version: number; PublishedAt: string }
export interface DashboardSummary { kind: 'dashboard'; id: string; name: string; version: number; publishedAt: string; sourceAnalysisId: string }
export interface DashboardVersionSummary { version: number; publishedAt: string; publishedBy: string }
export interface DashboardDescribe { DashboardId: string; Name: string; Definition: Record<string, unknown>; Errors: AnalysisDiagnostic[]; Version: number; PublishedAt: string; SourceAnalysisId: string }
export interface DashboardShare { principal: { type: 'user' | 'group'; id: string }; role: 'viewer' | 'co-owner' }
export interface DashboardQueryBody { controlValues?: Record<string, Array<string | number>> }
export interface DashboardExportBody { version?: number; format: 'csv' | 'pdf' }
export interface DashboardExportArtifact { bytes: Uint8Array; contentType: string; contentDisposition: string | null; etag: string | null }
export interface DashboardRemoved { id: string; version?: number; removed: true }
