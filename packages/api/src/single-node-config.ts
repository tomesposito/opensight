import { readFile, lstat } from 'node:fs/promises';
import { MetadataError } from './metadata-db.js';
import { entitlementConfig, type Entitlements } from './hosted-usage.js';

export const referenceDisclosure = 'Pilot, single-node, no HA claims. Blaze is ephemeral. Actual deployment requires separate authorization.';
export const unsupportedSurfaces = ['sharedParquet', 'distributedRefresh', 'customerEmbedDomains', 'supportingServiceHA'] as const;
export function assertReferenceSurfaces(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MetadataError('UNSUPPORTED', 422);
  for (const [key, value] of Object.entries(raw)) if (!(unsupportedSurfaces as readonly string[]).includes(key) || value !== false) throw new MetadataError('UNSUPPORTED', 422);
}
export interface ReferenceConfig { entitlements: Entitlements; auditDays: number; usageDays: number; location: string }
export function referenceConfig(env: NodeJS.ProcessEnv): ReferenceConfig | undefined {
  if (env.OPENSIGHT_REFERENCE === undefined) return undefined;
  if (env.OPENSIGHT_REFERENCE !== 'single-node') throw new MetadataError('UNSUPPORTED', 503);
  for (const name of ['OPENSIGHT_SHARED_PARQUET', 'OPENSIGHT_DISTRIBUTED_REFRESH', 'OPENSIGHT_CUSTOM_EMBED_DOMAINS', 'OPENSIGHT_SUPPORTING_SERVICE_HA']) {
    if (env[name] !== undefined && env[name] !== 'false') throw new MetadataError('UNSUPPORTED', 503);
  }
  if (env.OPENSIGHT_REPLICAS !== undefined && env.OPENSIGHT_REPLICAS !== '1') throw new MetadataError('UNSUPPORTED', 503);
  if (env.OPENSIGHT_OPTIONAL_SURFACES !== undefined) {
    try { assertReferenceSurfaces(JSON.parse(env.OPENSIGHT_OPTIONAL_SURFACES)); } catch { throw new MetadataError('UNSUPPORTED', 503); }
  }
  const days = (value: string, minimum: number): number => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > 36500) throw new MetadataError('REFERENCE_CONFIG_INVALID', 503);
    return Number(value);
  };
  const location = env.OPENSIGHT_REFERENCE_LOCATION;
  if (!location || !/^[A-Za-z0-9_-]{1,80}$/.test(location)) throw new MetadataError('REFERENCE_LOCATION_REQUIRED', 503);
  return { location, entitlements: entitlementConfig(env.OPENSIGHT_ENTITLEMENTS), auditDays: days(env.OPENSIGHT_AUDIT_RETENTION_DAYS ?? '0', 0), usageDays: days(env.OPENSIGHT_USAGE_RETENTION_DAYS ?? '30', 1) };
}
/** Mounted secret paths are selected by environment. Never log values or paths. */
export async function secretEnvironment(input: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const env = { ...input };
  try {
    for (const [key, path] of Object.entries(input)) if (/^OPENSIGHT_[A-Z0-9_]+_FILE$/.test(key)) {
      const target = key.slice(0, -5);
      if (!path || input[target] !== undefined) throw Error();
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 1048576) throw Error();
      env[target] = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
      delete env[key];
    }
    return env;
  } catch { throw new MetadataError('SECRET_INJECTION_INVALID', 503); }
}
