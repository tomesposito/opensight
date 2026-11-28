import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useAccess } from './access.js';
import { adminPages, dataPages, developerPages, pages, parseRoute, productSections, resetRouteScroll, routeSurface, routeHash, visiblePage, type AppRoute, type Page } from './app-navigation.js';
import { useCommandPalette } from './CommandPalette.js';
import { useGlobalSearch } from './GlobalSearch.js';
import { BrandMark } from './BrandMark.js';

export function useAppRoute() {
  const access = useAccess(), embed = access.embed, authorize = embed?.authorizeRoute;
  const [route, setRoute] = useState(() => authorize ? undefined : parseRoute(typeof window === 'undefined' ? '' : window.location?.hash ?? ''));
  const [entry, setEntry] = useState(0);
  const [routeError, setRouteError] = useState<string>();
  const [routePending, setRoutePending] = useState(!!authorize);
  const epoch = useRef(0), hostRequest = useRef(0);
  const check = (hash: string, commit: () => void) => {
    const current = ++epoch.current;
    if (!authorize) { commit(); return; }
    setRoutePending(true); setRouteError(undefined);
    void authorize(hash.slice(1)).then(() => { if (current === epoch.current) { setRoutePending(false); commit(); embed?.events?.emit({ type: 'navigation', path: hash.slice(1) }); } }).catch((error: unknown) => {
      if (current === epoch.current) { setRoutePending(false); setRoute(undefined); setRouteError(error instanceof Error ? error.message : 'EMBED_SCOPE_DENIED'); }
    });
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const changed = () => {
      const hash = window.location.hash;
      check(hash, () => { setRoute(parseRoute(hash)); setEntry(value => value + 1); resetRouteScroll(window); });
    };
    if (authorize) changed();
    window.addEventListener('hashchange', changed);
    return () => { epoch.current++; window.removeEventListener('hashchange', changed); };
  }, [authorize]);
  useLayoutEffect(() => embed?.events?.onAction(action => {
    if (action.type !== 'navigate' || !authorize) return;
    const hash = `#${action.path}`, next = parseRoute(hash);
    if (!next || routeSurface(access, next) !== 'visible' || hash === window.location.hash) return;
    const current = epoch.current, request = ++hostRequest.current;
    void authorize(action.path).then(() => {
      if (current !== epoch.current || request !== hostRequest.current || !embed.events?.live()) return;
      epoch.current++;
      window.history.pushState(null, '', hash);
      setRoute(next); setRouteError(undefined); setRoutePending(false); setEntry(value => value + 1); resetRouteScroll(window);
      embed.events.emit({ type: 'navigation', path: action.path });
    }).catch(() => {});
  }));
  const navigate = (next: AppRoute, replace = false) => {
    const hash = routeHash(next);
    if (route && routeHash(route) === hash) return;
    check(hash, () => {
    if (!replace && (!route || routeHash(route) !== hash)) setEntry(value => value + 1);
    if (typeof window !== 'undefined' && window.location?.hash !== hash) {
      // History changes do not reload either Vite or the file:// demo.
      window.history?.[replace ? 'replaceState' : 'pushState'](null, '', hash);
      // A pushed page starts at the top instead of inheriting the previous
      // page's scroll position. Replacements keep their scroll (same view).
      if (!replace) resetRouteScroll(window);
    }
    setRoute(next);
    });
  };
  return { route, navigate, entry, routePending, routeError };
}
export type Navigate = (route: AppRoute, replace?: boolean) => void;
export function AppLink({ to, navigate, children, current, className }: { to: AppRoute; navigate: Navigate; children: ReactNode; current?: boolean; className?: string }) {
  const surface = routeSurface(useAccess(), to);
  if (surface === 'hidden') return null;
  if (surface === 'disabled') return <a role="link" aria-disabled="true" className={className}>{children}</a>;
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(to);
  };
  return <a href={routeHash(to)} onClick={click} aria-current={current ? 'page' : undefined} className={className}>{children}</a>;
}
function VectorIcon({ path, size = 16, fill = false }: { path: string; size?: number; fill?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={path} fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Search: 'm15 15 5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    'My stuff': 'M4 4v16M9 4v16M14 6l5-1 3 14-5 1z',
    Analyses: 'M3 20h18M5 16V9h3v7m4 0V4h3v12m4 0v-5h3v5',
    Dashboards: 'M3 4h18v16H3zM3 9h18M9 9v11',
    Notebooks: 'M4 3h16v18H4zM8 3v18M11 8h6m-6 4h6m-6 4h4',
    Data: 'M3 6c0-5 18-5 18 0s-18 5-18 0v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0',
    'My folders': 'M3 6h7l3 3h8v11H3z',
    'Shared folders': 'M3 6h7l3 3h8v11H3zM8 15h8m-3-3 3 3-3 3',
    Ideas: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4',
    More: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z',
  };
  return <svg className="navigation-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function AppNavigation({ route, navigate, recentPages = [], children }: { route?: AppRoute; navigate: Navigate; recentPages?: readonly Page[]; children?: ReactNode }) {
  const access = useAccess(), section = route && pages[route.page].section;
  const surface = access.embed?.surface;
  const navigation = surface?.menus.navigation ?? 'visible';
  const account = surface?.menus.account ?? 'visible';
  const headerState = surface?.chrome.header ?? 'visible';
  const palette = useCommandPalette();
  const search = useGlobalSearch();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(section === 'Admin');
  const toggle = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const band = header.current;
    const shell = band?.closest<HTMLElement>('.app-shell');
    if (!band || !shell) return;
    // Setup's explicit demo banner and wrapped developer controls can move the
    // identity band. Keep the rail and its backdrop below the actual band.
    const align = () => shell.style.setProperty('--app-navigation-top', `${band.getBoundingClientRect().bottom}px`);
    align();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(align) : undefined;
    observer?.observe(band);
    if (shell.previousElementSibling) observer?.observe(shell.previousElementSibling);
    window.addEventListener('resize', align);
    window.addEventListener('scroll', align, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener('resize', align); window.removeEventListener('scroll', align); shell.style.removeProperty('--app-navigation-top'); };
  }, []);
  useEffect(() => { setNavigationOpen(false); }, [route]);
  useEffect(() => { if (section === 'Admin') setMoreOpen(true); }, [section]);
  const closeNavigation = () => { setNavigationOpen(false); toggle.current?.focus(); };
  const link = (page: Page) => access.mode === 'demo' && page === 'api'
    ? <span key={page} aria-disabled="true">API definition preview · Needs hosted API</span>
    : <AppLink key={page} to={{ page }} navigate={navigate} current={route?.page === page}>{pages[page].title}</AppLink>;
  const sectionPage = section === 'Admin' ? 'security' : productSections.find(item => item.title === section)?.page;
  return <>
    {headerState !== 'hidden' && <header inert={headerState === 'disabled'} aria-disabled={headerState === 'disabled' || undefined} ref={header} className="app-header product-header">
      {navigation !== 'hidden' && <button disabled={navigation === 'disabled'} ref={toggle} className="navigation-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navigationOpen} aria-controls="product-navigation" onClick={() => setNavigationOpen(open => !open)} onKeyDown={event => { if (navigationOpen && event.key === 'Escape') { event.preventDefault(); closeNavigation(); } }}><VectorIcon path="M4 7h16M4 12h16M4 17h16" size={18} /></button>}
      <AppLink className="brand" to={{ page: 'home' }} navigate={navigate}><span className="brand-mark" aria-hidden="true"><BrandMark size={22} /></span><span className="brand-wordmark">opensight</span></AppLink>
      {navigation !== 'hidden' && <nav inert={navigation === 'disabled'} aria-disabled={navigation === 'disabled' || undefined} className="breadcrumbs" aria-label="Breadcrumb">
        <AppLink to={{ page: 'home' }} navigate={navigate} current={route?.page === 'home'}>Home</AppLink>
        {route?.page !== 'home' && <>
          <span aria-hidden="true">/</span>
          {route && sectionPage && section !== pages[route.page].title && <><AppLink to={{ page: sectionPage }} navigate={navigate}>{section}</AppLink><span aria-hidden="true">/</span></>}
          <span className="header-caption" aria-current="page">{route ? pages[route.page].title : 'Page not found'}</span>
        </>}
      </nav>}
      {children}
      {account !== 'hidden' && <details inert={account === 'disabled'} aria-disabled={account === 'disabled' || undefined} className="account-menu hosted-account" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary aria-label="Account"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><span className="account-label">Account</span></summary>
        <div className="account-panel">
          <strong>{access.mode === 'hosted' ? access.session?.name ?? 'Hosted workspace' : access.mode === 'local' ? 'Local workspace' : 'Public sample preview'}</strong>
          {access.mode === 'hosted' && (access.session?.workspaceName || access.session?.tenantId) && <p className="account-workspace">{access.session?.workspaceName || access.session?.tenantId}</p>}
          <p>{access.mode === 'hosted' ? access.session?.role ?? 'No active session' : access.mode === 'local' ? 'Files and drafts stay on this computer.' : 'Synthetic sample data · No hosted account.'}</p>
          {access.mode === 'hosted' && <AppLink to={{ page: 'mcp-connections' }} navigate={navigate} current={route?.page === 'mcp-connections'}>MCP connections</AppLink>}
          {access.mode === 'hosted' && access.signOut && <button type="button" onClick={() => void access.signOut?.()}>Sign out</button>}
        </div>
      </details>}
    </header>}
    {navigationOpen && <button type="button" className="navigation-scrim" aria-label="Close navigation" onClick={closeNavigation} />}
    {navigation !== 'hidden' && <div inert={navigation === 'disabled'} aria-disabled={navigation === 'disabled' || undefined} id="product-navigation" className="product-navigation" data-open={navigationOpen} onKeyDown={event => { if (navigationOpen && event.key === 'Escape') { event.preventDefault(); closeNavigation(); } }}>
      <nav className="app-nav" aria-label="Product">
        {(search || palette) && <button type="button" className="rail-search" aria-label="Search" onClick={() => { closeNavigation(); if (search) search.open(); else palette?.open(); }}><NavigationIcon name="Search" />Search</button>}
        {productSections.filter(item => visiblePage(access, item.page)).map(item => <AppLink key={item.title} to={{ page: item.page }} navigate={navigate} current={section === item.title}><NavigationIcon name={item.title} />{item.title}</AppLink>)}
        {access.embed && visiblePage(access, 'ask-o') && link('ask-o')}
        <AppLink to={{ page: 'ideas' }} navigate={navigate} current={section === 'Ideas'}><NavigationIcon name="Ideas" />Ideas</AppLink>
      </nav>
      {section === 'Analyses' && visiblePage(access, 'analyses') && <nav className="section-nav" aria-label="Analyses"><AppLink to={{ page: 'analyses' }} navigate={navigate} current={route?.page === 'analyses'}>My analyses</AppLink><AppLink to={{ page: 'author' }} navigate={navigate} current={route?.page === 'author'}>Author</AppLink></nav>}
      <button type="button" className="rail-more" aria-expanded={moreOpen} aria-controls="more-navigation" onClick={() => setMoreOpen(open => !open)}><NavigationIcon name="More" />More<span className="rail-chevron" aria-hidden="true"><VectorIcon path={moreOpen ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} size={12} /></span></button>
      <div id="more-navigation" hidden={!moreOpen}>
        <nav className="section-nav" aria-label="Admin"><span className="rail-group-title">Admin</span>{adminPages.filter(page => visiblePage(access, page)).map(link)}</nav>
        <nav className="section-nav developer-nav" aria-label="Developer tools"><span className="rail-group-title">Developer tools</span>{developerPages.filter(page => visiblePage(access, page)).map(link)}</nav>
      </div>
      <section className="rail-recents" aria-label="Recents">
        <h2>Recents</h2><p className="recents-caption">Pages visited this session</p>
        {recentPages.length ? <nav aria-label="Recent pages">{recentPages.map(link)}</nav> : <p className="recents-empty">No recent pages yet.</p>}
      </section>
    </div>}
    {navigation !== 'hidden' && section === 'Data' && <nav inert={navigation === 'disabled'} aria-disabled={navigation === 'disabled' || undefined} className="section-nav" aria-label="Data">{dataPages.filter(page => visiblePage(access, page)).map(link)}</nav>}
  </>;
}
