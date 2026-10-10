import { useId, useLayoutEffect, useRef, useState } from 'react';

export function SaveAnalysisCopy({ name, onSave, onClose }: { name: string; onSave: (name: string) => string | undefined; onClose: () => void }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(`${name.trim() || 'Untitled analysis'} (copy)`), [error, setError] = useState('');
  useLayoutEffect(() => {
    const dialog = ref.current, previous = dialog?.ownerDocument.activeElement;
    dialog?.showModal(); dialog?.querySelector('input')?.select();
    return () => {
      dialog?.close();
      if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="analysis-file-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); setError(onSave(title) ?? ''); }}>
      <h2 id={`${id}-title`}>Save as Analysis</h2>
      <p id={`${id}-help`}>Save the current edits as a separate analysis on this device and open the copy. The saved original stays unchanged. Copies use the same data sources; data is not duplicated or shared.</p>
      <label>Analysis name<input autoFocus value={title} onChange={event => setTitle(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="submit" disabled={!title.trim() || title.trim() === name.trim()}>Save copy</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}
