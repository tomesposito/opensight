export type ScalarType = 'number' | 'string' | 'datetime';
export type ColumnType = 'INTEGER' | 'DECIMAL' | 'STRING' | 'DATETIME';
export type Aggregation = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
export type SqlDialect = 'duckdb' | 'postgres';
export interface PlanOptions {
  readonly dialect?: SqlDialect;
}
export interface SourceLocation {
  readonly path: string;
  /** Zero-based expression offsets, end exclusive. */
  readonly start: number;
  readonly end: number;
}
interface ExpressionInfo {
  readonly location: SourceLocation;
  readonly scalarType: ScalarType;
  readonly nullable: boolean;
  readonly level: 'row';
  readonly dependencies: readonly string[];
}
export type RowExpression = ExpressionInfo & (
  { readonly kind: 'literal'; readonly value: number } |
  { readonly kind: 'column'; readonly dataSetIdentifier: string; readonly columnName: string } |
  { readonly kind: 'binary'; readonly operator: '+' | '-' | '*'; readonly left: RowExpression; readonly right: RowExpression }
);
export interface BoundColumn {
  readonly name: string;
  readonly type: ColumnType;
  readonly scalarType: ScalarType;
  readonly nullable: boolean;
}
export interface Calculation {
  readonly name: string;
  readonly expression: RowExpression;
}
export interface Dimension {
  readonly fieldId: string;
  readonly outputName: string;
  readonly columnName: string;
  readonly granularity?: 'MONTH';
  readonly scalarType: ScalarType;
  readonly path: string;
}
export interface Measure {
  readonly fieldId: string;
  readonly outputName: string;
  readonly columnName: string;
  readonly aggregation: Aggregation;
  readonly path: string;
}
export type RowFilter = {
  readonly columnName: string;
  readonly path: string;
} & ({ readonly value: string } | { readonly values: readonly string[] });
/** OpenSight local test configuration, never inferred from missing AWS policies. */
export interface LocalDataBinding {
  readonly provenance: string;
  readonly dataSetArn: string;
  readonly physicalTableId: string;
  readonly csv: string;
  readonly nullEncoding: 'empty cell';
  readonly timezone: 'UTC';
  readonly security: { readonly dataset: 'unrestricted'; readonly source: 'unrestricted' };
}
export interface PlanRequest {
  /** Provisional synthetic analysis envelope, not an archive or API response. */
  readonly analysis: unknown;
  /** Reconstructed DescribeDataSet response body. */
  readonly dataSet: unknown;
  /** Reconstructed DescribeDataSource response body; never used for a connection. */
  readonly dataSource: unknown;
  /** Trusted caller-owned configuration; do not accept assertions from an imported asset. */
  readonly localData: unknown;
  readonly visualId: string;
}
export interface QueryPlan {
  readonly dialect: SqlDialect;
  readonly mode: 'synthetic-local';
  readonly visualId: string;
  readonly dataSetIdentifier: string;
  readonly tableName: string;
  /** Postgres resolves the declared schema; DuckDB materializes a local table. */
  readonly tableSchema?: string;
  readonly sourceColumns: readonly BoundColumn[];
  readonly localData: LocalDataBinding;
  readonly calculations: readonly Calculation[];
  readonly filters: readonly RowFilter[];
  readonly dimensions: readonly Dimension[];
  readonly measures: readonly Measure[];
  readonly stages: readonly ['source', 'row-calculations', 'row-filters', 'visual-aggregation', 'order'];
  readonly sql: string;
  readonly parameters: readonly string[];
}
export type ResultValue = string | number | null;
export type ResultRow = Record<string, ResultValue>;
export interface QueryResult {
  readonly plan: QueryPlan;
  readonly rows: ResultRow[];
}
export interface ExecuteOptions {
  /** CSV must resolve to a regular file inside this caller-selected directory. */
  readonly dataRoot: string;
}
export interface PostgresExecuteOptions {
  /** Trusted caller-owned connection details, never taken from imported metadata. */
  readonly connectionString: string;
}
