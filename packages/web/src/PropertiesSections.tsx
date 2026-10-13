import { useId, type Dispatch, type ReactNode } from 'react';
import type { AuthorAction, AuthorDraft, AuthorVisual } from './authoring.js';
import { GRID_COLUMNS, defaultMultiplesOptions, hasSmallMultiplesWell } from './authoring.js';
import type { MultiplesOptions as MultiplesOptionsState } from './model.js';
import { hasDataLabels, hasLegend, LEGEND_POSITIONS, type LegendPosition } from './formatting.js';

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

export function MultiplesOptions({ visual, dispatch }: SectionProps) {
  if (!hasSmallMultiplesWell(visual.kind) && !visual.smallMultiples?.length) return null;
  const current = visual.multiplesOptions ?? defaultMultiplesOptions();
  const set = (options: MultiplesOptionsState) => dispatch({ type: 'multiples-options', options });
  const patch = (p: Partial<MultiplesOptionsState>) => set({ ...current, ...p });
  // Auto-or-number editing: empty means "auto"; anything that is not a positive
  // integer is ignored so the last valid value stays (fail-closed editing).
  const autoOrNumber = (raw: string, apply: (value: 'auto' | number) => void) => {
    const trimmed = raw.trim();
    if (trimmed === '') { apply('auto'); return; }
    if (/^\d+$/.test(trimmed) && Number(trimmed) >= 1) apply(Number(trimmed));
  };
  return <details className="property-section"><summary>Multiples Options</summary>
    <h4 className="property-caption">Layout</h4>
    <div className="property-inline">
      <label>Visible rows<input aria-label="Visible rows" placeholder="Auto" inputMode="numeric"
        value={current.visibleRows === 'auto' ? '' : String(current.visibleRows)}
        onChange={e => autoOrNumber(e.target.value, value => patch({ visibleRows: value }))} /></label>
      <label>Visible columns<input aria-label="Visible columns" placeholder="Auto" inputMode="numeric"
        value={current.visibleColumns === 'auto' ? '' : String(current.visibleColumns)}
        onChange={e => autoOrNumber(e.target.value, value => patch({ visibleColumns: value }))} /></label>
    </div>
    <label>Number of panels<input type="number" min={1} max={20} aria-label="Number of panels" placeholder="20 (Default)"
      value={current.panelCount}
      onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20) patch({ panelCount: n }); }} /></label>
    <h4 className="property-caption">Panel title</h4>
    <label>Title options<select aria-label="Panel title size" value={current.title.size}
      onChange={e => { const size = e.target.value; if (size === 'small' || size === 'medium' || size === 'large') patch({ title: { ...current.title, size } }); }}>
      <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
    </select></label>
    <div className="property-inline" role="group" aria-label="Panel title emphasis">
      {(['bold', 'italic', 'underline'] as const).map(flag => <button type="button" key={flag}
        aria-label={`Panel title ${flag}`} aria-pressed={current.title[flag]}
        onClick={() => patch({ title: { ...current.title, [flag]: !current.title[flag] } })}>
        {flag === 'bold' ? <b>B</b> : flag === 'italic' ? <i>I</i> : <u>U</u>}</button>)}
    </div>
    <div className="property-inline" role="group" aria-label="Panel title alignment">
      {(['left', 'center', 'right'] as const).map(align => <button type="button" key={align}
        aria-label={`Panel title align ${align}`} aria-pressed={current.title.align === align}
        onClick={() => patch({ title: { ...current.title, align } })}>{align[0]!.toUpperCase() + align.slice(1)}</button>)}
    </div>
    <p className="field-hint">Underline is saved with the visual, but panel titles cannot render it.</p>
    <label className="toggle"><input type="checkbox" checked={current.border.enabled}
      onChange={e => patch({ border: { ...current.border, enabled: e.target.checked } })} />Panel border</label>
    {current.border.enabled && <>
      <h4 className="property-caption">Border options</h4>
      <div className="property-inline">
        <label>Width (px)<input type="number" min={1} step={1} aria-label="Panel border width in pixels" value={current.border.widthPx}
          onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) patch({ border: { ...current.border, widthPx: n } }); }} /></label>
        <label>Style<select aria-label="Panel border style" value={current.border.style}
          onChange={e => { const style = e.target.value; if (style === 'solid' || style === 'dashed' || style === 'dotted') patch({ border: { ...current.border, style } }); }}>
          <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
        </select></label>
        <label>Color<input type="color" aria-label="Panel border color" value={current.border.color}
          onChange={e => patch({ border: { ...current.border, color: e.target.value } })} /></label>
      </div>
      <p className="field-hint">Dashed and dotted borders are saved, but render as solid lines.</p>
    </>}
    <label className="toggle"><input type="checkbox" checked={current.gutter}
      onChange={e => patch({ gutter: e.target.checked })} />Panel gutter</label>
    <label className="toggle"><input type="checkbox" checked={current.background}
      onChange={e => patch({ background: e.target.checked })} />Panel background</label>
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
      <label className="toggle"><input type="checkbox" aria-label="Show Group/Color title" />Title</label>
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
  return <details className="property-section"><summary data-author-control="legend">Legend</summary>
    <label className="toggle"><input type="checkbox" checked={visual.legend} onChange={e => dispatch({ type: 'display', property: 'legend', value: e.target.checked })} />Show legend</label>
    <label>Legend position<select aria-label="Legend position" value={visual.formatting?.legendPosition ?? 'AUTO'} onChange={e => dispatch({ type: 'legend-position', position: e.target.value as LegendPosition })}>
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

