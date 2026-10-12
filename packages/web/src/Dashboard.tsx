import { useState } from 'react';
import { useAccess } from './access.js';
import type { Fixture, FixtureVisual } from './model.js';
import type { QueryClient } from './author-query.js';
import { QSidePanel } from './QSidePanel.js';
import { emptyDraft } from './authoring.js';
import { VisualCard } from './VisualCard.js';
import { VisualActionMenu } from './VisualActionMenu.js';
import type { VisualInteraction } from './visual-selection.js';
import { actionActivation, interpolateUrl, toggleSelection, type ActionSelections, type FilterAction, type NavigationAction, type Selection, type UrlAction } from './interactions.js';
import { hasViewActions, resolveViewNavigationAction, viewMenuActions, viewOriginProblem, viewVisualId } from './dashboard-interactions.js';

export function Dashboard({ fixture, hosted = false, dashboardId, client, sample = false }: { fixture: Fixture; sample?: boolean; hosted?: boolean; dashboardId?: string; client?: QueryClient }) {
  const access = useAccess();
  const [sheetId, setSheetId] = useState(fixture.sheets[0]?.id);
  const sheet = fixture.sheets.find(s => s.id === sheetId);
  const visuals = sheet?.visuals ?? [];
  // Action state resets when the sheet or its actions change, like author mode's interactionKey.
  const interactionKey = JSON.stringify([fixture.id, sheetId, visuals.map(v => [viewVisualId(v), v.filterActions, v.urlActions, v.navigationActions])]);
  const [selectionState, setSelectionState] = useState<{ key: string; selections: ActionSelections }>({ key: interactionKey, selections: {} });
  const [menuSelectionState, setMenuSelectionState] = useState<{ key: string; selections: ActionSelections }>({ key: interactionKey, selections: {} });
  const [problemState, setProblemState] = useState<{ key: string; visuals: Record<string, Record<string, string>> }>({ key: interactionKey, visuals: {} });
  const selections = selectionState.key === interactionKey ? selectionState.selections : {};
  const menuSelections = menuSelectionState.key === interactionKey ? menuSelectionState.selections : {};
  const runtimeProblems = problemState.key === interactionKey ? problemState.visuals : {};
  const clearViewSource = (id: string) => setSelectionState({ key: interactionKey, selections: Object.fromEntries(Object.entries(selections).filter(([key]) => key !== id)) });
  const recordViewProblem = (id: string, problems: Record<string, string>) => setProblemState({ key: interactionKey, visuals: { ...runtimeProblems, [id]: problems } });
  const onViewSelect = (visual: FixtureVisual, selection: Selection) => {
    const id = viewVisualId(visual);
    const selectFilters = (visual.filterActions ?? []).filter(action => actionActivation(action) === 'select');
    const menuActions = viewMenuActions(visual);
    if (selectFilters.length || menuActions.length) setSelectionState({ key: interactionKey, selections: toggleSelection(selections, id, selection) });
    const problems: Record<string, string> = {};
    for (const action of (visual.urlActions ?? []).filter(action => actionActivation(action) === 'select')) {
      const result = interpolateUrl(action.urlTemplate, selection.values);
      if (result.problem !== undefined) problems[action.id] = result.problem;
      else window.open(result.value, action.target ?? '_blank', 'noopener,noreferrer');
    }
    for (const action of (visual.navigationActions ?? []).filter(action => actionActivation(action) === 'select')) {
      const resolved = resolveViewNavigationAction(fixture.sheets, action, selection);
      if (resolved.problem !== undefined) problems[action.id] = resolved.problem;
      else { setSheetId(resolved.value.targetSheetId); break; }
    }
    recordViewProblem(id, problems);
  };
  /** Menu-option actions run from the visual's ⋯ menu against its current selection. */
  const runViewMenuAction = (visual: FixtureVisual, action: FilterAction | UrlAction | NavigationAction) => {
    const id = viewVisualId(visual);
    const selection = selections[id];
    if (!selection) return;
    if ('urlTemplate' in action) {
      const result = interpolateUrl(action.urlTemplate, selection.values);
      if (result.problem !== undefined) recordViewProblem(id, { [action.id]: result.problem });
      else { window.open(result.value, action.target ?? '_blank', 'noopener,noreferrer'); recordViewProblem(id, {}); }
    } else if ('targetSheetId' in action) {
      const resolved = resolveViewNavigationAction(fixture.sheets, action, selection);
      if (resolved.problem !== undefined) recordViewProblem(id, { [action.id]: resolved.problem });
      else { setSheetId(resolved.value.targetSheetId); recordViewProblem(id, {}); }
    } else setMenuSelectionState({ key: interactionKey, selections: toggleSelection(menuSelections, id, selection) });
  };
  return <>
    {(access.mode === 'demo' && sample || hosted && dashboardId !== undefined) && <QSidePanel draft={emptyDraft()} client={hosted ? client : undefined} dashboardId={dashboardId} />}
    {!sample && !hosted && <p className="fixture-notice">Questions are unavailable for definition previews. <a href="#/home">Open Home to explore sample sales data.</a></p>}
    <div className="dashboard-heading"><div><p className="eyebrow">{fixture.description}</p><h1>{fixture.name}</h1></div><span className="phase-badge">{sample ? 'Pinned sample data' : 'Definition preview'}</span></div>
    <p className="fixture-notice">{sample ? <>Pinned synthetic sales data. No live query is run. </> : <>Developer tool: inspect chart definitions and pinned sample results. </>}{fixture.notice}</p>
    <nav className="sheet-tabs" aria-label="Sheets">{fixture.sheets.map(s => <button key={s.id} aria-current={s.id === sheetId ? 'page' : undefined} onClick={() => setSheetId(s.id)}>{s.name}<span>{s.visuals.length} {s.visuals.length === 1 ? 'visual' : 'visuals'}</span></button>)}</nav>
    {sheet ? sheet.visuals.length ? <div className="dashboard-grid" aria-label={sheet.name}>{visuals.map(v => {
      const id = viewVisualId(v);
      const interaction: VisualInteraction | undefined = hasViewActions(v) && !viewOriginProblem(v) ? {
        onClear: () => clearViewSource(id),
        onSelect: selection => onViewSelect(v, selection),
      } : undefined;
      const menuActions = viewMenuActions(v);
      return <VisualCard key={v.path} visual={v} definitionPreview={!sample} interaction={interaction}
        actionMenu={menuActions.length ? <VisualActionMenu items={menuActions} selection={selections[id]} onInvoke={action => runViewMenuAction(v, action)} /> : undefined} />;
    })}</div> : <p role="status">This sheet has no visuals. Choose another sheet or ask the dashboard author to add a visual.</p> : <p role="status">This definition has no sheets. Load a definition with at least one sheet and visual.</p>}
    <p className="provenance">Source: <code>{fixture.provenance}</code></p>
  </>;
}
