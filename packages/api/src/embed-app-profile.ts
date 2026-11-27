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

/** Only the real app's approved surfaces. Authentication/admin/metadata routes
 * are deliberately absent; Embed credentials never enter hosted authentication. */
export function fullAppOperation(path: string, verb: string): AppLocation['area'] | undefined {
  if (verb === 'GET' && /^\/api\/v1\/dashboards(?:\/[A-Za-z0-9_-]{1,512})?$/.test(path)
    || verb === 'POST' && /^\/api\/v1\/dashboards\/[A-Za-z0-9_-]{1,512}\/versions\/[1-9]\d*\/visuals\/[A-Za-z0-9_-]{1,512}\/query$/.test(path)) return 'dashboard';
  if (verb === 'GET' && ['/api/prep-datasets', '/api/prep-sources', '/api/sources'].includes(path)) return 'catalog';
  if (verb === 'GET' && /^\/api\/datasets\/[A-Za-z0-9_-]{1,128}\/(?:schema|prep|execution|rows)$/.test(path)) return 'catalog';
  if (['GET', 'POST', 'PUT'].includes(verb) && /^\/api\/v1\/analyses(?:\/[A-Za-z0-9_-]{1,512})?$/.test(path)
    || verb === 'POST' && /^\/api\/v1\/analyses\/[A-Za-z0-9_-]{1,512}\/publish$/.test(path)
    || verb === 'GET' && /^\/api\/v1\/(?:metrics|prep-templates)(?:\/[A-Za-z0-9_-]{1,512})?$/.test(path)) return 'author';
  if (verb === 'GET' && (path === '/api/connectors' || /^\/api\/sources\/[A-Za-z0-9_-]{1,128}(?:\/policy)?$/.test(path))
    || verb === 'POST' && path === '/api/uploads'
    || ['GET', 'POST'].includes(verb) && /^\/api\/sources\/[A-Za-z0-9_-]{1,128}\/(?:preview|rows|output|query)$/.test(path)
    || ['PUT', 'DELETE'].includes(verb) && /^\/api\/datasets\/[A-Za-z0-9_-]{1,128}\/prep$/.test(path)
    || verb === 'POST' && /^\/api\/datasets\/[A-Za-z0-9_-]{1,128}\/(?:query|prep\/(?:preview|join-diagnostics))$/.test(path)) return 'prep';
  if (verb === 'GET' && path === '/api/o/status' || verb === 'POST' && /^\/api\/o\/(?:generate|calculation|query|plan|revise)$/.test(path)
    || verb === 'POST' && /^\/api\/v1\/dashboards\/[A-Za-z0-9_-]{1,512}\/question$/.test(path)) return 'ask';
  return undefined;
}

export function fullAppMethods(path: string): string[] {
  const match = /^\/api\/embed\/sessions\/[A-Za-z0-9_-]{32}\/app(\/.*)$/.exec(path);
  if (!match) return [];
  const target = match[1]!;
  if (target === '/session') return ['GET'];
  if (/^\/analysis\/[A-Za-z0-9_-]{1,512}$/.test(target)) return ['GET'];
  if (target === '/route') return ['POST'];
  return ['GET', 'POST', 'PUT', 'DELETE'].filter(verb => fullAppOperation(target, verb));
}
