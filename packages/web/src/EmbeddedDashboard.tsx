import type { EmbedSurface } from '@opensight/embedding-sdk/surface';
import { useEffect, useRef, useState } from 'react';
import { parameterValueError, type ParameterDeclaration, type ParameterValue } from '@opensight/query-engine/parameters';
import { EmbedVisualCard } from './EmbedVisualCard.js';
import type { FixtureVisual } from './model.js';
import type { EmbedTransport } from './embed-transport.js';

interface Control extends ParameterDeclaration { id: string; label: string; values: ParameterValue[] }
export interface DashboardContent {
  kind: 'dashboard' | 'visual'; title: string; visuals: (FixtureVisual & { id: string })[];
  controls: { filters: Control[]; parameters: Control[] };
}
export interface EmbedReaderState { filters?: Record<string, ParameterValue[]>; parameters?: Record<string, ParameterValue[]> }
type Drafts = Record<'filters' | 'parameters', Record<string, string[]>>;
const draftsFor = (content: DashboardContent): Drafts => ({
  filters: Object.fromEntries(content.controls.filters.map(c => [c.id, c.values.map(String)])),
  parameters: Object.fromEntries(content.controls.parameters.map(c => [c.id, c.values.map(String)])),
});

/** Reader state stays in the frame. Only the server plans and executes changes. */
export function EmbeddedDashboard({ initial, transport, onState, onContent, actions }: {
  actions?: EmbedSurface['actions'];
  initial: DashboardContent; transport: EmbedTransport; onState: (state: EmbedReaderState) => void; onContent?: (content: DashboardContent) => void;
}) {
  const [content, setContent] = useState(initial), [drafts, setDrafts] = useState(() => draftsFor(initial));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [failed, setFailed] = useState(false);
  const flight = useRef(false), generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const change = (kind: keyof Drafts, id: string, values: string[]) => {
    setDrafts(current => ({ ...current, [kind]: { ...current[kind], [id]: values } })); setError('');
  };
  const refresh = async (state: EmbedReaderState) => {
    if (flight.current) return;
    const current = generation.current; flight.current = true; setBusy(true); setError(''); setFailed(false); onState(state);
    try {
      const result = await transport.request<DashboardContent>('content', state);
      if (current !== generation.current) return;
      const filters = (value: DashboardContent) => Object.fromEntries(value.controls.filters.map(c => [c.id, c.values]));
      if (actions?.filtering !== 'hidden' && JSON.stringify(filters(content)) !== JSON.stringify(filters(result))) {
        transport.events.emit({ type: 'filterState', filters: filters(result) });
      }
      setContent(result); setDrafts(draftsFor(result)); onContent?.(result);
    } catch {
      if (current === generation.current) { setFailed(true); setError('Unable to update this view. Reconnect to check access and try again.'); }
    } finally { if (current === generation.current) { flight.current = false; setBusy(false); } }
  };
  const groups = { filters: actions?.filtering ?? 'visible', parameters: actions?.parameterControls ?? 'visible' };
  const hasControls = (kind: keyof Drafts) => groups[kind] !== 'hidden' && content.controls[kind].length > 0;
  const editable = (kind: keyof Drafts) => groups[kind] === 'visible' && hasControls(kind);
  const canApply = editable('filters') || editable('parameters');
  const apply = () => {
    if (!canApply) return;
    const state: EmbedReaderState = {};
    for (const kind of ['filters', 'parameters'] as const) {
      if (!editable(kind)) continue;
      const entries: [string, ParameterValue[]][] = [];
      for (const control of content.controls[kind]) {
        const raw = drafts[kind][control.id] ?? [];
        const values = raw.map(value => control.type === 'number' ? value.trim() ? Number(value) : NaN : value);
        const problem = parameterValueError(control, values);
        if (problem) { setError(`${control.label}: ${problem}`); return; }
        entries.push([control.id, values]);
      }
      state[kind] = Object.fromEntries(entries);
    }
    void refresh(state);
  };
  const showControls = hasControls('filters') || hasControls('parameters');
  return <section className={`embed-dashboard${showControls ? ' embed-dashboard-controls' : ''}`} aria-busy={busy}>
    {showControls && <form className="embed-reader-controls" onSubmit={event => event.preventDefault()} onKeyDown={event => {
      // The embed sandbox intentionally omits allow-forms. Use explicit handlers,
      // as Q does, so neither click nor Enter depends on native form submission.
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); apply(); }
    }}>
      <fieldset disabled={busy || !canApply}>
        <legend>View controls</legend>
        {(['filters', 'parameters'] as const).map(kind => hasControls(kind) && <section key={kind} aria-disabled={!editable(kind) || undefined} aria-label={kind === 'filters' ? 'Filters' : 'Parameters'}>
          <h2>{kind === 'filters' ? 'Filters' : 'Parameters'}</h2>
          {content.controls[kind].map(control => {
            const values = drafts[kind][control.id] ?? [];
            return <div className="embed-reader-control" key={control.id}>
              {(control.multiple || !values.length) && <span>{control.label}</span>}
              {values.map((value, index) => <div className="embed-reader-value" key={index}>
                <label>{control.multiple ? `${control.label} ${index + 1}` : control.label}
                  <input disabled={!editable(kind)} aria-label={control.multiple ? `${control.label} ${index + 1}` : control.label} type={control.type === 'number' ? 'number' : 'text'}
                    step={control.integer ? 1 : 'any'} value={value} maxLength={10000} placeholder={control.type === 'datetime' ? 'YYYY-MM-DD or UTC datetime' : undefined}
                    onChange={event => change(kind, control.id, values.map((v, i) => i === index ? event.target.value : v))} />
                </label>
                <button type="button" disabled={!editable(kind)} aria-label={`Remove ${control.label} ${index + 1}`} onClick={() => change(kind, control.id, values.filter((_, i) => i !== index))}>Remove</button>
              </div>)}
              {!values.length && <p>No values selected</p>}
              {(control.multiple || !values.length) && <button type="button" disabled={!editable(kind) || values.length >= 1000} onClick={() => change(kind, control.id, [...values, ''])}>Add {control.label}</button>}
            </div>;
          })}
        </section>)}
        <p className="embed-control-help">Apply to update the view with your current selections.</p>
        <button type="button" onClick={apply}>Apply</button><button type="button" onClick={() => { void refresh({}); }}>Reset all</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>}
    <div className="embed-dashboard-results">
      {busy ? <p role="status">Updating view…</p> : !failed && <div className="dashboard-grid">{content.visuals.map(v => <EmbedVisualCard key={v.id} visual={v} events={transport.events} />)}</div>}
    </div>
  </section>;
}
