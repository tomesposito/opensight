import { useState } from 'react';
import type { DraftSummary } from './local-drafts.js';

export function LocalDrafts({ entries, activeId, onOpen, onRename, onDelete, onRefresh, expanded = false }: {
  expanded?: boolean;
  entries: DraftSummary[]; activeId?: string; onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void; onDelete: (id: string) => void; onRefresh: () => void;
}) {
  const [rename, setRename] = useState<{ id: string; name: string }>();
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favoriteFilter = <label><input type="checkbox" checked={favoritesOnly} onChange={e => { setFavoritesOnly(e.target.checked); setPage(0); }} />Favorites only</label>;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const matches = entries.filter(entry => (!favoritesOnly || entry.favorite) && entry.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const updated = (entry: DraftSummary) => entry.updatedAt === new Date(0).toISOString() ? 'Before draft history was available' : <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time>;
  const actions = (entry: DraftSummary) => <>
    <button type="button" disabled={!!entry.problem} onClick={() => onOpen(entry.id)}>Open</button>
    <button type="button" disabled={!!entry.problem} onClick={() => setRename({ id: entry.id, name: entry.name })}>Rename</button>
    <button type="button" onClick={() => { onDelete(entry.id); setRename(undefined); }}>Delete</button>
  </>;
  const renameForm = rename && <form className="draft-rename" onSubmit={e => { e.preventDefault(); onRename(rename.id, rename.name); setRename(undefined); }}>
    <label>Draft name<input autoFocus value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} /></label>
    <button type="submit" disabled={!rename.name.trim()}>Save draft name</button><button type="button" onClick={() => setRename(undefined)}>Cancel</button>
  </form>;
  if (expanded) return <section className="local-drafts draft-collection" aria-label="Local drafts">
    <div className="draft-collection-tools">{favoriteFilter}<label>Search analyses<input type="search" value={search} placeholder="Search analyses by name" onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><button type="button" onClick={onRefresh}>Refresh drafts</button></div>
    <div className="collection-table-scroll" role="region" aria-label="Saved analyses" tabIndex={0}><table>
      <thead><tr><th scope="col">Name</th><th scope="col">Last updated</th><th scope="col">Actions</th></tr></thead>
      <tbody>{matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(entry => <tr key={entry.id}>
        <td><button type="button" className="draft-name-link" disabled={!!entry.problem} onClick={() => onOpen(entry.id)} aria-label={`Open ${entry.name}`}><strong>{entry.name}</strong>{entry.favorite && <span className="collection-badge">Favorite</span>}</button>{entry.sample && <span className="collection-badge">Sample data</span>}{entry.problem && <p role="alert">{entry.problem}</p>}</td>
        <td>{updated(entry)}</td><td><div className="collection-row-actions" aria-label={`Actions for ${entry.name}`}>{actions(entry)}</div></td>
      </tr>)}</tbody>
    </table>{!matches.length && <p className="collection-no-results" role="status">{favoritesOnly ? 'No favorite analyses match.' : entries.length ? 'No analyses match your search.' : 'No saved analyses yet. Use Save draft to keep your work.'}</p>}</div>
    <div className="collection-pagination"><span role="status">{matches.length} {matches.length === 1 ? 'analysis' : 'analyses'}</span><label>Items per page<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}><option value={25}>25</option><option value={50}>50</option></select></label><button type="button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button><span>Page {currentPage + 1} of {pages}</span><button type="button" aria-label="Next page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>›</button></div>
    <p className="collection-note">Saved in this browser on this device. Not synced or shared. Export .qs or JSON to share a definition; data is not included.</p>
    {renameForm}
  </section>;
  return <details className="local-drafts" open={expanded || undefined} onToggle={e => { if (e.currentTarget.open) onRefresh(); }}>
    <summary>Local drafts ({entries.length})</summary>
    <p>Saved in this browser on this device. Not synced or shared. Export .qs or JSON to share a definition; data is not included.</p>
    <button type="button" onClick={onRefresh}>Refresh drafts</button>
    {!entries.length && <p>No saved analyses yet. Use Save draft to keep your work.</p>}
    {favoriteFilter}
    {favoritesOnly && !matches.length && <p>No favorite analyses yet.</p>}
    <ul>{matches.map(entry => <li key={entry.id}>
      <div><strong>{entry.name}</strong>{entry.favorite && <span className="collection-badge">Favorite</span>}{entry.sample && <span> · Sample data</span>}{entry.id === activeId && <span> · Open</span>}<small>Updated {entry.updatedAt === new Date(0).toISOString() ? 'before draft history was available' : <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time>}</small>{entry.problem && <p role="alert">{entry.problem}</p>}</div>
      {actions(entry)}
    </li>)}</ul>
    {renameForm}
  </details>;
}
