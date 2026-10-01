import { resolveSecurity, planSourceRead, planPreparedQuery, queryPrepared, streamSourcePostgres, streamSourceMemory,
  type SecurityContext, type RowPredicate, type SourceRead, type PrepSource, type PrepMemoryTable, type InteractiveQuery } from '@opensight/query-engine';
import { HostedSources, type HostedSource } from './hosted-sources.js';
import { boundColumns, sourceCredentials, sourceError } from './source-schema.js';
import { type TenantContext, type Revisions } from './metadata.js';
import { object } from './metadata-resources.js';
import { BlazeStore, BlazeTable, BlazeError } from './blaze.js';
import { validateQuery } from './query.js';
import { MetadataError } from './metadata-db.js';

export type DataPath = 'discovery' | 'query' | 'preview' | 'output' | 'ai' | 'prep';
export interface Admission {
  source: HostedSource; security: SecurityContext; physical: PrepSource;
  tenantPredicate?: RowPredicate; deniedColumns: string[]; revisions: Revisions;
}
/** Every hosted data path enters here, before payload/connector/cache I/O. */
export class HostedData {
  readonly blaze = new BlazeStore();
  private readonly cacheRevisions = new Map<string, string>();
  constructor(readonly sources: HostedSources, private readonly postgres = streamSourcePostgres) {}
  async admit(context: TenantContext, id: string, path: DataPath): Promise<Admission> {
    const revisions = await this.sources.metadata.revisions(context);
    await this.sources.capability(context, path === 'ai' ? 'ai' : path === 'prep' ? 'build' : 'view');
    const source = await this.sources.get(context, id), b = source.binding;
    const endpoint = b.endpointId ? this.sources.endpoint(b.endpointId) : undefined;
    const tenantPredicate: RowPredicate | undefined = endpoint?.tenantColumn ? { column: endpoint.tenantColumn, operator: 'eq', value: context.tenantId } : undefined;
    const protectedData = source.policy.rowLevel || !!source.policy.protectedColumns?.length || !!tenantPredicate;
    if (path === 'prep' && protectedData) sourceError('PREP_SECURITY_REJECTED', 403);
    const users = await this.sources.metadata.list(context, 'user'), groups = await this.sources.metadata.list(context, 'group');
    const security: SecurityContext = { namespaceId: context.namespaceId, userId: context.userId,
      users: users.map(u => ({ id: u.id, namespaceId: context.namespaceId })),
      groups: groups.map(g => ({ id: g.id, namespaceId: context.namespaceId, userIds: g.body.userIds as string[] })),
      policy: { ...source.policy, namespaceId: context.namespaceId, dataSetArn: `urn:opensight:source:${source.id}` } };
    const resolved = resolveSecurity(security, boundColumns(b.columns), security.policy.dataSetArn);
    const physical: PrepSource = { id, connectorId: b.connectorId, columns: b.columns, table: b.table ?? 'source_rows', ...(b.schema ? { schema: b.schema } : {}), security: protectedData ? 'protected' : 'unrestricted' };
    const admission = { source, security, physical, ...(tenantPredicate ? { tenantPredicate } : {}), deniedColumns: resolved.deniedColumns, revisions };
    // Validate the immutable predicate even on schema/discovery paths.
    planSourceRead(this.read(admission), this.blaze.limits, 'postgres');
    await this.finish(context, [admission]);
    return admission;
  }
  async finish(context: TenantContext, admissions: readonly Admission[], expected?: Revisions): Promise<void> {
    for (const a of admissions) { this.sources.active(a.source); await this.sources.metadata.assertRevisions(context, a.revisions); }
    if (expected) await this.sources.metadata.assertRevisions(context, expected);
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
      await this.postgres(raw, await this.connection(context, a), this.blaze.limits, table);
    } else {
      const payload = object(await this.sources.payload(context, a.source), ['rows']);
      if (!Array.isArray(payload.rows) || payload.rows.length !== a.source.binding.rowCount) sourceError('SOURCE_PAYLOAD_INVALID', 503);
      await this.finish(context, [a]);
      table.start(a.source.binding.columns);
      for (const row of payload.rows) {
        if (!Array.isArray(row) || row.length !== table.columns.length || row.some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) sourceError('SOURCE_PAYLOAD_INVALID', 503);
        table.row(row);
      }
    }
    await this.finish(context, [a]);
  }
  async refresh(context: TenantContext, id: string) {
    await this.sources.capability(context, 'build');
    const a = await this.admit(context, id, 'query'), key = this.key(context, id);
    this.blaze.configure(key, { mode: 'BLAZE', intervalMinutes: null }); this.cacheRevisions.delete(key);
    await this.blaze.refresh(key, table => this.raw(context, a, table));
    await this.finish(context, [a]); this.cacheRevisions.set(key, this.stamp(a));
    // Raw counts, sizes and provenance never leave this boundary.
    return { mode: 'BLAZE', state: 'ready' };
  }
  async table(context: TenantContext, a: Admission, columns: readonly string[], mode: 'DIRECT_QUERY' | 'BLAZE' = 'DIRECT_QUERY'): Promise<BlazeTable> {
    const read = this.read(a, [...columns]);
    planSourceRead(read, this.blaze.limits, 'postgres'); // CLS and schema before secret or cache access.
    await this.finish(context, [a]);
    const result = new BlazeTable(this.blaze.limits);
    if (mode === 'BLAZE') {
      const key = this.key(context, a.source.id);
      if (this.cacheRevisions.get(key) !== this.stamp(a)) { this.blaze.invalidate(key); throw new BlazeError('BLAZE_NOT_READY', 'Source or policy changed; refresh required'); }
      const { table } = this.blaze.read(key);
      await streamSourceMemory(read, this.memory(a, table), this.blaze.limits, result);
    } else if (a.source.binding.connectorId === 'postgresql') await this.postgres(read, await this.connection(context, a), this.blaze.limits, result);
    else {
      const raw = new BlazeTable(this.blaze.limits); await this.raw(context, a, raw);
      await streamSourceMemory(read, this.memory(a, raw), this.blaze.limits, result);
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
    const limit = raw.limit ?? (path === 'preview' ? 100 : this.blaze.limits.maxRows);
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > this.blaze.limits.maxRows) sourceError('SOURCE_LIMIT_INVALID');
    const table = await this.table(context, a, columns as string[], mode);
    const result = query ? queryPrepared(table.columns, table.rowCount, table.value, query) : { columns: table.columns, rows: table.rows(Number(limit)), rowCount: table.rowCount, truncated: table.rowCount > Number(limit) };
    await this.finish(context, [a]); return result;
  }
}
