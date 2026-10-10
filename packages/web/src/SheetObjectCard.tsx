import type { CSSProperties, Dispatch } from 'react';
import { activeSheet, GRID_COLUMNS, type AuthorAction, type AuthorDraft, type AuthorSheet } from './authoring.js';
import type { SheetObject, TextStyle } from './sheet-objects.js';

export const objectLabel = (object: SheetObject) => object.kind === 'text' ? `Text box ${object.id.slice(7)}` : `Image ${object.id.slice(7)}`;
export function textCss(style: TextStyle): CSSProperties {
  return { fontSize: style.fontSize, fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : 'none', color: style.color, textAlign: style.alignment };
}
export function SheetObjectCard({ object, selected, sheet, dispatch }: { object: SheetObject; selected: boolean; sheet: AuthorSheet; dispatch: Dispatch<AuthorAction> }) {
  const label = objectLabel(object);
  return <section className={`author-card sheet-object${selected ? ' is-selected' : ''}`} aria-label={label} onFocus={() => { if (!selected) dispatch({ type: 'select', id: object.id }); }} onClick={() => { if (!selected) dispatch({ type: 'select', id: object.id }); }}>
    <div className="author-card-toolbar">
      <button type="button" className="drag-handle" aria-label={`Move ${label}`} title="Drag to move; use arrow keys to move one grid cell, Shift+arrows to resize" onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight', delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        const key = e.shiftKey ? horizontal ? 'w' : 'h' : horizontal ? 'x' : 'y';
        dispatch({ type: 'layout', sheetId: sheet.id, layout: sheet.layout.map(p => p.i === object.id ? { ...p, [key]: p[key] + delta } : p) });
      }}>⠿</button><strong>{label}</strong>
      <div className="author-card-actions"><button type="button" aria-label={`Configure ${label}`} onClick={() => dispatch({ type: 'select', id: object.id })}>Configure</button>
        <button type="button" aria-label={`Remove ${label}`} onClick={e => { e.stopPropagation(); dispatch({ type: 'remove', id: object.id }); }}>×</button></div>
    </div>
    {object.kind === 'text' ? <textarea className="sheet-text-editor" aria-label={`${label} content`} maxLength={20000} value={object.content} style={textCss(object.style)} onChange={e => dispatch({ type: 'object-text', id: object.id, content: e.target.value })} />
      : <div className="sheet-image-frame"><img draggable={false} src={object.dataUri} alt={object.alt} style={{ objectFit: object.keepAspectRatio ? 'contain' : 'fill', opacity: object.opacity }} /></div>}
  </section>;
}
export function SheetObjectProperties({ object, draft, dispatch }: { object: SheetObject; draft: AuthorDraft; dispatch: Dispatch<AuthorAction> }) {
  const sheet = activeSheet(draft), placement = sheet.layout.find(p => p.i === object.id)!;
  const style = (change: Partial<TextStyle>) => dispatch({ type: 'object-style', id: object.id, style: change });
  return <div className="sheet-object-properties" aria-label={`${objectLabel(object)} properties`}>
    <h3>{objectLabel(object)}</h3>
    <details className="property-section" open><summary>Display settings</summary>
      {object.kind === 'text' ? <>
        <p className="field-hint">Edit text on the canvas. Formatting applies to the entire text box.</p>
        <label>Font size<input aria-label="Text font size" type="number" min="8" max="96" value={object.style.fontSize} onChange={e => style({ fontSize: Number(e.target.value) })} /></label>
        <div className="object-text-style" role="group" aria-label="Text style">{(['bold', 'italic', 'underline'] as const).map(key => <button type="button" key={key} aria-pressed={object.style[key]} onClick={() => style({ [key]: !object.style[key] })}>{key[0]!.toUpperCase() + key.slice(1)}</button>)}</div>
        <label>Text color<input type="color" value={object.style.color} onChange={e => style({ color: e.target.value })} /></label>
        <label>Text alignment<select value={object.style.alignment} onChange={e => style({ alignment: e.target.value as TextStyle['alignment'] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <fieldset disabled aria-describedby="text-unavailable"><button type="button">Hyperlink</button><button type="button">Insert parameter</button></fieldset><p id="text-unavailable" className="field-hint">Text hyperlinks and parameters-in-text are not supported yet.</p>
      </> : <>
        <p className="field-hint">Embedded on this device, up to 4 MiB per image. No upload or hosted image service. Exported definitions include the image bytes.</p>
        <label>Image description<input maxLength={512} value={object.alt} onChange={e => dispatch({ type: 'object-image', id: object.id, alt: e.target.value })} /></label>
        <label className="toggle"><input type="checkbox" checked={object.keepAspectRatio} onChange={e => dispatch({ type: 'object-image', id: object.id, keepAspectRatio: e.target.checked })} />Keep image aspect ratio</label>
        <p className="field-hint">The image fits inside its grid frame without cropping. Clear this option to stretch it to fill.</p>
        <label>Image opacity (%)<input type="number" min="0" max="100" value={Math.round(object.opacity * 100)} onChange={e => dispatch({ type: 'object-image', id: object.id, opacity: Number(e.target.value) / 100 })} /></label>
        <label>Image URL<input disabled aria-describedby="image-url-unavailable" /></label><p id="image-url-unavailable" className="field-hint">Remote image URLs are unavailable. Insert an image from this device.</p>
      </>}
    </details>
    <details className="property-section object-placement" open><summary>Placement</summary><p className="field-hint">Grid cells. The Move handle also supports arrow keys; Shift+arrows resizes.</p>
      {(['x', 'y', 'w', 'h'] as const).map((key, index) => <label key={key}>{['Column', 'Row', 'Width', 'Height'][index]}<input aria-label={`Object ${['column', 'row', 'width', 'height'][index]}`} type="number" min={key === 'w' ? 3 : key === 'h' ? 4 : 0} max={key === 'x' ? GRID_COLUMNS - placement.w : key === 'w' ? GRID_COLUMNS - placement.x : 10000 - (key === 'y' ? placement.h : placement.y)} value={placement[key]} onChange={e => dispatch({ type: 'layout', sheetId: sheet.id, layout: sheet.layout.map(p => p.i === object.id ? { ...p, [key]: Number(e.target.value) } : p) })} /></label>)}
    </details>
    <button type="button" onClick={() => dispatch({ type: 'remove', id: object.id })}>Remove selected object</button>
  </div>;
}
