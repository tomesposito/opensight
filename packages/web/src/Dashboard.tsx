import { useState } from 'react';
import { useAccess } from './access.js';
import type { Fixture } from './model.js';
import type { QueryClient } from './author-query.js';
import { OEntry } from './OEntry.js';
import { emptyDraft } from './authoring.js';
import { VisualCard } from './VisualCard.js';

export function Dashboard({ fixture, hosted = false, dashboardId, client, sample = false }: { fixture: Fixture; sample?: boolean; hosted?: boolean; dashboardId?: string; client?: QueryClient }) {
  const access = useAccess();
  const [sheetId, setSheetId] = useState(fixture.sheets[0]?.id);
  const sheet = fixture.sheets.find(s => s.id === sheetId);
  return <>
    {(access.mode === 'demo' && sample || hosted && dashboardId !== undefined) && <OEntry draft={emptyDraft()} client={hosted ? client : undefined} dashboardId={dashboardId} />}
    {!sample && !hosted && <p className="fixture-notice">Questions are unavailable for definition previews. <a href="#/home">Open Home to explore sample sales data.</a></p>}
    <div className="dashboard-heading"><div><p className="eyebrow">{fixture.description}</p><h1>{fixture.name}</h1></div><span className="phase-badge">{sample ? 'Pinned sample data' : 'Definition preview'}</span></div>
    <p className="fixture-notice">{sample ? <>Pinned synthetic sales data. No live query is run. </> : <>Developer tool: inspect chart definitions and pinned sample results. </>}{fixture.notice}</p>
    <nav className="sheet-tabs" aria-label="Sheets">{fixture.sheets.map(s => <button key={s.id} aria-current={s.id === sheetId ? 'page' : undefined} onClick={() => setSheetId(s.id)}>{s.name}<span>{s.visuals.length} {s.visuals.length === 1 ? 'visual' : 'visuals'}</span></button>)}</nav>
    {sheet ? sheet.visuals.length ? <div className="dashboard-grid" aria-label={sheet.name}>{sheet.visuals.map(v => <VisualCard key={v.path} visual={v} definitionPreview={!sample} />)}</div> : <p role="status">This sheet has no visuals. Choose another sheet or ask the dashboard author to add a visual.</p> : <p role="status">This definition has no sheets. Load a definition with at least one sheet and visual.</p>}
    <p className="provenance">Source: <code>{fixture.provenance}</code></p>
  </>;
}
