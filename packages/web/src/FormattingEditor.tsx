import { useState, type Dispatch } from 'react';
import type { AuthorAction, AuthorVisual } from './authoring.js';
import { tabular } from './authoring.js';
import type { ConditionalRule, VisualFormatting } from './formatting.js';
export function FormattingEditor({ visual, dispatch }: { visual: AuthorVisual; dispatch: Dispatch<AuthorAction> }) {
  const f = visual.formatting ?? {}, rules = f.rules ?? [];
  const set = (patch: Partial<VisualFormatting>) => dispatch({ type: 'formatting', formatting: { ...f, ...patch } });
  const [field, setField] = useState(visual.measures[0] ?? ''), [operator, setOperator] = useState<ConditionalRule['operator']>('gt'), [threshold, setThreshold] = useState('0'), [color, setColor] = useState('#b3261e'), [background, setBackground] = useState('#fff0ec');
  const toggle = (key: 'headersVisible' | 'rowNamesVisible' | 'columnNamesVisible' | 'valueNamesVisible', title: string) => <label className="toggle"><input type="checkbox" checked={f[key] !== false} onChange={e => set({ [key]: e.target.checked })} />{title}</label>;
  const colorInput = (key: 'headerColor' | 'headerBackground' | 'cellColor' | 'cellBackground', title: string, fallback: string) => <label>{title}<input type="color" value={f[key] ?? fallback} onChange={e => set({ [key]: e.target.value })} /></label>;
  return <>
    {tabular(visual.kind) && <>
      <details className="property-section"><summary>Headers</summary>{toggle('headersVisible', 'Show headers')}{colorInput('headerColor', 'Header text color', '#19384a')}{colorInput('headerBackground', 'Header background', '#f3f7f8')}</details>
      <details className="property-section"><summary>Cells</summary>{colorInput('cellColor', 'Cell text color', '#19384a')}{colorInput('cellBackground', 'Cell background', '#ffffff')}<label>Cell font size<input type="number" min="8" max="32" value={f.fontSize ?? 13} onChange={e => set({ fontSize: Number(e.target.value) })} /></label><label>Decimal places<input type="number" min="0" max="12" value={f.decimalPlaces ?? 2} onChange={e => set({ decimalPlaces: Number(e.target.value) })} /></label></details>
      {(['totals', 'subtotals'] as const).map(property => <details className="property-section" key={property}><summary>{property === 'totals' ? 'Total' : 'Subtotal'}</summary><label className="toggle"><input type="checkbox" checked={visual[property]} onChange={e => dispatch({ type: 'display', property, value: e.target.checked })} />{property === 'totals' ? 'Show totals' : 'Show subtotals'}</label><p>Additive SUM over supplied groups. Subtotals require multiple group levels.</p></details>)}
    </>}
    {([{ label: 'Row names', fields: visual.rows.length ? visual.rows : visual.dimension ? [visual.dimension] : [], visibility: 'rowNamesVisible' }, { label: 'Column names', fields: visual.columns, visibility: 'columnNamesVisible' }, { label: 'Value names', fields: visual.measures, visibility: 'valueNamesVisible' }] as const).map(group => <details className="property-section" key={group.label}><summary>{group.label}</summary>
      {tabular(visual.kind) && toggle(group.visibility, `Show ${group.label.toLowerCase()}`)}
      {group.fields.map(field => <label key={field}>{field} display name<input value={f.names?.[field] ?? ''} placeholder={field} maxLength={128} onChange={e => { const names = { ...f.names }; if (e.target.value.trim()) Object.defineProperty(names, field, { value: e.target.value, enumerable: true, writable: true, configurable: true }); else delete names[field]; set({ names }); }} /></label>)}
      {!group.fields.length && <p>No fields in this well.</p>}
    </details>)}
    <details className="property-section"><summary data-author-control="conditional-formatting">Conditional formatting</summary>
      <p>First matching rule colors numeric cells, including totals. Bar, line, area, combo, pie, scatter and funnel marks also use the rule color. Percentage bars compare the original values. Other charts show rules in their result table.</p>
      <ol>{rules.map((rule, i) => <li key={i}>{rule.fieldId} {rule.operator} {rule.threshold} <span style={{ color: rule.color, background: rule.background }}>Aa</span><button type="button" aria-label={`Remove formatting rule ${i + 1}`} onClick={() => set({ rules: rules.filter((_, j) => i !== j) })}>Remove</button></li>)}</ol>
      <label>Rule measure<select aria-label="Rule measure" value={visual.measures.includes(field) ? field : visual.measures[0] ?? ''} onChange={e => setField(e.target.value)}>{visual.measures.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Rule comparison<select value={operator} onChange={e => setOperator(e.target.value as typeof operator)}><option value="gt">Greater than</option><option value="gte">At least</option><option value="lt">Less than</option><option value="lte">At most</option><option value="eq">Equals</option></select></label>
      <label>Rule threshold<input type="number" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} /></label>
      <label>Rule text / mark color<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label><label>Rule cell background<input type="color" value={background} onChange={e => setBackground(e.target.value)} /></label>
      <button type="button" disabled={!visual.measures.length || !threshold.trim() || !Number.isFinite(Number(threshold)) || rules.length >= 20} onClick={() => set({ rules: [...rules, { fieldId: visual.measures.includes(field) ? field : visual.measures[0]!, operator, threshold: Number(threshold), color, background }] })}>Add formatting rule</button>
    </details>
    <button type="button" onClick={() => dispatch({ type: 'formatting', formatting: {} })}>Reset formatting</button>
  </>;
}
