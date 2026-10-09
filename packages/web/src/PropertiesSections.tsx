import { useId, type Dispatch, type ReactNode } from 'react';
import type { AuthorAction, AuthorVisual } from './authoring.js';

type SectionProps = { visual: AuthorVisual; dispatch: Dispatch<AuthorAction> };

/** Reference affordances must never save settings the renderer cannot honor. */
function Unavailable({ label, reason, children }: { label: string; reason: string; children: ReactNode }) {
  const reasonId = useId();
  return <fieldset className="property-unavailable" disabled aria-label={label} aria-describedby={reasonId} title={reason}>
    {children}<p className="field-hint" id={reasonId}>{reason}</p>
  </fieldset>;
}

export function CardTitle({ visual, dispatch }: SectionProps) {
  return <section className="property-group" aria-label="Card title"><h4>CARD TITLE</h4>
    <label>Edit title<input aria-label="Title" value={visual.title} placeholder="Generated from fields" onChange={e => dispatch({ type: 'title', title: e.target.value })} /></label>
    <label className="toggle"><input type="checkbox" checked={visual.titleVisible} onChange={e => dispatch({ type: 'display', property: 'titleVisible', value: e.target.checked })} />Show title</label>
    <label>Title font size<input type="number" min="8" max="48" value={visual.formatting?.titleFontSize ?? 14} onChange={e => dispatch({ type: 'formatting', formatting: { ...visual.formatting, titleFontSize: Number(e.target.value) } })} /></label>
    <label>Edit subtitle<input aria-label="Subtitle" value={visual.subtitle ?? ''} onChange={e => dispatch({ type: 'subtitle', subtitle: e.target.value, visible: visual.subtitleVisible !== false })} /></label>
    <label className="toggle"><input type="checkbox" checked={visual.subtitleVisible !== false} onChange={e => dispatch({ type: 'subtitle', subtitle: visual.subtitle ?? '', visible: e.target.checked })} />Show subtitle</label>
    <Unavailable label="Alt text" reason="Custom alt text is not supported yet. Charts use their title as the accessible description.">
      <label>Alt text<textarea rows={2} /></label>
    </Unavailable>
  </section>;
}
