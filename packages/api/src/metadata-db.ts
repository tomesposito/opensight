import { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;
export interface SqlConnection { query(sql: string, values?: readonly SqlValue[]): Promise<SqlRow[]> }
export interface Database {
  transaction<T>(work: (connection: SqlConnection) => Promise<T>, scope?: { tenantId: string; namespaceId: string }): Promise<T>;
  close(): Promise<void>;
}

/** No driver dependency: an existing pg Pool satisfies this interface. */
export interface MetadataPool {
  connect(): Promise<{
    query(sql: string, values?: unknown[]): Promise<{ rows: SqlRow[] }>;
    release(error?: Error): void;
  }>;
}

export class MetadataError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function missing(): never { throw new MetadataError('RESOURCE_NOT_FOUND', 404); }

export function constraintError(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['23505', '40001', '40P01'].includes(code)) throw new MetadataError('METADATA_CONFLICT');
  if (['23503', '23514', '23502'].includes(code)) throw new MetadataError('METADATA_REFERENCE_INVALID');
  if (code.startsWith('ERR_SQLITE')) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|locked|busy/.test(message)) throw new MetadataError('METADATA_CONFLICT');
    if (/FOREIGN KEY|CHECK|NOT NULL/.test(message)) throw new MetadataError('METADATA_REFERENCE_INVALID');
  }
  throw error;
}

/** SQLite is the zero-service development adapter. A transaction never escapes its callback. */
export class SqliteMetadataDatabase implements Database {
  readonly #db: DatabaseSync;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  }
  transaction<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => {
      let active = false;
      const connection: SqlConnection = { query: async (sql, values = []) => {
        if (!active) throw new MetadataError('METADATA_TRANSACTION_CLOSED');
        return this.#db.prepare(sql).all(...values) as SqlRow[];
      } };
      try {
        this.#db.exec('BEGIN IMMEDIATE'); active = true;
        const value = await work(connection);
        this.#db.exec('COMMIT'); active = false;
        return value;
      } catch (error) {
        if (active) this.#db.exec('ROLLBACK');
        constraintError(error);
      } finally { active = false; }
    });
    this.#tail = result.catch(() => {});
    return result;
  }
  async close(): Promise<void> { await this.#tail; this.#db.close(); }
}

/** Use a separate owner/operator pool and a non-owner, NOBYPASSRLS tenant pool. */
export class PostgresMetadataDatabase implements Database {
  constructor(private readonly pool: MetadataPool, private readonly tenantRole = false) {}
  async transaction<T>(work: (connection: SqlConnection) => Promise<T>, scope?: { tenantId: string; namespaceId: string }): Promise<T> {
    if (this.tenantRole && !scope) throw new MetadataError('TENANT_CONTEXT_REQUIRED', 401);
    const client = await this.pool.connect();
    let active = false, discard: Error | undefined;
    try {
      await client.query('RESET ALL');
      if (this.tenantRole) {
        const { rows } = await client.query(`SELECT 1 AS unsafe FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
          UNION ALL SELECT 1 FROM pg_class WHERE relname LIKE 'h1_%' AND pg_has_role(current_user, relowner, 'MEMBER')`);
        if (rows.length) throw new MetadataError('METADATA_UNSAFE_DATABASE_ROLE', 503);
      }
      await client.query('BEGIN'); active = true;
      if (scope) await client.query("SELECT set_config('opensight.tenant_id', $1, true), set_config('opensight.namespace_id', $2, true)", [scope.tenantId, scope.namespaceId]);
      const connection: SqlConnection = { query: async (sql, values = []) => {
        if (!active) throw new MetadataError('METADATA_TRANSACTION_CLOSED');
        let position = 0;
        return (await client.query(sql.replace(/\?/g, () => `$${++position}`), [...values])).rows;
      } };
      const result = await work(connection);
      await client.query('COMMIT'); active = false;
      return result;
    } catch (error) {
      if (active) try { await client.query('ROLLBACK'); } catch { discard = new Error('Metadata rollback failed'); }
      return constraintError(error);
    } finally {
      active = false;
      try { await client.query('RESET ALL'); } catch { discard = new Error('Metadata context reset failed'); }
      client.release(discard);
    }
  }
  async close(): Promise<void> { /* Caller owns the pools. */ }
}
