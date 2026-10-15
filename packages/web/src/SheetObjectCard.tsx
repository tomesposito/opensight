import { useState, type CSSProperties, type Dispatch } from 'react';
import { activeSheet, GRID_COLUMNS, sheetParameters, type AuthorAction, type AuthorDraft, type AuthorSheet } from './authoring.js';
import { linkUrlProblem, resolveTextParameters, type SheetObject, type TextObject, type TextStyle } from './sheet-objects.js';

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
    {object.kind === 'text' ? <>
      <textarea className="sheet-text-editor" aria-label={`${label} content`} maxLength={20000} value={object.content} style={textCss(object.style)} onChange={e => dispatch({ type: 'object-text', id: object.id, content: e.target.value })} />
      {object.linkUrl && <p className="field-hint">Link: <a href={object.linkUrl} target="_blank" rel="noopener noreferrer">{object.linkUrl}</a></p>}
    </>
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
        <label>Text alignment<select aria-label="Text alignment" value={object.style.alignment} onChange={e => style({ alignment: e.target.value as TextStyle['alignment'] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <TextLinkControls object={object} dispatch={dispatch} />
        <TextParameterControls object={object} draft={draft} dispatch={dispatch} />
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

/** Whole-box hyperlink editing for text boxes. The reducer keeps the change only
 * when the URL passes linkUrlProblem, so Apply is additionally gated here for
 * immediate feedback. */
function TextLinkControls({ object, dispatch }: { object: TextObject; dispatch: Dispatch<AuthorAction> }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(object.linkUrl ?? '');
  const problem = linkUrlProblem(input.trim());
  const apply = () => {
    if (problem) return;
    dispatch({ type: 'object-link', id: object.id, linkUrl: input.trim() });
    setOpen(false);
  };
  return <div className="object-text-link">
    <button type="button" aria-expanded={open} onClick={() => { setInput(object.linkUrl ?? ''); setOpen(!open); }}>{object.linkUrl ? 'Edit hyperlink' : 'Hyperlink'}</button>
    {open && <>
      <label>Link URL<input aria-label="Hyperlink URL" type="url" placeholder="https://" maxLength={2048} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} /></label>
      {problem && input.trim() && <p className="field-error" role="alert">{problem}</p>}
      <div><button type="button" disabled={!!problem} onClick={apply}>Apply</button>
        {object.linkUrl && <button type="button" onClick={() => { dispatch({ type: 'object-link', id: object.id, linkUrl: '' }); setInput(''); setOpen(false); }}>Remove link</button>}</div>
      <p className="field-hint">The whole text box becomes a link. Only http:// and https:// URLs are accepted.</p>
    </>}
  </div>;
}

/** Insert `$name` parameter placeholders into the text-box content at the canvas
 * editor's caret (falls back to appending). The preview shows what the placeholder
 * resolves to with the analysis's current parameter values. */
function TextParameterControls({ object, draft, dispatch }: { object: TextObject; draft: AuthorDraft; dispatch: Dispatch<AuthorAction> }) {
  const [open, setOpen] = useState(false);
  const params = sheetParameters(draft);
  const insert = (name: string) => {
    const placeholder = `$${name}`;
    const editor = typeof document === 'undefined' ? null
      : document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${CSS.escape(`${objectLabel(object)} content`)}"]`);
    const start = editor?.selectionStart ?? object.content.length;
    const end = editor?.selectionEnd ?? start;
    dispatch({ type: 'object-text', id: object.id, content: object.content.slice(0, start) + placeholder + object.content.slice(end) });
    setOpen(false);
    editor?.focus();
  };
  const hasPlaceholder = /\$[A-Za-z_]/.test(object.content);
  return <div className="object-text-params">
    <button type="button" aria-expanded={open} disabled={params.length === 0} title={params.length === 0 ? 'Add a parameter to the analysis first.' : undefined} onClick={() => setOpen(!open)}>Insert parameter</button>
    {params.length === 0 && <p className="field-hint">Add a parameter to the analysis to insert one here.</p>}
    {open && params.length > 0 && <ul>{params.map(p => <li key={p.id}><button type="button" onClick={() => insert(p.name)}>{`$${p.name}`}</button></li>)}</ul>}
    {hasPlaceholder && <p className="field-hint">Preview: {resolveTextParameters(object.content, params)}</p>}
  </div>;
}
