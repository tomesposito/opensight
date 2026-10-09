import { useAccess } from './access.js';
import { AppLink, type Navigate } from './AppNavigation.js';
import { pages, visiblePage, type Page } from './app-navigation.js';

export function RecentPages({ recentPages, navigate }: { recentPages: readonly Page[]; navigate: Navigate }) {
  return recentPages.length ? <ul className="recent-pages">{recentPages.map(page => <li key={page}><AppLink to={{ page }} navigate={navigate}>{pages[page].title}</AppLink></li>)}</ul>
    : <p className="recents-empty">No recent pages yet.</p>;
}

export function MyStuff({ recentPages, navigate }: { recentPages: readonly Page[]; navigate: Navigate }) {
  const access = useAccess();
  const collections: Page[] = ['analyses', 'dashboards', 'my-folders', 'shared-folders'];
  return <section className="collection-page my-stuff-page" aria-labelledby="my-stuff-title">
    <h1 id="my-stuff-title">My stuff</h1>
    <div className="collection-card">
      <h2>Your collections</h2>
      <p>Open a collection to find your work. Saved analyses are stored on this device.</p>
      <nav className="my-stuff-links" aria-label="Your collections">{collections.filter(page => visiblePage(access, page)).map(page => <AppLink key={page} to={{ page }} navigate={navigate}>{pages[page].title}</AppLink>)}</nav>
    </div>
    <div className="collection-card">
      <h2>Recent pages</h2>
      <p>Pages visited this session. This list clears when you reload or sign out.</p>
      <RecentPages recentPages={recentPages} navigate={navigate} />
    </div>
  </section>;
}

export function FolderEmptyState({ shared, navigate }: { shared: boolean; navigate: Navigate }) {
  const access = useAccess();
  return <section className="collection-page folder-page" aria-labelledby="folder-page-title">
    <h1 id="folder-page-title">{shared ? 'Shared folders' : 'My folders'}</h1>
    <div className="collection-card folder-empty-state">
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false"><path d="M5 13h14l4 5h20v22H5zM5 13V9h14l4 4h17v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      <h2>Folder browsing is not available here yet</h2>
      <p>{shared ? 'Shared folders organize work made available by other people.' : 'Folders organize analyses and dashboards.'}</p>
      <p>{access.mode === 'hosted' ? 'Your hosted folders have not been loaded. This UI does not browse or manage folders yet.' : 'Folder storage and sharing need a hosted API. This workspace does not create or list folders.'}</p>
      <AppLink to={{ page: 'organization' }} navigate={navigate}>About folders and sharing</AppLink>
    </div>
  </section>;
}
