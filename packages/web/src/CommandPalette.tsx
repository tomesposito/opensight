import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useAccess } from './access.js';
import type { Navigate } from './AppNavigation.js';
import { filterCommands, navigationCommands, type Command } from './command-palette.js';
import { listenForAuthorShortcuts } from './keyboard-shortcuts.js';
import { useToast } from './Toasts.js';

type CommandGroup = { commands: readonly Command[]; chrome?: 'light' | 'dark' };
type PaletteContext = { open: () => void; register: (id: string, group: CommandGroup) => () => void };
const Context = createContext<PaletteContext | undefined>(undefined);
export const useCommandPalette = () => useContext(Context);

/** Register only while the UI owning these actions is available. Callers memoize
 * the group so unrelated provider updates do not restart registration. */
export function usePaletteCommands(group: CommandGroup) {
  const palette = useCommandPalette(), id = useId();
  useEffect(() => palette?.register(id, group), [palette, id, group]);
}

export function CommandPaletteProvider({ navigate, children }: { navigate: Navigate; children: ReactNode }) {
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ReadonlyMap<string, CommandGroup>>(new Map());
  const register = useCallback((id: string, group: CommandGroup) => {
    setGroups(current => new Map(current).set(id, group));
    return () => setGroups(current => { const next = new Map(current); next.delete(id); return next; });
  }, []);
  const palette = useMemo(() => ({ open: () => setOpen(true), register }), [register]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    return listenForAuthorShortcuts(document, { 'toggle-command-palette': palette.open });
  }, [palette]);
  const registered = [...groups.values()];
  const commands = [...navigationCommands(access, navigate), ...registered.flatMap(group => group.commands)];
  const chrome = registered.find(group => group.chrome)?.chrome ?? 'light';
  return <Context.Provider value={palette}>
    {children}
    {open && <CommandPaletteDialog commands={commands} chrome={chrome} onClose={() => setOpen(false)} />}
  </Context.Provider>;
}

export function CommandPaletteDialog({ commands, chrome = 'light', onClose }: { commands: readonly Command[]; chrome?: 'light' | 'dark'; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const previous = useRef<HTMLElement | null>(null), composing = useRef(false), running = useRef(false);
  const restored = useRef(false);
  const id = useId(), notify = useToast();
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string>();
  const results = filterCommands(commands, query);
  const active = results.find(command => command.id === selected) ?? results[0];
  const optionId = (command: Command) => `${id}-option-${encodeURIComponent(command.id)}`;
  const restoreFocus = () => {
    if (restored.current) return;
    restored.current = true;
    if (previous.current?.isConnected) previous.current.focus();
  };
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    previous.current = dialog?.ownerDocument.activeElement as HTMLElement | null;
    restored.current = false;
    dialog?.showModal(); inputRef.current?.focus();
    return () => {
      dialog?.close();
      restoreFocus();
    };
  }, []);
  useEffect(() => {
    if (active) dialogRef.current?.ownerDocument.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active?.id]);
  const execute = async (command: Command) => {
    if (running.current) return;
    running.current = true;
    const document = dialogRef.current?.ownerDocument;
    // Finish modal cleanup before navigation or Q's own focus effect runs.
    dialogRef.current?.close(); restoreFocus();
    flushSync(onClose);
    try {
      let result: void | Promise<void> = undefined;
      flushSync(() => { result = command.run(); });
      await result;
    } catch (error) {
      notify(`Could not run ${command.label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!previous.current?.isConnected) document?.querySelector<HTMLElement>('.product-header .brand')?.focus();
    }
  };
  return <dialog ref={dialogRef} className="command-palette" data-chrome={chrome} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={onClose}>
    <header><h2 id={`${id}-title`}>Command palette</h2><button type="button" aria-label="Close command palette" aria-keyshortcuts="Escape" onClick={onClose}>Close <span aria-hidden="true">×</span></button></header>
    <label className="sr-only" htmlFor={`${id}-search`}>Search commands</label>
    <input ref={inputRef} id={`${id}-search`} type="text" role="combobox" autoComplete="off" spellCheck={false}
      aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={active ? optionId(active) : undefined}
      aria-describedby={`${id}-help`} aria-keyshortcuts="Meta+K Control+K" placeholder="Search commands…" value={query}
      onChange={event => { setQuery(event.target.value); setSelected(undefined); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (results.length) {
            const index = results.findIndex(command => command.id === active?.id);
            setSelected(results[(index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length]!.id);
          }
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (active && !event.repeat) void execute(active);
        }
      }} />
    <ul id={`${id}-results`} role="listbox" aria-label="Commands">
      {results.map(command => <li key={command.id} id={optionId(command)} role="option" aria-selected={command.id === active?.id}
        onPointerDown={event => event.preventDefault()} onClick={() => { void execute(command); }}>{command.label}</li>)}
    </ul>
    <p className="command-count" role="status">{results.length ? `${results.length} ${results.length === 1 ? 'command' : 'commands'}` : 'No matching commands'}</p>
    <p id={`${id}-help`}>↑ ↓ to move · Enter to run · Esc to close</p>
  </dialog>;
}
