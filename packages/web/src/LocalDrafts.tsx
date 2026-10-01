import { useState } from 'react';
import type { DraftSummary } from './local-drafts.js';

export function LocalDrafts({ entries, activeId, onOpen, onRename, onDelete, onRefresh }: {
  entries: DraftSummary[]; activeId?: string; onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void; onDelete: (id: string) => void; onRefresh: () => void;
}) {
  const [rename, setRename] = useState<{ id: string; name: string }>();
  return <details className="local-drafts" onToggle={e => { if (e.currentTarget.open) onRefresh(); }}>
    <summary>Local drafts ({entries.length})</summary>
    <p>Saved in this browser on this device. Not synced or shared. Export .qs or JSON to share a definition; data is not included.</p>
    <button type="button" onClick={onRefresh}>Refresh drafts</button>
    {!entries.length && <p>No saved analyses yet. Use Save draft to keep your work.</p>}
    <ul>{entries.map(entry => <li key={entry.id}>
      <div><strong>{entry.name}</strong>{entry.id === activeId && <span> · Open</span>}<small>Updated {entry.updatedAt === new Date(0).toISOString() ? 'before draft history was available' : <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time>}</small>{entry.problem && <p role="alert">{entry.problem}</p>}</div>
      <button type="button" disabled={!!entry.problem} onClick={() => onOpen(entry.id)}>Reopen</button>
      <button type="button" disabled={!!entry.problem} onClick={() => setRename({ id: entry.id, name: entry.name })}>Rename</button>
      <button type="button" onClick={() => { onDelete(entry.id); setRename(undefined); }}>Delete</button>
    </li>)}</ul>
    {rename && <form onSubmit={e => { e.preventDefault(); onRename(rename.id, rename.name); setRename(undefined); }}>
      <label>Draft name<input autoFocus value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} /></label>
      <button type="submit" disabled={!rename.name.trim()}>Save draft name</button><button type="button" onClick={() => setRename(undefined)}>Cancel</button>
    </form>}
  </details>;
}
