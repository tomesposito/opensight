import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { EmbedFrame, embedAsset, type EmbedBrand } from './EmbedFrame.js';
import { VisualCard } from './VisualCard.js';
import type { FixtureVisual } from './model.js';
import { startEmbedTransport, type EmbedShell, type EmbedTransport, type SessionState } from './embed-transport.js';
import { EmbeddedAuthor, type ConsoleContent } from './EmbeddedAuthor.js';
import './style.css';
import './embed.css';
interface Shell extends EmbedShell { appearance: EmbedBrand; assets: Record<string, string> }
interface Content { kind: 'dashboard' | 'visual' | 'q' | 'console'; title: string; visuals?: (FixtureVisual & { id: string })[]; columns?: { name: string; type: string }[] }
const shell = JSON.parse(document.getElementById('opensight-embed-data')?.textContent ?? 'null') as Shell | null;
let bootstrap = new URLSearchParams(window.location.hash.slice(1)).get('bootstrap') ?? '';
window.history.replaceState(null, '', window.location.pathname);
document.getElementById('opensight-embed-data')?.remove();
function Question({ transport, columns }: { transport: EmbedTransport; columns: { name: string; type: string }[] }) {
  const [question, setQuestion] = useState(''), [rows, setRows] = useState<Record<string, unknown>[]>([]), [busy, setBusy] = useState(false);
  const ask = () => { if (busy || !question.trim()) return; setBusy(true); void transport.request<{ rows: Record<string, unknown>[] }>('question', { Question: question }).then(r => setRows(r.rows)).catch(() => {}).finally(() => setBusy(false)); };
  return <section className="embed-question"><div role="search">
    <label>Question<input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }} placeholder="total amount by region" maxLength={1000} /></label><button type="button" onClick={ask} disabled={busy || !question.trim()}>Ask</button>
    <p>Use sum, total, average, min, max, or count followed by a field, optionally “by” another field.</p><p>Available fields: {columns.map(c => c.name).join(', ')}</p>
  </div>{rows.length > 0 && <table><thead><tr>{Object.keys(rows[0]!).map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{Object.values(row).map((value, j) => <td key={j}>{String(value ?? '')}</td>)}</tr>)}</tbody></table>}</section>;
}
function SessionFrame({ shell }: { shell: Shell }) {
  const [state, setState] = useState<SessionState>('loading'), [content, setContent] = useState<Content | null>(null), transport = useRef<EmbedTransport | null>(null);
  useEffect(() => {
    document.title = shell.appearance.iframeTitle;
    const favicon = embedAsset(shell.appearance.faviconAssetId, shell.assets);
    if (favicon) { const link = document.createElement('link'); link.rel = 'icon'; link.href = favicon; document.head.appendChild(link); }
    const value = bootstrap; bootstrap = '';
    const current = startEmbedTransport(shell, value, state => { setState(state); if (['expired', 'revoked', 'error', 'saved'].includes(state)) setContent(null); }, async t => {
      const result = await t.request<Content>('content'); setContent(result); t.ready();
    });
    transport.current = current; return () => current.destroy();
  }, [shell]);
  const ready = state === 'ready' && content, empty = ready && ['dashboard', 'visual'].includes(content.kind) && !content.visuals?.length;
  const frameState = ready ? empty ? 'empty' : 'ready' : state === 'expired' || state === 'saved' ? 'expired' : state === 'revoked' || state === 'error' ? 'error' : 'loading';
  const statusTitle = state === 'saved' ? 'Analysis saved' : state === 'expired' ? 'Session expired' : state === 'revoked' ? 'Access revoked' : state === 'error' ? 'Embedded content unavailable' : state === 'loading' ? 'Loading embedded content' : undefined;
  return <EmbedFrame state={frameState} statusTitle={statusTitle} appearance={shell.appearance} assets={shell.assets} title={content?.title} viewLabel={content?.kind === 'console' ? 'Analysis editor' : content?.kind === 'q' ? 'Q search' : 'Embedded view'} description="Session view · using your current data permissions"
    detail={state === 'revoked' ? 'Access has been revoked. Request a new session from your application.' : state === 'saved' ? 'Analysis saved. Request a new session to continue editing.' : state === 'expired' ? 'This session has expired. Request a new session from your application.' : undefined}>
    {ready && content.kind === 'q' && transport.current && <Question transport={transport.current} columns={content.columns ?? []} />}
    {ready && content.kind === 'console' && transport.current && <EmbeddedAuthor initial={content as ConsoleContent} transport={transport.current} />}
    {ready && content.kind !== 'console' && <div className="dashboard-grid">{content.visuals?.map(v => <VisualCard key={v.id} visual={v} />)}</div>}
  </EmbedFrame>;
}
createRoot(document.getElementById('root')!).render(shell ? <SessionFrame shell={shell} /> : <EmbedFrame state="error" />);
