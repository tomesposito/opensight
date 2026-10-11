import { useState, type Dispatch } from 'react';
import { activeSheet, sheetParameters, type AuthorDraft, type AuthorVisual, type AuthorAction } from './authoring.js';
import { actionActivation, actionDimensions, originProblem, targetProblem, urlActionProblem, navigationActionProblem, navigationSheets, type ActionActivation, type FilterAction, type NavigationAction, type UrlAction } from './interactions.js';

/** QuickSight caps a visual at 10 custom actions. */
export const ACTION_LIMIT = 10;
type PanelKind = 'filter' | 'url' | 'navigation';
type WorkingAction = FilterAction | UrlAction | NavigationAction;
const kindOf = (action: WorkingAction): PanelKind => 'urlTemplate' in action ? 'url' : 'targetSheetId' in action ? 'navigation' : 'filter';
const kindLabel = (kind: PanelKind): string => kind === 'url' ? 'URL action' : kind === 'navigation' ? 'Navigation action' : 'Filter action';
const allActions = (visual: AuthorVisual): WorkingAction[] => [...visual.filterActions ?? [], ...visual.urlActions ?? [], ...visual.navigationActions ?? []];
const findAction = (visual: AuthorVisual, id: string): WorkingAction | undefined => allActions(visual).find(action => action.id === id);
export const actionCount = (visual: AuthorVisual): number => allActions(visual).length;

function nextAction(visual: AuthorVisual, kind: PanelKind): WorkingAction {
  const existing = allActions(visual);
  let n = 1; while (existing.some(action => action.id === `action-${n}`)) n++;
  const common = { id: `action-${n}`, name: `${kindLabel(kind)} ${n}`, sourceField: actionDimensions(visual)[0] ?? '', activation: 'select' as ActionActivation };
  return kind === 'url' ? { ...common, urlTemplate: '' } : kind === 'navigation' ? { ...common, targetSheetId: '', parameterMappings: {} } : { ...common, targets: 'all' as const, mappings: {} };
}

/** Interaction-tab section: action list plus the New action entry point. */
export function ActionsSection({ visual, onOpenPanel }: { visual: AuthorVisual; onOpenPanel: (actionId?: string) => void }) {
  const actions = allActions(visual), atLimit = actions.length >= ACTION_LIMIT;
  return <details className="property-section" open><summary data-author-control="actions">Actions</summary>
    <p className="field-hint">Enhance your dashboards with custom actions to explore data. Max limit {ACTION_LIMIT}</p>
    {!!actions.length && <ul className="action-list">{actions.map(action => <li key={action.id}>
      <button type="button" className="action-row" onClick={() => onOpenPanel(action.id)} aria-label={`Edit ${action.name}`}>
        <span className="action-row-name">{action.name}</span>
        <span className="action-row-meta">{kindLabel(kindOf(action))} · {actionActivation(action) === 'menu' ? 'Menu option' : 'Select'}</span>
      </button>
    </li>)}</ul>}
    <button type="button" className="new-action-button" disabled={atLimit} onClick={() => onOpenPanel()}>{atLimit ? `Action limit reached (${ACTION_LIMIT})` : 'New action'}</button>
  </details>;
}

/**
 * Right-dock New action panel (QuickSight parity). Edits a working copy;
 * Save commits through the draft reducer, Close discards, Delete removes.
 */
