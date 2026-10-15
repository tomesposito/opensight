import { useId, type Dispatch, type ReactNode } from 'react';
import type { AuthorAction, AuthorDraft, AuthorVisual } from './authoring.js';
import { GRID_COLUMNS, defaultMultiplesOptions, hasSmallMultiplesWell } from './authoring.js';
import type { MultiplesOptions as MultiplesOptionsState } from './model.js';
import { hasDataLabels, hasLegend, LEGEND_POSITIONS, DATA_LABEL_POSITIONS, CARD_DEFAULTS, cleanCardStyle, cleanCardLayout, cleanAltText, altTextValid, type LegendPosition, type LegendTextStyle, type LegendTitle, type GroupTitle, type DataLabels, type DataLabelPosition, type CardStyle, type CardSwatch, type CardBorder } from './formatting.js';
import { LIGHT_THEME } from './themes.js';

type SectionProps = { visual: AuthorVisual; dispatch: Dispatch<AuthorAction> };

/** Reference affordances must never save settings the renderer cannot honor. */
function Unavailable({ label, reason, children }: { label: string; reason: string; children: ReactNode }) {
  const reasonId = useId();
  return <fieldset className="property-unavailable" disabled aria-label={label} aria-describedby={reasonId} title={reason}>
    {children}<p className="field-hint" id={reasonId}>{reason}</p>
  </fieldset>;
}

export function CardTitle({ visual, dispatch }: SectionProps) {
  const altText = visual.formatting?.altText ?? '';
  const setAltText = (raw: string) => {
    const cleaned = cleanAltText(raw);
    if (cleaned === undefined || altTextValid(cleaned)) dispatch({ type: 'alt-text', altText: cleaned });
  };
  return <section className="property-group" aria-label="Card title"><h4>CARD TITLE</h4>
    <label>Edit title<input aria-label="Title" value={visual.title} placeholder="Generated from fields" onChange={e => dispatch({ type: 'title', title: e.target.value })} /></label>
    <label className="toggle"><input type="checkbox" checked={visual.titleVisible} onChange={e => dispatch({ type: 'display', property: 'titleVisible', value: e.target.checked })} />Show title</label>
    <label>Title font size<input type="number" min="8" max="48" value={visual.formatting?.titleFontSize ?? 14} onChange={e => dispatch({ type: 'formatting', formatting: { ...visual.formatting, titleFontSize: Number(e.target.value) } })} /></label>
    <label>Edit subtitle<input aria-label="Subtitle" value={visual.subtitle ?? ''} onChange={e => dispatch({ type: 'subtitle', subtitle: e.target.value, visible: visual.subtitleVisible !== false })} /></label>
    <label className="toggle"><input type="checkbox" checked={visual.subtitleVisible !== false} onChange={e => dispatch({ type: 'subtitle', subtitle: visual.subtitle ?? '', visible: e.target.checked })} />Show subtitle</label>
    <label>Alt text<textarea rows={2} value={altText} placeholder="Describe the chart for screen readers" onChange={e => setAltText(e.target.value)} /></label>
    <p className="field-hint">Custom accessible description for the chart, up to 500 characters. When empty, the chart title is used.</p>
    {altText && <button type="button" onClick={() => dispatch({ type: 'alt-text', altText: undefined })}>Reset alt text</button>}
  </section>;
}

/** Color swatch + opacity % editor for one card-style part. Unset parts show the
 *  reference defaults without saving anything; any edit creates an explicit
 *  (fail-closed validated) swatch. Opacity edits stay within 0–100; anything
 *  else keeps the last valid value. */
function SwatchEditor({ label, defaultColor, defaultOpacityPct, value, onChange }: {
  label: string; defaultColor: string; defaultOpacityPct: number;
  value: CardSwatch | undefined; onChange: (swatch: CardSwatch | undefined) => void;
}) {
  const setOpacity = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (value?.color === undefined) onChange(undefined);
      else { const { opacityPct: _dropped, ...rest } = value; onChange(Object.keys(rest).length ? rest : undefined); }
      return;
    }
    if (/^\d+$/.test(trimmed) && Number(trimmed) >= 0 && Number(trimmed) <= 100) onChange({ color: value?.color ?? defaultColor, opacityPct: Number(trimmed) });
  };
  return <div className="property-control-row"><span>{label}</span><div className="property-inline">
    <input type="color" aria-label={`${label} color`} value={value?.color ?? defaultColor}
      onChange={e => onChange({ ...(value ?? {}), color: e.target.value })} />
    <input aria-label={`${label} opacity (%)`} inputMode="numeric" placeholder={`${defaultOpacityPct}%`}
      value={value?.opacityPct ?? ''} onChange={e => setOpacity(e.target.value)} />
  </div></div>;
}

