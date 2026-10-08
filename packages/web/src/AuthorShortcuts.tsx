import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { focusAuthorControl } from './AuthorToolbar.js';
import { AUTHOR_SHORTCUTS, listenForAuthorShortcuts, shortcutKeys } from './keyboard-shortcuts.js';
import { useCommandPalette } from './CommandPalette.js';

export function AuthorShortcuts({ workspace, onSave }: { workspace: RefObject<HTMLDivElement | null>; onSave: () => void }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const palette = useCommandPalette();
  // Keep a single listener (and its IME state) while using the latest draft.
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    const document = workspace.current?.ownerDocument;
    if (!document) return;
    return listenForAuthorShortcuts(document, {
      'save-draft': () => save.current(),
      'focus-search': () => focusAuthorControl(workspace.current, '.analysis-search'),
      'shortcuts-help': () => setHelpOpen(true),
      'toggle-command-palette': palette?.open,
    });
  }, [workspace, palette]);
  return helpOpen ? <ShortcutsHelpDialog onClose={() => setHelpOpen(false)} /> : null;
}

export function ShortcutsHelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = dialog?.ownerDocument.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus?.();
    };
  }, []);
  return <dialog ref={ref} className="shortcuts-dialog" aria-labelledby={title} onCancel={onClose}>
    <header><h2 id={title}>Keyboard shortcuts</h2><button type="button" autoFocus aria-label="Close keyboard shortcuts" aria-keyshortcuts="Escape" onClick={onClose}>Close <span aria-hidden="true">×</span></button></header>
    <p>Use Cmd on Mac or Ctrl on Windows/Linux. Except Esc, shortcuts are paused in inputs, selections, and editable text.</p>
    {[...new Set(AUTHOR_SHORTCUTS.map(shortcut => shortcut.group))].map(group => <section key={group}>
      <h3>{group}</h3>
      <dl>{AUTHOR_SHORTCUTS.filter(shortcut => shortcut.group === group).map(shortcut => <div key={shortcut.id}>
        <dt>{shortcut.label}</dt>
        <dd>{shortcutKeys(shortcut).map((key, index) => <span key={key}>{index > 0 && <span aria-hidden="true"> + </span>}<kbd>{key}</kbd></span>)}</dd>
      </div>)}</dl>
    </section>)}
  </dialog>;
}
