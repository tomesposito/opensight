/** Governed input tables (issue #161): shared web types for the API shapes in packages/api/src/input-tables.ts. */
export type InputColumnType = 'text' | 'number' | 'date' | 'boolean';
export interface InputColumn { name: string; type: InputColumnType; required: boolean }
export type InputCellValue = string | number | boolean | null;
export interface InputRow { id: string; values: Record<string, InputCellValue> }
export interface InputTableSummary {
  id: string; name: string; boundDatasetId: string | null;
  columnCount: number; rowCount: number; canEdit: boolean; canManage: boolean;
  version: number; updatedAt: string;
}
export interface InputTableFull {
  id: string; namespaceId: string; ownerId: string; name: string; boundDatasetId: string | null;
  columns: InputColumn[]; rows: InputRow[]; editors: string[];
  canEdit: boolean; canManage: boolean; version: number; createdAt: string; updatedAt: string;
}
export interface InputAuditEntry {
  id: string; tableId: string; namespaceId: string; actorId: string;
  action: 'table_created' | 'table_renamed' | 'bound_dataset_changed' | 'row_added' | 'row_updated' | 'row_deleted' | 'editors_changed' | 'table_deleted';
  at: string; detail: Record<string, unknown>;
}
