import { useId } from 'react';

export interface AuthorMenuAction {
  label: string;
  run?: () => void;
  reason?: string;
  checked?: boolean;
  keepOpen?: boolean;
}

/** Unavailable actions stay keyboard reachable so their reason can be read. */
export function AuthorMenuItem({ label, run, reason, checked, keepOpen }: AuthorMenuAction) {
  const id = useId();
  return <div className="author-menu-item">
    <button type="button" aria-disabled={!!reason} aria-describedby={reason ? id : undefined}
      role={checked === undefined ? undefined : 'checkbox'} aria-checked={checked} aria-readonly={checked === undefined ? undefined : true}
      title={reason} data-menu-keep-open={keepOpen || undefined}
      onClick={() => { if (!reason) run?.(); }}>
      {checked === undefined ? label : <><span className="menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>{label}</>}
    </button>
    {reason && <small id={id} className="menu-item-reason">{reason}</small>}
  </div>;
}
