import { useState, type Dispatch } from 'react';
import { activeSheet, sheetParameters, type AuthorDraft, type AuthorVisual, type AuthorAction } from './authoring.js';
import { actionDimensions, originProblem, targetProblem, urlActionProblem, navigationActionProblem, navigationSheets, type NavigationAction, type UrlAction, type FilterAction } from './interactions.js';
export function ActionEditor({ draft, visual, dispatch, runtimeProblems = {} }: { draft: AuthorDraft; visual: AuthorVisual; dispatch: Dispatch<AuthorAction>; runtimeProblems?: Record<string, string> }) {
  const runtimeProblem = (id: string) => Object.hasOwn(runtimeProblems, id) ? runtimeProblems[id] : undefined;
  const [actionType, setActionType] = useState('Filter');
  const navigations = visual.navigationActions ?? [], sheets = navigationSheets(draft), parameters = sheetParameters(draft);
  const saveNavigation = (action: NavigationAction) => dispatch({ type: 'navigation-actions', actions: navigations.map(a => a.id === action.id ? action : a) });
  const urls = visual.urlActions ?? [];
  const saveUrl = (action: UrlAction) => dispatch({ type: 'url-actions', actions: urls.map(a => a.id === action.id ? action : a) });
  const sheet = activeSheet(draft), actions = visual.filterActions ?? [], problem = originProblem(visual);
  const save = (action: FilterAction) => dispatch({ type: 'filter-actions', actions: actions.map(a => a.id === action.id ? action : a) });
  return <details className="property-section" open><summary data-author-control="actions">Custom actions</summary>
    {problem && <p role="status">Cannot originate: {problem}</p>}
    {actions.map(action => <fieldset key={action.id}><legend>{action.name}</legend>
      <label>Action name<input value={action.name} onChange={e => save({ ...action, name: e.target.value })} /></label>
      <label>Selection field<select value={action.sourceField} onChange={e => save({ ...action, sourceField: e.target.value })}>{[...new Set([action.sourceField, ...actionDimensions(visual)])].map(f => <option key={f}>{f}</option>)}</select></label>
      <label>Affected visuals<select value={action.targets === 'all' ? 'all' : 'selected'} onChange={e => save({ ...action, targets: e.target.value === 'all' ? 'all' : [] })}><option value="all">All compatible visuals</option><option value="selected">Selected visuals</option></select></label>
      {action.targets !== 'all' && action.targets.filter(id => !sheet.visuals.some(v => v.id === id)).map(id => <p key={id}>Cannot receive: {id.replace(/^unresolved:/, '')} is not on this sheet.</p>)}
      {sheet.visuals.map(target => {
        const reason = targetProblem(visual, target, action, draft.calculatedFields, draft.dataset), field = action.mappings[target.id] ?? action.sourceField;
        return <div key={target.id} className="action-target"><strong>{target.title || target.id} ({target.kind})</strong>
          {action.targets !== 'all' && <label><input type="checkbox" disabled={!!reason} checked={action.targets.includes(target.id)} onChange={e => save({ ...action, targets: e.target.checked ? [...action.targets as string[], target.id] : (action.targets as string[]).filter(id => id !== target.id) })} />Receive action</label>}
          <label>Map {action.sourceField} to<select aria-label={`Target field for ${target.id}`} value={field} disabled={!actionDimensions(target).length || target.id === visual.id} onChange={e => save({ ...action, mappings: { ...action.mappings, [target.id]: e.target.value } })}>{[...new Set([field, ...actionDimensions(target)])].map(f => <option key={f}>{f}</option>)}</select></label>
          <p>{reason ? `Cannot receive: ${reason}` : 'Can receive this action.'}</p>
        </div>;
      })}
      <button type="button" onClick={() => dispatch({ type: 'filter-actions', actions: actions.filter(a => a.id !== action.id) })}>Remove action</button>
    </fieldset>)}
    {urls.map(action => <fieldset key={action.id}><legend>{action.name || 'URL action'}</legend>
      <label>Action name<input value={action.name} onChange={e => saveUrl({ ...action, name: e.target.value })} /></label>
      <label>Source field<select value={action.sourceField} onChange={e => saveUrl({ ...action, sourceField: e.target.value })}>{[...new Set([action.sourceField, ...actionDimensions(visual)])].map(f => <option key={f}>{f}</option>)}</select></label>
      <label>URL template<input value={action.urlTemplate} placeholder="https://example.com/{region}" onChange={e => saveUrl({ ...action, urlTemplate: e.target.value })} /></label>
      <label>Open in<select value={action.target ?? '_blank'} onChange={e => saveUrl({ ...action, target: e.target.value as '_blank' | '_self' })}><option value="_blank">New tab</option><option value="_self">Current tab</option></select></label>
      {(urlActionProblem(visual, action) ?? runtimeProblem(action.id)) && <p role="status">Action disabled: {urlActionProblem(visual, action) ?? runtimeProblem(action.id)}</p>}
      <button type="button" onClick={() => dispatch({ type: 'url-actions', actions: urls.filter(a => a.id !== action.id) })}>Remove action</button>
    </fieldset>)}
    {navigations.map(action => <fieldset key={action.id}><legend>{action.name || 'Navigation action'}</legend>
      <label>Action name<input value={action.name} onChange={e => saveNavigation({ ...action, name: e.target.value })} /></label>
      <label>Source field<select value={action.sourceField} onChange={e => saveNavigation({ ...action, sourceField: e.target.value })}>{[...new Set([action.sourceField, ...actionDimensions(visual)])].map(f => <option key={f}>{f}</option>)}</select></label>
      <label>Target sheet<select value={action.targetSheetId} onChange={e => saveNavigation({ ...action, targetSheetId: e.target.value })}>
        {!sheets.some(s => s.id === action.targetSheetId) && <option value={action.targetSheetId}>{action.targetSheetId || 'Choose a sheet'}</option>}
        {sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      {Object.entries(action.parameterMappings).map(([field, name]) => <div key={field} className="action-target">
        <label>Mapped source field<select value={field} onChange={e => saveNavigation({ ...action, parameterMappings: Object.fromEntries(Object.entries(action.parameterMappings).map(([f, p]) => [f === field ? e.target.value : f, p])) })}>{[...new Set([field, ...actionDimensions(visual).filter(f => !Object.hasOwn(action.parameterMappings, f))])].map(f => <option key={f}>{f}</option>)}</select></label>
        <label>Target parameter<select value={name} onChange={e => saveNavigation({ ...action, parameterMappings: { ...action.parameterMappings, [field]: e.target.value } })}>
          {!parameters.some(p => p.name === name) && <option value={name}>{name || 'Choose a parameter'}</option>}
          {parameters.map(p => <option key={p.id} value={p.name}>{p.name} ({p.type})</option>)}
        </select></label>
        <button type="button" onClick={() => saveNavigation({ ...action, parameterMappings: Object.fromEntries(Object.entries(action.parameterMappings).filter(([f]) => f !== field)) })}>Remove mapping</button>
      </div>)}
      <button type="button" disabled={actionDimensions(visual).every(f => Object.hasOwn(action.parameterMappings, f))} onClick={() => {
        const field = actionDimensions(visual).find(f => !Object.hasOwn(action.parameterMappings, f));
        if (field) saveNavigation({ ...action, parameterMappings: { ...action.parameterMappings, [field]: '' } });
      }}>Add parameter mapping</button>
      {(navigationActionProblem(draft, visual, action) ?? runtimeProblem(action.id)) && <p role="status">Action disabled: {navigationActionProblem(draft, visual, action) ?? runtimeProblem(action.id)}</p>}
      <button type="button" onClick={() => dispatch({ type: 'navigation-actions', actions: navigations.filter(a => a.id !== action.id) })}>Remove action</button>
    </fieldset>)}
    <label>Action type<select value={actionType} onChange={e => setActionType(e.target.value)}><option>Filter</option><option>URL</option><option>Navigation</option></select></label>
    <button type="button" disabled={!!problem} onClick={() => {
      let n = 1; while ([...actions, ...urls, ...navigations].some(a => a.id === `action-${n}`)) n++;
      const common = { id: `action-${n}`, name: `${actionType} action ${n}`, sourceField: actionDimensions(visual)[0]! };
      if (actionType === 'URL') dispatch({ type: 'url-actions', actions: [...urls, { ...common, urlTemplate: '' }] });
      else if (actionType === 'Navigation') dispatch({ type: 'navigation-actions', actions: [...navigations, { ...common, targetSheetId: sheets.find(s => s.id !== sheet.id)?.id ?? '', parameterMappings: {} }] });
      else dispatch({ type: 'filter-actions', actions: [...actions, { ...common, targets: 'all', mappings: {} }] });
    }}>{`Add ${actionType.toLowerCase()} action`}</button>
    <p>Click a bar, slice, or data row. URL placeholders use grouped dimension names and encode clicked values. Hierarchy fields apply when selected at that level. Brush a line chart for filter actions. Click the same selection again or use Reset actions to clear filters.</p>
  </details>;
}
