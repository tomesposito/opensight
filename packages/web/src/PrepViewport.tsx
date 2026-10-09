import { useEffect, useRef, useState, type ReactNode } from 'react';

type View = { x: number; y: number; scale: number };
const initialView: View = { x: 24, y: 16, scale: 1 };
const minScale = 0.001;
export function zoomPrepView(view: View, scale: number, x: number, y: number): View {
  const next = Math.max(minScale, Math.min(2, scale)), ratio = next / view.scale;
  return { scale: next, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
export function fitPrepView(width: number, height: number, contentWidth: number, contentHeight: number): View {
  const scale = Math.max(minScale, Math.min(1, (width - 48) / Math.max(1, contentWidth), (height - 64) / Math.max(1, contentHeight)));
  return { scale, x: (width - contentWidth * scale) / 2, y: Math.max(16, (height - 32 - contentHeight * scale) / 2) };
}
/** View state belongs to the mounted prep session, independent of step edits. */
export function PrepViewport({ children }: { children: ReactNode }) {
  const [view, setView] = useState(initialView), [panning, setPanning] = useState(false);
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; view: View } | null>(null);
  const zoom = (factor: number) => {
    const box = viewport.current;
    setView(v => zoomPrepView(v, v.scale * factor, (box?.clientWidth ?? 0) / 2, (box?.clientHeight ?? 0) / 2));
  };
  const fit = () => {
    if (viewport.current && content.current) setView(fitPrepView(viewport.current.clientWidth, viewport.current.clientHeight, content.current.offsetWidth, content.current.offsetHeight));
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      setView(v => zoomPrepView(v, v.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), event.clientX - box.left, event.clientY - box.top));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return <div className="prep-viewport-shell">
    <div className={`prep-viewport${panning ? ' panning' : ''}`} ref={viewport} tabIndex={0} role="region" aria-label="Pipeline canvas" aria-description="Drag the canvas to pan. Scroll to zoom. Arrow keys pan; plus and minus zoom; 0 resets; F fits the pipeline."
      onPointerDown={e => {
        if (e.button !== 0 || e.isPrimary === false || (e.target as Element).closest('button, input, select, a, textarea')) return;
        e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, view }; setPanning(true);
      }}
      onPointerMove={e => {
        const start = drag.current;
        if (start?.id === e.pointerId) setView({ ...start.view, x: start.view.x + e.clientX - start.x, y: start.view.y + e.clientY - start.y });
      }}
      onPointerUp={e => { if (drag.current?.id === e.pointerId) { drag.current = null; setPanning(false); e.currentTarget.releasePointerCapture(e.pointerId); } }}
      onPointerCancel={() => { drag.current = null; setPanning(false); }}
      onLostPointerCapture={() => { drag.current = null; setPanning(false); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0', 'f', 'F'].includes(e.key)) e.preventDefault();
        if (e.key === '+' || e.key === '=') zoom(1.2);
        else if (e.key === '-') zoom(1 / 1.2);
        else if (e.key === '0') setView(initialView);
        else if (e.key.toLowerCase() === 'f') fit();
        else if (e.key.startsWith('Arrow')) setView(v => ({ ...v, x: v.x + (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0), y: v.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0) }));
      }}>
      <div ref={content} className="prep-viewport-content" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>{children}</div>
    </div>
    <div className="prep-zoom" role="group" aria-label="Canvas zoom">
      <button type="button" aria-label="Fit pipeline to view" onClick={fit}>Fit</button>
      <button type="button" aria-label="Zoom out" disabled={view.scale <= minScale} onClick={() => zoom(1 / 1.2)}>−</button>
      <button type="button" aria-label="Reset canvas view" title="Reset zoom and pan" onClick={() => setView(initialView)}>{Number((view.scale * 100).toFixed(1))}%</button>
      <button type="button" aria-label="Zoom in" disabled={view.scale >= 2} onClick={() => zoom(1.2)}>+</button>
    </div>
  </div>;
}
