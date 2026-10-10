import { useId, useLayoutEffect, useRef, useState, type Dispatch } from 'react';
import { DEFAULT_LAYOUT_SETTINGS, layoutSettingsValid, type AuthorAction, type AuthorSheet } from './authoring.js';

export function SheetLayoutSettings({ sheet, dispatch, onClose }: { sheet: AuthorSheet; dispatch: Dispatch<AuthorAction>; onClose: () => void }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null);
  const current = sheet.layoutSettings ?? DEFAULT_LAYOUT_SETTINGS();
  const [rowHeight, setRowHeight] = useState(String(current.rowHeight));
  const [margin, setMargin] = useState(String(current.margin));
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const dialog = ref.current, previous = dialog?.ownerDocument.activeElement;
    dialog?.showModal(); dialog?.querySelector('input')?.select();
    return () => {
      dialog?.close();
      if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="analysis-file-dialog analysis-settings-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const settings = { rowHeight: Number(rowHeight), margin: Number(margin) };
      if (!layoutSettingsValid(settings)) { setError('Row height must be 20–120 pixels and spacing 0–48 pixels.'); return; }
      dispatch({ type: 'sheet-layout-settings', id: sheet.id, settings }); onClose();
    }}>
      <h2 id={`${id}-title`}>Layout Settings</h2>
      <p id={`${id}-help`}>Settings belong to the sheet “{sheet.name}” and are saved with the analysis. Apply changes together; Undo restores the previous settings.</p>
      <label>Row height (pixels)<input inputMode="numeric" value={rowHeight} onChange={event => setRowHeight(event.target.value)} /></label>
      <label>Spacing between items (pixels)<input inputMode="numeric" value={margin} onChange={event => setMargin(event.target.value)} /></label>
      <p>Row height sets the grid row size; spacing sets the gap between visuals and objects on the canvas.</p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="submit">Apply settings</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}
