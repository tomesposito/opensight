import { useEffect, useRef, useState } from 'react';
import { assembleQsBundle, parseBundleJson, parseQsBundle, type BundleDataSet, type QsBundle } from '@opensight/bundle-parser/browser';
import { validatePrepPipeline, type PrepColumn, type PrepPipeline, type PrepStep } from '@opensight/bundle-parser/prep';
import type { PrepPreview } from '@opensight/query-engine';
import type { createApiClient } from './api-client.js';
import { prepCatalog, prepLabel, prepSchema, newPrepStep, prepBundle, type PrepSourceSummary } from './data-prep.js';
import { PrepStepEditor } from './PrepStepEditor.js';
export type PrepClient = Pick<ReturnType<typeof createApiClient>, 'listPrepSources' | 'listPrepDatasets' | 'savePrep' | 'deletePrep' | 'previewPrep'>;
const demoSource: PrepSourceSummary = { id: 'demo-sales', connectorId: 'file', available: true, columns: [{ name: 'region', type: 'STRING' }, { name: 'category', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }, { name: 'order_date', type: 'DATETIME' }] };
function fresh(hosted: boolean): BundleDataSet {
  return { resourceType: 'dataset', dataSetId: `prepared-${globalThis.crypto.randomUUID()}`, name: 'Untitled prepared dataset', importMode: 'DIRECT_QUERY', physicalTableMap: {}, opensightPrep: { version: 1, input: hosted ? '' : demoSource.id, steps: [] } };
}
function initial(hosted: boolean): BundleDataSet {
  if (!hosted && typeof localStorage !== 'undefined') try {
    const raw = localStorage.getItem('opensight-prep-draft');
    if (raw) { const parsed = parseBundleJson(new TextEncoder().encode(raw)).members[0]?.resource; if (parsed?.resourceType === 'dataset' && parsed.opensightPrep) return parsed; }
  } catch { /* Invalid local drafts never execute. Start an empty draft. */ }
  return fresh(hosted);
}
export function DataPrep({ client, onSources, onAuthor }: { client?: PrepClient; onSources?: () => void; onAuthor?: () => void }) {
  const [resource, setResource] = useState<BundleDataSet>(() => initial(!!client));
  const [original, setOriginal] = useState<QsBundle>();
  const [imported, setImported] = useState<QsBundle>();
  const [sources, setSources] = useState<PrepSourceSummary[]>(client ? [] : [demoSource]);
  const [saved, setSaved] = useState<BundleDataSet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<PrepStep>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<{ key: string; result?: PrepPreview; error?: string }>();
  const file = useRef<HTMLInputElement>(null);
  const pipeline = resource.opensightPrep!, index = pipeline.steps.findIndex(s => s.id === selected);
  let columns: PrepColumn[] = [], problem = '';
  try { columns = prepSchema(pipeline, sources, selected); } catch (e) { problem = e instanceof Error ? e.message : 'Invalid pipeline'; }
  const previewKey = JSON.stringify([pipeline, selected, reload]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    Promise.all([client.listPrepSources(), client.listPrepDatasets()]).then(([sources, stored]) => {
      if (cancelled) return; setSources(sources); setSaved(stored.datasets);
      setResource(r => r.opensightPrep!.input ? r : { ...r, opensightPrep: { ...r.opensightPrep!, input: sources[0]?.id ?? '' } });
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load connected sources'); });
    return () => { cancelled = true; };
  }, [client, reload]);
  useEffect(() => {
    if (client || original || typeof localStorage === 'undefined') return;
    try { validatePrepPipeline(resource.opensightPrep); localStorage.setItem('opensight-prep-draft', JSON.stringify(resource)); } catch { /* Invalid edits are shown in the inspector and not persisted. */ }
  }, [client, resource, original]);
  useEffect(() => {
    if (!client || problem) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.previewPrep(resource.dataSetId, pipeline, selected).then(result => { if (!cancelled) setPreview({ key: previewKey, result }); }).catch(e => { if (!cancelled) setPreview({ key: previewKey, error: e instanceof Error ? e.message : 'Preview unavailable' }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, pipeline, selected, previewKey, problem, resource.dataSetId]);
  const current = preview?.key === previewKey ? preview : undefined;
  const change = (next: PrepPipeline) => { setResource(r => ({ ...r, opensightPrep: next })); setMessage(''); setError(''); };
  const inputColumns = (): PrepColumn[] => {
    try { return prepSchema({ ...pipeline, steps: pipeline.steps.slice(0, index < 0 ? pipeline.steps.length : index) }, sources); } catch { return []; }
  };
  const add = (kind: PrepStep['kind']) => {
    try { const cols = prepSchema(pipeline, sources); setEditing(newPrepStep(kind, cols, sources, pipeline.input)); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : 'Choose an input source first'); }
  };
  const apply = (step: PrepStep) => {
    const exists = pipeline.steps.some(s => s.id === step.id), next = { ...pipeline, steps: exists ? pipeline.steps.map(s => s.id === step.id ? step : s) : [...pipeline.steps, step] };
    try { validatePrepPipeline(next); prepSchema(next, sources); change(next); setEditing(undefined); setSelected(step.id); } catch (e) { setError(e instanceof Error ? e.message : 'Invalid configuration'); }
  };
  const move = (delta: number) => {
    const steps = [...pipeline.steps]; const target = index + delta;
    if (index < 0 || target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target]!, steps[index]!]; change({ ...pipeline, steps }); setEditing(undefined);
  };
  const remove = () => { change({ ...pipeline, steps: pipeline.steps.filter(s => s.id !== selected) }); setSelected(null); setEditing(undefined); };
  const load = (r: BundleDataSet, bundle?: QsBundle) => { setResource(structuredClone(r)); setOriginal(bundle); setSelected(null); setEditing(undefined); setMessage(''); setError(''); };
  const save = async () => {
    if (!client || busy || problem) return; setBusy(true); setError('');
    try { const result = await client.savePrep(resource.dataSetId, resource.name, pipeline); setMessage(result.persistence === 'file' ? 'Dataset pipeline saved.' : 'Dataset pipeline saved for this API session; export a bundle to keep a portable copy.'); setReload(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); }
  };
  const deleteSaved = async () => {
    if (!client || busy) return; setBusy(true); setError('');
    try { await client.deletePrep(resource.dataSetId); load(fresh(true)); setReload(n => n + 1); setMessage('Saved pipeline deleted.'); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); } finally { setBusy(false); }
  };
  const download = async () => {
    setError('');
    try {
      const bytes = await assembleQsBundle(prepBundle(resource, pipeline, original));
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })), a = document.createElement('a');
      a.href = url; a.download = `${resource.dataSetId}.qs`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
  };
  const importFile = async (f?: File) => {
    if (!f) return; setError('');
    try {
      if (f.size > 32 * 1024 * 1024) throw new Error('Bundle exceeds the 32 MiB import limit');
      const bytes = new Uint8Array(await f.arrayBuffer()), bundle = f.name.endsWith('.qs') ? await parseQsBundle(bytes) : parseBundleJson(bytes);
      const datasets = bundle.members.filter(m => m.resource.resourceType === 'dataset' && m.resource.opensightPrep);
      if (!datasets.length) throw new Error('This bundle contains no prepared datasets');
      setImported(bundle);
      if (datasets.length === 1) load(datasets[0]!.resource as BundleDataSet, bundle);
      else setMessage('Choose a prepared dataset from the imported bundle.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
  };
  return <section className="data-prep" aria-labelledby="prep-title">
    <header className="prep-heading"><div><p className="eyebrow">DATA PREPARATION</p><h1 id="prep-title">Transformation pipeline</h1><p>Connect data, build ordered steps, and preview each result.</p></div><div className="prep-actions"><button onClick={onSources}>Data sources</button>{onAuthor && <button onClick={onAuthor}>Back to analysis</button>}</div></header>
    <div className="prep-document-bar"><label>Dataset name<input value={resource.name} onChange={e => setResource(r => ({ ...r, name: e.target.value }))} /></label>{client && <label>Saved datasets<select value={saved.some(r => r.dataSetId === resource.dataSetId) ? resource.dataSetId : ''} onChange={e => { const r = saved.find(r => r.dataSetId === e.target.value); if (r) load(r); }}><option value="">Unsaved dataset</option>{saved.map(r => <option key={r.dataSetId} value={r.dataSetId}>{r.name}</option>)}</select></label>}<div className="prep-actions"><button onClick={() => load(fresh(!!client))}>New</button><button onClick={() => file.current?.click()}>Import bundle</button><button onClick={() => void download()}>Export bundle</button><button disabled={!client || busy || !!problem} onClick={() => void save()}>Save pipeline</button>{saved.some(r => r.dataSetId === resource.dataSetId) && <button disabled={busy} onClick={() => void deleteSaved()}>Delete saved pipeline</button>}</div><input hidden ref={file} type="file" accept=".qs,.json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
    {imported && imported.members.filter(m => m.resource.resourceType === 'dataset' && m.resource.opensightPrep).length > 1 && <label>Imported dataset<select value={resource.dataSetId} onChange={e => { const r = imported.members.find(m => m.resource.resourceType === 'dataset' && m.resource.dataSetId === e.target.value)?.resource; if (r?.resourceType === 'dataset') load(r, imported); }}><option value="">Choose dataset</option>{imported.members.flatMap(m => m.resource.resourceType === 'dataset' && m.resource.opensightPrep ? [<option key={m.path} value={m.resource.dataSetId}>{m.resource.name}</option>] : [])}</select></label>}
    {!client && <p className="prep-notice">Static demo · Configure and export a pipeline using sample schema. Live rows and server saves need a hosted API. No source data runs in this demo.</p>}
    {message && <p role="status">{message}</p>}{error && <p className="prep-error" role="alert">{error}</p>}
    <div className="prep-workspace"><aside className="prep-sidebar" aria-label="Transformations and configuration"><h2>Transformations</h2><button className="prep-add-data" onClick={() => { setSelected(null); setEditing(undefined); }}>＋ Add data</button>{['Column transformations','Combine','Other'].map(group => <div className="prep-catalog-group" key={group}><h3>{group}</h3>{prepCatalog.filter(c => c.group === group).map(c => <button key={c.kind} disabled={!pipeline.input || !!problem} onClick={() => add(c.kind)}>＋ {c.label}</button>)}</div>)}
      {editing ? <PrepStepEditor key={editing.id} step={editing} columns={inputColumns()} sources={sources.filter(s => s.available)} apply={apply} cancel={() => { setEditing(undefined); setError(''); }} /> : selected ? <div className="prep-step-summary"><h3>{pipeline.steps[index] ? prepLabel(pipeline.steps[index]!.kind) : 'Step'}</h3><button onClick={() => setEditing(pipeline.steps[index])}>Configure step</button><div className="prep-actions"><button disabled={index <= 0} onClick={() => move(-1)}>Move earlier</button><button disabled={index < 0 || index >= pipeline.steps.length - 1} onClick={() => move(1)}>Move later</button><button onClick={remove}>Remove step</button></div></div> : <div className="prep-input-config"><h3>Input · Add data</h3><label>Connected source<select value={pipeline.input} onChange={e => change({ ...pipeline, input: e.target.value })}>{!sources.some(s => s.id === pipeline.input) && <option value={pipeline.input}>{pipeline.input || 'Choose a source'}</option>}{sources.map(s => <option key={s.id} value={s.id} disabled={!s.available}>{s.id}{!s.available ? ' (protected)' : ''}</option>)}</select></label>{client && <button onClick={() => setReload(n => n + 1)}>Refresh sources</button>}<p>{client ? 'Upload files in Data sources. Joins and appends use sources from the same engine and configured connection.' : 'Sample schema only. Source bindings must be configured on the hosted API before preview.'}</p></div>}
    </aside><div className="prep-main"><div className="prep-canvas-heading"><h2>Pipeline canvas</h2><span>{pipeline.steps.length} steps · left to right</span></div><div className="prep-canvas" aria-label="Ordered transformation graph"><ol className="prep-nodes"><li className="prep-node-wrap"><button className={`prep-node input-node${selected === null ? ' selected' : ''}`} aria-pressed={selected === null} onClick={() => { setSelected(null); setEditing(undefined); }}><span className="prep-node-icon">▤</span><strong>Input</strong><span>{pipeline.input || 'Add data'}</span></button></li>{pipeline.steps.map((step,i) => <li className="prep-node-wrap" key={step.id}><span className="prep-edge" aria-hidden="true">⟶</span><div>{(step.kind === 'join' || step.kind === 'append') && <div className="prep-secondary-source"><span>▤ {step.config.source}</span><span aria-hidden="true">↓</span></div>}<button className={`prep-node${selected === step.id ? ' selected' : ''}`} aria-pressed={selected === step.id} onClick={() => { setSelected(step.id); setEditing(undefined); }}><span className="prep-node-icon">{i + 1}</span><strong>{prepLabel(step.kind)}</strong><span>Configure · Preview</span></button></div></li>)}<li className="prep-node-wrap"><span className="prep-edge" aria-hidden="true">⟶</span><div className="prep-output"><strong>Output dataset</strong><span>{resource.name}</span></div></li></ol>{!pipeline.steps.length && <p className="prep-canvas-hint">Choose a transformation on the left to add your first step.</p>}</div>
      <section className="prep-preview" aria-label="Step data preview"><div className="prep-preview-heading"><h2>{selected && pipeline.steps[index] ? `${prepLabel(pipeline.steps[index]!.kind)} preview` : 'Input preview'}</h2><span>{columns.length} columns</span></div>{problem ? <p className="prep-error" role="alert">{problem}</p> : !client ? <p className="prep-preview-empty">Needs hosted API · Live preview is unavailable in the static demo.</p> : current?.error ? <p className="prep-error" role="alert">{current.error}</p> : !current?.result ? <p role="status">Loading step preview…</p> : <p role="status">{current.result.returnedRows} rows shown · {current.result.truncated ? `at least ${current.result.rowCountLowerBound} output rows; total unknown` : `${current.result.totalRows} output rows total`} · limit {current.result.limit} · {current.result.dialect}</p>}
        <div className="prep-table-scroll"><table><thead><tr>{columns.map(c => <th key={c.name}>{c.name}<small>{c.type}</small></th>)}</tr></thead><tbody>{!problem && current?.result?.rows.map((row,i) => <tr key={i}>{columns.map(c => <td key={c.name}>{row[c.name] === null ? <em>null</em> : String(row[c.name])}</td>)}</tr>)}</tbody></table></div><p className="prep-preview-help">Previews return at most 100 rows after transformation. Aggregates use the full source; row order is unspecified. Prepared datasets are saved as pipeline metadata; connecting them to analysis visuals requires hosted dataset publication.</p>
      </section></div></div>
  </section>;
}
