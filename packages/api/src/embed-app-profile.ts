import { hasCapability } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import type { TenantEmbedConfig } from './embedding-config.js';

export interface AppLocation { path: string; area: 'dashboard' | 'catalog' | 'author' | 'prep' | 'ask'; id?: string }
/** Exact application paths only: no URLs, queries, fragments, escapes or aliases. */
export function fullAppLocation(value: unknown, landing = false): AppLocation {
  if (typeof value !== 'string') throw new MetadataError('EMBED_REQUEST_INVALID', 400);
  const routes: [RegExp, AppLocation['area']][] = [
    [/^\/dashboards(?:\/([A-Za-z0-9_-]{1,512}))?$/, 'dashboard'],
    [/^\/data$/, 'catalog'], [/^\/analyses\/author(?:\/([A-Za-z0-9_-]{1,512}))?$/, 'author'],
    [/^\/data\/preparation$/, 'prep'], [/^\/ask-o$/, 'ask'],
    ...(!landing ? [
      [/^\/home$/, 'dashboard'], [/^\/analyses(?:\/new|\/drafts\/[A-Za-z0-9-]{1,80})?$/, 'author'],
      [/^\/data\/(?:sources|new)$/, 'prep'], [/^\/data\/datasets\/([A-Za-z0-9_-]{1,128})$/, 'catalog'],
      [/^\/data\/preparation\/(?:source|edit|dataset)\/([A-Za-z0-9_-]{1,128})$/, 'prep'],
    ] as [RegExp, AppLocation['area']][] : []),
  ];
  for (const [pattern, area] of routes) {
    const match = pattern.exec(value);
    if (match) return { path: value, area, ...(match[1] ? { id: match[1] } : {}) };
  }
  throw new MetadataError(landing ? 'EMBED_REQUEST_INVALID' : 'EMBED_SCOPE_DENIED', landing ? 400 : 403);
}
export type AppFeatures = Pick<TenantEmbedConfig['features'], 'authoring' | 'registeredDashboards'>;
export function appFeature(features: AppFeatures, area: AppLocation['area']): void {
  if ((area === 'author' || area === 'prep') && !features.authoring || area === 'dashboard' && !features.registeredDashboards)
    throw new MetadataError('EMBED_FEATURE_UNSUPPORTED', 422);
}
export function appRole(role: unknown, area: AppLocation['area']): void {
  if ((area === 'author' || area === 'prep') && !hasCapability(role, 'build')) throw new MetadataError('EMBED_AUTHOR_REQUIRED', 403);
  if (area === 'ask' && !hasCapability(role, 'ai')) throw new MetadataError('SECURITY_AI_REQUIRED', 403);
}
