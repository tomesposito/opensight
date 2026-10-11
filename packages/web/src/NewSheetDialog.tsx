import { useId, useLayoutEffect, useRef, useState, type Dispatch } from 'react';
import { DEFAULT_LAYOUT_SETTINGS, type AuthorAction } from './authoring.js';

export const SHEET_LAYOUT_MODES = ['tiled'] as const;
export const OPTIMIZE_WIDTHS = [1280, 1600, 1920, 2400] as const;

export function NewSheetDialog({ defaultName, defaultWidth, dispatch, onClose }: {
  defaultName: string; defaultWidth: number; dispatch: Dispatch<AuthorAction>; onClose: () => void;
}) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(defaultName);
  const [optimizeWidth, setOptimizeWidth] = useState(String(OPTIMIZE_WIDTHS.includes(defaultWidth as (typeof OPTIMIZE_WIDTHS)[number]) ? defaultWidth : DEFAULT_LAYOUT_SETTINGS().optimizeWidth));
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
      dispatch({ type: 'sheet-add', name, settings: { ...DEFAULT_LAYOUT_SETTINGS(), optimizeWidth: Number(optimizeWidth) } });
      onClose();
    }}>
      <h2 id={`${id}-title`}>New sheet</h2>
      <p id={`${id}-help`}>Choose the kind of sheet to add to the analysis.</p>
      <div className="sheet-type-cards" role="radiogroup" aria-label="Sheet type">
        <label className="sheet-type-card">
          <input type="radio" name={`${id}-type`} value="interactive" defaultChecked />
          <span><strong>Interactive sheet</strong><span>Single page, interactive content.</span></span>
        </label>
        <label className="sheet-type-card sheet-type-card-disabled">
          <input type="radio" name={`${id}-type`} value="pixel-perfect" disabled aria-describedby={`${id}-pixel-note`} />
          <span><strong>Pixel-Perfect report</strong><span>Multi-page, highly formatted document.</span>
            <span id={`${id}-pixel-note`} role="note">Pixel-perfect reports are a future polish item and are not built yet, so this card is unavailable.</span></span>
        </label>
      </div>
      <label>Sheet name<input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label>
      <label>Layout<select defaultValue="tiled" aria-label="Layout">{SHEET_LAYOUT_MODES.map(mode => <option value={mode} key={mode}>{mode === 'tiled' ? 'Tiled' : mode}</option>)}</select></label>
      <label>Optimize for viewing on<select value={optimizeWidth} onChange={event => setOptimizeWidth(event.target.value)} aria-label="Optimize for viewing on">{OPTIMIZE_WIDTHS.map(width => <option value={width} key={width}>{width}px</option>)}</select></label>
      <p>The layout stays tiled; “Optimize for viewing on” sets the sheet canvas design width in pixels.</p>
      <div className="dialog-actions"><button type="submit">Create sheet</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}
