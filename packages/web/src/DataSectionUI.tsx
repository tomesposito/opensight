import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

export function DataTabs<T extends string>({ label, tabs, selected, select }: { label: string; tabs: readonly T[]; selected: T; select: (tab: T) => void }) {
  const id = useId();
  return <div className="data-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => <button type="button" key={tab} id={`${id}-${index}`} role="tab" aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1} onClick={() => select(tab)} onKeyDown={event => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined;
    if (next === undefined) return;
    event.preventDefault(); select(tabs[next]!); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }}>{tab}</button>)}</div>;
}
export function DataMenu({ label, children }: { label: string; children: ReactNode }) {
  return <details className="data-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
    <summary aria-label={label}>⋮</summary><div className="data-menu-items" onClick={event => { const target = event.target; if (target instanceof HTMLButtonElement && !target.disabled) { const disclosure = event.currentTarget.parentElement; if (disclosure instanceof HTMLDetailsElement) disclosure.open = false; } }}>{children}</div>
  </details>;
}
export function DataDialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current, previous = dialog?.ownerDocument.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="data-dialog" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id={`${id}-title`}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div><button type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button></header>{children}
  </dialog>;
}
export function DataTable({ headings, children, empty }: { headings: readonly string[]; children?: ReactNode; empty?: string }) {
  return <div className="data-table-scroll"><table className="data-table"><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}{empty && <tr><td colSpan={headings.length} className="data-table-empty">{empty}</td></tr>}</tbody></table></div>;
}
