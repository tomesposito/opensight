import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { usePaletteCommands } from './CommandPalette.js';

const MenuName = createContext('');
const MenuReasons = createContext<{ revealed: readonly string[]; reveal: (id: string) => void } | undefined>(undefined);

export function AuthorMenu({ name, children }: { name: string; children: ReactNode }) {
  const [revealed, setRevealed] = useState<readonly string[]>([]);
  // A reason must not collapse between pointer-down (focus transfer) and click
  // on a lower item. Keep revealed reasons until the disclosure closes.
  return <details name="analysis-menu" data-author-menu={name} onToggle={event => { if (!event.currentTarget.open) setRevealed([]); }}><summary>{name}</summary><div className="menu-popover">
    <MenuName.Provider value={name}><MenuReasons.Provider value={{ revealed, reveal: id => setRevealed(previous => previous.includes(id) ? previous : [...previous, id]) }}>{children}</MenuReasons.Provider></MenuName.Provider>
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
  const reasons = useContext(MenuReasons);
  // Search and the menus execute the same callbacks with the same guards.
  usePaletteCommands(useMemo(() => ({ commands: menu && run && !reason ? [
    { id: `menu-${id}`, label: `${menu}: ${label}`, run },
  ] : [] }), [id, menu, label, run, reason]));
  return <div className="author-menu-item" data-reason-revealed={reasons?.revealed.includes(id) || undefined} onPointerEnter={() => { if (reason) reasons?.reveal(id); }} onFocus={() => { if (reason) reasons?.reveal(id); }}>
    <button type="button" aria-keyshortcuts={keyShortcuts} aria-disabled={!!reason} aria-describedby={reason ? id : descriptionId}
      role={checked === undefined ? undefined : 'checkbox'} aria-checked={checked} aria-readonly={checked === undefined ? undefined : true}
      title={reason} data-menu-keep-open={keepOpen || undefined}
      onClick={() => { if (!reason) run?.(); }}>
      {checked === undefined ? label : <><span className="menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>{label}</>}
    </button>
    {reason && <small id={id} className="menu-item-reason">{reason}</small>}
  </div>;
}