export function CardStyle({ visual, dispatch }: SectionProps) {
  const style: CardStyle = visual.formatting?.cardStyle ?? {};
  const set = (next: CardStyle | undefined) => dispatch({ type: 'card-style', style: cleanCardStyle(next) });
  const border: Partial<CardBorder> = style.border ?? {};
  const setBorder = (patch: Partial<CardBorder>) => set({ ...style, border: { color: border.color ?? CARD_DEFAULTS.borderColor, ...patch } });
  const setBorderWidth = (raw: string) => { if (/^\d+$/.test(raw) && Number(raw) >= 0 && Number(raw) <= 8) setBorder({ widthPx: Number(raw) }); };
  return <section className="property-group" aria-label="Card style"><h4>CARD STYLE</h4>
    <SwatchEditor label="Background" defaultColor={CARD_DEFAULTS.backgroundColor} defaultOpacityPct={CARD_DEFAULTS.backgroundOpacityPct}
      value={style.background} onChange={background => set(background === undefined ? { ...style, background: undefined } : { ...style, background })} />
    <div className="property-control-row"><span>Border</span><div className="property-inline">
      <input type="color" aria-label="Border color" value={border.color ?? CARD_DEFAULTS.borderColor}
        onChange={e => setBorder({ color: e.target.value })} />
      <input aria-label="Border opacity (%)" inputMode="numeric" placeholder={`${CARD_DEFAULTS.borderOpacityPct}%`}
        value={border.opacityPct ?? ''} onChange={e => {
          const trimmed = e.target.value.trim();
          if (trimmed === '') {
            const { opacityPct: _dropped, ...rest } = border;
            set({ ...style, border: Object.keys(rest).length ? { color: rest.color ?? CARD_DEFAULTS.borderColor, widthPx: rest.widthPx } : undefined });
          }
          else if (/^\d+$/.test(trimmed) && Number(trimmed) >= 0 && Number(trimmed) <= 100) setBorder({ opacityPct: Number(trimmed) });
        }} />
      <select aria-label="Border width" value={String(border.widthPx ?? CARD_DEFAULTS.borderWidthPx)} onChange={e => setBorderWidth(e.target.value)}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(width => <option key={width} value={width}>{width === 0 ? 'No border' : `${width}px`}</option>)}
      </select>
    </div></div>
    <SwatchEditor label="Selection" defaultColor={CARD_DEFAULTS.selectionColor} defaultOpacityPct={CARD_DEFAULTS.selectionOpacityPct}
      value={style.selection} onChange={selection => set(selection === undefined ? { ...style, selection: undefined } : { ...style, selection })} />
    <p className="field-hint">Selection color is saved with the visual and exports, but the chart does not draw a separate selection highlight.</p>
    <label className="toggle"><input type="checkbox" checked={style.loadingAnimation ?? CARD_DEFAULTS.loadingAnimation}
      onChange={e => set({ ...style, loadingAnimation: e.target.checked })} />Loading animation</label>
    {Object.keys(style).length > 0 && <button type="button" onClick={() => set(undefined)}>Reset card style to defaults</button>}
  </section>;
}

export function CardLayout({ visual, dispatch }: SectionProps) {
  const padding = visual.formatting?.cardLayout?.paddingPx;
  const set = (layout: { paddingPx?: number } | undefined) => dispatch({ type: 'card-layout', layout: cleanCardLayout(layout) });
  const setPadding = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') { set(undefined); return; }
    if (/^\d+$/.test(trimmed) && Number(trimmed) >= 0 && Number(trimmed) <= 64) set({ paddingPx: Number(trimmed) });
  };
  return <section className="property-group" aria-label="Card layout"><h4>CARD LAYOUT</h4>
    <div className="property-control-row">
      <label>Padding (px)<input type="number" min="0" max="64" aria-label="Card padding in pixels" placeholder={`${CARD_DEFAULTS.paddingPx} (Default)`}
        value={padding ?? ''} onChange={e => setPadding(e.target.value)} /></label>
      {padding !== undefined && <button type="button" onClick={() => set(undefined)}>Reset to default</button>}
    </div>
  </section>;
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

/** Wired text-styling controls: font (the analysis theme owns the typeface — no
 *  fake font list), size, color, and B/I/U. Absent fields mean theme defaults;
 *  `onChange(undefined)` clears the whole style. Underline is saved but never
 *  rendered: ECharts text has no underline primitive. Without `value`/`onChange`
 *  it renders the unwired reference placeholder for `<Unavailable>` stubs. */
