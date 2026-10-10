import { Socket } from 'node:net';
import { Pool, type PoolConfig } from 'pg';
import { MetadataError, PostgresMetadataDatabase, type Database, type MetadataPool } from './metadata-db.js';
import { InvocationScope } from './runtime-scope.js';

type Client = Awaited<ReturnType<MetadataPool['connect']>>;
export interface OwnedPool extends MetadataPool { end(): Promise<void>; on(event: 'error', listener: (error: Error) => void): unknown }
export type PoolFactory = (config: PoolConfig) => OwnedPool;

/** Register sockets at construction, before pg's connect promise can hang. */
export class InvocationPool implements MetadataPool {
  readonly pool: OwnedPool;
  private readonly sockets = new Set<Socket>();
  private readonly socketClosures = new Set<Promise<void>>();
  private readonly clients = new Set<Client>();
  private closed = false;
  private ending?: Promise<void>;
  constructor(readonly scope: InvocationScope, config: PoolConfig, readonly connectMs = 3000, factory: PoolFactory = c => new Pool(c)) {
    scope.check();
    this.pool = factory({ ...config, max: 1, min: 0, idleTimeoutMillis: 0, keepAlive: false,
      connectionTimeoutMillis: Math.min(connectMs, scope.remaining()), statement_timeout: 2000, query_timeout: 2000,
      lock_timeout: 500, idle_in_transaction_session_timeout: 3000, options: '-c idle_session_timeout=5000',
      stream: () => {
        const socket = new Socket(); this.sockets.add(socket);
        const closed = new Promise<void>(resolve => socket.once('close', () => { this.sockets.delete(socket); resolve(); }));
        this.socketClosures.add(closed); void closed.then(() => this.socketClosures.delete(closed));
        if (this.closed || scope.signal.aborted) socket.destroy();
        return socket;
      } });
    this.pool.on('error', () => { this.force(); scope.controller.abort(); });
    scope.own(this);
  }
  force = (): void => { this.closed = true; for (const socket of this.sockets) socket.destroy(); };
  async connect(): Promise<Client> {
    this.scope.check();
    if (this.closed) throw new MetadataError('METADATA_TRANSACTION_CLOSED', 503);
    const client = await this.scope.stage(async () => {
      const client = await this.pool.connect();
      if (this.closed || this.scope.signal.aborted) { client.release(new Error('INVOCATION_CANCELLED')); throw new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503); }
      this.clients.add(client); return client;
    }, this.connectMs, this.force, 'SQL_CONNECT_TIMEOUT');
    let released = false;
    return {
      query: (sql, values) => this.scope.stage(() => client.query(sql, values), 2000, this.force, 'SQL_STATEMENT_TIMEOUT'),
      release: error => {
        if (released) return; released = true;
        if (!this.clients.delete(client)) return;
        // Do not retain an idle connection during compute, object or mail I/O.
        client.release(error ?? new Error('INVOCATION_TRANSACTION_COMPLETE'));
      },
    };
  }
  close(): Promise<void> {
    return this.ending ??= (async () => {
      this.closed = true;
      for (const client of this.clients) client.release(new Error('INVOCATION_COMPLETE'));
      this.clients.clear();
      this.force();
      await this.pool.end();
      await Promise.all([...this.socketClosures]);
      if (this.sockets.size) throw new MetadataError('INVOCATION_CLEANUP_FAILED', 503);
    })();
  }
}

export interface InvocationDatabases { membership: Database; tenant: Database }
export function invocationDatabases(scope: InvocationScope, env: NodeJS.ProcessEnv, connectMs = 3000, factory?: PoolFactory): InvocationDatabases {
  const operator = env.OPENSIGHT_POSTGRES_OPERATOR_URL, tenant = env.OPENSIGHT_POSTGRES_TENANT_URL, ca = env.OPENSIGHT_POSTGRES_CA;
  try {
    if (!operator || !tenant || !ca) throw Error();
    const a = new URL(operator), b = new URL(tenant);
    if (![a, b].every(u => ['postgres:', 'postgresql:'].includes(u.protocol) && u.username && u.password && !u.search && !u.hash)
      || a.host !== b.host || a.pathname !== b.pathname || a.username === b.username) throw Error();
  } catch { throw new MetadataError('RUNTIME_DATABASE_CONFIG_INVALID', 503); }
  const config = (connectionString: string): PoolConfig => ({ connectionString, ssl: { ca, rejectUnauthorized: true } });
  const membership = new InvocationPool(scope, config(operator!), connectMs, factory);
  const restricted = new InvocationPool(scope, config(tenant!), connectMs, factory);
  return { membership: new PostgresMetadataDatabase(membership), tenant: new PostgresMetadataDatabase(restricted, true) };
}
