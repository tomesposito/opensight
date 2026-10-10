import { allowed, type Access } from './access.js';

export const pages = {
  home: { path: '/home', section: 'Home', title: 'Home' },
  'my-stuff': { path: '/my-stuff', section: 'My stuff', title: 'My stuff' },
  'my-folders': { path: '/folders/mine', section: 'My folders', title: 'My folders' },
  'shared-folders': { path: '/folders/shared', section: 'Shared folders', title: 'Shared folders' },
  dashboards: { path: '/dashboards', section: 'Dashboards', title: 'Dashboards' },
  analyses: { path: '/analyses', section: 'Analyses', title: 'My analyses' },
  author: { path: '/analyses/author', section: 'Analyses', title: 'Author' },
  data: { path: '/data', section: 'Data', title: 'Data' },
  'data-prep': { path: '/data/preparation', section: 'Data', title: 'Data preparation' },
  'data-sources': { path: '/data/sources', section: 'Data', title: 'Data sources' },
  security: { path: '/admin/security', section: 'Admin', title: 'Security & namespaces' },
  organization: { path: '/admin/organization', section: 'Admin', title: 'Folders, sharing & embedding' },
  automation: { path: '/admin/automation', section: 'Admin', title: 'Schedules & alerts' },
  'ai-settings': { path: '/admin/ai-settings', section: 'Admin', title: 'AI provider settings' },
  users: { path: '/admin/users', section: 'Admin', title: 'Users and invitations' },
  fixtures: { path: '/admin/developer/fixtures', section: 'Admin', title: 'Developer fixture preview' },
  api: { path: '/admin/developer/api', section: 'Admin', title: 'API definition preview' },
} as const;
export type Page = keyof typeof pages;
export type AppRoute = { page: Page; draftId?: string; newAnalysis?: boolean; createDataset?: boolean; sourceId?: string; datasetId?: string; baseDatasetId?: string };
export const productSections = [
  { title: 'My stuff', page: 'my-stuff' },
  { title: 'Analyses', page: 'analyses' }, { title: 'Dashboards', page: 'dashboards' },
  { title: 'Data', page: 'data' },
  { title: 'My folders', page: 'my-folders' }, { title: 'Shared folders', page: 'shared-folders' },
] as const;
export const dataPages: Page[] = ['data', 'data-prep', 'data-sources'];
export const adminPages: Page[] = ['security', 'organization', 'automation', 'ai-settings', 'users'];
export const developerPages: Page[] = ['fixtures', 'api'];

/** Session-only page history. Never retain a draft URL or imply asset activity. */
export function recordRecentPage(recents: readonly Page[], page: Page | undefined, access: Access): Page[] {
  const permitted = recents.filter(item => item !== 'author' && !routeProblem(access, item));
  if (!page || page === 'author' || routeProblem(access, page)) return permitted;
  return [page, ...permitted.filter(item => item !== page)].slice(0, 6);
}

export function visiblePage(access: Access, page: Page): boolean {
  if (page === 'dashboards') return access.mode === 'local';
  if (page === 'analyses' || page === 'author' || dataPages.includes(page)) return allowed(access, 'build');
  if (page === 'ai-settings' || page === 'users') return access.mode === 'hosted' && allowed(access, 'admin');
  if (page === 'fixtures') return access.mode === 'demo' || allowed(access, 'build');
  return true;
}
export function routeProblem(access: Access, page: Page): string | undefined {
  if (page === 'dashboards' && access.mode !== 'local') return 'This page is available in the local workspace.';
  if (page === 'api' && access.mode === 'demo') return 'Needs hosted API · The fixture demo does not connect to the API.';
  if (visiblePage(access, page)) return;
  return page === 'ai-settings' || page === 'users'
    ? 'SECURITY_ADMIN_REQUIRED: Hosted administrator access required.'
    : 'SECURITY_BUILD_REQUIRED: Author access required.';
}
export function routeHash(route: AppRoute): string {
  if ((route.page === 'data' || route.page === 'data-prep') && route.datasetId) return `#${route.page === 'data' ? '/data/datasets' : '/data/preparation/edit'}/${encodeURIComponent(route.datasetId)}`;
  if (route.page === 'data-prep' && route.baseDatasetId) return `#/data/preparation/dataset/${encodeURIComponent(route.baseDatasetId)}`;
  if (route.page === 'data' && route.createDataset) return '#/data/new';
  if (route.page === 'data-prep' && route.sourceId) return `#/data/preparation/source/${encodeURIComponent(route.sourceId)}`;
  return route.page === 'author' && route.draftId ? `#/analyses/drafts/${encodeURIComponent(route.draftId)}`
    : route.page === 'author' && route.newAnalysis ? '#/analyses/new' : `#${pages[route.page].path}`;
}
export function parseRoute(hash: string): AppRoute | undefined {
  if (!hash || hash === '#' || hash === '#/') return { page: 'home' };
  const dataset = /^#\/data\/(datasets|preparation\/edit|preparation\/dataset)\/([A-Za-z0-9_-]{1,128})$/.exec(hash);
  if (dataset) return dataset[1] === 'datasets' ? { page: 'data', datasetId: dataset[2] } : dataset[1] === 'preparation/edit' ? { page: 'data-prep', datasetId: dataset[2] } : { page: 'data-prep', baseDatasetId: dataset[2] };
  if (hash === '#/data/new') return { page: 'data', createDataset: true };
  const source = /^#\/data\/preparation\/source\/([^/]{1,512})$/.exec(hash);
  if (source) {
    try { const sourceId = decodeURIComponent(source[1]!); if (sourceId.length <= 128 && !/[\x00-\x1f]/.test(sourceId)) return { page: 'data-prep', sourceId }; } catch { /* Malformed links fail closed. */ }
    return;
  }
  if (hash === '#/analyses/new') return { page: 'author', newAnalysis: true };
  const draft = /^#\/analyses\/drafts\/([a-zA-Z0-9-]{1,80})$/.exec(hash);
  if (draft) return { page: 'author', draftId: draft[1] };
  const page = (Object.keys(pages) as Page[]).find(page => hash === `#${pages[page].path}`);
  return page ? { page } : undefined;
}