function TextStyling({ label, size, value, onChange }: { label: string; size: number; value?: LegendTextStyle; onChange?: (style: LegendTextStyle | undefined) => void }) {
  if (value === undefined || onChange === undefined) return <>
    <h4 className="property-caption">Text styling</h4>
    <div className="property-inline">
      <select aria-label={`${label} font`} defaultValue="Analysis theme"><option>Analysis theme</option></select>
      <input aria-label={`${label} font size`} type="number" placeholder={String(size)} />
    </div>
    <div className="property-inline" role="group" aria-label={`${label} emphasis`}>
      <button type="button" aria-label={`${label} bold`}><b>B</b></button>
      <button type="button" aria-label={`${label} italic`}><i>I</i></button>
      <button type="button" aria-label={`${label} underline`}><u>U</u></button>
    </div>
  </>;
  const patch = (p: Partial<LegendTextStyle>) => {
    const next = { ...value, ...p };
    for (const flag of ['bold', 'italic', 'underline'] as const) if (!next[flag]) delete next[flag];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const setSize = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') { const { fontSize: _dropped, ...rest } = value; onChange(Object.keys(rest).length ? rest : undefined); return; }
    if (/^\d+$/.test(trimmed) && Number(trimmed) >= 8 && Number(trimmed) <= 32) patch({ fontSize: Number(trimmed) });
  };
  return <>
    <h4 className="property-caption">Text styling</h4>
    <div className="property-inline">
      <select aria-label={`${label} font`} value="Analysis theme" onChange={() => {}}><option>Analysis theme</option></select>
      <input aria-label={`${label} font size`} type="number" min={8} max={32} placeholder={String(size)}
        value={value.fontSize ?? ''} onChange={e => setSize(e.target.value)} />
    </div>
    <div className="property-inline">
      <label>Color<input type="color" aria-label={`${label} color`} value={value.color ?? LIGHT_THEME.textColor}
        onChange={e => patch({ color: e.target.value })} /></label>
      {value.color !== undefined && <button type="button" aria-label={`${label} reset color to theme default`}
        onClick={() => { const { color: _dropped, ...rest } = value; onChange(Object.keys(rest).length ? rest : undefined); }}>Reset</button>}
    </div>
    <div className="property-inline" role="group" aria-label={`${label} emphasis`}>
      {(['bold', 'italic', 'underline'] as const).map(flag => <button type="button" key={flag}
        aria-label={`${label} ${flag}`} aria-pressed={!!value[flag]}
        onClick={() => { const p: Partial<LegendTextStyle> = {}; p[flag] = !value[flag]; patch(p); }}>
        {flag === 'bold' ? <b>B</b> : flag === 'italic' ? <i>I</i> : <u>U</u>}</button>)}
    </div>
  </>;
}

export function GroupColorOptions({ visual, dispatch }: SectionProps) {
  if (!['bar', 'bar100', 'pie'].includes(visual.kind)) return null;
  const field = visual.dimension;
  const names = visual.formatting?.names;
  const title: GroupTitle = visual.formatting?.groupTitle ?? {};
  const cleanTitle = (t: GroupTitle): GroupTitle | undefined => {
    const next: GroupTitle = {};
    if (t.show) next.show = true;
    if (t.text !== undefined) next.text = t.text;
    if (t.style !== undefined) next.style = t.style;
    return Object.keys(next).length ? next : undefined;
  };
  const setTitle = (next: GroupTitle | undefined) => dispatch({ type: 'group-title', title: next });
  return <details className="property-section"><summary>Group/Color</summary>
    <section className="property-group" aria-label="Group/Color title"><h4>GROUP/COLOR TITLE</h4>
      <label className="toggle"><input type="checkbox" aria-label="Show Group/Color title" checked={!!title.show}
        onChange={e => setTitle(cleanTitle({ ...title, show: e.target.checked }))} />Show Group/Color title</label>
      {title.show && <>
        <label>Group/Color title<input aria-label="Group/Color title" placeholder={field ?? 'Group/Color title'} maxLength={128}
          value={title.text ?? ''} onChange={e => {
            const text = e.target.value.trim();
            setTitle(cleanTitle({ ...title, text: text ? e.target.value.slice(0, 128) : undefined }));
          }} /></label>
        <TextStyling label="Group/Color title" size={14} value={title.style ?? {}}
          onChange={style => setTitle(cleanTitle({ ...title, style }))} />
        <p className="field-hint">Group/Color titles are saved with the visual and exports, but the chart does not draw a separate group title.</p>
      </>}
    </section>
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
  const title: LegendTitle = visual.formatting?.legendTitle ?? {};
  const valueStyle: LegendTextStyle = visual.formatting?.legendValueStyle ?? {};
  const cleanTitle = (t: LegendTitle): LegendTitle | undefined => {
    const next: LegendTitle = {};
    if (t.show) next.show = true;
    if (t.text !== undefined) next.text = t.text;
    if (t.style !== undefined) next.style = t.style;
    return Object.keys(next).length ? next : undefined;
  };
  const setTitle = (next: LegendTitle | undefined) => dispatch({ type: 'legend-title', title: next });
  return <details className="property-section"><summary data-author-control="legend">Legend</summary>
    <label className="toggle"><input type="checkbox" checked={visual.legend} onChange={e => dispatch({ type: 'display', property: 'legend', value: e.target.checked })} />Show legend</label>
    <label>Legend position<select aria-label="Legend position" value={visual.formatting?.legendPosition ?? 'AUTO'} onChange={e => dispatch({ type: 'legend-position', position: e.target.value as LegendPosition })}>
      {LEGEND_POSITIONS.map(position => <option key={position} value={position}>{position[0] + position.slice(1).toLowerCase()}</option>)}
    </select></label>
    <p className="field-hint">Auto places the legend at the bottom.</p>
    <section className="property-group" aria-label="Legend title"><h4>LEGEND TITLE</h4>
      <label className="toggle"><input type="checkbox" aria-label="Show legend title" checked={!!title.show}
        onChange={e => setTitle(cleanTitle({ ...title, show: e.target.checked }))} />Show legend title</label>
      {title.show && <>
        <label>Legend title<input aria-label="Legend title" placeholder="Legend" maxLength={128}
          value={title.text ?? ''} onChange={e => {
            const text = e.target.value.trim();
            setTitle(cleanTitle({ ...title, text: text ? e.target.value.slice(0, 128) : undefined }));
          }} /></label>
        <TextStyling label="Legend title" size={14} value={title.style ?? {}}
          onChange={style => setTitle(cleanTitle({ ...title, style }))} />
        <p className="field-hint">Legend titles are saved with the visual and exports, but the chart does not draw a separate legend title.</p>
      </>}
    </section>
    <section className="property-group" aria-label="Legend value"><h4>LEGEND VALUE</h4>
      <TextStyling label="Legend value" size={12} value={valueStyle}
        onChange={style => dispatch({ type: 'legend-value-style', style })} />
      <p className="field-hint">Underline is saved with the visual, but legend entries cannot render it.</p>
    </section>
  </details>;
}

