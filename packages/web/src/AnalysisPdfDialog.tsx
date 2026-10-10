import { useId, useLayoutEffect, useRef } from 'react';

/** Native PDF output uses the same rendered-sheet snapshot as Print. */
export function AnalysisPdfDialog({ onContinue, onClose }: { onContinue: () => void; onClose: () => void }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current, previous = dialog?.ownerDocument.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="analysis-file-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id={`${id}-title`}>Export to PDF</h2>
    <div id={`${id}-help`}>
      <p>In the browser print dialog, choose <strong>Save as PDF</strong> (or your system’s PDF destination), then Save. If your browser has no PDF destination, use a browser that supports it.</p>
      <p>Exports a snapshot of the current sheet, including its current selections and visible table rows. Other sheets and rows outside table scroll areas are not included. The sheet fits one landscape page; large sheets appear smaller.</p>
    </div>
    <div className="dialog-actions"><button type="button" autoFocus onClick={onContinue}>Continue to Save as PDF</button><button type="button" onClick={onClose}>Cancel</button></div>
  </dialog>;
}
