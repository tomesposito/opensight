import { useId, type Dispatch, type ReactNode } from 'react';
import type { AuthorAction, AuthorVisual } from './authoring.js';
import { hasSmallMultiplesWell } from './authoring.js';
import { hasLegend, LEGEND_POSITIONS, type LegendPosition } from './formatting.js';

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

export function CardStyle() {
  return <section className="property-group" aria-label="Card style"><h4>CARD STYLE</h4>
    <Unavailable label="Card style controls" reason="Per-card background, border, selection and loading animation settings are not supported yet. Shown placeholders are reference defaults, not applied settings.">
      <div className="property-control-row"><span>Background</span><div className="property-inline"><input type="color" aria-label="Background color" defaultValue="#ffffff" /><input aria-label="Background opacity (%)" placeholder="85%" /></div></div>
      <div className="property-control-row"><span>Border</span><div className="property-inline"><input type="color" aria-label="Border color" defaultValue="#cccccc" /><input aria-label="Border opacity (%)" placeholder="100%" /><select aria-label="Border width" defaultValue="1px"><option>1px</option></select></div></div>
      <div className="property-control-row"><span>Selection</span><div className="property-inline"><input type="color" aria-label="Selection color" defaultValue="#000000" /><input aria-label="Selection opacity (%)" placeholder="100%" /></div></div>
      <label className="toggle"><input type="checkbox" />Loading animation</label>
    </Unavailable>
  </section>;
}

export function CardLayout() {
  return <section className="property-group" aria-label="Card layout"><h4>CARD LAYOUT</h4>
    <Unavailable label="Card layout controls" reason="Per-card padding is not supported yet. 24px is a reference default, not the current canvas padding.">
      <label>Padding<select defaultValue="24px"><option>24px</option></select></label>
    </Unavailable>
  </section>;
}

function TextButtons({ label, alignment = false }: { label: string; alignment?: boolean }) {
  return <>
    <div className="property-inline" role="group" aria-label={`${label} emphasis`}>
      <button type="button" aria-label={`${label} bold`}><b>B</b></button>
      <button type="button" aria-label={`${label} italic`}><i>I</i></button>
      <button type="button" aria-label={`${label} underline`}><u>U</u></button>
    </div>
    {alignment && <div className="property-inline" role="group" aria-label={`${label} alignment`}>
      {['Left', 'Center', 'Right'].map(value => <button type="button" key={value} aria-label={`${label} align ${value.toLowerCase()}`}>{value}</button>)}
    </div>}
  </>;
}

export function MultiplesOptions({ visual }: Pick<SectionProps, 'visual'>) {
  if (!hasSmallMultiplesWell(visual.kind) && !visual.smallMultiples?.length) return null;
  return <details className="property-section"><summary>Multiples Options</summary>
    <Unavailable label="Multiples options controls" reason="Faceted preview and panel styling are not supported yet. These reference defaults are not applied; Small multiples field assignments remain saved in the draft.">
      <h4 className="property-caption">Layout</h4>
      <div className="property-inline">
        <label>Visible rows<input placeholder="Auto" /></label><label>Visible columns<input placeholder="Auto" /></label>
      </div>
      <label>Number of panels<input placeholder="20 (Default)" /></label>
      <label className="toggle"><input type="checkbox" />Panel title</label>
      <label>Title options<select defaultValue="Small"><option>Small</option></select></label>
      <TextButtons label="Panel title" alignment />
      <label className="toggle"><input type="checkbox" />Panel border</label>
      <label>Border options<select defaultValue="1px"><option>1px</option></select></label>
      <label className="toggle"><input type="checkbox" />Panel gutter</label>
      <label className="toggle"><input type="checkbox" />Panel background</label>
    </Unavailable>
  </details>;
}

function TextStyling({ label, size }: { label: string; size: number }) {
  return <>
    <h4 className="property-caption">Text styling</h4>
    <div className="property-inline">
      <select aria-label={`${label} font`} defaultValue="Analysis theme"><option>Analysis theme</option></select>
      <input aria-label={`${label} font size`} type="number" placeholder={String(size)} />
    </div>
    <TextButtons label={label} />
  </>;
}

export function GroupColorOptions({ visual, dispatch }: SectionProps) {
  if (!['bar', 'bar100', 'pie'].includes(visual.kind)) return null;
  const field = visual.dimension;
  const names = visual.formatting?.names;
  return <details className="property-section"><summary>Group/Color</summary>
    <Unavailable label="Group title controls" reason="A separate Group/Color title and its text styling are not supported yet.">
      <label className="toggle"><input type="checkbox" />Title</label>
      <TextStyling label="Group title" size={14} />
    </Unavailable>
    <label>Field name<input aria-label="Group/Color field name" disabled={!field} title={!field ? 'Assign a Group/Color field first.' : 'Display name used in generated titles and result tables.'} placeholder={field ?? 'Assign a Group/Color field first'} maxLength={128}
      value={field && names && Object.hasOwn(names, field) ? names[field] : ''}
      onChange={e => {
        if (!field) return;
        const next = { ...names };
        if (e.target.value.trim()) Object.defineProperty(next, field, { value: e.target.value, enumerable: true, writable: true, configurable: true });
        else delete next[field];
        dispatch({ type: 'formatting', formatting: { ...visual.formatting, names: next } });
      }} /></label>
    <p className="field-hint">{field ? `Source field: ${field}. Display names appear in generated titles and result tables.` : 'Assign a Group/Color field first.'}</p>
    <Unavailable label="Group sort controls" reason="Sort editing is not supported in Author yet; imported sort settings are retained.">
      <label>Sort<select defaultValue="Not editable"><option>Not editable</option></select></label>
    </Unavailable>
    {visual.kind === 'pie' && <Unavailable label="Slice limit controls" reason="Slice limits are not supported yet; all supplied result rows are shown.">
      <label>Number of slices displayed<input placeholder="Default: 20" /></label>
    </Unavailable>}
  </details>;
}

export function LegendOptions({ visual, dispatch }: SectionProps) {
  if (!hasLegend(visual.kind)) return null;
  return <details className="property-section"><summary>Legend</summary>
    <label className="toggle"><input type="checkbox" checked={visual.legend} onChange={e => dispatch({ type: 'display', property: 'legend', value: e.target.checked })} />Show legend</label>
    <label>Legend position<select value={visual.formatting?.legendPosition ?? 'AUTO'} onChange={e => dispatch({ type: 'legend-position', position: e.target.value as LegendPosition })}>
      {LEGEND_POSITIONS.map(position => <option key={position} value={position}>{position[0] + position.slice(1).toLowerCase()}</option>)}
    </select></label>
    <p className="field-hint">Auto places the legend at the bottom.</p>
    <section className="property-group" aria-label="Legend title"><h4>LEGEND TITLE</h4>
      <Unavailable label="Legend title controls" reason="A separate legend title and its text styling are not supported yet.">
        <label className="toggle"><input type="checkbox" />Show legend title</label>
        <label>Legend title<input placeholder="Legend" /></label>
        <TextStyling label="Legend title" size={14} />
      </Unavailable>
    </section>
    <section className="property-group" aria-label="Legend value"><h4>LEGEND VALUE</h4>
      <Unavailable label="Legend value controls" reason="Per-visual legend value styling is not supported yet. Font and color follow the analysis theme.">
        <TextStyling label="Legend value" size={12} />
      </Unavailable>
    </section>
  </details>;
}
