import { useState, type Dispatch } from 'react';
import { activeSheet, type AuthorDraft, type AuthorVisual, type AuthorAction } from './authoring.js';
import { actionDimensions, originProblem, targetProblem, urlActionProblem, type UrlAction, type FilterAction } from './interactions.js';
export function ActionEditor({ draft, visual, dispatch, runtimeProblems = {} }: { draft: AuthorDraft; visual: AuthorVisual; dispatch: Dispatch<AuthorAction>; runtimeProblems?: Record<string, string> }) {
  const [actionType, setActionType] = useState('Filter');
  const urls = visual.urlActions ?? [];
  const saveUrl = (action: UrlAction) => dispatch({ type: 'url-actions', actions: urls.map(a => a.id === action.id ? action : a) });
  const sheet = activeSheet(draft), actions = visual.filterActions ?? [], problem = originProblem(visual);
  const save = (action: FilterAction) => dispatch({ type: 'filter-actions', actions: actions.map(a => a.id === action.id ? action : a) });
  return <details className="property-section" open><summary>Custom actions</summary>
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
      {(urlActionProblem(visual, action) ?? runtimeProblems[action.id]) && <p role="status">Action disabled: {urlActionProblem(visual, action) ?? runtimeProblems[action.id]}</p>}
      <button type="button" onClick={() => dispatch({ type: 'url-actions', actions: urls.filter(a => a.id !== action.id) })}>Remove action</button>
    </fieldset>)}
    <label>Action type<select value={actionType} onChange={e => setActionType(e.target.value)}><option>Filter</option><option>URL</option></select></label>
    <button type="button" disabled={!!problem} onClick={() => {
      let n = 1; while ([...actions, ...urls].some(a => a.id === `action-${n}`)) n++;
      const common = { id: `action-${n}`, name: `${actionType} action ${n}`, sourceField: actionDimensions(visual)[0]! };
      if (actionType === 'URL') dispatch({ type: 'url-actions', actions: [...urls, { ...common, urlTemplate: '' }] });
      else dispatch({ type: 'filter-actions', actions: [...actions, { ...common, targets: 'all', mappings: {} }] });
    }}>Add {actionType.toLowerCase()} action</button>
    <p>Click a bar, slice, or data row. URL placeholders use grouped dimension names and encode clicked values. Hierarchy fields apply when selected at that level. Brush a line chart for filter actions. Click the same selection again or use Reset actions to clear filters.</p>
  </details>;
}
