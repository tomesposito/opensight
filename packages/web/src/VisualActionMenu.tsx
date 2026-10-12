import { useState } from 'react';
import type { FilterAction, NavigationAction, Selection, UrlAction } from './interactions.js';

/**
 * QuickSight-style ⋯ overflow menu for menu-option actions. Shared by the
 * author card and the dashboard (view) card: menu items run against the
 * visual's current selection and stay disabled until a data point is
 * selected.
 */
export function VisualActionMenu({ items, selection, onInvoke }: { items: (FilterAction | UrlAction | NavigationAction)[]; selection?: Selection; onInvoke: (action: FilterAction | UrlAction | NavigationAction) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="visual-action-menu">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Run action" onClick={e => { e.stopPropagation(); setOpen(value => !value); }}>⋯</button>
    {open && <div role="menu">{items.map(action => <button key={action.id} type="button" role="menuitem" disabled={!selection} title={selection ? undefined : 'Select a data point first'} onClick={e => { e.stopPropagation(); setOpen(false); onInvoke(action); }}>{action.name}</button>)}</div>}
  </div>;
}
