import { randomUUID } from 'node:crypto';
import { AutomationStore } from './automation-store.js';
import { hasCapability } from '@opensight/query-engine';
import type { Identity } from './security.js';
import type { Role } from '@opensight/query-engine';

/**
 * Governed input tables (issue #161, IDD decided 2026-10-30).
 * Scoped NEW tables owned by OpenSight, bound to a dataset for context.
 * Source systems are NEVER mutated; no write credentials anywhere.
 */

export type InputColumnType = 'text' | 'number' | 'date' | 'boolean';
export const INPUT_COLUMN_TYPES: readonly InputColumnType[] = ['text', 'number', 'date', 'boolean'];

export interface InputColumn { name: string; type: InputColumnType; required: boolean }
export type InputCellValue = string | number | boolean | null;
export interface InputRow { id: string; values: Record<string, InputCellValue> }
export interface InputTable {
  id: string; namespaceId: string; ownerId: string; name: string;
  boundDatasetId: string | null; columns: InputColumn[]; rows: InputRow[];
  editors: string[]; version: number; createdAt: string; updatedAt: string;
}
export type InputAuditAction = 'table_created' | 'table_renamed' | 'bound_dataset_changed' | 'row_added' | 'row_updated' | 'row_deleted' | 'editors_changed' | 'table_deleted';
export interface InputAuditEntry {
  id: string; tableId: string; namespaceId: string; actorId: string; action: InputAuditAction; at: string;
  /** For row add/delete: { row }. For cell updates: { rowId, changes: { column, oldValue, newValue }[] }.
   *  For editors: { oldEditors, newEditors }. For rename/bound: { oldValue, newValue }. */
  detail: Record<string, unknown>;
}
export interface InputTablesState { version: 1; tables: InputTable[]; audit: InputAuditEntry[] }

export const MAX_INPUT_COLUMNS = 32;
export const MAX_INPUT_ROWS = 10_000;
export const MAX_INPUT_NAME_CHARS = 120;
export const MAX_INPUT_TEXT_CHARS = 10_000;
export const MAX_INPUT_AUDIT_ENTRIES_PER_TABLE = 1000;
export const MAX_INPUT_AUDIT_ENTRIES_TOTAL = 10_000;

export class InputTableError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = 'InputTableError'; }
}
function fail(code: string, status: number, message: string): never { throw new InputTableError(code, status, message); }

export const COLUMN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
export const TABLE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;

export function validateTableName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > MAX_INPUT_NAME_CHARS || /[\x00-\x1f]/.test(raw)) fail('INPUT_TABLE_INVALID_NAME', 400, 'Table name must be 1-120 characters.');
  return raw;
}

export function validateColumns(raw: unknown): InputColumn[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_INPUT_COLUMNS) fail('INPUT_TABLE_COLUMN_LIMIT_EXCEEDED', 400, `Expected 1-${MAX_INPUT_COLUMNS} columns.`);
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('INPUT_TABLE_INVALID_COLUMN', 400, `Column ${i + 1} is invalid.`);
    const col = entry as Record<string, unknown>;
    if (Object.keys(col).some(k => !['name', 'type', 'required'].includes(k))) fail('INPUT_TABLE_INVALID_COLUMN', 400, `Column ${i + 1} has unsupported fields.`);
    if (typeof col.name !== 'string' || col.name.length < 1 || col.name.length > 64 || !COLUMN_NAME_RE.test(col.name)) fail('INPUT_TABLE_INVALID_COLUMN_NAME', 400, `Column name "${String(col.name)}" must start with a letter or underscore and contain only letters, digits and underscores (max 64).`);
    const lower = col.name.toLowerCase();
    if (seen.has(lower)) fail('INPUT_TABLE_DUPLICATE_COLUMN', 400, `Duplicate column name: ${col.name}`);
    seen.add(lower);
    if (!INPUT_COLUMN_TYPES.includes(col.type as InputColumnType)) fail('INPUT_TABLE_INVALID_COLUMN_TYPE', 400, `Column ${col.name} type must be text, number, date or boolean.`);
    if (typeof col.required !== 'boolean') fail('INPUT_TABLE_INVALID_COLUMN', 400, `Column ${col.name} required flag must be a boolean.`);
    return { name: col.name, type: col.type as InputColumnType, required: col.required };
  });
}

