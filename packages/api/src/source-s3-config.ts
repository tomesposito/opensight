import { validateConnectorConfig, type ConnectorConfig, type S3SourceOptions } from '@opensight/query-engine';
import { sourceError } from './source-schema.js';

export interface HostedS3Settings extends S3SourceOptions { configs: readonly ConnectorConfig[] }
/** Exact operator allowlist, analogous to database endpoints. Never taken from an HTTP body. */
export function hostedS3Settings(environment: NodeJS.ProcessEnv = process.env): HostedS3Settings {
  try {
    const raw: unknown = JSON.parse(environment.OPENSIGHT_S3_SOURCES ?? '[]');
    if (!Array.isArray(raw) || raw.length > 256) sourceError();
    return { environment, configs: raw.map(config => validateConnectorConfig('s3', config)) };
  } catch { return sourceError('SOURCE_ENDPOINT_CONFIG_INVALID', 503); }
}
export function permittedS3Config(raw: unknown, settings: HostedS3Settings): ConnectorConfig {
  const config = validateConnectorConfig('s3', raw);
  if (!settings.configs.some(allowed => Object.keys(allowed).length === Object.keys(config).length && Object.entries(config).every(([key, value]) => allowed[key] === value))) sourceError('SOURCE_ENDPOINT_DENIED', 403);
  return config;
}