export function DataLabelsOptions({ visual, dispatch }: SectionProps) {
  if (!hasDataLabels(visual.kind)) return null;
  return <details className="property-section"><summary data-author-control="data-labels">Data labels</summary>
    <label className="toggle"><input type="checkbox" checked={visual.labels} onChange={e => dispatch({ type: 'display', property: 'labels', value: e.target.checked })} />Show data labels</label>
    <Unavailable label="Data label content and styling controls" reason="Independent category/metric, position, typography and overlap settings are not supported yet. Labels follow the visual type and analysis theme; Outside is a reference default.">
      <label className="toggle"><input type="checkbox" />Category</label>
      <label className="toggle"><input type="checkbox" />Metric</label>
      <label>Position<select aria-label="Data label position" defaultValue="Outside"><option>Outside</option></select></label>
      <TextStyling label="Data label" size={12} />
      <label className="toggle"><input type="checkbox" />Allow labels to overlap</label>
    </Unavailable>
    <label>Data label decimal places<input type="number" min="0" max="12" placeholder="Automatic" value={visual.formatting?.decimalPlaces ?? ''} onChange={e => {
      if (e.target.value === '') {
        const { decimalPlaces: _old, ...rest } = visual.formatting ?? {};
        dispatch({ type: 'formatting', formatting: rest });
      } else dispatch({ type: 'formatting', formatting: { ...visual.formatting, decimalPlaces: Number(e.target.value) } });
    }} /></label>
  </details>;
}

export function ReferenceLinesEditor({ visual, dispatch }: SectionProps) {
  const lines = visual.referenceLines ?? [];
  return <details className="property-section"><summary data-author-control="reference-lines">Reference lines</summary>
    <p className="field-hint">Dashed lines at fixed values on the value axis.</p>
    {lines.map(line => <fieldset key={line.id} className="property-group" aria-label={`Reference line ${line.id}`}>
      <label>Value<input type="number" step="any" value={line.value} onChange={e => {
        const value = Number(e.target.value);
        if (Number.isFinite(value)) dispatch({ type: 'reference-line-update', id: line.id, patch: { value } });
      }} /></label>
      <label>Label<input value={line.label} maxLength={128} placeholder={String(line.value)} onChange={e => dispatch({ type: 'reference-line-update', id: line.id, patch: { label: e.target.value } })} /></label>
      <label>Color<input type="color" value={line.color} onChange={e => dispatch({ type: 'reference-line-update', id: line.id, patch: { color: e.target.value } })} /></label>
      <button type="button" onClick={() => dispatch({ type: 'reference-line-remove', id: line.id })}>Remove line</button>
    </fieldset>)}
    <button type="button" onClick={() => dispatch({ type: 'reference-line-add' })}>Add reference line</button>
  </details>;
}

export function VisualPlacement({ visual, draft, dispatch }: SectionProps & { draft: AuthorDraft }) {
  const sheet = draft.sheets.find(s => s.id === draft.activeSheetId);
  const placement = sheet?.layout.find(p => p.i === visual.id);
  if (!placement) return null;
  const keys = ['x', 'y', 'w', 'h'] as const;
  const labels: Record<(typeof keys)[number], string> = { x: 'Column', y: 'Row', w: 'Width', h: 'Height' };
  return <details className="property-section" open><summary data-author-control="visual-placement">Placement</summary>
    <p className="field-hint">Grid cells. Drag the handle to move; drag a corner to resize.</p>
    {keys.map(key => <label key={key}>{labels[key]}<input aria-label={`Visual ${labels[key].toLowerCase()}`} type="number"
      min={key === 'w' ? 3 : key === 'h' ? 4 : 0}
      max={key === 'x' ? GRID_COLUMNS - placement.w : key === 'w' ? GRID_COLUMNS - placement.x : 10000 - (key === 'y' ? placement.h : placement.y)}
      value={placement[key]} onChange={e => {
        const value = Number(e.target.value);
        if (!Number.isSafeInteger(value)) return;
        dispatch({ type: 'layout', sheetId: sheet!.id, layout: sheet!.layout.map(p => p.i === visual.id ? { ...p, [key]: value } : p) });
      }} /></label>)}
  </details>;
}
