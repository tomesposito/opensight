import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasCapability, type PrepMemoryTable, type PrepSource } from '@opensight/query-engine';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { readBody, RequestError, SecurityError } from './query.js';
import { method, routeId, send } from './automation-routes.js';
import { isObject } from './mapping.js';
import type { Identity, SecurityService } from './security.js';
import {
  InputTableError, InputTableStore, appendAudit, canEditInputTable, canManageInputTable, canViewInputTable,
  mergeRowPatch, nowIso, validateCellValue, validateColumns, validateRowValues, validateTableName,
  MAX_INPUT_ROWS, MAX_INPUT_AUDIT_ENTRIES_PER_TABLE, type InputColumn, type InputPrincipal, type InputTable,
} from './input-tables.js';

export interface InputTableDependencies {
  security?: SecurityService;
  /** Single-user local workspace identity (no role registry). */
  localIdentity?: Identity;
  /** Returns true when the caller may reference this dataset id. When omitted, ids are accepted as opaque references. */
  isDatasetVisible?: (identity: Identity, datasetId: string) => boolean;
  /** Same-namespace user ids for editors validation; omit (or return undefined) to validate shape only. */
  workspaceUserIds?: (identity: Identity) => readonly string[] | undefined;
}

const PREP_TYPE: Record<InputColumn['type'], PrepColumn['type']> = { text: 'STRING', number: 'DECIMAL', date: 'DATETIME', boolean: 'BOOLEAN' };
export const inputTablePrepSourceId = (tableId: string): string => `input-table-${tableId}`;

function body(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isObject(raw) || Object.keys(raw).some(k => !allowed.includes(k))) throw new InputTableError('INPUT_TABLE_INVALID_BODY', 400, 'Request body has unsupported fields.');
  return raw as Record<string, unknown>;
}

