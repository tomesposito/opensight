import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand, type RDSClientConfig } from '@aws-sdk/client-rds';
import { ConnectorError, connectorDefinition, validateConnectorConfig, type ConnectorConfig } from './connectors.js';
import { ExecutionCancelledError } from './prep-stream.js';

export type RdsDiscoveryErrorCode = 'RDS_ACCESS_DENIED' | 'RDS_REQUEST_FAILED' | 'RDS_INVALID_RESPONSE' | 'RDS_LIMIT_EXCEEDED' | 'RDS_TIMEOUT';
export class RdsDiscoveryError extends Error {
  constructor(readonly code: RdsDiscoveryErrorCode) { super(code); this.name = 'RdsDiscoveryError'; }
}
/** Real SDK command boundary; no transport or credential-provider imitation in tests. */
export interface RdsDiscoveryClient {
  send(command: DescribeDBInstancesCommand | DescribeDBClustersCommand, options: { abortSignal: AbortSignal }): Promise<{
    DBInstances?: unknown; DBClusters?: unknown; Marker?: string;
  }>;
  destroy(): void;
}
export interface RdsDiscoveryOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  clientFactory?: (config: RDSClientConfig) => RdsDiscoveryClient;
  signal?: AbortSignal;
  /** May lower the hard 30-second discovery deadline. */
  timeoutMs?: number;
}
/**
 * One discovered database. Endpoints and identifiers only: the RDS API also
 * returns master usernames and other account detail, and none of it is ever
 * copied into a discovery result. Credentials are never discovered; a source
 * created from a result stores environment variable names (see rdsSourceConfig).
 */
export interface DiscoveredDatabase {
  readonly kind: 'instance' | 'cluster';
  readonly identifier: string;
  readonly engine: string;
  readonly connectorId: string;
  readonly endpoint: string;
  readonly port: number;
  readonly databaseName?: string;
}
function fail(code: RdsDiscoveryErrorCode): never { throw new RdsDiscoveryError(code); }
const INSTANCE_ENGINES: Readonly<Record<string, string>> = {
  postgres: 'postgresql', mysql: 'mysql', mariadb: 'mariadb',
  'aurora-postgresql': 'postgresql', 'aurora-mysql': 'mysql', redshift: 'redshift-manual',
};
const CLUSTER_ENGINES: Readonly<Record<string, string>> = {
  'aurora-postgresql': 'postgresql', 'aurora-mysql': 'mysql',
};
function settings(connectorId: string, raw: unknown, environment: RdsDiscoveryOptions['environment'] = process.env): { config: ConnectorConfig; client: RDSClientConfig } {
  const config = validateConnectorConfig(connectorId, raw);
  const name = config.regionEnv!;
  const region = environment[name];
  if (!region || region.length > 8192 || /[\x00-\x20\x7f]/.test(region)) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', '$.config.regionEnv', 'Required server environment value is missing or invalid');
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', '$.config.regionEnv', 'Invalid AWS region');
  return { config, client: { region, maxAttempts: 1,
    // Operator environment must not redirect authenticated SDK requests to arbitrary endpoints.
    ignoreConfiguredEndpointUrls: true } };
}
function errorCode(error: unknown): never {
  if (error instanceof RdsDiscoveryError || error instanceof ConnectorError || error instanceof ExecutionCancelledError) throw error;
  const name = error instanceof Error ? error.name : undefined;
  if (['AccessDenied', 'AccessDeniedException', 'InvalidClientTokenId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken', 'AuthFailure'].includes(name ?? '')) fail('RDS_ACCESS_DENIED');
  return fail('RDS_REQUEST_FAILED');
}
async function withClient<T>(connectorId: string, raw: unknown, options: RdsDiscoveryOptions, work: (client: RdsDiscoveryClient, signal: AbortSignal) => Promise<T>): Promise<T> {
  const { client: clientSettings } = settings(connectorId, raw, options.environment);
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.timeoutMs', 'Expected 1–30000 milliseconds');
  if (options.signal?.aborted) throw new ExecutionCancelledError();
  const controller = new AbortController();
  let client: RdsDiscoveryClient | undefined, timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
  const cancelled = () => timedOut ? new RdsDiscoveryError('RDS_TIMEOUT') : new ExecutionCancelledError();
  let rejectAbort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(cancelled()); });
  controller.signal.addEventListener('abort', rejectAbort, { once: true });
  try {
    client = options.clientFactory ? options.clientFactory(clientSettings) : (() => {
      const sdk = new RDSClient(clientSettings);
      return { send: (command, sendOptions) => sdk.send(command, sendOptions), destroy: () => sdk.destroy() } satisfies RdsDiscoveryClient;
    })();
    return await Promise.race([stopped, work(client, controller.signal)]);
  } catch (error) { if (controller.signal.aborted) throw cancelled(); return errorCode(error); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', rejectAbort); controller.abort(); client?.destroy(); }
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) fail('RDS_INVALID_RESPONSE');
  return value as string;
}
function endpoint(value: unknown): string {
  const host = text(value);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)) fail('RDS_INVALID_RESPONSE');
  return host;
}
function port(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) fail('RDS_INVALID_RESPONSE');
  return value as number;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('RDS_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function classify(kind: 'instance' | 'cluster', raw: unknown, seen: Set<string>, out: DiscoveredDatabase[]): void {
  const entry = record(raw);
  const identifier = text(kind === 'instance' ? entry.DBInstanceIdentifier : entry.DBClusterIdentifier);
  const engine = text(entry.Engine);
  const connectorId = (kind === 'instance' ? INSTANCE_ENGINES : CLUSTER_ENGINES)[engine];
  // Anything the API cannot classify stays unlisted rather than guessed.
  if (!connectorId) return;
  const host = kind === 'instance' ? record(entry.Endpoint ?? {}).Address : entry.Endpoint;
  const portValue = kind === 'instance' ? record(entry.Endpoint ?? {}).Port : entry.Port;
  // A resource with no usable endpoint cannot become a source; leave it unlisted.
  if (host === undefined || host === '' || portValue === undefined) return;
  const databaseRaw = kind === 'instance' ? entry.DBName : entry.DatabaseName;
  const key = `${kind}:${identifier}`;
  if (seen.has(key)) fail('RDS_INVALID_RESPONSE');
  seen.add(key);
  if (out.length >= 1000) fail('RDS_LIMIT_EXCEEDED');
  out.push(Object.freeze({ kind, identifier, engine, connectorId, endpoint: endpoint(host), port: port(portValue),
    ...(databaseRaw === undefined || databaseRaw === null || databaseRaw === '' ? {} : { databaseName: text(databaseRaw) }) }));
}
async function pageAll(client: RdsDiscoveryClient, signal: AbortSignal, kind: 'instance' | 'cluster', seen: Set<string>, out: DiscoveredDatabase[]): Promise<void> {
  const markers = new Set<string>();
  let marker: string | undefined;
  for (let page = 0; page < 20; page++) {
    const response = kind === 'instance'
      ? await client.send(new DescribeDBInstancesCommand({ MaxRecords: 100, ...(marker ? { Marker: marker } : {}) }), { abortSignal: signal })
      : await client.send(new DescribeDBClustersCommand({ MaxRecords: 100, ...(marker ? { Marker: marker } : {}) }), { abortSignal: signal });
    if (signal.aborted) throw new ExecutionCancelledError();
    const list = kind === 'instance' ? response.DBInstances : response.DBClusters;
    if (list !== undefined && !Array.isArray(list)) fail('RDS_INVALID_RESPONSE');
    for (const entry of list ?? []) classify(kind, entry, seen, out);
    if (response.Marker === undefined) return;
    if (typeof response.Marker !== 'string' || !response.Marker || response.Marker.length > 8192 || markers.has(response.Marker)) fail('RDS_INVALID_RESPONSE');
    markers.add(response.Marker); marker = response.Marker;
  }
  fail('RDS_LIMIT_EXCEEDED');
}
/**
 * List DB instances and clusters in the configured region through the RDS API
 * and classify each by engine into its manual connector. The three discovery
 * registry entries (rds, aurora, redshift) share this one implementation and
 * schema; the entry selects configuration only. Results are complete or the
 * call fails — never a partial list presented as discovery.
 */
