import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { VisualCard } from './VisualCard.js';
import type { FixtureVisual } from './model.js';
import './style.css';

interface EmbedData { dashboardId: string; visualId?: string; title: string; parentOrigin: string; expiresAt: number; visuals: (FixtureVisual & { id: string; sheet: string })[] }
const data = JSON.parse(document.getElementById('opensight-embed-data')?.textContent ?? 'null') as EmbedData | null;
function EmbeddedDashboard({ data }: { data: EmbedData }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    window.parent.postMessage({ type: 'opensight:ready', dashboardId: data.dashboardId, visualId: data.visualId }, data.parentOrigin);
    // Remove the bearer URL from frame history once loaded; requests are never made by this snapshot.
    window.history.replaceState(null, '', window.location.pathname);
    const timer = window.setTimeout(() => {
      setExpired(true);
      window.parent.postMessage({ type: 'opensight:expired', dashboardId: data.dashboardId, visualId: data.visualId }, data.parentOrigin);
    }, Math.max(0, data.expiresAt * 1000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [data]);
  if (expired) return <p role="status">Embed URL expired. Request a fresh URL through the hosted API.</p>;
  return <main className="embedded-dashboard"><h1>{data.title}</h1><p>Dashboard snapshot · rendered with your data access permissions</p>
    <div className="dashboard-grid">{data.visuals.map(visual => <VisualCard key={visual.id} visual={visual} />)}</div>
    {!data.visuals.length && <p>No visuals in this dashboard.</p>}
  </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(data ? <EmbeddedDashboard data={data} /> : <p role="alert">Embed data is unavailable. Generate an embed URL through the hosted API.</p>);
