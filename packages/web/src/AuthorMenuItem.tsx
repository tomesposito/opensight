import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import { usePaletteCommands } from './CommandPalette.js';

const MenuName = createContext('');

export function AuthorMenu({ name, children }: { name: string; children: ReactNode }) {
  return <details name="analysis-menu" data-author-menu={name}><summary>{name}</summary><div className="menu-popover">
    <MenuName.Provider value={name}>{children}</MenuName.Provider>
  </div></details>;
}

export interface AuthorMenuAction {
  label: string;
  run?: () => void;
  reason?: string;
  checked?: boolean;
  keepOpen?: boolean;
  descriptionId?: string;
  keyShortcuts?: string;
}

/** Unavailable actions stay keyboard reachable so their reason can be read. */
export function AuthorMenuItem({ label, run, reason, checked, keepOpen, descriptionId, keyShortcuts }: AuthorMenuAction) {
  const id = useId();
  const menu = useContext(MenuName);
  // Search and the menus execute the same callbacks with the same guards.
  usePaletteCommands(useMemo(() => ({ commands: menu && run && !reason ? [
    { id: `menu-${id}`, label: `${menu}: ${label}`, run },
  ] : [] }), [id, menu, label, run, reason]));
  return <div className="author-menu-item">
    <button type="button" aria-keyshortcuts={keyShortcuts} aria-disabled={!!reason} aria-describedby={reason ? id : descriptionId}
      role={checked === undefined ? undefined : 'checkbox'} aria-checked={checked} aria-readonly={checked === undefined ? undefined : true}
      title={reason} data-menu-keep-open={keepOpen || undefined}
      onClick={() => { if (!reason) run?.(); }}>
      {checked === undefined ? label : <><span className="menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>{label}</>}
    </button>
    {reason && <small id={id} className="menu-item-reason">{reason}</small>}
  </div>;
}