function auditPagination(query: string): { limit: number; offset: number } | undefined {
  const params = new URLSearchParams(query);
  if (!params.size) return undefined;
  if ([...params.keys()].some(key => key !== 'limit' && key !== 'offset')) throw new RequestError(400, 'Query parameters are not supported');
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const values = params.getAll(name);
    if (!values.length) return fallback;
    const raw = values[0]!;
    const value = Number(raw);
    if (values.length !== 1 || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new InputTableError('INPUT_TABLE_AUDIT_PAGINATION_INVALID', 400, `${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
  };
  return { limit: integer('limit', MAX_INPUT_AUDIT_ENTRIES_PER_TABLE, 1, MAX_INPUT_AUDIT_ENTRIES_PER_TABLE), offset: integer('offset', 0, 0, Number.MAX_SAFE_INTEGER) };
}

export class InputTableRoutes {
  constructor(private readonly store: InputTableStore, private readonly deps: InputTableDependencies = {}) {}

  private principal(identity?: Identity): InputPrincipal {
    if (this.deps.security) {
      if (!identity) throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', 'Authentication required');
      const user = this.deps.security.user(identity);
      return { namespaceId: identity.namespaceId, userId: identity.userId, role: user.role };
    }
    if (this.deps.localIdentity) return { ...this.deps.localIdentity };
    if (identity) return { ...identity };
    throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', 'Input tables need a local or authenticated API');
  }

  private requireAuthor(principal: InputPrincipal): void {
    if (principal.role !== undefined && !hasCapability(principal.role, 'build')) throw new SecurityError(403, 'SECURITY_BUILD_REQUIRED', 'Author capability required');
  }
  private requireEdit(principal: InputPrincipal, table: InputTable): void {
    if (!canEditInputTable(principal, table)) throw new SecurityError(403, 'INPUT_TABLE_EDIT_REQUIRED', 'Editor grant and author capability required');
  }
  private requireManage(principal: InputPrincipal, table: InputTable): void {
    if (!canManageInputTable(principal, table)) throw new SecurityError(403, 'INPUT_TABLE_MANAGE_REQUIRED', 'Only the table owner or an administrator can manage this table');
  }

  private findVisible(principal: InputPrincipal, id: string): InputTable {
    const table = this.store.read().tables.find(t => t.id === id);
    if (!table || !canViewInputTable(principal, table)) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
    return table;
  }

  private checkBoundDataset(identity: Identity | undefined, principal: InputPrincipal, raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw new InputTableError('INPUT_TABLE_INVALID_BOUND_DATASET', 400, 'boundDatasetId must be a dataset id or null.');
    const visible = this.deps.isDatasetVisible;
    if (visible && identity && !visible(identity, raw)) throw new InputTableError('INPUT_TABLE_BOUND_DATASET_NOT_FOUND', 400, `Bound dataset is not visible to the caller: ${raw}`);
    void principal;
    return raw;
  }

  private summary(principal: InputPrincipal, table: InputTable) {
    return {
      id: table.id, name: table.name, boundDatasetId: table.boundDatasetId,
      columnCount: table.columns.length, rowCount: table.rows.length,
      canEdit: canEditInputTable(principal, table), canManage: canManageInputTable(principal, table),
      version: table.version, updatedAt: table.updatedAt,
    };
  }
  private full(principal: InputPrincipal, table: InputTable) {
    return {
      id: table.id, namespaceId: table.namespaceId, ownerId: table.ownerId, name: table.name,
      boundDatasetId: table.boundDatasetId, columns: table.columns, rows: table.rows, editors: table.editors,
      canEdit: canEditInputTable(principal, table), canManage: canManageInputTable(principal, table),
      version: table.version, createdAt: table.createdAt, updatedAt: table.updatedAt,
    };
  }

  /** Prep integration: same-namespace tables as DuckDB memory sources. Reference form: `input-table-<id>`. */
  prepSourcesFor(identity: Identity): PrepSource[] {
    const principal: InputPrincipal = this.deps.security ? (() => { try { return { namespaceId: identity.namespaceId, userId: identity.userId, role: this.deps.security!.user(identity).role }; } catch { return { namespaceId: identity.namespaceId, userId: identity.userId }; } })() : { ...identity };
    return this.store.read().tables.filter(t => canViewInputTable(principal, t)).map(t => this.prepSource(t));
  }
  prepTablesFor(identity: Identity): PrepMemoryTable[] {
    const principal: InputPrincipal = this.deps.security ? (() => { try { return { namespaceId: identity.namespaceId, userId: identity.userId, role: this.deps.security!.user(identity).role }; } catch { return { namespaceId: identity.namespaceId, userId: identity.userId }; } })() : { ...identity };
    return this.store.read().tables.filter(t => canViewInputTable(principal, t)).map(t => {
      const source = this.prepSource(t);
      const matrix = t.rows.map(r => t.columns.map(c => r.values[c.name] ?? null));
      return { source, rowCount: matrix.length, value: (row: number, column: number) => matrix[row]?.[column] ?? null };
    });
  }
  private prepSource(table: InputTable): PrepSource {
    return {
      id: inputTablePrepSourceId(table.id), connectorId: 'file',
      table: `input_table_${table.id.replace(/[^A-Za-z0-9_]/g, '_')}`,
      columns: table.columns.map(c => ({ name: c.name, type: PREP_TYPE[c.type] })),
      security: 'unrestricted',
    };
  }

  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity?: Identity): Promise<boolean> {
    if (!path.startsWith('/api/input-tables')) return false;
    try {
      const auditMatch = /^\/api\/input-tables\/([^/]+)\/audit$/.exec(path);
      if (query && !(auditMatch && request.method === 'GET')) throw new RequestError(400, 'Query parameters are not supported');
      const principal = this.principal(identity);
      const tableMatch = /^\/api\/input-tables\/([^/]+)$/.exec(path);
      const editorsMatch = /^\/api\/input-tables\/([^/]+)\/editors$/.exec(path);
      const rowsMatch = /^\/api\/input-tables\/([^/]+)\/rows$/.exec(path);
      const rowMatch = /^\/api\/input-tables\/([^/]+)\/rows\/([^/]+)$/.exec(path);

      if (path === '/api/input-tables') {
        const verb = method(request, response, ['GET', 'POST']);
        if (verb === 'GET') {
          const tables = this.store.read().tables.filter(t => canViewInputTable(principal, t));
          send(response, 200, { tables: tables.map(t => this.summary(principal, t)) });
          return true;
        }
        this.requireAuthor(principal);
        const raw = body(await readBody(request), ['name', 'boundDatasetId', 'columns', 'editors']);
        const name = validateTableName(raw.name);
        const boundDatasetId = this.checkBoundDataset(identity, principal, raw.boundDatasetId);
        const columns = validateColumns(raw.columns);
        const editors = raw.editors === undefined ? [] : this.validateEditors(identity, principal, raw.editors);
        const at = nowIso();
        const table: InputTable = {
          id: randomUUID(), namespaceId: principal.namespaceId, ownerId: principal.userId, name,
          boundDatasetId, columns, rows: [], editors, version: 1, createdAt: at, updatedAt: at,
        };
        await this.store.change(draft => {
          // Recheck against the current role inside the serialized mutation (#218):
          // the grant may have been revoked while the body was in flight or queued.
          this.requireAuthor(this.principal(identity));
          draft.tables.push(structuredClone(table));
          appendAudit(draft, table, principal.userId, 'table_created', { name, boundDatasetId, columns, editors });
        });
        send(response, 201, this.full(principal, table));
        return true;
      }

      if (editorsMatch) {
        method(request, response, ['PUT']);
        const id = routeId(editorsMatch[1]!);
        const current = this.findVisible(principal, id);
        this.requireManage(principal, current);
        const raw = body(await readBody(request), ['editors']);
        if (!Object.hasOwn(raw, 'editors')) throw new InputTableError('INPUT_TABLE_INVALID_BODY', 400, 'editors is required.');
        const editors = this.validateEditors(identity, principal, raw.editors);
        const updated = await this.store.change(draft => {
          const table = draft.tables.find(t => t.id === id && t.namespaceId === principal.namespaceId);
          if (!table) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
          this.requireManage(this.principal(identity), table);
          const oldEditors = [...table.editors];
          table.editors = editors; table.version++; table.updatedAt = nowIso();
          appendAudit(draft, table, principal.userId, 'editors_changed', { oldEditors, newEditors: editors });
          return structuredClone(table);
        });
        send(response, 200, this.full(principal, updated));
        return true;
      }

      if (rowsMatch) {
        method(request, response, ['POST']);
        const id = routeId(rowsMatch[1]!);
        const current = this.findVisible(principal, id);
        this.requireEdit(principal, current);
        const raw = body(await readBody(request), ['values']);
        if (!isObject(raw.values)) throw new InputTableError('INPUT_TABLE_INVALID_BODY', 400, 'values must be an object keyed by column name.');
        const values = validateRowValues(current.columns, raw.values as Record<string, unknown>);
        const row = { id: randomUUID(), values };
        const result = await this.store.change(draft => {
          const table = draft.tables.find(t => t.id === id && t.namespaceId === principal.namespaceId);
          if (!table) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
          this.requireEdit(this.principal(identity), table);
          if (table.rows.length >= MAX_INPUT_ROWS) throw new InputTableError('INPUT_TABLE_ROW_LIMIT_EXCEEDED', 400, `At most ${MAX_INPUT_ROWS} rows per table.`);
          table.rows.push(structuredClone(row)); table.version++; table.updatedAt = nowIso();
          appendAudit(draft, table, principal.userId, 'row_added', { row: structuredClone(row) });
          return { row: structuredClone(row), version: table.version };
        });
        send(response, 201, result);
        return true;
      }

      if (rowMatch) {
        const verb = method(request, response, ['PATCH', 'DELETE']);
        const id = routeId(rowMatch[1]!), rowId = routeId(rowMatch[2]!);
        const current = this.findVisible(principal, id);
        this.requireEdit(principal, current);
        if (!current.rows.some(r => r.id === rowId)) throw new InputTableError('INPUT_TABLE_ROW_NOT_FOUND', 404, 'Row not found');
        if (verb === 'DELETE') {
          const result = await this.store.change(draft => {
            const table = draft.tables.find(t => t.id === id && t.namespaceId === principal.namespaceId);
            if (!table) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
            this.requireEdit(this.principal(identity), table);
            const index = table.rows.findIndex(r => r.id === rowId);
            if (index < 0) throw new InputTableError('INPUT_TABLE_ROW_NOT_FOUND', 404, 'Row not found');
            const [removed] = table.rows.splice(index, 1);
            table.version++; table.updatedAt = nowIso();
            appendAudit(draft, table, principal.userId, 'row_deleted', { row: structuredClone(removed!) });
            return { deleted: true, version: table.version };
          });
          send(response, 200, result);
          return true;
        }
        const raw = body(await readBody(request), ['values', 'expectedVersion']);
        if (!isObject(raw.values) || !Object.keys(raw.values).length) throw new InputTableError('INPUT_TABLE_INVALID_BODY', 400, 'values must be a non-empty object keyed by column name.');
        const expectedVersion = raw.expectedVersion;
        if (Object.hasOwn(raw, 'expectedVersion') && (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
          throw new InputTableError('INPUT_TABLE_INVALID_VERSION', 400, 'expectedVersion must be a positive safe integer.');
        }
        const patch = raw.values as Record<string, unknown>;
        const result = await this.store.change(draft => {
          const table = draft.tables.find(t => t.id === id && t.namespaceId === principal.namespaceId);
          if (!table) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
          this.requireEdit(this.principal(identity), table);
          const row = table.rows.find(r => r.id === rowId);
          if (!row) throw new InputTableError('INPUT_TABLE_ROW_NOT_FOUND', 404, 'Row not found');
          if (expectedVersion !== undefined && expectedVersion !== table.version) {
            throw new InputTableError('INPUT_TABLE_VERSION_CONFLICT', 412, 'Input table has changed. Reload the table before saving.');
          }
          // Merge and audit against the latest committed row, after any queued writes (#219).
          const merged = mergeRowPatch(table.columns, row.values, patch);
          // Validate each patched cell too so type errors keep their precise named codes.
          for (const col of table.columns) if (Object.hasOwn(patch, col.name)) validateCellValue(col, patch[col.name]);
          row.values = structuredClone(merged.values);
          table.version++; table.updatedAt = nowIso();
          appendAudit(draft, table, principal.userId, 'row_updated', { rowId, changes: merged.changes });
          return { row: structuredClone(row), version: table.version };
        });
        send(response, 200, result);
        return true;
      }

      if (auditMatch) {
        method(request, response, ['GET']);
        const pagination = auditPagination(query);
        const id = routeId(auditMatch[1]!);
        const state = this.store.read();
        const table = state.tables.find(t => t.id === id);
        const entries = state.audit.filter(a => a.tableId === id);
        if (table) {
          if (!canViewInputTable(principal, table)) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
        } else {
          // Deleted tables keep their audit trail (D-84): still namespace-scoped, never leaked.
          if (!entries.length || entries[0]!.namespaceId !== principal.namespaceId) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
        }
        const visible = entries.filter(a => a.namespaceId === principal.namespaceId);
        send(response, 200, pagination
          ? { entries: visible.slice(pagination.offset, pagination.offset + pagination.limit), total: visible.length, ...pagination }
          : { entries: visible });
        return true;
      }

      if (tableMatch) {
        const verb = method(request, response, ['GET', 'PATCH', 'DELETE']);
        const id = routeId(tableMatch[1]!);
        const current = this.findVisible(principal, id);
        if (verb === 'GET') { send(response, 200, this.full(principal, current)); return true; }
        if (verb === 'DELETE') {
          this.requireManage(principal, current);
          await this.store.change(draft => {
            const index = draft.tables.findIndex(t => t.id === id && t.namespaceId === principal.namespaceId);
            if (index < 0) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
            this.requireManage(this.principal(identity), draft.tables[index]!);
            const [removed] = draft.tables.splice(index, 1);
            appendAudit(draft, removed!, principal.userId, 'table_deleted', { name: removed!.name });
          });
          send(response, 200, { deleted: true });
          return true;
        }
        // PATCH: rename and/or boundDatasetId (canEdit). Column schema is FIXED after creation in v1.
        this.requireEdit(principal, current);
        const raw = body(await readBody(request), ['name', 'boundDatasetId']);
        if (!Object.hasOwn(raw, 'name') && !Object.hasOwn(raw, 'boundDatasetId')) throw new InputTableError('INPUT_TABLE_INVALID_BODY', 400, 'Provide name and/or boundDatasetId.');
        const name = Object.hasOwn(raw, 'name') ? validateTableName(raw.name) : undefined;
        const boundDatasetId = Object.hasOwn(raw, 'boundDatasetId') ? this.checkBoundDataset(identity, principal, raw.boundDatasetId) : undefined;
        const updated = await this.store.change(draft => {
          const table = draft.tables.find(t => t.id === id && t.namespaceId === principal.namespaceId);
          if (!table) throw new InputTableError('INPUT_TABLE_NOT_FOUND', 404, 'Input table not found');
          this.requireEdit(this.principal(identity), table);
          if (name !== undefined && name !== table.name) {
            appendAudit(draft, table, principal.userId, 'table_renamed', { oldValue: table.name, newValue: name });
            table.name = name;
          }
          if (boundDatasetId !== undefined && boundDatasetId !== table.boundDatasetId) {
            appendAudit(draft, table, principal.userId, 'bound_dataset_changed', { oldValue: table.boundDatasetId, newValue: boundDatasetId });
            table.boundDatasetId = boundDatasetId;
          }
          table.version++; table.updatedAt = nowIso();
          return structuredClone(table);
        });
        send(response, 200, this.full(principal, updated));
        return true;
      }

      throw new RequestError(404, 'Route not found');
    } catch (error) {
      if (error instanceof InputTableError) { request.resume(); send(response, error.status, { errorCode: error.code, Message: error.message }); return true; }
      if (error instanceof SecurityError) { request.resume(); send(response, error.status, { errorCode: error.code, Message: error.message }); return true; }
      if (error instanceof RequestError) { request.resume(); send(response, error.status, { Message: error.message }); return true; }
      throw error;
    }
  }

  private validateEditors(identity: Identity | undefined, principal: InputPrincipal, raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length > 256) throw new InputTableError('INPUT_TABLE_EDITORS_INVALID', 400, 'editors must be a list of at most 256 user ids.');
    const editors: string[] = [];
    for (const value of raw) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new InputTableError('INPUT_TABLE_EDITORS_INVALID', 400, 'editors must be user ids.');
      if (!editors.includes(value)) editors.push(value);
    }
    const known = this.deps.workspaceUserIds && identity ? new Set(this.deps.workspaceUserIds(identity)) : undefined;
    if (known) for (const editor of editors) if (!known.has(editor)) throw new InputTableError('INPUT_TABLE_EDITOR_NOT_IN_WORKSPACE', 400, `Editor is not a user in this workspace: ${editor}`);
    void principal;
    return editors;
  }
}
