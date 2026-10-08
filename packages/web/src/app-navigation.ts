import { allowed, type Access } from './access.js';

export const pages = {
  home: { path: '/home', section: 'Home', title: 'Home' },
  reports: { path: '/reports', section: 'Reports', title: 'Reports' },
  analyses: { path: '/analyses', section: 'Analyses', title: 'My analyses' },
  author: { path: '/analyses/author', section: 'Analyses', title: 'Author' },
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
export type AppRoute = { page: Page; draftId?: string; newAnalysis?: boolean };
export const productSections = [
  { title: 'Home', page: 'home' }, { title: 'Analyses', page: 'analyses' },
  { title: 'Reports', page: 'reports' }, { title: 'Data', page: 'data-prep' }, { title: 'Admin', page: 'security' },
] as const;
export const dataPages: Page[] = ['data-prep', 'data-sources'];
export const adminPages: Page[] = ['security', 'organization', 'automation', 'ai-settings', 'users'];
export const developerPages: Page[] = ['fixtures', 'api'];

export function visiblePage(access: Access, page: Page): boolean {
  if (page === 'reports' || page === 'analyses' || page === 'author' || dataPages.includes(page)) return allowed(access, 'build');
  if (page === 'ai-settings' || page === 'users') return access.mode === 'hosted' && allowed(access, 'admin');
  if (page === 'fixtures') return access.mode === 'demo' || allowed(access, 'build');
  return true;
}
export function routeProblem(access: Access, page: Page): string | undefined {
  if (page === 'api' && access.mode === 'demo') return 'Needs hosted API · The fixture demo does not connect to the API.';
  if (visiblePage(access, page)) return;
  return page === 'ai-settings' || page === 'users'
    ? 'SECURITY_ADMIN_REQUIRED: Hosted administrator access required.'
    : 'SECURITY_BUILD_REQUIRED: Author access required.';
}
export function routeHash(route: AppRoute): string {
  return route.page === 'author' && route.draftId ? `#/analyses/drafts/${encodeURIComponent(route.draftId)}`
    : route.page === 'author' && route.newAnalysis ? '#/analyses/new' : `#${pages[route.page].path}`;
}
export function parseRoute(hash: string): AppRoute | undefined {
  if (!hash || hash === '#' || hash === '#/') return { page: 'home' };
  if (hash === '#/analyses/new') return { page: 'author', newAnalysis: true };
  const draft = /^#\/analyses\/drafts\/([a-zA-Z0-9-]{1,80})$/.exec(hash);
  if (draft) return { page: 'author', draftId: draft[1] };
  const page = (Object.keys(pages) as Page[]).find(page => hash === `#${pages[page].path}`);
  return page ? { page } : undefined;
}
