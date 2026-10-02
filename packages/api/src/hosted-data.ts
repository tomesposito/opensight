import { setImmediate as yieldTurn } from 'node:timers/promises';
import { TenantBudgets, type WorkScope } from './budgets.js';
import { HostedCache } from './hosted-cache.js';
import { containedWork, wireTable, type TableResult, type QueryResult } from './contained-work.js';
import { resolveSecurity, planSourceRead, planPreparedQuery, streamSourcePostgres,
  type SecurityContext, type RowPredicate, type SourceRead, type PrepSource, type PrepMemoryTable, type InteractiveQuery } from '@opensight/query-engine';
import { HostedSources, type HostedSource } from './hosted-sources.js';
import { boundColumns, sourceCredentials, sourceError } from './source-schema.js';
import { type TenantContext, type Revisions } from './metadata.js';
import { object } from './metadata-resources.js';
import { BlazeTable } from './blaze.js';
import { validateQuery } from './query.js';
import { MetadataError } from './metadata-db.js';

export type DataPath = 'discovery' | 'query' | 'preview' | 'output' | 'ai' | 'prep';
export interface Admission {
  source: HostedSource; security: SecurityContext; physical: PrepSource;
  tenantPredicate?: RowPredicate; deniedColumns: string[]; revisions: Revisions;
}
/** Every hosted data path enters here, before payload/connector/cache I/O. */
export class HostedData {
  readonly cache?: HostedCache;
  private readonly verifiers = new WeakMap<TenantContext, () => Promise<void>>();
  private readonly signals = new WeakMap<TenantContext, AbortSignal>();
  private readonly admitted = new WeakMap<TenantContext, Set<Admission>>();
  begin(context: TenantContext, signal?: AbortSignal, verify?: () => Promise<void>): void { if (verify) this.verifiers.set(context, verify); this.admitted.set(context, new Set()); if (signal) this.signals.set(context, signal); }
  async publication(context: TenantContext, revisions: Revisions): Promise<void> { await this.finish(context, [...this.admitted.get(context) ?? []], revisions); }
  constructor(readonly sources: HostedSources, private readonly postgres = streamSourcePostgres, readonly budgets?: TenantBudgets) { if (budgets) this.cache = new HostedCache(budgets); }
  scope(context: TenantContext): WorkScope {
    this.sources.metadata.assertContext(context);
    if (!this.budgets) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
    return this.budgets.current(context);
  }
  limits(context: TenantContext) {
    this.sources.metadata.assertContext(context);
    const l = this.budgets?.limits(context.tenantId);
    if (!l) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
    return { maxRows: l.sourceRows, cellChars: l.cellChars, datasetBytes: l.workingBytes, maxBytes: l.cacheBytes };
  }
  async work<T>(context: TenantContext, refresh: boolean, admissions: readonly Admission[], run: () => Promise<T>, revisions?: Revisions): Promise<T> {
    if (!this.budgets) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
    return this.budgets.run(context, refresh, async () => { await this.verifiers.get(context)?.(); await this.finish(context, admissions, revisions); }, async () => {
      const result = await run(); const scope = this.scope(context);
      if (Buffer.byteLength(JSON.stringify(result)) > scope.limits.resultBytes) throw new MetadataError('TENANT_BUDGET_EXCEEDED', 429);
      scope.check(); return result;
    }, this.signals.get(context));
  }
  sink(context: TenantContext, table: BlazeTable, source = false) {
    const scope = this.scope(context);
    return {
      start: (columns: Parameters<BlazeTable['start']>[0]) => { scope.check(); const bytes = table.bytes; table.start(columns); scope.memory(table.bytes - bytes + 256); },
      row: (values: Parameters<BlazeTable['row']>[0]) => { scope.check(); if (source) scope.rows(1); const bytes = table.bytes; table.row(values); scope.memory(table.bytes - bytes); },
      oversized: (): never => table.oversized(),
    };
  }
  async computeQuery(context: TenantContext, table: BlazeTable, query: InteractiveQuery) {
    const scope = this.scope(context);
    const source: PrepSource = { id: 'result', connectorId: 'file', table: 'result', columns: table.columns, security: 'unrestricted' };
    return containedWork<QueryResult>(scope, { kind: 'query', table: await wireTable(scope, table, source), query }, this.limits(context));
  }
  async upload(context: TenantContext, input: unknown) {
    await this.sources.capability(context, 'build');
    if (!this.budgets) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
    // Upload commits invalidate its own revision-bound session; verify before the atomic write.
    let committed = false;
    return this.budgets.run(context, false, async () => {
      await this.sources.capability(context, 'build'); if (!committed) await this.verifiers.get(context)?.();
    }, async () => {
      const result = await this.sources.upload(context, input, async request => {
        const scope = this.scope(context); scope.memory(request.data.byteLength);
        const parsed = await containedWork<TableResult>(scope, { kind: 'upload', request }, this.limits(context));
        scope.rows(parsed.rows.length); scope.memory(Buffer.byteLength(JSON.stringify(parsed)));
        await this.verifiers.get(context)?.(); scope.check(); return parsed;
      });
      committed = true; return result;
    }, this.signals.get(context));
  }
  async admit(context: TenantContext, id: string, path: DataPath, embedSecurity?: (security: SecurityContext) => SecurityContext): Promise<Admission> {
    const revisions = await this.sources.metadata.revisions(context);
    await this.sources.capability(context, path === 'ai' ? 'ai' : path === 'prep' ? 'build' : 'view');
    const source = await this.sources.get(context, id), b = source.binding;
    const endpoint = b.endpointId ? this.sources.endpoint(b.endpointId) : undefined;
    const tenantPredicate: RowPredicate | undefined = endpoint?.tenantColumn ? { column: endpoint.tenantColumn, operator: 'eq', value: context.tenantId } : undefined;
    const protectedData = source.policy.rowLevel || !!source.policy.protectedColumns?.length || !!tenantPredicate;
    if (path === 'prep' && protectedData) sourceError('PREP_SECURITY_REJECTED', 403);
    const users = await this.sources.metadata.list(context, 'user'), groups = await this.sources.metadata.list(context, 'group');
    let security: SecurityContext = { namespaceId: context.namespaceId, userId: context.userId,
      users: users.map(u => ({ id: u.id, namespaceId: context.namespaceId })),
      groups: groups.map(g => ({ id: g.id, namespaceId: context.namespaceId, userIds: g.body.userIds as string[] })),
      policy: { ...source.policy, namespaceId: context.namespaceId, dataSetArn: `urn:opensight:source:${source.id}` } };
    if (embedSecurity) security = embedSecurity(security);
    const resolved = resolveSecurity(security, boundColumns(b.columns), security.policy.dataSetArn);
    const physical: PrepSource = { id, connectorId: b.connectorId, columns: b.columns, table: b.table ?? 'source_rows', ...(b.schema ? { schema: b.schema } : {}), security: protectedData ? 'protected' : 'unrestricted' };
    const admission = { source, security, physical, ...(tenantPredicate ? { tenantPredicate } : {}), deniedColumns: resolved.deniedColumns, revisions };
    // Validate the immutable predicate even on schema/discovery paths.
    planSourceRead(this.read(admission), this.limits(context), 'postgres');
    await this.finish(context, [admission]);
    this.admitted.get(context)?.add(admission);
    return admission;
  }
  async finish(context: TenantContext, admissions: readonly Admission[], expected?: Revisions): Promise<void> {
    for (const a of admissions) await this.sources.metadata.assertRevisions(context, a.revisions);
    if (expected) await this.sources.metadata.assertRevisions(context, expected);
    for (const a of admissions) this.sources.active(a.source);
  }
  read(a: Admission, columns = a.physical.columns.filter(c => !a.deniedColumns.includes(c.name)).map(c => c.name)): SourceRead {
    return { source: a.physical, security: a.security, columns, ...(a.tenantPredicate ? { tenantPredicate: a.tenantPredicate } : {}) };
  }
  async discover(context: TenantContext, path: 'discovery' | 'ai' = 'discovery') {
    const revisions = await this.sources.metadata.revisions(context);
    await this.sources.capability(context, path === 'ai' ? 'ai' : 'view');
    const results = [];
    for (const r of await this.sources.metadata.list(context, 'source')) {
      if (r.ownerId !== context.userId) continue;
      try {
        const a = await this.admit(context, r.id, path);
        results.push({ id: r.id, version: r.version, connectorId: a.source.binding.connectorId, available: true,
          columns: a.physical.columns.filter(c => !a.deniedColumns.includes(c.name)), ...(a.source.binding.expiresAt ? { expiresAt: a.source.binding.expiresAt } : {}) });
      } catch (error) {
        if (!(error instanceof MetadataError) && !(error instanceof Error && 'code' in error)) throw error;
        const code = String((error as { code: unknown }).code);
        if (!['SOURCE_RETIRED', 'UPLOAD_EXPIRED', 'ROW_ACCESS_DENIED', 'SOURCE_POLICY_REQUIRED', 'SOURCE_ENDPOINT_DENIED', 'SOURCE_MIGRATION_REQUIRED'].includes(code)) throw error;
        results.push({ id: r.id, available: false, columns: [], errorCode: code });
      }
    }
    await this.sources.metadata.assertRevisions(context, revisions);
    return results;
  }
  async schema(context: TenantContext, id: string, path: 'discovery' | 'ai' = 'discovery') {
    const a = await this.admit(context, id, path);
    const result = { id, version: a.source.version, connectorId: a.source.binding.connectorId, columns: a.physical.columns.filter(c => !a.deniedColumns.includes(c.name)) };
    await this.finish(context, [a]); return result;
  }
  private key(context: TenantContext, id: string): string { return JSON.stringify([context.tenantId, context.namespaceId, context.userId, 'source', id]); }
  private stamp(a: Admission): string { return JSON.stringify([a.source.version, a.revisions]); }
  private memory(a: Admission, table: BlazeTable): PrepMemoryTable {
    return { source: { ...a.physical, connectorId: 'file', schema: undefined, table: 'source_rows' }, rowCount: table.rowCount, value: table.value };
  }
  private async connection(context: TenantContext, a: Admission) {
    const endpoint = this.sources.endpoint(a.source.binding.endpointId!);
    const credentials = sourceCredentials(await this.sources.payload(context, a.source));
    await this.finish(context, [a]);
    return { host: endpoint.host, port: endpoint.port, database: endpoint.database, ssl: endpoint.tls ? { rejectUnauthorized: true as const } : false as const,
      user: credentials.username, password: credentials.password };
  }
  /** Raw leaf snapshots stay internal and owner-scoped; prepared protected snapshots are forbidden. */
  private async raw(context: TenantContext, a: Admission, table: BlazeTable): Promise<void> {
    if (a.source.binding.connectorId === 'postgresql') {
      const raw: SourceRead = { source: a.physical, columns: a.physical.columns.map(c => c.name), security: { ...a.security,
        policy: { namespaceId: context.namespaceId, dataSetArn: a.security.policy.dataSetArn, rowLevel: false, rowRules: [] } }, ...(a.tenantPredicate ? { tenantPredicate: a.tenantPredicate } : {}) };
      await this.postgres(raw, await this.connection(context, a), this.limits(context), this.sink(context, table, true), this.scope(context));
    } else {
      const payload = object(await this.sources.payload(context, a.source), ['rows']);
      if (!Array.isArray(payload.rows) || payload.rows.length !== a.source.binding.rowCount) sourceError('SOURCE_PAYLOAD_INVALID', 503);
      await this.finish(context, [a]);
      const sink = this.sink(context, table, true); sink.start(a.source.binding.columns);
      for (const [index, row] of payload.rows.entries()) {
        if (index % 256 === 0) { await yieldTurn(); this.scope(context).check(); }
        if (!Array.isArray(row) || row.length !== table.columns.length || row.some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) sourceError('SOURCE_PAYLOAD_INVALID', 503);
        sink.row(row);
      }
    }
    await this.finish(context, [a]);
  }
  async refresh(context: TenantContext, id: string) {
    await this.sources.capability(context, 'build');
    const a = await this.admit(context, id, 'query'), key = this.key(context, id);
    return this.work(context, true, [a], async () => {
      const scope = this.scope(context);
      await this.cache!.refresh(scope, key, this.stamp(a), async () => {
        const table = new BlazeTable(this.limits(context)); await this.raw(context, a, table);
        await this.finish(context, [a]); scope.check(); return table;
      });
      return { mode: 'BLAZE', state: 'ready' };
    });
  }
  async table(context: TenantContext, a: Admission, columns: readonly string[], mode: 'DIRECT_QUERY' | 'BLAZE' = 'DIRECT_QUERY'): Promise<BlazeTable> {
    const scope = this.scope(context);
    const read = this.read(a, [...columns]);
    planSourceRead(read, this.limits(context), 'postgres'); // CLS and schema before secret or cache access.
    await this.finish(context, [a]);
    const result = new BlazeTable(this.limits(context));
    if (mode === 'DIRECT_QUERY' && a.source.binding.connectorId === 'postgresql') {
      await this.postgres(read, await this.connection(context, a), this.limits(context), this.sink(context, result, true), scope);
    } else {
      let table: BlazeTable;
      if (mode === 'BLAZE') {
        table = this.cache!.read(scope, this.key(context, a.source.id), this.stamp(a)); scope.rows(table.rowCount);
      } else { table = new BlazeTable(this.limits(context)); await this.raw(context, a, table); }
      const computed = await containedWork<TableResult>(scope, { kind: 'source', read,
        table: await wireTable(scope, table, this.memory(a, table).source) }, this.limits(context));
      const sink = this.sink(context, result); sink.start(computed.columns);
      for (const [i, row] of computed.rows.entries()) { if (i % 256 === 0) await yieldTurn(); sink.row(row); }
    }
    await this.finish(context, [a]); return result;
  }
  async execute(context: TenantContext, id: string, path: 'query' | 'preview' | 'output', input: unknown) {
    const raw = object(structuredClone(input), path === 'query' ? ['query', 'mode'] : ['columns', 'mode', 'limit']);
    const mode = raw.mode ?? 'DIRECT_QUERY';
    if (mode !== 'DIRECT_QUERY' && mode !== 'BLAZE') sourceError('SOURCE_EXECUTION_INVALID');
    const a = await this.admit(context, id, path);
    let query: InteractiveQuery | undefined;
    if (path === 'query') { query = validateQuery(raw.query); planPreparedQuery(a.physical.columns, query, a.security); }
    const columns = raw.columns === undefined ? this.read(a).columns : raw.columns;
    if (!Array.isArray(columns) || columns.some(c => typeof c !== 'string')) sourceError('SOURCE_COLUMNS_INVALID');
    const limit = raw.limit ?? (path === 'preview' ? Math.min(100, this.limits(context).maxRows) : this.limits(context).maxRows);
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > this.limits(context).maxRows) sourceError('SOURCE_LIMIT_INVALID');
    planSourceRead(this.read(a, columns as string[]), this.limits(context), 'postgres');
    return this.work(context, false, [a], async () => {
      const table = await this.table(context, a, columns as string[], mode);
      const result = query ? await this.computeQuery(context, table, query) : { columns: table.columns, rows: table.rows(Number(limit)), rowCount: table.rowCount, truncated: table.rowCount > Number(limit) };
      await this.finish(context, [a]); return result;
    });
  }
}