export function DataLabelsOptions({ visual, dispatch }: SectionProps) {
  if (!hasDataLabels(visual.kind)) return null;
  const options: DataLabels = visual.formatting?.dataLabels ?? {};
  // Strip back-to-default so the model and exports stay lean.
  const clean = (next: DataLabels): DataLabels | undefined => {
    const out: DataLabels = {};
    if (next.content !== undefined && Object.keys(next.content).length && !(next.content.category !== false && next.content.metric !== false)) out.content = next.content;
    if (next.position !== undefined && next.position !== 'auto') out.position = next.position;
    if (next.style !== undefined && Object.keys(next.style).length) out.style = next.style;
    if (next.allowOverlap !== undefined) out.allowOverlap = next.allowOverlap;
    return Object.keys(out).length ? out : undefined;
  };
  const set = (next: DataLabels | undefined) => dispatch({ type: 'data-labels', labels: next });
  const content = options.content ?? {};
  const patchContent = (key: 'category' | 'metric', value: boolean) => set(clean({ ...options, content: { ...content, [key]: value } }));
  return <details className="property-section"><summary data-author-control="data-labels">Data labels</summary>
    <label className="toggle"><input type="checkbox" checked={visual.labels} onChange={e => dispatch({ type: 'display', property: 'labels', value: e.target.checked })} />Show data labels</label>
    <section className="property-group" aria-label="Data label content"><h4>CONTENT</h4>
      <label className="toggle"><input type="checkbox" aria-label="Show category in data labels" checked={content.category ?? true}
        onChange={e => patchContent('category', e.target.checked)} />Category</label>
      <label className="toggle"><input type="checkbox" aria-label="Show metric in data labels" checked={content.metric ?? true}
        onChange={e => patchContent('metric', e.target.checked)} />Metric</label>
    </section>
    <label>Position<select aria-label="Data label position" value={options.position ?? 'auto'}
      onChange={e => set(clean({ ...options, position: e.target.value as DataLabelPosition }))}>
      {DATA_LABEL_POSITIONS.map(position => <option key={position} value={position}>{position[0] + position.slice(1)}</option>)}
    </select></label>
    <TextStyling label="Data label" size={12} value={options.style ?? {}}
      onChange={style => set(clean({ ...options, style }))} />
    <p className="field-hint">Underline is saved with the visual, but labels cannot render it.</p>
    <label className="toggle"><input type="checkbox" aria-label="Allow labels to overlap" checked={options.allowOverlap ?? false}
      onChange={e => set(clean({ ...options, allowOverlap: e.target.checked }))} />Allow labels to overlap</label>
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
