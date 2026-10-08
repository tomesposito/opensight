import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { allowed, useAccess } from './access.js';
import { OEntry } from './OEntry.js';
import { usePaletteCommands } from './CommandPalette.js';

type QSidePanelProps = Omit<ComponentProps<typeof OEntry>, 'renderBar'> & {
  renderTrigger?: (trigger: ReactNode) => ReactNode;
};

export function QSidePanel(props: QSidePanelProps) {
  const access = useAccess();
  // Keep the toolbar available when the current principal cannot ask questions.
  if (access.mode !== 'local' && !allowed(access, 'ai')) return <>{props.renderTrigger?.(null)}</>;
  return <QSidePanelContent {...props} />;
}

function QSidePanelContent({ renderTrigger, ...entry }: QSidePanelProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openPanel = useCallback(() => {
    setOpen(true);
    panelRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }, []);
  usePaletteCommands(useMemo(() => ({ commands: [{ id: 'open-qa', label: 'Open Q&A panel', keywords: 'ask question', run: openPanel }] }), [openPanel]));
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    // Non-modal: Escape still works after an answer action removes its focused
    // button, or after the user moves focus back into the analysis.
    const escape = (event: KeyboardEvent) => {
      // A native modal above this non-modal panel owns Escape (for example the
      // Author shortcuts help). Leave its cancel event and focus handling intact.
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !panel?.ownerDocument.querySelector?.('dialog[open]')) { event.preventDefault(); close(); }
    };
    panel?.ownerDocument.addEventListener('keydown', escape);
    return () => panel?.ownerDocument.removeEventListener('keydown', escape);
  }, [open, close]);
  const trigger = <button ref={triggerRef} type="button" className="q-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={openPanel}>
    <span className="o-mark" aria-hidden="true">Q</span> Ask a question about {entry.draft.dataset?.name ?? 'Local sales'}
  </button>;
  return <>
    {renderTrigger ? renderTrigger(trigger) : <div className="q-entry">{trigger}</div>}
    {open && <div ref={panelRef} id={id} className="q-side-panel" role="dialog" aria-labelledby={`${id}-heading`}>
      <header className="q-panel-heading"><h2 id={`${id}-heading`}>ASK Q</h2><button type="button" aria-label="Close Ask Q" onClick={close}>Close <span aria-hidden="true">×</span></button></header>
      <div className="q-panel-content"><OEntry {...entry} /></div>
    </div>}
  </>;
}