function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Validate one cell value against its column definition. Missing (undefined/null) is allowed only for optional columns. */
export function validateCellValue(column: InputColumn, raw: unknown): InputCellValue {
  if (raw === undefined || raw === null) {
    if (column.required) fail('INPUT_TABLE_REQUIRED_VALUE_MISSING', 400, `Column ${column.name} is required.`);
    return null;
  }
  switch (column.type) {
    case 'text':
      if (typeof raw !== 'string') fail('INPUT_TABLE_INVALID_VALUE_TYPE', 400, `Column ${column.name} expects text.`);
      if (raw.length > MAX_INPUT_TEXT_CHARS) fail('INPUT_TABLE_TEXT_TOO_LONG', 400, `Column ${column.name} exceeds ${MAX_INPUT_TEXT_CHARS} characters.`);
      return raw;
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) fail('INPUT_TABLE_INVALID_NUMBER', 400, `Column ${column.name} expects a finite number.`);
      return raw;
    case 'date':
      if (typeof raw !== 'string' || !isCalendarDate(raw)) fail('INPUT_TABLE_INVALID_DATE', 400, `Column ${column.name} expects a valid calendar date (YYYY-MM-DD).`);
      return raw;
    case 'boolean':
      if (typeof raw !== 'boolean') fail('INPUT_TABLE_INVALID_VALUE_TYPE', 400, `Column ${column.name} expects true or false.`);
      return raw;
  }
}

/** Validate a full candidate row (all columns present after merging). Unknown columns rejected. */
export function validateRowValues(columns: readonly InputColumn[], values: Record<string, unknown>): Record<string, InputCellValue> {
  const known = new Set(columns.map(c => c.name));
  for (const key of Object.keys(values)) if (!known.has(key)) fail('INPUT_TABLE_UNKNOWN_COLUMN', 400, `Unknown column: ${key}`);
  const out: Record<string, InputCellValue> = {};
  for (const col of columns) out[col.name] = validateCellValue(col, values[col.name]);
  return out;
}

/** Validate + normalize a partial patch against the existing row, checking required on the merged row. */
export function mergeRowPatch(columns: readonly InputColumn[], existing: Record<string, InputCellValue>, patch: Record<string, unknown>): { values: Record<string, InputCellValue>; changes: { column: string; oldValue: InputCellValue; newValue: InputCellValue }[] } {
  const known = new Set(columns.map(c => c.name));
  for (const key of Object.keys(patch)) if (!known.has(key)) fail('INPUT_TABLE_UNKNOWN_COLUMN', 400, `Unknown column: ${key}`);
  const merged: Record<string, unknown> = { ...existing, ...patch };
  const values = validateRowValues(columns, merged);
  const changes = Object.keys(patch).map(column => ({ column, oldValue: existing[column] ?? null, newValue: values[column] ?? null })).filter(c => c.oldValue !== c.newValue);
  return { values, changes };
}

