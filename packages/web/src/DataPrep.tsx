import type { AuthorDataset } from './authoring.js';
import { PrepGraph } from './PrepGraph.js';
import { PrepStepIcon } from './PrepIcons.js';
import { DatasetExecution, ExecutionBadge, type ExecutionClient } from './DatasetExecution.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { assembleQsBundle, parseBundleJson, parseQsBundle, type BundleDataSet, type QsBundle } from '@opensight/bundle-parser/browser';
import { validatePrepPipeline, type PrepColumn, type PrepPipeline, type PrepStep, type PrepInput, type PrepJoinInput } from '@opensight/bundle-parser/prep';
import type { PrepPreview } from '@opensight/query-engine';
import type { createApiClient } from './api-client.js';
import { prepCatalog, prepStepLabel, prepSchema, prepPlan, prepRefKey, prepRefLabel, prepSourceRef, prepInputNodes, prepInstanceLabel, prepStepSourceInstance, prepStepIssue, prepMessage, newPrepStep, prepBundle, prepPrefix, prepLeftInput, removePrepStep, type PrepSourceSummary } from './data-prep.js';
import { PrepStepEditor, PrepSourcePicker } from './PrepStepEditor.js';
import { PrepPreviewTable } from './PrepPreviewTable.js';
import { loadDataCatalog } from './data-section.js';
export type PrepClient = Pick<ReturnType<typeof createApiClient>, 'listPrepSources' | 'listPrepDatasets' | 'savePrep' | 'deletePrep' | 'previewPrep'> & Partial<ExecutionClient>;
const demoSource: PrepSourceSummary = { id: 'demo-sales', connectorId: 'file', available: true, columns: [{ name: 'region', type: 'STRING' }, { name: 'category', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }, { name: 'order_date', type: 'DATETIME' }] };
const demoLookup: PrepSourceSummary = { id: 'demo-regions', name: 'Regions (sample schema)', connectorId: 'file', available: true, columns: [{ name: 'region', type: 'STRING' }, { name: 'manager', type: 'STRING' }] };
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
export function DataPrep({ client, initialSource, initialDatasetId, onSources, onAuthor, onBuild, onDatasets, onSaved }: { client?: PrepClient; initialSource?: PrepInput; initialDatasetId?: string; onDatasets?: () => void; onSaved?: (dataset: BundleDataSet) => void; onSources?: () => void; onAuthor?: () => void; onBuild?: (dataset: AuthorDataset) => void }) {
  const [resource, setResource] = useState<BundleDataSet>(() => { const r = initial(!!client); if (initialSource && client) r.opensightPrep!.input = initialSource; return r; });
  const openedDataset = useRef(false);
  const [opening, setOpening] = useState(!!initialDatasetId);
  const [openingError, setOpeningError] = useState('');
  const [original, setOriginal] = useState<QsBundle>();
  const [imported, setImported] = useState<QsBundle>();
  const [sources, setSources] = useState<PrepSourceSummary[]>(client ? [] : [demoSource, demoLookup]);
  const [saved, setSaved] = useState<BundleDataSet[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<PrepStep>();
  const [tab, setTab] = useState<'configure' | 'preview'>('configure');
  const [staged, setStaged] = useState<PrepJoinInput | null>(null);
  const [staging, setStaging] = useState(false);
  const [pending, setPending] = useState<PrepJoinInput | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [stepSearch, setStepSearch] = useState('');
  const stepsPanel = useRef<HTMLElement>(null);
  const matchesStep = (label: string) => label.toLowerCase().includes(stepSearch.trim().toLowerCase());
  const matchingSteps = prepCatalog.filter(c => matchesStep(c.label));
  const [preview, setPreview] = useState<{ key: string; result?: PrepPreview; error?: string }>();
  const file = useRef<HTMLInputElement>(null);
  const pipeline = resource.opensightPrep!, index = pipeline.steps.findIndex(s => s.id === selected);
  const schemaContext = { datasets: saved, datasetId: resource.dataSetId };
  const storedResource = saved.find(r => r.dataSetId === resource.dataSetId);
  const executionClient = client?.getDatasetExecution && client.setDatasetExecution && client.refreshBlaze && client.getPreparedRows ? client as PrepClient & ExecutionClient : undefined;
  const dirty = !!storedResource && (storedResource.name !== resource.name || JSON.stringify(storedResource.opensightPrep) !== JSON.stringify(pipeline));
  const executionFor = (ref: PrepInput) => typeof ref !== 'string' ? sources.find(s => typeof s.ref === 'object' && 'dataset' in s.ref && s.ref.dataset === ref.dataset)?.execution : undefined;
  const inputNodes = prepInputNodes(pipeline);
  /** Attribute errors to the first invalid step while leaving the graph repairable. */
  const stepIssues = pipeline.steps.map((step, i) => {
    const scoped = prepStepIssue(step);
    if (scoped) return scoped;
    try { prepSchema(prepPrefix(pipeline, i), sources, undefined, schemaContext); } catch { return ''; }
    try { prepSchema(prepPrefix(pipeline, i + 1), sources, undefined, schemaContext); return ''; } catch (e) { return prepMessage(e); }
  });
  const stagedNode = (): ReactNode => {
    if (!staged) return null;
    const ref = staged, occurrence = inputNodes.filter(n => prepRefKey(n.ref) === prepRefKey(ref)).length + 1;
    return <div className="prep-input-branch"><button className="prep-node input-node staged" onClick={() => { setPending(ref); setStaging(true); setSelected(null); setEditing(undefined); setTab('configure'); }} title="Staged input — not joined yet. Add a Join or Append step to configure how it relates to the pipeline."><span className="prep-node-icon">▤</span><strong>{`Source ${inputNodes.length + 1} · Staged`}</strong><span>{prepInstanceLabel(prepRefLabel(ref), occurrence)}</span></button><span className="prep-source-consumers"><span className="unconfigured-dot" aria-hidden="true">●</span> Not joined yet — add a Combine step</span></div>;
  };
  const selectedStep = index >= 0 ? pipeline.steps[index] : undefined;
  let columns: PrepColumn[] = [], problem = '';
  try { columns = prepSchema(pipeline, sources, selected, schemaContext); } catch (e) { problem = prepMessage(e); }
  const previewKey = JSON.stringify([pipeline, selected, reload, sources, saved]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    loadDataCatalog(client).then(stored => {
      const sources = stored.sources;
      if (cancelled) return; setSources(sources); setSaved(stored.datasets); setVersions(stored.versions);
      if (initialDatasetId && !openedDataset.current) {
        const existing = stored.datasets.find(dataset => dataset.dataSetId === initialDatasetId);
        if (!existing?.opensightPrep) { setOpeningError('PREP_NOT_FOUND: This dataset is unavailable or was deleted.'); return; }
        openedDataset.current = true; setResource(structuredClone(existing)); setOpening(false); setOpeningError(''); return;
      }
      setResource(r => r.opensightPrep!.input ? r : { ...r, opensightPrep: { ...r.opensightPrep!, input: sources[0] ? prepSourceRef(sources[0]) as PrepInput : '' } });
    }).catch(e => { if (!cancelled) { setError(prepMessage(e)); if (initialDatasetId && !openedDataset.current) setOpeningError(prepMessage(e)); } });
    return () => { cancelled = true; };
  }, [client, reload, initialDatasetId]);
  useEffect(() => {
    if (client || original || typeof localStorage === 'undefined') return;
    try { validatePrepPipeline(resource.opensightPrep); localStorage.setItem('opensight-prep-draft', JSON.stringify(resource)); } catch { /* Invalid edits are shown in the inspector and not persisted. */ }
  }, [client, resource, original]);
  useEffect(() => {
    if (!client || problem || opening) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.previewPrep(resource.dataSetId, pipeline, selected).then(result => { if (!cancelled) setPreview({ key: previewKey, result }); }).catch(e => { if (!cancelled) setPreview({ key: previewKey, error: prepMessage(e) }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, pipeline, selected, previewKey, problem, resource.dataSetId, opening]);
  const current = preview?.key === previewKey ? preview : undefined;
  const change = (next: PrepPipeline) => { setResource(r => ({ ...r, opensightPrep: next })); setMessage(''); setError(''); };
  const inputColumns = (): PrepColumn[] => {
    try { return prepSchema(prepPrefix(pipeline, index < 0 ? pipeline.steps.length : index), sources, editing ? prepLeftInput(pipeline, editing) : undefined, schemaContext); } catch { return []; }
  };
  const add = (kind: PrepStep['kind']) => {
    try {
      const cols = prepSchema(pipeline, sources, pipeline.steps.at(-1)?.id ?? null, schemaContext);
      const step = newPrepStep(kind, cols, sources, pipeline.input);
      if (staged && step.kind === 'join') {
        step.config.source = staged;
        const rightCols = editorSources().find(s => prepRefKey(prepSourceRef(s)) === prepRefKey(staged))?.columns ?? [];
        const left = cols[0]?.name ?? '', leftType = cols[0]?.type;
        step.config.keys = [{ left, right: rightCols.find(c => c.name === left && c.type === leftType)?.name ?? rightCols.find(c => c.type === leftType)?.name ?? rightCols[0]?.name ?? '' }];
      } else if (staged && step.kind === 'append' && typeof staged === 'string') step.config.source = staged;
      setEditing(step); setSelected(null); setStaging(false); setTab('configure');
    } catch (e) { setError(prepMessage(e)); }
  };
  const stepPipeline = (step: PrepStep): PrepPipeline => ({ ...pipeline, steps: pipeline.steps.some(s => s.id === step.id) ? pipeline.steps.map(s => s.id === step.id ? step : s) : [...pipeline.steps, step] });
  const validateStep = (step: PrepStep) => {
    const next = stepPipeline(step), position = next.steps.findIndex(s => s.id === step.id);
    // Permit topological, one-at-a-time repairs when multiple later branches
    // already have dangling references. Save/preview still validate every step.
    prepSchema(prepPrefix(next, position + 1), sources, step.id, schemaContext);
  };
  const editorSources = (): PrepSourceSummary[] => {
    try {
      const plan = prepPlan(prepPrefix(pipeline, index < 0 ? pipeline.steps.length : index), sources, undefined, schemaContext);
      return [...sources, ...plan.stages.map((s, i) => ({ id: s.id, ref: { step: s.id }, name: `${i + 1}. ${prepStepLabel(pipeline.steps[i]!)}`, connectorId: plan.dialect === 'postgres' ? 'postgresql' : 'file', columns: s.columns, available: true }))];
    } catch { return sources; }
  };
  const inspectInput = (node: { ref: PrepInput; instance: number; consumers: string[] }) => {
    const idx = pipeline.steps.findIndex((s, i) => (s.kind === 'join' || s.kind === 'append') && prepRefKey(s.config.source) === prepRefKey(node.ref) && node.consumers.includes(`${i + 1}. ${prepStepLabel(s)}`));
    if (idx >= 0) { setSelected(pipeline.steps[idx]!.id); setEditing(pipeline.steps[idx]); setTab('configure'); setError(''); }
  };
  const rightLabel = (step: PrepStep | undefined): string | undefined => step && (step.kind === 'join' || step.kind === 'append') ? prepInstanceLabel(prepRefLabel(step.config.source), prepStepSourceInstance(pipeline, step)) : undefined;
  const apply = (step: PrepStep) => {
    const exists = pipeline.steps.some(s => s.id === step.id), next = { ...pipeline, steps: exists ? pipeline.steps.map(s => s.id === step.id ? step : s) : [...pipeline.steps, step] };
    try {
      validateStep(step); change(next); setEditing(undefined); setSelected(step.id); setStaging(false);
      if (staged && (step.kind === 'join' || step.kind === 'append') && prepRefKey(step.config.source) === prepRefKey(staged)) setStaged(null);
    } catch (e) { setError(prepMessage(e)); }
  };
  const move = (delta: number) => {
    const steps = [...pipeline.steps]; const target = index + delta;
    if (index < 0 || target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target]!, steps[index]!]; change({ ...pipeline, steps }); setEditing(undefined);
  };
  const remove = () => { if (selected) change(removePrepStep(pipeline, selected)); setSelected(null); setEditing(undefined); };
  const branch = (from: string) => {
    try {
      const cols = prepSchema(pipeline, sources, from, schemaContext);
      const step = { ...newPrepStep('select', cols, sources, pipeline.input), from };
      const next = { ...pipeline, steps: [...pipeline.steps, step] };
      prepSchema(next, sources, step.id, schemaContext);
      change(next); setSelected(step.id); setEditing(step); setStaging(false); setTab('configure');
    } catch (e) { setError(prepMessage(e)); }
  };
  const load = (r: BundleDataSet, bundle?: QsBundle) => { setResource(structuredClone(r)); setOriginal(bundle); setStaged(null); setStaging(false); setPending(null); setTab('configure'); setSelected(null); setEditing(undefined); setMessage(''); setError(''); };
  const save = async () => {
    if (!client || busy || problem) return; setBusy(true); setError('');
    try {
      const result = await client.savePrep(resource.dataSetId, resource.name, pipeline, versions ? versions[resource.dataSetId] ?? 0 : undefined);
      if ('version' in result) setVersions(current => ({ ...current, [resource.dataSetId]: result.version }));
      setMessage('version' in result || result.persistence === 'file' ? 'Dataset pipeline saved.' : 'Dataset pipeline saved for this API session; export a bundle to keep a portable copy.');
      setReload(n => n + 1); onSaved?.(result.resource);
    }
    catch (e) { setError(prepMessage(e)); } finally { setBusy(false); }
  };
  const buildChart = async () => {
    if (!client || !onBuild || busy || !storedResource || dirty) return;
    setBusy(true); setError('');
    try {
      const source = (await client.listPrepSources()).find(s => typeof s.ref === 'object' && 'dataset' in s.ref && s.ref.dataset === resource.dataSetId);
      if (!source?.available) throw new Error(source?.errorCode ?? 'Dataset is unavailable. Refresh Blaze if required.');
      onBuild({ id: resource.dataSetId, name: resource.name, columns: source.columns });
    } catch (e) { setError(prepMessage(e)); } finally { setBusy(false); }
  };
  const deleteSaved = async () => {
    if (!client || busy) return; setBusy(true); setError('');
    try { await client.deletePrep(resource.dataSetId, versions?.[resource.dataSetId]); load(fresh(true)); setReload(n => n + 1); setMessage('Saved pipeline deleted.'); } catch (e) { setError(prepMessage(e)); } finally { setBusy(false); }
  };
  const download = async () => {
    setError('');
    try {
      const bytes = await assembleQsBundle(prepBundle(resource, pipeline, original));
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })), a = document.createElement('a');
      a.href = url; a.download = `${resource.dataSetId}.qs`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(prepMessage(e)); }
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
    } catch (e) { setError(prepMessage(e)); }
  };
  if (initialDatasetId && opening) return <section className="data-page"><button onClick={onDatasets}>‹ Datasets</button>{!client ? <p role="alert">Needs local or hosted API · Saved datasets are unavailable in the static demo.</p> : openingError ? <><p role="alert">{openingError}</p><button onClick={() => setReload(n => n + 1)}>Retry</button></> : <p role="status">Loading dataset…</p>}</section>;
  return <section className="data-prep" aria-labelledby="prep-title">
    <header className="prep-heading"><div><p className="eyebrow">DATA PREPARATION</p><h1 id="prep-title">Transformation pipeline</h1><p>Connect data, build branching paths, and preview each result.</p></div><div className="prep-actions">{onDatasets && <button onClick={onDatasets}>‹ Datasets</button>}<button onClick={onSources}>Data sources</button>{onAuthor && <button onClick={onAuthor}>Back to analysis</button>}</div></header>
    <div className="prep-document-bar"><label>Dataset name<input value={resource.name} onChange={e => setResource(r => ({ ...r, name: e.target.value }))} /></label>{client && <label>Saved datasets<select value={saved.some(r => r.dataSetId === resource.dataSetId) ? resource.dataSetId : ''} onChange={e => { const r = saved.find(r => r.dataSetId === e.target.value); if (r) load(r); }}><option value="">Unsaved dataset</option>{saved.map(r => <option key={r.dataSetId} value={r.dataSetId}>{r.name}</option>)}</select></label>}<div className="prep-actions"><button onClick={() => load(fresh(!!client))}>New</button><button onClick={() => file.current?.click()}>Import bundle</button><button onClick={() => void download()}>Export bundle</button><button disabled={!client || busy || !!problem} onClick={() => void save()}>Save pipeline</button>{onBuild && <button disabled={!storedResource || dirty || busy || !!problem} onClick={() => void buildChart()}>Build a chart</button>}{saved.some(r => r.dataSetId === resource.dataSetId) && <button disabled={busy} onClick={() => void deleteSaved()}>Delete saved pipeline</button>}</div><input hidden ref={file} type="file" accept=".qs,.json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
    {imported && imported.members.filter(m => m.resource.resourceType === 'dataset' && m.resource.opensightPrep).length > 1 && <label>Imported dataset<select value={resource.dataSetId} onChange={e => { const r = imported.members.find(m => m.resource.resourceType === 'dataset' && m.resource.dataSetId === e.target.value)?.resource; if (r?.resourceType === 'dataset') load(r, imported); }}><option value="">Choose dataset</option>{imported.members.flatMap(m => m.resource.resourceType === 'dataset' && m.resource.opensightPrep ? [<option key={m.path} value={m.resource.dataSetId}>{m.resource.name}</option>] : [])}</select></label>}
    {!client && <p className="prep-notice">Static demo · Configure and export a pipeline using sample schema. Live rows and server saves need a local or hosted API. No source data runs in this demo.</p>}
    <p className="prep-notice">Cross-source joins, pivot, unpivot, append and aggregate on the output path require Blaze. Save and refresh to query their cached output.</p>
    <details className="prep-execution"><summary>Dataset execution · mode, refresh and cached output</summary><DatasetExecution key={resource.dataSetId} client={executionClient} datasetId={resource.dataSetId} saved={!!storedResource} dirty={dirty} onChanged={() => setReload(n => n + 1)} /></details>
    {message && <p role="status">{message}</p>}{error && <p className="prep-error" role="alert">{error}</p>}
    <div className="prep-workspace"><aside className="prep-sidebar" aria-label="Steps" tabIndex={-1} ref={stepsPanel}><h2>Steps</h2><p>Select a step to add a transformation</p>
      <label className="prep-steps-search"><span className="sr-only">Search steps</span><input type="search" placeholder="Search steps" value={stepSearch} onChange={e => setStepSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setStepSearch(''); stepsPanel.current?.focus(); } }} /></label>
      {matchesStep('Add data') && <div className="prep-catalog-group"><h3>Input</h3>

      <button className="prep-add-data" onClick={() => { const first = editorSources()[0]; setPending(staged ?? (first ? prepSourceRef(first) : null)); setStaging(true); setSelected(null); setEditing(undefined); setTab('configure'); }}>＋ Add data</button></div>}{['Column transformations','Combine transformations','Other'].filter(group => matchingSteps.some(c => c.group === group)).map(group => <div className="prep-catalog-group" key={group}><h3>{group}</h3>{matchingSteps.filter(c => c.group === group).map(c => <button key={c.kind} disabled={!pipeline.input || !!problem} title={(c.kind === 'join' || c.kind === 'append') && staged ? `Uses the staged input (${prepRefLabel(staged)})` : undefined} aria-label={`＋ ${c.label}`} onClick={() => add(c.kind)}><PrepStepIcon kind={c.kind} /> {c.label}</button>)}</div>)}
      {!matchesStep('Add data') && matchingSteps.length === 0 && <p role="status">No matching steps. Try another name.</p>}
    </aside><div className="prep-main"><div className="prep-canvas-heading"><h2>Pipeline canvas</h2><span>{pipeline.steps.length} steps · left to right</span></div><div className="prep-canvas" aria-label="Transformation DAG">{staged && <div className="prep-input-rail" aria-label="Staged input sources">{stagedNode()}</div>}<PrepGraph pipeline={pipeline} selected={selected} issues={stepIssues} disabled={!!problem}
      select={id => { setSelected(id); setEditing(undefined); setStaging(false); setTab('configure'); }} branch={branch} setOutput={output => change({ ...pipeline, output })}
      input={<button className={`prep-node input-node${selected === null ? ' selected' : ''}`} aria-pressed={selected === null} onClick={() => { setSelected(null); setEditing(undefined); setStaging(false); setTab('configure'); }}><span className="prep-node-icon">▤</span><strong>Input · Source 1</strong><span>{prepRefLabel(pipeline.input) || 'Add data'}</span>{executionFor(pipeline.input) && <ExecutionBadge status={executionFor(pipeline.input)} />}</button>}
      output={<><strong>Output dataset</strong><span>{resource.name}</span><ExecutionBadge status={sources.find(s => typeof s.ref === 'object' && 'dataset' in s.ref && s.ref.dataset === resource.dataSetId)?.execution} /></>}
      secondary={(step, i) => {
        if (step.kind !== 'join' && step.kind !== 'append') return null;
        const ref = step.config.source;
        if (typeof ref !== 'string' && 'step' in ref) return <div className="prep-secondary-source"><button onClick={() => { setSelected(ref.step); setEditing(undefined); setStaging(false); setTab('configure'); }}>From step {pipeline.steps.findIndex(s => s.id === ref.step) + 1} · {pipeline.steps.find(s => s.id === ref.step) ? prepStepLabel(pipeline.steps.find(s => s.id === ref.step)!) : 'Invalid reference'}</button></div>;
        const sourceIndex = inputNodes.findIndex(n => prepRefKey(n.ref) === prepRefKey(ref) && n.consumers.includes(`${i + 1}. ${prepStepLabel(step)}`)), node = inputNodes[sourceIndex];
        return node && <div className="prep-secondary-source"><button className="prep-node input-node" onClick={() => inspectInput(node)}><span className="prep-node-icon" aria-hidden="true">▤</span><strong>Source {sourceIndex + 1}</strong><span>{prepInstanceLabel(prepRefLabel(node.ref), node.instance)}</span>{executionFor(node.ref) && <ExecutionBadge status={executionFor(node.ref)} />}</button><span className="sr-only">{node.consumers.join(' · ')}</span></div>;
      }} />{!pipeline.steps.length && <p className="prep-canvas-hint">Choose a transformation on the left to add your first step.</p>}</div>
      <div className="prep-detail-tabs" role="tablist" aria-label="Step details">{(['configure', 'preview'] as const).map(value => <button key={value} id={`prep-${value}-tab`} role="tab" aria-selected={tab === value} aria-controls={`prep-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={e => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'configure' : e.key === 'End' ? 'preview' : tab === 'configure' ? 'preview' : 'configure'; setTab(next); document.getElementById(`prep-${next}-tab`)?.focus(); }
      }}>{value === 'configure' ? 'Configure' : 'Preview'}</button>)}<span>{selectedStep ? prepStepLabel(selectedStep) : editing ? prepStepLabel(editing) : 'Input'}</span></div>
      <section className="prep-configure" id="prep-configure-panel" role="tabpanel" aria-labelledby="prep-configure-tab" hidden={tab !== 'configure'}>
      {editing ? <PrepStepEditor key={editing.id} step={editing} columns={inputColumns()} sources={editorSources()} pipeline={pipeline} validate={validateStep} apply={apply} cancel={() => { setEditing(undefined); setError(''); }} /> : staging ? <div className="prep-staging"><h3>Add data</h3>
        {pending ? <PrepSourcePicker label="Stage a source" value={pending} sources={editorSources()} change={setPending} /> : <p>No available sources to stage.</p>}
        <div className="prep-actions"><button disabled={!pending} onClick={() => { if (!pipeline.input && pending && !(typeof pending === 'object' && 'step' in pending)) change({ ...pipeline, input: pending }); else setStaged(pending); setStaging(false); setError(''); }}>Stage input</button><button onClick={() => { setStaging(false); setPending(null); }}>Cancel</button></div>
        {staged && <button onClick={() => { setStaged(null); setStaging(false); setPending(null); }}>Remove staged input</button>}
        <p>The staged source appears on the canvas flagged as not yet joined. Add a Join or Append step to declare how it relates to your pipeline.</p></div> : selected ? <div className="prep-step-summary"><h3>{pipeline.steps[index] ? prepStepLabel(pipeline.steps[index]!) : 'Step'}</h3><button onClick={() => setEditing(pipeline.steps[index])}>Configure step</button><div className="prep-actions"><button disabled={index <= 0} onClick={() => move(-1)}>Move earlier</button><button disabled={index < 0 || index >= pipeline.steps.length - 1} onClick={() => move(1)}>Move later</button><button onClick={remove}>Remove step</button></div></div> : <div className="prep-input-config"><h3>Input · Add data</h3><PrepSourcePicker label="Connected source" value={pipeline.input} sources={sources} change={input => change({ ...pipeline, input: input as PrepInput })} />{client && <button onClick={() => setReload(n => n + 1)}>Refresh sources</button>}<p>{client ? 'Upload files in Data sources, or choose a saved prepared dataset. Joins use the same engine and configured connection.' : 'Sample schema only. Source bindings must be configured on the hosted API before preview.'}</p></div>}
      </section>
      <section className="prep-preview" id="prep-preview-panel" role="tabpanel" aria-labelledby="prep-preview-tab" hidden={tab !== 'preview'}><div className="prep-preview-heading"><h2>{selected && pipeline.steps[index] ? `${prepStepLabel(pipeline.steps[index]!)} preview` : 'Input preview'}</h2><span>{columns.length} columns{rightLabel(selectedStep) ? ` · Right source: ${rightLabel(selectedStep)}` : ''}</span></div>{problem ? <p className="prep-error" role="alert">{problem}</p> : !client ? <p className="prep-preview-empty">Needs local or hosted API · Live preview is unavailable in the static demo.</p> : current?.error ? <p className="prep-error" role="alert">{current.error}</p> : !current?.result ? <p role="status">Loading step preview…</p> : <p role="status">{current.result.returnedRows} rows shown · {current.result.truncated ? `at least ${current.result.rowCountLowerBound} output rows; total unknown` : `${current.result.totalRows} output rows total`} · limit {current.result.limit} · {current.result.dialect}{current.result.cachedInputs?.map(input => <span key={`${input.datasetId}:${input.refreshedAt}`}><br />Cached input {input.datasetId} · refreshed {input.refreshedAt}</span>)}</p>}
        <PrepPreviewTable key={JSON.stringify([resource.dataSetId, selected, columns])} columns={columns} rows={!problem ? current?.result?.rows ?? [] : []} /><p className="prep-preview-help">Draft previews execute source steps and label cached inputs. Previews return at most 100 rows after transformation. Aggregates use the full source; row order is unspecified. {onBuild ? 'Save the pipeline, then select Build a chart to query its output in the analysis editor.' : 'Prepared datasets are saved as pipeline metadata; connecting them to analysis visuals requires hosted dataset publication.'}</p>
      </section></div></div>
  </section>;
}
