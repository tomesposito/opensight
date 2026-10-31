import { useEffect, useRef, useState } from 'react';
import { functionCatalog, parseExpression, type MetricDefinition } from '@opensight/query-engine/browser';
import type { createApiClient } from './api-client.js';
import type { MetricDatasetOption, MetricHistory, MetricList, MetricSummary } from './governed-metrics.js';
import { DataDialog, DataTable } from './DataSectionUI.js';
export type MetricClient = Partial<Pick<ReturnType<typeof createApiClient>, 'metricDatasets' | 'listMetrics' | 'saveMetric' | 'publishMetric' | 'metricHistory'>>;
const blank = (): MetricDefinition => ({ name: '', expression: '', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const datasetKey = (d: MetricDatasetOption) => JSON.stringify(d.dataset);

export function GovernedMetrics({ client, datasetId }: { client?: MetricClient; datasetId?: string }) {
  const [datasets, setDatasets] = useState<MetricDatasetOption[]>(), [selected, setSelected] = useState('');
  const [list, setList] = useState<MetricList>(), [revision, setRevision] = useState(0), [error, setError] = useState('');
  const [editing, setEditing] = useState<{ metric?: MetricSummary }>(), [history, setHistory] = useState<{ name: string; versions: MetricHistory[] }>();
  const [busy, setBusy] = useState(false), acting = useRef(false);
  const available = !!(client?.metricDatasets && client.listMetrics && client.saveMetric && client.publishMetric && client.metricHistory);
  useEffect(() => {
    if (!available) return;
    const abort = new AbortController(); setDatasets(undefined); setError('');
    void client!.metricDatasets!(abort.signal).then(result => {
      if (abort.signal.aborted) return;
      const choices = datasetId ? result.filter(d => d.dataset.id === datasetId) : result;
      setDatasets(choices); setSelected(current => choices.some(d => datasetKey(d) === current) ? current : datasetKey(choices.find(d => d.owned) ?? choices[0] ?? { dataset: { kind: 'dataset', id: '' }, name: '', columns: [], canPublish: false, owned: false }));
    }).catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [client, datasetId, available]);
  const dataset = datasets?.find(d => datasetKey(d) === selected);
  useEffect(() => {
    setList(undefined); setEditing(undefined); setHistory(undefined);
    if (!dataset || !client?.listMetrics) return;
    const abort = new AbortController();
    void client.listMetrics(dataset.dataset.id, abort.signal, dataset.dataset).then(value => { if (!abort.signal.aborted) { setList(value); setError(''); } }).catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [client, selected, datasets, revision]);
  const action = async (work: () => Promise<void>) => {
    if (acting.current) return; acting.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(message(e)); } finally { acting.current = false; setBusy(false); }
  };
  if (!available) return <section className="data-card"><h2>Governed metrics</h2><p>Needs a local or hosted API. Metric definitions are workspace assets; this static demo has no metric store.</p></section>;
  return <section className="governed-metrics" aria-label="Governed metrics">
    <div className="data-toolbar"><div><h2>Governed metrics</h2><p>Shared definitions for this dataset. Analyses, dashboards and Ask O follow the latest published version.</p></div>
      <button className="data-primary" disabled={!dataset || !!dataset.errorCode || !list?.canCreate || busy} onClick={() => setEditing({})}>Create metric</button></div>
    <label>Dataset<select aria-label="Metric dataset" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy || !datasets?.length}><option value="" disabled>Choose a dataset</option>{datasets?.map(d => <option key={datasetKey(d)} value={datasetKey(d)}>{d.name}{d.owned ? ' · Owned by you' : ' · Workspace dataset'}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    {!datasets && !error && <p role="status">Loading datasets…</p>}
    {datasets?.length === 0 && <p>No datasets available. Add a dataset before defining a metric.</p>}
    {dataset?.errorCode && <p role="alert">{dataset.errorCode}: Dataset fields are unavailable. Restore its sources before editing metrics.</p>}
    {dataset && !list && !error && <p role="status">Loading metrics…</p>}
    {list && <><p>{list.canPublish ? 'You can save drafts and publish definitions for this dataset.' : 'You can save a draft for approval. A dataset owner or workspace administrator publishes it.'}</p>
      <DataTable headings={['Name', 'Status', 'Published version', 'Actions']} empty={!list.items.length ? 'No governed metrics for this dataset. Create a definition to get started.' : undefined}>
        {list.items.map(m => <tr key={m.id}><td>{m.definition.name}<small>{m.definition.description}</small></td><td>{m.state === 'draft' ? 'Draft awaiting approval' : 'Published'}</td><td>{m.publishedVersion ?? 'Not published'}</td><td>
          {m.permissions.edit && <button disabled={busy || !!dataset?.errorCode} onClick={() => setEditing({ metric: m })}>Edit {m.definition.name}</button>}
          {m.permissions.publish && m.state === 'draft' && <button disabled={busy || !!dataset?.errorCode} onClick={() => { void action(async () => { await client!.publishMetric!(m.id, m.version); setRevision(n => n + 1); }); }}>Publish {m.definition.name}</button>}
          {m.permissions.edit && <button disabled={busy} onClick={() => { void action(async () => { setHistory({ name: m.definition.name, versions: await client!.metricHistory!(m.id) }); }); }}>History of {m.definition.name}</button>}
        </td></tr>)}
      </DataTable><button disabled={busy} onClick={() => setRevision(n => n + 1)}>Refresh metrics</button></>}
    {editing && dataset && <MetricDefinitionForm dataset={dataset} metric={editing.metric} onClose={() => setEditing(undefined)} onSave={async definition => {
      const id = editing.metric?.id ?? `metric-${globalThis.crypto.randomUUID()}`;
      await client!.saveMetric!(id, dataset.dataset, definition, editing.metric?.version);
      setEditing(undefined); setRevision(n => n + 1);
    }} />}
    {history && <DataDialog title={`Version history: ${history.name}`} onClose={() => setHistory(undefined)}><div className="data-dialog-body">
      {history.versions.map(v => <details key={v.version}><summary>Version {v.version} · {v.state} · {v.at} · {v.actor}</summary><p>{v.definition.name}</p><pre>{v.definition.expression}</pre><p>Default aggregation: {v.definition.defaultAggregation} · Format: {v.definition.format.style}, {v.definition.format.decimalPlaces} decimal places {v.definition.format.currency ?? ''}</p><p>{v.definition.description}</p><p>Synonyms: {v.definition.synonyms.join(', ') || 'None'}</p></details>)}
    </div><footer><button onClick={() => setHistory(undefined)}>Close history</button></footer></DataDialog>}
  </section>;
}

export function MetricDefinitionForm({ dataset, metric, onSave, onClose }: { dataset: MetricDatasetOption; metric?: MetricSummary; onSave: (definition: MetricDefinition) => Promise<void>; onClose: () => void }) {
  const [definition, setDefinition] = useState<MetricDefinition>(() => metric ? structuredClone(metric.definition) : blank());
  const [synonyms, setSynonyms] = useState(definition.synonyms.join('\n')), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [functionName, setFunctionName] = useState('sum'), acting = useRef(false);
  const reference = functionCatalog.find(f => f.name === functionName)!;
  const syntax = (() => {
    if (!definition.expression.trim()) return undefined;
    try {
      const parsed = parseExpression(definition.expression, '$.expression', { bind: name => {
        const field = dataset.columns.find(c => c.name === name);
        if (!field) throw new Error(`METRIC_UNKNOWN_FIELD: ${name}`);
        return { scalarType: field.type === 'STRING' ? 'string' : field.type === 'DATETIME' ? 'datetime' : field.type === 'BOOLEAN' ? 'boolean' : 'number', nullable: true };
      } });
      if (parsed.scalarType !== 'number' && !['COUNT', 'DISTINCT_COUNT'].includes(definition.defaultAggregation)) return 'METRIC_TYPE_MISMATCH: Choose a numeric expression or a count aggregation.';
    } catch (error) { return message(error); }
    return undefined;
  })();
  const patch = (value: Partial<MetricDefinition>) => setDefinition(d => ({ ...d, ...value }));
  return <DataDialog title={metric ? 'Edit governed metric' : 'Create governed metric'} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); if (acting.current || syntax) return; acting.current = true; setBusy(true); setError('');
      void onSave({ ...definition, name: definition.name.trim(), synonyms: synonyms.split('\n').map(s => s.trim()).filter(Boolean) }).catch(e => setError(message(e))).finally(() => { acting.current = false; setBusy(false); });
    }}><div className="data-dialog-body metric-definition-form"><p>Dataset: {dataset.name}. Saving creates a draft. Published consumers change only after approval.</p>
      <label>Name<input autoFocus required maxLength={128} disabled={busy} value={definition.name} onChange={e => patch({ name: e.target.value })} /></label>
      <label>Expression<textarea required rows={5} maxLength={10000} disabled={busy} value={definition.expression} onChange={e => patch({ expression: e.target.value })} /></label>
      <label>Insert dataset field<select aria-label="Insert dataset field" value="" disabled={busy} onChange={e => patch({ expression: definition.expression + `{${e.target.value}}` })}><option value="" disabled>Choose a field</option>{dataset.columns.map(c => <option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}</select></label>
      <label>Function reference<select aria-label="Function reference" value={functionName} onChange={e => setFunctionName(e.target.value)}>{functionCatalog.map(f => <option key={f.name}>{f.name}</option>)}</select></label>
      <div className="function-reference"><code>{reference.signature}</code><p>Example: <code>{reference.example}</code></p><button type="button" disabled={busy} onClick={() => patch({ expression: reference.example })}>Use example</button></div>
      <p>Use the calculated-field expression language with real fields of this dataset. Metric definitions do not accept analysis parameters.</p>
      <label>Default aggregation<select aria-label="Default aggregation" disabled={busy} value={definition.defaultAggregation} onChange={e => patch({ defaultAggregation: e.target.value as MetricDefinition['defaultAggregation'] })}>{['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT_COUNT'].map(a => <option key={a}>{a}</option>)}</select></label>
      <label>Format<select aria-label="Format" disabled={busy} value={definition.format.style} onChange={e => patch({ format: { style: e.target.value as MetricDefinition['format']['style'], decimalPlaces: definition.format.decimalPlaces, ...(e.target.value === 'currency' ? { currency: 'USD' } : {}) } })}><option value="number">Number</option><option value="percent">Percentage</option><option value="currency">Currency</option></select></label>
      <label>Decimal places<input type="number" required min={0} max={10} disabled={busy} value={definition.format.decimalPlaces} onChange={e => patch({ format: { ...definition.format, decimalPlaces: Number(e.target.value) } })} /></label>
      {definition.format.style === 'currency' && <label>Currency code<input required pattern="[A-Z]{3}" maxLength={3} disabled={busy} value={definition.format.currency} onChange={e => patch({ format: { ...definition.format, currency: e.target.value.toUpperCase() } })} /></label>}
      <label>Description<textarea rows={2} maxLength={4000} disabled={busy} value={definition.description} onChange={e => patch({ description: e.target.value })} /></label>
      <label>Synonyms (one per line)<textarea rows={3} disabled={busy} value={synonyms} onChange={e => setSynonyms(e.target.value)} /></label>
      {(syntax || error) && <p role="alert">{syntax || error}</p>}
    </div><footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="data-primary" disabled={busy || !!syntax || !definition.name.trim() || !definition.expression.trim()}>{busy ? 'Saving…' : 'Save draft'}</button></footer></form>
  </DataDialog>;
}