/** Permission helpers. Role carries capabilities; local single-user mode passes role undefined and is treated as author+admin. */
export interface InputPrincipal extends Identity { role?: Role }
export function canViewInputTable(principal: InputPrincipal, table: Pick<InputTable, 'namespaceId'>): boolean {
  return principal.namespaceId === table.namespaceId;
}
export function canEditInputTable(principal: InputPrincipal, table: Pick<InputTable, 'namespaceId' | 'ownerId' | 'editors'>): boolean {
  if (principal.namespaceId !== table.namespaceId) return false;
  if (principal.role !== undefined && !hasCapability(principal.role, 'build')) return false;
  if (principal.role === undefined) return true; // local single-user workspace
  if (principal.userId === table.ownerId) return true;
  if (hasCapability(principal.role, 'admin')) return true;
  return table.editors.includes(principal.userId);
}
export function canManageInputTable(principal: InputPrincipal, table: Pick<InputTable, 'namespaceId' | 'ownerId'>): boolean {
  if (principal.namespaceId !== table.namespaceId) return false;
  if (principal.role === undefined) return true;
  return principal.userId === table.ownerId || hasCapability(principal.role, 'admin');
}

/** Store-state validation on load: strict, fail closed with a named error on a corrupt store. */
export function validateInputTablesState(raw: unknown): InputTablesState {
  const bad = (msg: string): never => { throw new Error(`INPUT_TABLE_STORE_CORRUPT: ${msg}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('expected an object');
  const s = raw as Record<string, unknown>;
  if (s.version !== 1 || !Array.isArray(s.tables) || !Array.isArray(s.audit)) return bad('expected version 1 with tables and audit');
  const tableIds = new Set<string>();
  const tables: InputTable[] = s.tables.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return bad(`tables[${i}] is not an object`);
    const t = entry as Record<string, unknown>;
    if (typeof t.id !== 'string' || !TABLE_ID_RE.test(t.id)) return bad(`tables[${i}].id is invalid`);
    if (tableIds.has(t.id)) return bad(`duplicate table id ${t.id}`);
    tableIds.add(t.id);
    if (typeof t.namespaceId !== 'string' || !t.namespaceId || typeof t.ownerId !== 'string' || !t.ownerId) return bad(`tables[${i}] scope is invalid`);
    if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > MAX_INPUT_NAME_CHARS) return bad(`tables[${i}].name is invalid`);
    if (t.boundDatasetId !== null && typeof t.boundDatasetId !== 'string') return bad(`tables[${i}].boundDatasetId is invalid`);
    let columns: InputColumn[];
    try { columns = validateColumns(t.columns); } catch (e) { return bad(`tables[${i}].columns: ${e instanceof Error ? e.message : String(e)}`); }
    if (!Array.isArray(t.rows) || t.rows.length > MAX_INPUT_ROWS) return bad(`tables[${i}].rows exceeds the row cap`);
    const rowIds = new Set<string>();
    const rows: InputRow[] = t.rows.map((r, j) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return bad(`tables[${i}].rows[${j}] is not an object`);
      const row = r as Record<string, unknown>;
      if (typeof row.id !== 'string' || !row.id || rowIds.has(row.id)) return bad(`tables[${i}].rows[${j}].id is invalid or duplicated`);
      rowIds.add(row.id);
      if (!row.values || typeof row.values !== 'object' || Array.isArray(row.values)) return bad(`tables[${i}].rows[${j}].values is invalid`);
      let values: Record<string, InputCellValue>;
      try { values = validateRowValues(columns, row.values as Record<string, unknown>); } catch (e) { return bad(`tables[${i}].rows[${j}]: ${e instanceof Error ? e.message : String(e)}`); }
      return { id: row.id, values };
    });
    if (!Array.isArray(t.editors) || t.editors.some(e => typeof e !== 'string' || !e)) return bad(`tables[${i}].editors is invalid`);
    if (!Number.isSafeInteger(t.version) || Number(t.version) < 1) return bad(`tables[${i}].version is invalid`);
    if (typeof t.createdAt !== 'string' || !Number.isFinite(Date.parse(t.createdAt)) || typeof t.updatedAt !== 'string' || !Number.isFinite(Date.parse(t.updatedAt))) return bad(`tables[${i}] timestamps are invalid`);
    return { id: t.id, namespaceId: t.namespaceId, ownerId: t.ownerId, name: t.name, boundDatasetId: t.boundDatasetId, columns, rows, editors: [...new Set(t.editors as string[])], version: Number(t.version), createdAt: t.createdAt, updatedAt: t.updatedAt };
  });
  // Legacy stores may exceed the retention caps; enforce caps on append, not on load.
  const audit: InputAuditEntry[] = s.audit.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return bad(`audit[${i}] is not an object`);
    const a = entry as Record<string, unknown>;
    const actions: InputAuditAction[] = ['table_created', 'table_renamed', 'bound_dataset_changed', 'row_added', 'row_updated', 'row_deleted', 'editors_changed', 'table_deleted'];
    if (typeof a.id !== 'string' || !a.id || typeof a.tableId !== 'string' || !a.tableId || typeof a.namespaceId !== 'string' || !a.namespaceId
      || typeof a.actorId !== 'string' || !a.actorId || !actions.includes(a.action as InputAuditAction)
      || typeof a.at !== 'string' || !Number.isFinite(Date.parse(a.at)) || !a.detail || typeof a.detail !== 'object' || Array.isArray(a.detail)) return bad(`audit[${i}] is invalid`);
    return { id: a.id, tableId: a.tableId, namespaceId: a.namespaceId, actorId: a.actorId, action: a.action as InputAuditAction, at: a.at, detail: a.detail as Record<string, unknown> };
  });
  return { version: 1, tables, audit };
}

export const emptyInputTablesState = (): InputTablesState => ({ version: 1, tables: [], audit: [] });

/**
 * Dedicated JSON store following the prep/automation pattern: atomic write via
 * temp-file + rename (AutomationStore), strict validation on load, fail closed
 * with INPUT_TABLE_STORE_CORRUPT on a corrupt file. Every mutation appends its
 * audit entries in the same update so data and audit can never diverge.
 */
export class InputTableStore {
  private constructor(readonly store: AutomationStore<InputTablesState>) {}
  static async load(path?: string): Promise<InputTableStore> {
    try {
      const store = await AutomationStore.load(emptyInputTablesState(), path, validateInputTablesState);
      return new InputTableStore(store);
    } catch (error) {
      // AutomationStore wraps load failures; surface the named corruption error so a
      // corrupt input-table store fails closed under its own code, not a generic one.
      const cause = (error as { cause?: unknown })?.cause;
      if (cause instanceof Error && cause.message.startsWith('INPUT_TABLE_STORE_CORRUPT')) throw cause;
      throw error;
    }
  }
  read(): InputTablesState { return this.store.read(); }
  tableById(id: string): InputTable | undefined { return this.store.project(state => state.tables.find(table => table.id === id)); }
  auditFor(tableId: string): InputAuditEntry[] { return this.store.project(state => state.audit.filter(entry => entry.tableId === tableId)); }
  /** Single serialized mutation; audit entries are appended atomically with the data change. */
  change<R>(update: (draft: InputTablesState) => R): Promise<R> { return this.store.change(update); }
}

export function newId(): string { return randomUUID(); }
export function nowIso(): string { return new Date().toISOString(); }
export function appendAudit(draft: InputTablesState, table: Pick<InputTable, 'id' | 'namespaceId'>, actorId: string, action: InputAuditAction, detail: Record<string, unknown>): void {
  draft.audit.push({ id: randomUUID(), tableId: table.id, namespaceId: table.namespaceId, actorId, action, at: nowIso(), detail });
  let excess = draft.audit.reduce((count, entry) => count + Number(entry.tableId === table.id), 0) - MAX_INPUT_AUDIT_ENTRIES_PER_TABLE;
  // Entries are appended in order: discard this table's oldest entries first.
  if (excess > 0) draft.audit = draft.audit.filter(entry => entry.tableId !== table.id || excess-- <= 0);
  if (draft.audit.length > MAX_INPUT_AUDIT_ENTRIES_TOTAL) draft.audit.splice(0, draft.audit.length - MAX_INPUT_AUDIT_ENTRIES_TOTAL);
}