export function ActionPanel({ draft, visual, actionId, initialKind = 'filter', onClose, dispatch, runtimeProblems = {} }: {
  draft: AuthorDraft; visual: AuthorVisual; actionId?: string; initialKind?: PanelKind; onClose: () => void;
  dispatch: Dispatch<AuthorAction>; runtimeProblems?: Record<string, string>;
}) {
  const [working, setWorking] = useState<WorkingAction>(() => {
    const existing = actionId ? findAction(visual, actionId) : undefined;
    return existing ? structuredClone(existing) : nextAction(visual, initialKind);
  });
  const patch = (update: Partial<WorkingAction>) => setWorking(previous => ({ ...previous, ...update }) as WorkingAction);
  const kind = kindOf(working);
  const switchKind = (next: PanelKind) => {
    if (next === kind) return;
    const { id, name, sourceField, activation } = working;
    setWorking(next === 'url' ? { id, name, sourceField, activation, urlTemplate: '' }
      : next === 'navigation' ? { id, name, sourceField, activation, targetSheetId: navigationSheets(draft).find(s => s.id !== activeSheet(draft).id)?.id ?? '', parameterMappings: {} }
      : { id, name, sourceField, activation, targets: 'all', mappings: {} });
  };
  const save = () => {
    const action = structuredClone(working);
    if (kind === 'url') dispatch({ type: 'url-actions', actions: [...visual.urlActions ?? []].filter(a => a.id !== action.id).concat([action as UrlAction]) });
    else if (kind === 'navigation') dispatch({ type: 'navigation-actions', actions: [...visual.navigationActions ?? []].filter(a => a.id !== action.id).concat([action as NavigationAction]) });
    else dispatch({ type: 'filter-actions', actions: [...visual.filterActions ?? []].filter(a => a.id !== action.id).concat([action as FilterAction]) });
    onClose();
  };
  const remove = () => {
    if (kind === 'url') dispatch({ type: 'url-actions', actions: (visual.urlActions ?? []).filter(a => a.id !== working.id) });
    else if (kind === 'navigation') dispatch({ type: 'navigation-actions', actions: (visual.navigationActions ?? []).filter(a => a.id !== working.id) });
    else dispatch({ type: 'filter-actions', actions: (visual.filterActions ?? []).filter(a => a.id !== working.id) });
    onClose();
  };
  const problem = originProblem(visual);
  return <div className="action-panel" aria-label={actionId ? `Edit ${working.name}` : 'New action'}>
    <div className="action-panel-header">
      <button type="button" aria-label="Back to properties" onClick={onClose}>‹</button>
      <h2>{actionId ? working.name || 'Edit action' : 'New action'}</h2>
      <button type="button" aria-label="Close action panel" onClick={onClose}>✕</button>
    </div>
    <div className="action-panel-body">
      {problem && <p role="status" className="notice-amber">Cannot originate: {problem}</p>}
      <label>Action name<input value={working.name} maxLength={120} onChange={e => patch({ name: e.target.value })} /></label>
      <fieldset className="action-radio-group"><legend>Activation</legend>
        {(['select', 'menu'] as const).map(value => <label key={value}><input type="radio" name="action-activation" value={value} checked={actionActivation(working) === value} onChange={() => patch({ activation: value })} />{value === 'select' ? 'Select' : 'Menu option'}</label>)}
        <p className="field-hint">Menu option actions run from the visual's ⋯ menu instead of firing on selection.</p>
      </fieldset>
      <label>Action type<select value={kind} onChange={e => switchKind(e.target.value as PanelKind)}>
        <option value="filter">Filter action</option><option value="navigation">Navigation action</option><option value="url">URL action</option>
      </select></label>
      {kind === 'filter' && <FilterFields draft={draft} visual={visual} action={working as FilterAction} onChange={patch} />}
      {kind === 'url' && <UrlFields visual={visual} action={working as UrlAction} onChange={patch} problem={runtimeProblems[working.id]} />}
      {kind === 'navigation' && <NavigationFields draft={draft} visual={visual} action={working as NavigationAction} onChange={patch} problem={runtimeProblems[working.id]} />}
    </div>
    <div className="action-panel-footer">
      <button type="button" className="primary-button" onClick={save} disabled={!working.name.trim()}>Save</button>
      <button type="button" onClick={onClose}>Close</button>
      {actionId && <button type="button" className="danger-button" onClick={remove}>Delete</button>}
    </div>
  </div>;
}

function SourceField({ visual, value, onChange }: { visual: AuthorVisual; value: string; onChange: (field: string) => void }) {
  return <label>Source field<select value={value} onChange={e => onChange(e.target.value)}>
    {!actionDimensions(visual).includes(value) && <option value={value}>{value || 'Choose a field'}</option>}
    {actionDimensions(visual).map(field => <option key={field}>{field}</option>)}
  </select></label>;
}

function FilterFields({ draft, visual, action, onChange }: { draft: AuthorDraft; visual: AuthorVisual; action: FilterAction; onChange: (update: Partial<FilterAction>) => void }) {
  const sheet = activeSheet(draft), dimensions = actionDimensions(visual);
  const scoped = action.scopeFields !== undefined;
  const targets = sheet.visuals.filter(v => v.id !== visual.id);
  const eligible = targets.filter(target => !targetProblem(visual, target, action, draft.calculatedFields, draft.dataset));
  return <>
    <SourceField visual={visual} value={action.sourceField} onChange={sourceField => onChange({ sourceField })} />
    <fieldset className="action-radio-group"><legend>Filter scope</legend>
      <label><input type="radio" name="filter-scope" checked={!scoped} onChange={() => onChange({ scopeFields: undefined })} />All fields</label>
      <label><input type="radio" name="filter-scope" checked={scoped} onChange={() => onChange({ scopeFields: [action.sourceField] })} />Selected fields</label>
      {scoped && <div className="action-checkbox-list">{dimensions.map(field => <label key={field}><input type="checkbox" checked={(action.scopeFields ?? []).includes(field)} onChange={e => onChange({ scopeFields: e.target.checked ? [...(action.scopeFields ?? []), field] : (action.scopeFields ?? []).filter(f => f !== field) })} />{field}</label>)}</div>}
    </fieldset>
    <fieldset className="action-radio-group"><legend>Target visuals</legend>
      <label><input type="radio" name="filter-targets" checked={action.targets === 'all'} onChange={() => onChange({ targets: 'all' })} />All visuals</label>
      <label><input type="radio" name="filter-targets" checked={action.targets !== 'all'} onChange={() => onChange({ targets: [] })} />Select visuals</label>
      {action.targets === 'all' ? null : eligible.length ? <div className="action-checkbox-list">{eligible.map(target => {
        const selected = (action.targets as string[]).includes(target.id), field = action.mappings[target.id] ?? action.sourceField;
        return <div key={target.id} className="action-target">
          <label><input type="checkbox" checked={selected} onChange={e => onChange({ targets: e.target.checked ? [...action.targets as string[], target.id] : (action.targets as string[]).filter(id => id !== target.id) })} />{target.title || target.id} ({target.kind})</label>
          {selected && <label>Map {action.sourceField} to<select aria-label={`Target field for ${target.id}`} value={field} onChange={e => onChange({ mappings: { ...action.mappings, [target.id]: e.target.value } })}>{[...new Set([field, ...actionDimensions(target)])].map(f => <option key={f}>{f}</option>)}</select></label>}
        </div>;
      })}</div> : <p role="status" className="notice-amber">Sheet contains no visuals that can be selected as targets.</p>}
      {action.targets !== 'all' && (action.targets as string[]).filter(id => !sheet.visuals.some(v => v.id === id)).map(id => <p key={id} role="status" className="notice-amber">Cannot receive: {id.replace(/^unresolved:/, '')} is not on this sheet.</p>)}
    </fieldset>
  </>;
}

