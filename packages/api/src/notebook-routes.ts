import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeNotebookSql, NotebookSqlError, type PrepSource, type PrepMemoryTable } from '@opensight/query-engine';
import { method, send } from './automation-routes.js';
import { blazeLimits } from './blaze.js';
import { readBody, RequestError } from './query.js';
import { SecurityError, type Identity, type SecurityService } from './security.js';
import { NotebookStore, NotebookError, notebookFail, notebookObject, notebookAuthor, notebookBindings, validateNotebookContent, canViewNotebook, canEditNotebook, canManageNotebook, NOTEBOOK_RUN_RETENTION, NOTEBOOK_SNAPSHOT_LIMIT, type Notebook, type NotebookPrincipal, type NotebookRun, type NotebookSnapshot, type NotebookCellResult } from './notebooks.js';

export interface NotebookDependencies {
  security?: SecurityService; localIdentity?: Identity;
  sources(identity: Identity): Promise<PrepSource[]>;
  table(identity: Identity, ref: string): Promise<PrepMemoryTable>;
  /** Opaque fingerprint of current caller/security policy, never a client assertion. */
  accessStamp(identity: Identity): string;
}
const denial = () => new NotebookError('NOTEBOOK_DATASET_ACCESS_DENIED', 403, 'Every dataset must be accessible to the executing identity.');
export class NotebookRoutes {
  private busy = false;
  constructor(private readonly store: NotebookStore, private readonly deps: NotebookDependencies) {}
  private principal(identity?: Identity): NotebookPrincipal {
    if (this.deps.security && identity) return { ...identity, role: this.deps.security.user(identity).role };
    if (this.deps.localIdentity) return this.deps.localIdentity;
    throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', 'Notebooks need a local or authenticated organization API.');
  }
  private find(p: NotebookPrincipal, id: string, manage = false, state = this.store.read()): Notebook {
    const n = state.notebooks.find(n => n.id === id);
    if (!n || !(canViewNotebook(p, n) || manage && canManageNotebook(p, n))) notebookFail('NOTEBOOK_NOT_FOUND', 'Notebook not found.', 404);
    return n;
  }
  private summary(p: NotebookPrincipal, n: Notebook) {
    return { id: n.id, name: n.name, ownerId: n.ownerId, published: n.published, cellCount: n.cells.length, parameterCount: n.parameters.length, version: n.version, updatedAt: n.updatedAt, canEdit: canEditNotebook(p, n), canManage: canManageNotebook(p, n) };
  }
  private snapshotAllowed(p: NotebookPrincipal, s: NotebookSnapshot, accessible: ReadonlySet<string>, accessStamp: string): boolean {
    const notebook = this.store.read().notebooks.find(n => n.id === s.notebookId);
    return s.namespaceId === p.namespaceId && s.ownerId === p.userId && s.accessStamp === accessStamp && !!notebook && canViewNotebook(p, notebook) && s.datasetRefs.every(ref => accessible.has(ref));
  }
  private async sources(p: NotebookPrincipal) {
    this.principal(p);
    const sources = await this.deps.sources(p), ids = new Set(sources.map(s => s.id)), accessStamp = this.deps.accessStamp(p);
    const snapshots = this.store.read().snapshots.filter(s => this.snapshotAllowed(p, s, ids, accessStamp));
    return { sources: [...sources, ...snapshots.map(s => ({ id: s.id, table: s.id, connectorId: 'file' as const, security: 'unrestricted' as const, columns: s.columns, asOf: s.asOf }))], snapshots, accessStamp };
  }
  private async full(p: NotebookPrincipal, n: Notebook) {
    const { snapshots } = await this.sources(p);
    return { ...n, ...this.summary(p, n), snapshots: snapshots.filter(s => s.notebookId === n.id).map(s => this.snapshotSummary(s)) };
  }
  private snapshotSummary(s: NotebookSnapshot) { return { id: s.id, cellId: s.cellId, asOf: s.asOf, rowCount: s.rowCount, truncated: s.truncated, columns: s.columns }; }
  private async assertRefs(p: NotebookPrincipal, refs: readonly string[], expectedStamp?: string) {
    const available = await this.sources(p);
    if (expectedStamp !== undefined && expectedStamp !== available.accessStamp || refs.some(ref => !available.sources.some(s => s.id === ref))) throw denial();
    return available;
  }
  private async execute(p: NotebookPrincipal, n: Notebook, raw: Record<string, unknown>): Promise<NotebookRun> {
    const bindings = notebookBindings(n.parameters, raw.parameters === undefined ? {} : raw.parameters);
    if (raw.cellId !== undefined && (typeof raw.cellId !== 'string' || !n.cells.some(c => c.id === raw.cellId))) notebookFail('NOTEBOOK_CELL_NOT_FOUND', 'Cell not found.', 404);
    // One bounded notebook execution per local process, like the prep materializer.
    if (this.busy) notebookFail('NOTEBOOK_BUSY', 'Another notebook is running; retry shortly.', 409);
    this.busy = true;
    try {
      const run: NotebookRun = { id: randomUUID(), notebookId: n.id, namespaceId: p.namespaceId, executedBy: p.userId, notebookVersion: n.version, executedAt: new Date().toISOString(), accessStamp: this.deps.accessStamp(p), results: [] };
      for (const cell of n.cells.filter(c => raw.cellId === undefined || c.id === raw.cellId)) {
        const started = Date.now();
        const result: NotebookCellResult = { cellId: cell.id, kind: cell.kind, executedAt: new Date().toISOString(), elapsedMs: 0, datasetRefs: cell.kind === 'sql' ? cell.datasetRefs : [] };
        try {
          this.find(this.principal(p), n.id);
          if (cell.kind === 'sql') {
            const available = await this.assertRefs(p, cell.datasetRefs, run.accessStamp);
            const tables: PrepMemoryTable[] = [];
            for (const ref of cell.datasetRefs) {
              const snapshot = available.snapshots.find(s => s.id === ref);
              tables.push(snapshot ? { source: { id: ref, table: ref, connectorId: 'file', security: 'unrestricted', columns: snapshot.columns }, rowCount: snapshot.rowCount, value: (r, c) => snapshot.rows[r]![snapshot.columns[c]!.name]! } : await this.deps.table(p, ref));
            }
            // Store original source lineage so a saved snapshot never launders access.
            result.datasetRefs = [...new Set(cell.datasetRefs.flatMap(ref => available.snapshots.find(s => s.id === ref)?.datasetRefs ?? [ref]))];
            result.data = await executeNotebookSql(cell.text, cell.datasetRefs, bindings, tables, Math.min(100_000, blazeLimits().maxRows));
            await this.assertRefs(this.principal(p), result.datasetRefs, run.accessStamp);
          } else if (cell.kind === 'visual') {
            const source = run.results.find(r => r.cellId === cell.sourceCellId);
            result.sourceCellId = cell.sourceCellId;
            if (!source?.data || source.error) notebookFail('NOTEBOOK_DEPENDENCY_FAILED', 'The source SQL cell needs a successful result in this run.', 422);
            result.datasetRefs = source.datasetRefs;
          }
        } catch (e) {
          delete result.data;
          result.error = e instanceof NotebookError || e instanceof NotebookSqlError ? { code: e.code, message: e.message } : { code: 'NOTEBOOK_DATASET_ACCESS_DENIED', message: 'Dataset could not be materialized under the executing identity.' };
        }
        result.elapsedMs = Date.now() - started; run.results.push(result);
      }
      // Revalidate every successful result at the response/persistence boundary.
      for (const result of run.results) if (!result.error && result.datasetRefs.length) {
        try { await this.assertRefs(this.principal(p), result.datasetRefs, run.accessStamp); }
        catch { delete result.data; result.error = { code: 'NOTEBOOK_DATASET_ACCESS_DENIED', message: denial().message }; }
      }
      for (const result of run.results) if (result.sourceCellId && run.results.find(r => r.cellId === result.sourceCellId)?.error) result.error = { code: 'NOTEBOOK_DEPENDENCY_FAILED', message: 'The source SQL cell failed.' };
      await this.store.change(draft => {
        this.find(this.principal(p), n.id, false, draft);
        if (this.deps.accessStamp(p) !== run.accessStamp) throw denial();
        draft.runs.push(run);
        const retained = draft.runs.filter(r => r.notebookId === n.id).slice(-NOTEBOOK_RUN_RETENTION);
        draft.runs = draft.runs.filter(r => r.notebookId !== n.id || retained.includes(r));
      });
      return run;
    } finally { this.busy = false; }
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity?: Identity): Promise<void> {
    try {
      if (query) notebookFail('NOTEBOOK_INVALID_BODY', 'Query parameters are not supported.');
      const p = this.principal(identity);
      if (path === '/api/notebooks/datasets') {
        method(request, response, ['GET']);
        send(response, 200, { datasets: (await this.sources(p)).sources.map(s => ({ id: s.id, columns: s.columns, ...('asOf' in s ? { asOf: s.asOf } : {}) })) }); return;
      }
      if (path === '/api/notebooks') {
        const verb = method(request, response, ['GET', 'POST']);
        if (verb === 'GET') { send(response, 200, { notebooks: this.store.read().notebooks.filter(n => canViewNotebook(p, n)).map(n => this.summary(p, n)), canCreate: notebookAuthor(p) }); return; }
        if (!notebookAuthor(p)) notebookFail('NOTEBOOK_AUTHOR_REQUIRED', 'Author capability required.', 403);
        const content = validateNotebookContent(await readBody(request)), now = new Date().toISOString();
        const n: Notebook = { ...content, id: randomUUID(), namespaceId: p.namespaceId, ownerId: p.userId, version: 1, createdAt: now, updatedAt: now };
        await this.store.change(draft => { if (!notebookAuthor(this.principal(p))) notebookFail('NOTEBOOK_AUTHOR_REQUIRED', 'Author capability required.', 403); draft.notebooks.push(n); });
        send(response, 201, await this.full(p, n)); return;
      }
      const match = /^\/api\/notebooks\/([A-Za-z0-9_-]{1,128})(?:\/(run|runs)|\/cells\/([A-Za-z0-9_-]{1,128})\/(snapshot))?$/.exec(path);
      if (!match) notebookFail('NOTEBOOK_NOT_FOUND', 'Notebook route not found.', 404);
      const id = match[1]!, action = match[2] ?? match[4];
      const n = this.find(p, id, !action && ['PATCH', 'DELETE'].includes(request.method ?? ''));
      if (action === 'run') {
        method(request, response, ['POST']);
        const run = await this.execute(p, n, notebookObject(await readBody(request), ['parameters', 'cellId']));
        const { accessStamp: _stamp, ...visible } = run; send(response, 200, visible); return;
      }
      if (action === 'runs') {
        method(request, response, ['GET']);
        const runs = [];
        for (const run of this.store.read().runs.filter(r => r.notebookId === id).reverse()) {
          const { accessStamp: _stamp, results, ...metadata } = run;
          let permitted = run.executedBy === p.userId;
          if (permitted) try { await this.assertRefs(p, [...new Set(results.flatMap(r => r.datasetRefs))], run.accessStamp); } catch { permitted = false; }
          runs.push({ ...metadata, ...(permitted ? { results } : { resultsRedacted: true }) });
        }
        send(response, 200, { runs }); return;
      }
      if (action === 'snapshot') {
        method(request, response, ['POST']); notebookObject(await readBody(request), []);
        if (!notebookAuthor(p)) notebookFail('NOTEBOOK_AUTHOR_REQUIRED', 'Saving a dataset snapshot requires author capability.', 403);
        const cellId = match[3]!;
        if (!n.cells.some(c => c.id === cellId && c.kind === 'sql')) notebookFail('NOTEBOOK_CELL_NOT_FOUND', 'SQL cell not found.', 404);
        const run = this.store.read().runs.filter(r => r.notebookId === id && r.executedBy === p.userId && r.notebookVersion === n.version && r.results.some(c => c.cellId === cellId && c.data && !c.error)).at(-1);
        const result = run?.results.find(r => r.cellId === cellId);
        if (!run || !result?.data) notebookFail('NOTEBOOK_RESULT_REQUIRED', 'Run this SQL cell successfully under your identity before saving a snapshot.', 409);
        await this.assertRefs(p, result.datasetRefs, run.accessStamp);
        const snapshot: NotebookSnapshot = { ...result.data, id: `snapshot-${randomUUID()}`, notebookId: id, cellId, runId: run.id, namespaceId: p.namespaceId, ownerId: p.userId, asOf: result.executedAt, datasetRefs: result.datasetRefs, accessStamp: run.accessStamp };
        await this.store.change(draft => {
          const current = this.find(this.principal(p), id, false, draft);
          if (!notebookAuthor(this.principal(p))) notebookFail('NOTEBOOK_AUTHOR_REQUIRED', 'Author capability required.', 403);
          if (this.deps.accessStamp(p) !== run.accessStamp) throw denial();
          if (current.version !== n.version) notebookFail('NOTEBOOK_VERSION_CONFLICT', 'Notebook changed; rerun before saving.', 409);
          if (draft.snapshots.filter(s => s.notebookId === id).length >= NOTEBOOK_SNAPSHOT_LIMIT) notebookFail('NOTEBOOK_SNAPSHOT_LIMIT_EXCEEDED', 'At most 100 snapshots per notebook.', 409);
          draft.snapshots.push(snapshot);
        });
        send(response, 201, this.snapshotSummary(snapshot)); return;
      }
      const verb = method(request, response, ['GET', 'PATCH', 'DELETE']);
      if (verb === 'GET') { send(response, 200, await this.full(p, n)); return; }
      if (verb === 'DELETE') {
        if (!canManageNotebook(p, n)) notebookFail('NOTEBOOK_MANAGE_REQUIRED', 'Only the owner or workspace administrator can delete.', 403);
        await this.store.change(draft => {
          if (!canManageNotebook(this.principal(p), this.find(p, id, true, draft))) notebookFail('NOTEBOOK_MANAGE_REQUIRED', 'Manage permission required.', 403);
          draft.notebooks = draft.notebooks.filter(n => n.id !== id); draft.runs = draft.runs.filter(r => r.notebookId !== id); draft.snapshots = draft.snapshots.filter(s => s.notebookId !== id);
        }); send(response, 200, { deleted: true }); return;
      }
      if (!canEditNotebook(p, n)) notebookFail('NOTEBOOK_EDIT_REQUIRED', 'Owner or administrator and author capability required.', 403);
      const raw = notebookObject(await readBody(request), ['name', 'published', 'parameters', 'cells', 'version']);
      const updated = await this.store.change(draft => {
        const current = this.find(this.principal(p), id, true, draft);
        if (!canEditNotebook(this.principal(p), current)) notebookFail('NOTEBOOK_EDIT_REQUIRED', 'Author and edit permission required.', 403);
        if (raw.version !== current.version) notebookFail('NOTEBOOK_VERSION_CONFLICT', 'Reload the notebook before saving.', 409);
        Object.assign(current, validateNotebookContent({ name: raw.name === undefined ? current.name : raw.name, published: raw.published === undefined ? current.published : raw.published, parameters: raw.parameters === undefined ? current.parameters : raw.parameters, cells: raw.cells === undefined ? current.cells : raw.cells }), { version: current.version + 1, updatedAt: new Date().toISOString() });
        return current;
      });
      send(response, 200, await this.full(p, updated));
    } catch (e) {
      request.resume();
      if (e instanceof NotebookError || e instanceof SecurityError) { send(response, e.status, { errorCode: e.code, Message: e.message }); return; }
      if (e instanceof RequestError) { send(response, e.status, { errorCode: 'NOTEBOOK_INVALID_BODY', Message: e.message }); return; }
      throw e;
    }
  }
}
