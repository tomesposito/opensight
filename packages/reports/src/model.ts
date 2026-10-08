import type { ColumnType, ResultRow, ResultValue, RowExpression } from '@opensight/query-engine';

/** The query engine's dataset/column reference, without bound expression metadata. */
export type ReportFieldReference = Pick<Extract<RowExpression, { kind: 'column' }>, 'dataSetIdentifier' | 'columnName'>;
export interface TextStyle { fontSize?: number; bold?: boolean; italic?: boolean; color?: string }
export interface TextRun { text: string; style?: TextStyle }
export type Placeholder = 'pageNumber' | 'totalPages' | 'date' | 'reportTitle';
export type RepeatingRun = TextRun | { field: Placeholder; style?: TextStyle };
export interface TextBand { kind: 'text'; id: string; runs: TextRun[]; headingLevel?: 1 | 2 | 3 }
export interface TableColumn { field: ReportFieldReference; type: ColumnType; label: string }
export interface TableBand {
  kind: 'table'; id: string; datasetId: string; columns: TableColumn[];
  style?: TextStyle;
  /** Supplied summary values in column order; slice 1 performs no aggregation. */
  summary?: ResultValue[];
}
export interface ReportDefinition {
  version: 1; id: string; title: string;
  /** Explicit YYYY-MM-DD for deterministic layout and export; never reads the clock. */
  date: string;
  pageSetup: {
    size: 'A4' | 'Letter' | 'Legal'; orientation: 'portrait' | 'landscape';
    margins: { top: number; right: number; bottom: number; left: number };
  };
  header: { runs: RepeatingRun[] };
  footer: { runs: RepeatingRun[] };
  body: (TextBand | TableBand)[];
}
export type RowsByBand = Readonly<Record<string, readonly ResultRow[]>>;
export type ReportErrorCode = 'REPORT_INVALID_DEFINITION' | 'REPORT_UNSUPPORTED_BAND' | 'REPORT_INVALID_ROWS'
  | 'REPORT_ROW_OVERFLOW' | 'REPORT_PAGE_OVERFLOW' | 'REPORT_LIMIT_EXCEEDED' | 'REPORT_UNSUPPORTED_TEXT' | 'REPORT_INVALID_LAYOUT';
export class ReportError extends Error {
  constructor(public readonly code: ReportErrorCode, public readonly path: string, message: string) {
    super(`${code}: ${path}: ${message}`); this.name = code;
  }
}
export function fail(code: ReportErrorCode, path: string, message: string): never { throw new ReportError(code, path, message); }
