import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { allowed, useAccess } from './access.js';
import { OEntry } from './OEntry.js';

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
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const trigger = <button ref={triggerRef} type="button" className="q-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(true)}>
    <span className="o-mark" aria-hidden="true">Q</span> Ask a question about {entry.draft.dataset?.name ?? 'Local sales'}
  </button>;
  return <>
    {renderTrigger ? renderTrigger(trigger) : <div className="q-entry">{trigger}</div>}
    {open && <div ref={panelRef} id={id} className="q-side-panel" role="dialog" aria-labelledby={`${id}-heading`} onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <header className="q-panel-heading"><h2 id={`${id}-heading`}>ASK Q</h2><button type="button" aria-label="Close Ask Q" onClick={close}>Close <span aria-hidden="true">×</span></button></header>
      <div className="q-panel-content"><OEntry {...entry} /></div>
    </div>}
  </>;
}