export async function discoverDatabaseSources(connectorId: string, raw: unknown, options: RdsDiscoveryOptions = {}): Promise<readonly DiscoveredDatabase[]> {
  const definition = connectorDefinition(connectorId);
  if (definition.implementation !== 'discovery') throw new ConnectorError('CONNECTOR_NOT_IMPLEMENTED', '$.connector', 'Connector does not provide database discovery');
  return withClient(connectorId, raw, options, async (client, signal) => {
    const seen = new Set<string>(), out: DiscoveredDatabase[] = [];
    await pageAll(client, signal, 'instance', seen, out);
    await pageAll(client, signal, 'cluster', seen, out);
    return Object.freeze(out);
  });
}
const SQL_ENV_NAMES = ['hostEnv', 'portEnv', 'databaseEnv', 'userEnv', 'passwordEnv', 'caEnv'] as const;
const POSTGRES_ENV_NAMES = ['connectionEnv'] as const;
/**
 * Build the stored config for a source created from a discovery result. Every
 * value is an environment variable NAME supplied by the user, exactly as in
 * the manual flow — discovery supplies the target connector, never a value.
 * The result passes the manual connector's own validation or this fails closed.
 */
export function rdsSourceConfig(discovered: Pick<DiscoveredDatabase, 'connectorId'>, envNames: unknown): ConnectorConfig {
  const connectorId = discovered?.connectorId;
  const allowed: readonly string[] = connectorId === 'postgresql' ? POSTGRES_ENV_NAMES : ['mysql', 'mariadb', 'redshift-manual'].includes(connectorId ?? '') ? SQL_ENV_NAMES : [];
  if (!allowed.length) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.connectorId', 'Discovered connector cannot create a source');
  if (!envNames || typeof envNames !== 'object' || Array.isArray(envNames) || ![Object.prototype, null].includes(Object.getPrototypeOf(envNames))) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.envNames', 'Expected an environment name object');
  const input = envNames as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.envNames', 'Unknown environment name field');
  const config: Record<string, string> = {};
  for (const key of allowed) if (typeof input[key] === 'string') config[key] = input[key] as string;
  return validateConnectorConfig(connectorId!, config);
}
