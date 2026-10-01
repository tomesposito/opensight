import type { SqlDialect } from './types.js';

export type ConnectorField =
  | { readonly kind: 'environment'; readonly label: string; readonly required?: boolean }
  | { readonly kind: 'choice'; readonly label: string; readonly values: readonly string[]; readonly required?: boolean }
  | { readonly kind: 'string'; readonly label: string; readonly required?: boolean };
export interface ConnectorDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: 'File' | 'Database' | 'AWS' | 'SaaS';
  readonly schema: Readonly<Record<string, ConnectorField>>;
  readonly dialect?: SqlDialect;
  readonly implementation: 'upload' | 'query' | 'hosted' | 'unimplemented';
}
const env = (label: string, required = true): ConnectorField => ({ kind: 'environment', label, required });
const sql = { hostEnv: env('Host environment variable'), portEnv: env('Port environment variable'), databaseEnv: env('Database environment variable'), userEnv: env('User environment variable'), passwordEnv: env('Password environment variable'), caEnv: env('TLS CA environment variable', false) };
const aws = { regionEnv: env('AWS region environment variable'), resourceEnv: env('Resource environment variable'), credentialsEnv: env('Credentials environment variable') };
const saas = { endpointEnv: env('API endpoint environment variable'), tokenEnv: env('API token environment variable') };

/** Public metadata only. Configurations contain environment variable names, never secrets. */
export const connectors: readonly ConnectorDefinition[] = [
  { id: 'file', name: 'Upload a file', category: 'File', implementation: 'upload', dialect: 'duckdb', schema: {
    format: { kind: 'choice', label: 'File format', values: ['csv', 'tsv', 'json', 'xls', 'xlsx'], required: true },
    delimiter: { kind: 'choice', label: 'Delimiter', values: [',', '\t', ';', '|'] },
    sheet: { kind: 'string', label: 'Worksheet' },
  } },
  { id: 'mysql', name: 'MySQL', category: 'Database', schema: sql, dialect: 'mysql', implementation: 'unimplemented' },
  { id: 'postgresql', name: 'PostgreSQL', category: 'Database', schema: { connectionEnv: env('Connection URL environment variable') }, dialect: 'postgres', implementation: 'query' },
  { id: 'mariadb', name: 'MariaDB', category: 'Database', schema: sql, dialect: 'mysql', implementation: 'unimplemented' },
  ...[['sql-server', 'SQL Server'], ['presto', 'Presto'], ['trino', 'Trino'], ['spark', 'Spark'], ['teradata', 'Teradata'], ['snowflake', 'Snowflake']].map(([id, name]): ConnectorDefinition => ({ id: id!, name: name!, category: 'Database', schema: sql, implementation: 'unimplemented' })),
  ...[['salesforce', 'Salesforce'], ['github', 'GitHub'], ['twitter', 'Twitter'], ['jira', 'Jira'], ['servicenow', 'ServiceNow']].map(([id, name]): ConnectorDefinition => ({ id: id!, name: name!, category: 'SaaS', schema: saas, implementation: 'hosted' })),
  ...[['s3-analytics', 'S3 Analytics'], ['s3', 'S3'], ['athena', 'Athena'], ['rds', 'RDS (auto-discovery)'], ['aurora', 'Aurora'], ['redshift', 'Redshift (auto-discovery)'], ['redshift-manual', 'Redshift (manual)'], ['iot-analytics', 'AWS IoT Analytics']].map(([id, name]): ConnectorDefinition => ({ id: id!, name: name!, category: 'AWS', schema: aws, implementation: 'hosted' })),
];
// Registry metadata is shared by API and browser. Callers cannot change validation rules.
for (const connector of connectors) {
  for (const field of Object.values(connector.schema)) { if (field.kind === 'choice') Object.freeze(field.values); Object.freeze(field); }
  Object.freeze(connector.schema); Object.freeze(connector);
}
Object.freeze(connectors);
export type ConnectorErrorCode = 'UNKNOWN_CONNECTOR' | 'INVALID_CONNECTOR_CONFIG' | 'CONNECTOR_NOT_IMPLEMENTED' | 'CONNECTOR_NOT_CONFIGURED';
export class ConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode, readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'ConnectorError'; }
}
export function connectorDefinition(id: string): ConnectorDefinition {
  const definition = connectors.find(c => c.id === id);
  if (!definition) throw new ConnectorError('UNKNOWN_CONNECTOR', '$.connector', 'Unknown connector');
  return definition;
}
export type ConnectorConfig = Readonly<Record<string, string>>;
export function validateConnectorConfig(id: string, raw: unknown): ConnectorConfig {
  const { schema } = connectorDefinition(id);
  const invalid = (path: string, message: string): never => { throw new ConnectorError('INVALID_CONNECTOR_CONFIG', path, message); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid('$.config', 'Expected a configuration object');
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!Object.hasOwn(schema, key)) invalid('$.config', 'Unknown configuration field');
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, field] of Object.entries(schema)) {
    if (!Object.hasOwn(input, key)) { if (field.required) invalid(`$.config.${key}`, 'Required field'); continue; }
    const value = input[key];
    if (typeof value !== 'string' || !value.length || value.includes('\0') || value.length > 256) invalid(`$.config.${key}`, 'Expected a nonempty string of at most 256 characters');
    const text = value as string;
    if (field.kind === 'environment' && !/^[A-Z_][A-Z0-9_]*$/.test(text)) invalid(`$.config.${key}`, 'Expected an environment variable name, not a credential or address');
    if (field.kind === 'choice' && !field.values.includes(text)) invalid(`$.config.${key}`, 'Unsupported choice');
    result[key] = text;
  }
  if (id === 'file') {
    if (result.delimiter && !['csv', 'tsv'].includes(result.format!)) invalid('$.config.delimiter', 'Delimiter is only valid for CSV/TSV');
    if (result.sheet && !['xls', 'xlsx'].includes(result.format!)) invalid('$.config.sheet', 'Worksheet is only valid for Excel');
    if (result.format === 'tsv' && result.delimiter && result.delimiter !== '\t') invalid('$.config.delimiter', 'TSV requires a tab delimiter');
  }
  return Object.freeze(result);
}
export interface ConnectorState { state: 'needs_hosted_api' | 'not_configured' | 'not_implemented' | 'ready'; message: string }
export function connectorState(id: string, apiAvailable = false): ConnectorState {
  const c = connectorDefinition(id);
  if (c.implementation === 'unimplemented') return { state: 'not_implemented', message: 'Not yet implemented' };
  if (c.implementation === 'upload') return apiAvailable
    ? { state: 'ready', message: 'Ready for file upload to DuckDB staging' }
    : { state: 'needs_hosted_api', message: 'Needs local or hosted API · Uploads are unavailable in the static demo.' };
  if (c.implementation === 'hosted') return { state: apiAvailable ? 'not_configured' : 'needs_hosted_api', message: 'Needs a hosted connector implementation' };
  return apiAvailable
    ? { state: 'not_configured', message: 'Needs an operator-configured connection' }
    : { state: 'needs_hosted_api', message: 'Needs a hosted API and an operator-configured connection' };
}
/** Validation does not test credentials or claim a successful connection. No I/O. */
export function connectConnector(id: string, config: unknown, apiAvailable = false): ConnectorState {
  validateConnectorConfig(id, config);
  return connectorState(id, apiAvailable);
}
export function connectorDialect(id: string): SqlDialect {
  const c = connectorDefinition(id);
  if (!c.dialect) throw new ConnectorError('CONNECTOR_NOT_IMPLEMENTED', '$.connector', 'Query dialect is not yet implemented');
  return c.dialect;
}
