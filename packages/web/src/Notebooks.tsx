import { useEffect, useState } from 'react';
import type { createApiClient } from './api-client.js';
import { allowed, useAccess } from './access.js';
import { VisualCard } from './VisualCard.js';
import { notebookVisual, type Notebook, type NotebookCell, type NotebookData, type NotebookDataset, type NotebookParameter, type NotebookRun, type NotebookSummary } from './notebooks.js';
export type NotebookClient = Pick<ReturnType<typeof createApiClient>, 'listNotebooks' | 'getNotebook' | 'createNotebook' | 'updateNotebook' | 'deleteNotebook' | 'runNotebook' | 'notebookDatasets' | 'notebookRuns' | 'snapshotNotebookCell'>;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const content = (n: Notebook) => ({ name: n.name, published: n.published, parameters: n.parameters, cells: n.cells });

export function Notebooks({ client, id, onOpen }: { client?: NotebookClient; id?: string; onOpen: (id?: string) => void }) {
  const access = useAccess();
  const [items, setItems] = useState<NotebookSummary[]>([]), [notebook, setNotebook] = useState<Notebook>();
  const [datasets, setDatasets] = useState<NotebookDataset[]>([]), [runs, setRuns] = useState<NotebookRun[]>([]), [run, setRun] = useState<NotebookRun>();
  const [canCreate, setCanCreate] = useState(false), [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(!!client), [name, setName] = useState('');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setNotebook(undefined); setRun(undefined); setDirty(false);
    void (async () => {
      if (!id) { const list = await client.listNotebooks(controller.signal); if (!controller.signal.aborted) { setItems(list.notebooks); setCanCreate(list.canCreate); } }
      else {
        const [n, sources, history] = await Promise.all([client.getNotebook(id, controller.signal), client.notebookDatasets(controller.signal), client.notebookRuns(id, controller.signal)]);
        if (!controller.signal.aborted) { setNotebook(n); setDatasets(sources.datasets); setRuns(history.runs); setEditing(n.canEdit && !n.published); setBindings({}); }
      }
    })().catch(e => { if (!controller.signal.aborted) setError(message(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, id]);
  const action = async (operation: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await operation(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const edit = (patch: Partial<Notebook>) => { if (notebook) { setNotebook({ ...notebook, ...patch }); setDirty(true); setRun(undefined); } };
  const updateCell = (cell: NotebookCell) => { if (notebook) edit({ cells: notebook.cells.map(c => c.id === cell.id ? cell : c) }); };
  const runCells = (cellId?: string) => action(async () => {
    if (!client || !notebook || dirty) return;
    const parameters = Object.fromEntries(notebook.parameters.filter(p => Object.hasOwn(bindings, p.name)).map(p => {
      const raw = bindings[p.name]!;
      if (p.type === 'number' && (!raw.trim() || !Number.isFinite(Number(raw)))) throw new Error(`NOTEBOOK_PARAMETER_INVALID: ${p.name} needs a number.`);
      return [p.name, p.type === 'number' ? Number(raw) : raw];
    }));
    setRun(undefined);
    setRun(await client.runNotebook(notebook.id, parameters, cellId));
    setRuns((await client.notebookRuns(notebook.id)).runs);
  });
  const reorder = (index: number, direction: number) => {
    if (!notebook) return;
    const cells = [...notebook.cells], target = index + direction;
    [cells[index], cells[target]] = [cells[target]!, cells[index]!];
    if (cells.some((c, i) => c.kind === 'visual' && !cells.slice(0, i).some(s => s.id === c.sourceCellId))) { setError('NOTEBOOK_VISUAL_DEPENDENCY_INVALID: A visual must stay after its source SQL cell.'); return; }
    edit({ cells });
  };
  const add = (kind: NotebookCell['kind']) => {
    if (!notebook) return;
    const id = `cell-${crypto.randomUUID()}`;
    const sql = notebook.cells.find(c => c.kind === 'sql');
    if (kind === 'visual' && !sql) { setError('Add a SQL cell before adding a visual.'); return; }
    edit({ cells: [...notebook.cells, kind === 'markdown' ? { id, kind, text: '' } : kind === 'sql' ? { id, kind, text: 'SELECT * FROM "dataset_id"', datasetRefs: [] } : { id, kind, sourceCellId: sql!.id, chart: { type: 'bar', dimension: 'dimension', measure: 'measure', aggregation: 'SUM' } }] });
  };
  const remove = (id: string) => {
    if (!notebook) return;
    if (notebook.cells.some(c => c.kind === 'visual' && c.sourceCellId === id)) { setError('Remove dependent visual cells before removing this SQL cell.'); return; }
    edit({ cells: notebook.cells.filter(c => c.id !== id) });
  };
  return <section className="notebooks-page" aria-label="Notebooks">
    <header className="notebooks-heading"><div><h1>{notebook?.name ?? 'Notebooks'}</h1><p>SQL, notes and visuals · Published apps run with each viewer’s own data permissions.</p></div>{id && <button disabled={busy || dirty} onClick={() => onOpen()}>All notebooks</button>}</header>
    <p className="data-note">Available on the local and organization API. Hosted notebook support is not available in v1.</p>
    {!client ? <div className="data-card notebooks-notice"><h2>Connect a local or organization API</h2><p>The static demo cannot store or run notebooks. No queries run here.</p></div> : <>
      {error && <p className="notebook-error" role="alert">{error}{!notebook && <span> · This server may not support notebooks; hosted routes are not available in v1.</span>}</p>}
      {loading && <p role="status">Loading notebooks…</p>}
      {!id && !loading && <div className="data-card notebook-list">
        {canCreate && <form onSubmit={event => { event.preventDefault(); void action(async () => { const n = await client.createNotebook({ name, published: false, parameters: [], cells: [] }); onOpen(n.id); }); }}><label>Notebook name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()} className="data-primary">Create notebook</button></form>}
        {!items.length && !error && <p>No notebooks yet. Published notebooks in your namespace will appear here.</p>}
        {!!items.length && <table><thead><tr><th>Name</th><th>Owner</th><th>Status</th><th>Cells</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{items.map(n => <tr key={n.id}><td><button className="data-name" onClick={() => onOpen(n.id)}>{n.name}</button></td><td>{n.ownerId}</td><td>{n.published ? 'Published app' : 'Draft'}</td><td>{n.cellCount}</td><td>{n.updatedAt}</td><td>{n.canManage && <button disabled={busy} onClick={() => void action(async () => { await client.deleteNotebook(n.id); setItems(items.filter(item => item.id !== n.id)); })}>Delete {n.name}</button>}</td></tr>)}</tbody></table>}
      </div>}
      {notebook && <>
        <div className="notebook-toolbar">
          {notebook.canEdit && <button disabled={busy || dirty} onClick={() => setEditing(!editing)}>{editing ? 'Open run view' : 'Edit notebook'}</button>}
          {editing && <><button className="data-primary" disabled={busy || !dirty} onClick={() => void action(async () => { const saved = await client.updateNotebook(notebook.id, { ...content(notebook), version: notebook.version }); setNotebook(saved); setDirty(false); setRun(undefined); })}>Save notebook</button><button disabled={busy || !dirty} onClick={() => void action(async () => { setNotebook(await client.getNotebook(notebook.id)); setDirty(false); setBindings({}); setRun(undefined); })}>Discard changes</button></>}
          <button disabled={busy || dirty} onClick={() => void runCells()}>Run all</button><span role="status">{busy ? 'Working…' : dirty ? 'Save changes before running.' : `Saved version ${notebook.version} · ${notebook.published ? 'Published app' : 'Draft'}`}</span>
        </div>
        {editing && <div className="notebook-settings data-card"><label>Name<input maxLength={120} value={notebook.name} disabled={busy} onChange={e => edit({ name: e.target.value })} /></label><label><input type="checkbox" checked={notebook.published} disabled={busy} onChange={e => edit({ published: e.target.checked })} />Publish as an app for this namespace</label><p>Publishing shares the notebook. Each viewer must already have access to every declared dataset.</p></div>}
        <section className="notebook-parameters data-card" aria-label="Notebook parameters"><h2>Parameters</h2>
          {editing ? <>
            {notebook.parameters.map((p, index) => <ParameterEditor key={index} parameter={p} disabled={busy} onChange={value => { edit({ parameters: notebook.parameters.map((p, i) => i === index ? value : p) }); setBindings({}); }} onRemove={() => { edit({ parameters: notebook.parameters.filter((_, i) => i !== index) }); setBindings({}); }} />)}
            <button disabled={busy || notebook.parameters.length >= 200} onClick={() => edit({ parameters: [...notebook.parameters, { name: `parameter${notebook.parameters.length + 1}`, type: 'string' }] })}>Add parameter</button><p>Use <code>$name</code> in SQL for a typed parameter. SQL values are bound by the server.</p>
          </> : !notebook.parameters.length && <p>No parameters.</p>}
          {notebook.parameters.map(p => <label key={p.name}>{p.name} ({p.type})<input type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'} step={p.type === 'number' ? 'any' : undefined} disabled={busy} value={bindings[p.name] ?? String(p.default ?? '')} onChange={e => { setBindings({ ...bindings, [p.name]: e.target.value }); setRun(undefined); }} /></label>)}
        </section>
        <div className="notebook-cells">{notebook.cells.map((cell, index) => {
          const result = run?.results?.find(r => r.cellId === cell.id);
          return <section className="notebook-cell data-card" key={cell.id} aria-label={`${cell.kind} cell ${index + 1}`}>
            <header><h2>{index + 1}. {cell.kind === 'sql' ? 'SQL' : cell.kind === 'visual' ? 'Visual' : 'Markdown'}</h2>{editing && <div><button disabled={busy || index === 0} onClick={() => reorder(index, -1)} aria-label={`Move cell ${index + 1} up`}>↑</button><button disabled={busy || index === notebook.cells.length - 1} onClick={() => reorder(index, 1)} aria-label={`Move cell ${index + 1} down`}>↓</button><button disabled={busy} onClick={() => remove(cell.id)}>Delete cell {index + 1}</button></div>}</header>
            {cell.kind === 'markdown' ? <>{editing && <label>Markdown<textarea aria-label="Markdown" disabled={busy} maxLength={10000} value={cell.text} onChange={e => updateCell({ ...cell, text: e.target.value })} /></label>}<Markdown text={cell.text} /></> : cell.kind === 'sql' ? <>
              {editing && <><label>SQL<textarea aria-label="SQL" spellCheck={false} disabled={busy} maxLength={10000} value={cell.text} onChange={e => updateCell({ ...cell, text: e.target.value })} /></label><fieldset disabled={busy}><legend>Declared datasets</legend>{datasets.map(d => <label key={d.id}><input type="checkbox" checked={cell.datasetRefs.includes(d.id)} onChange={e => updateCell({ ...cell, datasetRefs: e.target.checked ? [...cell.datasetRefs, d.id] : cell.datasetRefs.filter(ref => ref !== d.id) })} /><code>{d.id}</code>{d.asOf && ` · Snapshot as of ${d.asOf}`}<small>{d.columns.map(c => c.name).join(', ')}</small></label>)}{!datasets.length && <p>No accessible datasets.</p>}{cell.datasetRefs.filter(ref => !datasets.some(d => d.id === ref)).map(ref => <p key={ref}>Unavailable: <code>{ref}</code> <button onClick={() => updateCell({ ...cell, datasetRefs: cell.datasetRefs.filter(r => r !== ref) })}>Remove reference</button></p>)}</fieldset><p>Use the exact dataset ID as a quoted SQL table name: <code>SELECT * FROM &quot;dataset_id&quot;</code></p></>}
              <button disabled={busy || dirty} onClick={() => void runCells(cell.id)}>Run cell {index + 1}</button>
              {result?.data && <><ResultTable data={result.data} /><p>Executed as {run?.executedBy} · {result.executedAt} · {result.elapsedMs} ms</p>{allowed(access, 'build') && <button disabled={busy || dirty} onClick={() => void action(async () => { await client.snapshotNotebookCell(notebook.id, cell.id); setNotebook(await client.getNotebook(notebook.id)); setDatasets((await client.notebookDatasets()).datasets); })}>Save result as dataset snapshot</button>}</>}
              {notebook.snapshots.filter(s => s.cellId === cell.id).map(s => <p key={s.id}>Dataset snapshot <code>{s.id}</code> · As of {s.asOf} · {s.rowCount} rows{s.truncated ? ' (capped result)' : ''}</p>)}
            </> : <>
              {editing && <div className="notebook-chart-fields"><label>Source SQL cell<select disabled={busy} value={cell.sourceCellId} onChange={e => updateCell({ ...cell, sourceCellId: e.target.value })}>{notebook.cells.slice(0, index).filter(c => c.kind === 'sql').map(c => <option key={c.id} value={c.id}>SQL cell {notebook.cells.indexOf(c) + 1}</option>)}</select></label><label>Chart<select disabled={busy} value={cell.chart.type} onChange={e => updateCell({ ...cell, chart: { ...cell.chart, type: e.target.value as typeof cell.chart.type } })}>{['bar', 'line', 'pie', 'table'].map(t => <option key={t}>{t}</option>)}</select></label>{(['dimension', 'measure'] as const).map(field => <label key={field}>{field}<input disabled={busy} value={cell.chart[field]} onChange={e => updateCell({ ...cell, chart: { ...cell.chart, [field]: e.target.value } })} /></label>)}<label>Aggregation<select disabled={busy} value={cell.chart.aggregation} onChange={e => updateCell({ ...cell, chart: { ...cell.chart, aggregation: e.target.value as typeof cell.chart.aggregation } })}>{['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => <option key={a}>{a}</option>)}</select></label></div>}
              {!result?.error && <NotebookVisual cell={cell} data={run?.results?.find(r => r.cellId === cell.sourceCellId)?.data} />}
            </>}
            {result?.error && <p className="notebook-error" role="alert">{result.error.code}: {result.error.message}</p>}
          </section>;
        })}</div>
        {editing && <div className="notebook-toolbar">{(['markdown', 'sql', 'visual'] as const).map(kind => <button key={kind} disabled={busy || notebook.cells.length >= 100} onClick={() => add(kind)}>Add {kind === 'sql' ? 'SQL' : kind} cell</button>)}</div>}
        <details className="notebook-history"><summary>Run history ({runs.length})</summary><p>Latest 20 runs. Other callers’ result data stays private.</p><ul>{runs.map(r => <li key={r.id}>{r.executedAt} · Executed as {r.executedBy} · Version {r.notebookVersion}{r.resultsRedacted ? ' · Results private or access changed' : ''}</li>)}</ul></details>
      </>}
    </>}
  </section>;
}
function ParameterEditor({ parameter: p, disabled, onChange, onRemove }: { parameter: NotebookParameter; disabled: boolean; onChange: (p: NotebookParameter) => void; onRemove: () => void }) {
  return <div className="notebook-parameter-editor"><label>Name<input disabled={disabled} value={p.name} onChange={e => onChange({ ...p, name: e.target.value })} /></label><label>Type<select disabled={disabled} value={p.type} onChange={e => onChange({ name: p.name, type: e.target.value as NotebookParameter['type'] })}>{['string', 'number', 'date'].map(t => <option key={t}>{t}</option>)}</select></label><label><input disabled={disabled} type="checkbox" checked={p.default !== undefined} onChange={e => onChange({ name: p.name, type: p.type, ...(e.target.checked ? { default: p.type === 'number' ? 0 : p.type === 'date' ? new Date().toISOString().slice(0, 10) : '' } : {}) })} />Default</label>{p.default !== undefined && <label>Default value<input disabled={disabled} type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'} step="any" value={p.default} onChange={e => onChange({ ...p, default: p.type === 'number' ? Number(e.target.value) : e.target.value })} /></label>}<button disabled={disabled} onClick={onRemove}>Remove parameter</button></div>;
}
function Markdown({ text }: { text: string }) {
  // Deliberately small, safe markdown renderer: headings, bullets and paragraphs;
  // React escapes all content. Raw HTML and active links are never interpreted.
  return <div className="notebook-markdown">{text.split(/\n\s*\n/).map((block, i) => /^#{1,6} /.test(block) ? <h3 key={i}>{block.replace(/^#{1,6} /, '')}</h3> : block.split('\n').every(line => /^[-*] /.test(line)) ? <ul key={i}>{block.split('\n').map((line, j) => <li key={j}>{line.slice(2)}</li>)}</ul> : <p key={i}>{block}</p>)}</div>;
}
function NotebookVisual({ cell, data }: { cell: Extract<NotebookCell, { kind: 'visual' }>; data?: NotebookData }) {
  if (!data) return <p>Run the source SQL cell to view this chart.</p>;
  try { return <><VisualCard visual={notebookVisual(cell, data)} />{data.truncated && <p>Chart uses the capped SQL result.</p>}</>; }
  catch (e) { return <p className="notebook-error" role="alert">{message(e)}</p>; }
}
function ResultTable({ data }: { data: NotebookData }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(data.rows.length / 50));
  const current = Math.min(page, pages - 1);
  return <div className="notebook-result"><p>{data.rowCount} rows{data.truncated ? ' · Truncated at the server row limit' : ''}</p><div className="notebook-table-scroll"><table><thead><tr>{data.columns.map(c => <th key={c.name}>{c.name}</th>)}</tr></thead><tbody>{data.rows.slice(current * 50, (current + 1) * 50).map((row, i) => <tr key={i}>{data.columns.map(c => <td key={c.name}>{row[c.name] === null ? 'NULL' : String(row[c.name])}</td>)}</tr>)}</tbody></table></div>{pages > 1 && <nav aria-label="Result pages"><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous rows</button><span>Page {current + 1} of {pages}</span><button disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Next rows</button></nav>}</div>;
}