function UrlFields({ visual, action, onChange, problem }: { visual: AuthorVisual; action: UrlAction; onChange: (update: Partial<UrlAction>) => void; problem?: string }) {
  const templateProblem = urlActionProblem(visual, action);
  return <>
    <SourceField visual={visual} value={action.sourceField} onChange={sourceField => onChange({ sourceField })} />
    <label>URL template<input value={action.urlTemplate} placeholder="https://example.com/{region}" onChange={e => onChange({ urlTemplate: e.target.value })} /></label>
    <label>Open in<select value={action.target ?? '_blank'} onChange={e => onChange({ target: e.target.value as '_blank' | '_self' })}><option value="_blank">New tab</option><option value="_self">Current tab</option></select></label>
    <p className="field-hint">URL placeholders use grouped dimension names and encode clicked values.</p>
    {(templateProblem ?? problem) && <p role="status">Action disabled: {templateProblem ?? problem}</p>}
  </>;
}

function NavigationFields({ draft, visual, action, onChange, problem }: { draft: AuthorDraft; visual: AuthorVisual; action: NavigationAction; onChange: (update: Partial<NavigationAction>) => void; problem?: string }) {
  const sheets = navigationSheets(draft), parameters = sheetParameters(draft);
  const definitionProblem = navigationActionProblem(draft, visual, action);
  return <>
    <SourceField visual={visual} value={action.sourceField} onChange={sourceField => onChange({ sourceField })} />
    <label>Target sheet<select value={action.targetSheetId} onChange={e => onChange({ targetSheetId: e.target.value })}>
      {!sheets.some(s => s.id === action.targetSheetId) && <option value={action.targetSheetId}>{action.targetSheetId || 'Choose a sheet'}</option>}
      {sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    {Object.entries(action.parameterMappings).map(([field, name]) => <div key={field} className="action-target">
      <label>Mapped source field<select value={field} onChange={e => onChange({ parameterMappings: Object.fromEntries(Object.entries(action.parameterMappings).map(([f, p]) => [f === field ? e.target.value : f, p])) })}>{[...new Set([field, ...actionDimensions(visual).filter(f => !Object.hasOwn(action.parameterMappings, f))])].map(f => <option key={f}>{f}</option>)}</select></label>
      <label>Target parameter<select value={name} onChange={e => onChange({ parameterMappings: { ...action.parameterMappings, [field]: e.target.value } })}>
        {!parameters.some(p => p.name === name) && <option value={name}>{name || 'Choose a parameter'}</option>}
        {parameters.map(p => <option key={p.id} value={p.name}>{p.name} ({p.type})</option>)}
      </select></label>
      <button type="button" onClick={() => onChange({ parameterMappings: Object.fromEntries(Object.entries(action.parameterMappings).filter(([f]) => f !== field)) })}>Remove mapping</button>
    </div>)}
    <button type="button" disabled={actionDimensions(visual).every(f => Object.hasOwn(action.parameterMappings, f))} onClick={() => {
      const field = actionDimensions(visual).find(f => !Object.hasOwn(action.parameterMappings, f));
      if (field) onChange({ parameterMappings: { ...action.parameterMappings, [field]: '' } });
    }}>Add parameter mapping</button>
    {(definitionProblem ?? problem) && <p role="status">Action disabled: {definitionProblem ?? problem}</p>}
  </>;
}
