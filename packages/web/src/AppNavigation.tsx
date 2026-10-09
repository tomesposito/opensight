import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useAccess } from './access.js';
import { adminPages, dataPages, developerPages, pages, parseRoute, productSections, routeHash, visiblePage, type AppRoute, type Page } from './app-navigation.js';

export function useAppRoute() {
  const [route, setRoute] = useState(() => parseRoute(typeof window === 'undefined' ? '' : window.location?.hash ?? ''));
  const [entry, setEntry] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const changed = () => { setRoute(parseRoute(window.location.hash)); setEntry(value => value + 1); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const navigate = (next: AppRoute, replace = false) => {
    const hash = routeHash(next);
    if (!replace && (!route || routeHash(route) !== hash)) setEntry(value => value + 1);
    if (typeof window !== 'undefined' && window.location?.hash !== hash) {
      // History changes do not reload either Vite or the file:// demo.
      window.history?.[replace ? 'replaceState' : 'pushState'](null, '', hash);
    }
    setRoute(next);
  };
  return { route, navigate, entry };
}
export type Navigate = (route: AppRoute, replace?: boolean) => void;
export function AppLink({ to, navigate, children, current, className }: { to: AppRoute; navigate: Navigate; children: ReactNode; current?: boolean; className?: string }) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(to);
  };
  return <a href={routeHash(to)} onClick={click} aria-current={current ? 'page' : undefined} className={className}>{children}</a>;
}
export function AppNavigation({ route, navigate, children }: { route?: AppRoute; navigate: Navigate; children?: ReactNode }) {
  const access = useAccess(), section = route && pages[route.page].section;
  const [navigationOpen, setNavigationOpen] = useState(false);
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
  const closeNavigation = () => { setNavigationOpen(false); toggle.current?.focus(); };
  const link = (page: Page) => access.mode === 'demo' && page === 'api'
    ? <span key={page} aria-disabled="true">API definition preview · Needs hosted API</span>
    : <AppLink key={page} to={{ page }} navigate={navigate} current={route?.page === page}>{pages[page].title}</AppLink>;
  return <>
    <header ref={header} className="app-header product-header">
      <button ref={toggle} className="navigation-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navigationOpen} aria-controls="product-navigation" onClick={() => setNavigationOpen(open => !open)} onKeyDown={event => { if (navigationOpen && event.key === 'Escape') { event.preventDefault(); closeNavigation(); } }}>☰</button>
      <AppLink className="brand" to={{ page: 'home' }} navigate={navigate}><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</AppLink>
      <span className="header-caption">{route ? pages[route.page].title : 'Page not found'}</span>
      {children}
    </header>
    {navigationOpen && <button type="button" className="navigation-scrim" aria-label="Close navigation" onClick={closeNavigation} />}
    <div id="product-navigation" className="product-navigation" data-open={navigationOpen} onKeyDown={event => { if (navigationOpen && event.key === 'Escape') { event.preventDefault(); closeNavigation(); } }}>
      <nav className="app-nav" aria-label="Product">{productSections.filter(item => visiblePage(access, item.page)).map(item => <AppLink key={item.title} to={{ page: item.page }} navigate={navigate} current={section === item.title}>{item.title}</AppLink>)}</nav>
    {section === 'Analyses' && visiblePage(access, 'analyses') && <nav className="section-nav" aria-label="Analyses"><AppLink to={{ page: 'analyses' }} navigate={navigate} current={route?.page === 'analyses'}>My analyses</AppLink><AppLink to={{ page: 'author' }} navigate={navigate} current={route?.page === 'author'}>Author</AppLink></nav>}
    </div>
    {section === 'Data' && <nav className="section-nav" aria-label="Data">{dataPages.filter(page => visiblePage(access, page)).map(link)}</nav>}
    {section === 'Admin' && <div className="admin-navigation"><nav className="section-nav" aria-label="Admin">{adminPages.filter(page => visiblePage(access, page)).map(link)}</nav><nav className="section-nav developer-nav" aria-label="Developer tools"><span>Developer tools</span>{developerPages.filter(page => visiblePage(access, page)).map(link)}</nav></div>}
  </>;
}
