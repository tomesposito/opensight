import { useEffect, useRef, useState } from 'react';
import type { BundleDataSet } from '@opensight/bundle-parser';
import type { PrepInput } from '@opensight/bundle-parser/prep';
import type { createApiClient } from './api-client.js';
import type { PrepTemplate } from './prep-templates.js';
import { DataDialog, DataTable } from './DataSectionUI.js';
import { MetricDefinitionForm, type MetricClient } from './GovernedMetrics.js';
import type { MetricDatasetOption } from './governed-metrics.js';
import { prepSourceRef, prepRefKey, prepMessage, prepStepLabel, type PrepSourceSummary } from './data-prep.js';
export type PromotionClient = MetricClient & Partial<Pick<ReturnType<typeof createApiClient>, 'listPrepTemplates' | 'proposePrepTemplate' | 'publishPrepTemplate' | 'createFromPrepTemplate'>>;
export function CalculationPromotion({ client, datasetId, calculationId, onClose }: { client?: MetricClient; datasetId: string; calculationId: string; onClose: () => void }) {
  const [dataset, setDataset] = useState<MetricDatasetOption>(), [error, setError] = useState('');
  useEffect(() => {
    if (!client?.metricDatasets || !client.promoteCalculation) { setError('Needs a local or hosted API. Calculation promotion creates a governed draft in the workspace store.'); return; }
    const abort = new AbortController();
    void client.metricDatasets(abort.signal).then(items => {
      if (abort.signal.aborted) return;
      const d = items.find(d => d.dataset.kind === 'prepared-dataset' && d.dataset.id === datasetId && d.owned);
      const calc = d?.calculations?.find(c => c.id === calculationId);
      if (!calc?.definition) setError(calc?.errorCode ?? 'Save the calculation in this dataset before promoting it.'); else setDataset(d);
    }).catch(e => { if (!abort.signal.aborted) setError(prepMessage(e)); });
    return () => abort.abort();
  }, [client, datasetId, calculationId]);
  const calc = dataset?.calculations?.find(c => c.id === calculationId);
  if (dataset && calc) return <MetricDefinitionForm dataset={dataset} initialDefinition={calc.definition} promotionName={calc.name} onClose={onClose} onSave={async definition => {
    await client!.promoteCalculation!(`metric-${globalThis.crypto.randomUUID()}`, dataset.dataset, calculationId, definition); onClose();
  }} />;
  return <DataDialog title="Promote calculation" onClose={onClose}><div className="data-dialog-body"><p role={error ? 'alert' : 'status'}>{error || 'Loading saved calculation…'}</p></div><footer><button onClick={onClose}>Close</button></footer></DataDialog>;
}
export function PrepPromotions({ client, dataset, sources, propose, onCreated, onClose }: { client?: PromotionClient; dataset: BundleDataSet; sources: PrepSourceSummary[]; propose: boolean; onCreated: (resource: BundleDataSet) => void; onClose: () => void }) {
  const [items, setItems] = useState<PrepTemplate[]>([]), [revision, setRevision] = useState(0), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [name, setName] = useState(dataset.name), [proposing, setProposing] = useState(propose), [selected, setSelected] = useState<PrepTemplate>();
  const [bindings, setBindings] = useState<Record<string, PrepInput>>({}), [busy, setBusy] = useState(false), acting = useRef(false);
  const available = !!(client?.listPrepTemplates && client.proposePrepTemplate && client.publishPrepTemplate && client.createFromPrepTemplate);
  useEffect(() => {
    if (!available) return;
    const abort = new AbortController();
    void client!.listPrepTemplates!(abort.signal).then(items => { if (!abort.signal.aborted) setItems(items); }).catch(e => { if (!abort.signal.aborted) setError(prepMessage(e)); });
    return () => abort.abort();
  }, [client, available, revision]);
  const action = async (work: () => Promise<void>) => { if (acting.current) return; acting.current = true; setBusy(true); setError(''); try { await work(); } catch (e) { setError(prepMessage(e)); } finally { acting.current = false; setBusy(false); } };
  return <DataDialog title={proposing ? 'Promote recipe to template' : 'Shared recipe templates'} onClose={() => { if (!busy) onClose(); }}>
    <div className="data-dialog-body prep-promotions">
      {!available ? <p>Needs a local or hosted API. Recipe templates are shared workspace assets; this static demo has no template store.</p> : <>
        <p>Editors propose drafts. The recipe owner or a workspace administrator publishes them for shared use.</p>
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        {proposing ? <form onSubmit={e => { e.preventDefault(); void action(async () => {
          await client!.proposePrepTemplate!(`template-${globalThis.crypto.randomUUID()}`, dataset.dataSetId, name.trim()); setProposing(false); setMessage('Template draft proposed. Review its steps before publishing.'); setRevision(n => n + 1);
        }); }}><label>Template name<input required maxLength={128} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label><p>The saved recipe is copied. Its connected sources become input slots for each new dataset.</p><button className="data-primary" disabled={busy || !name.trim()}>Save template draft</button></form> : <>
          <DataTable headings={['Template', 'Status / owner', 'Actions']} empty={!items.length ? 'No visible templates. Promote a saved recipe to propose one.' : undefined}>
            {items.map(t => <tr key={t.id}><td><strong>{t.definition.name}</strong><details><summary>Review {t.definition.name}</summary><p>Source recipe: {t.source.id} · version {t.source.version}</p><p>Inputs: {t.slots.join(', ')} · Output: {t.definition.pipeline.output ?? 'Last step'}</p><ol>{t.definition.pipeline.steps.map(s => <li key={s.id}>{s.name ?? prepStepLabel(s)} · {s.id}{s.from ? ` · From ${s.from}` : ''}<pre>{JSON.stringify(s.config, null, 2)}</pre></li>)}</ol></details></td><td>{t.state === 'draft' ? 'Draft awaiting approval' : 'Published'}<small>Owner: {t.owner}</small></td><td>
              {t.permissions.publish && t.state === 'draft' && <button disabled={busy} onClick={() => void action(async () => { await client!.publishPrepTemplate!(t.id, t.version); setRevision(n => n + 1); setMessage('Template published for shared use.'); })}>Publish {t.definition.name}</button>}
              {t.publishedVersion !== null && <button disabled={busy} onClick={() => { setSelected(t); setName(t.definition.name); setBindings({}); setError(''); }}>Start from {t.definition.name}</button>}
            </td></tr>)}
          </DataTable><button disabled={busy} onClick={() => setRevision(n => n + 1)}>Refresh templates</button>
        </>}
        {selected && <form onSubmit={e => { e.preventDefault(); void action(async () => { const result = await client!.createFromPrepTemplate!(selected, `prepared-${globalThis.crypto.randomUUID()}`, name.trim(), bindings); onCreated(result.resource); onClose(); }); }}><h3>Start from {selected.definition.name}</h3><p>Copies published version {selected.publishedVersion}. Bind every input; later template edits will not change this dataset.</p>
          <label>New dataset name<input required maxLength={128} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label>
          {selected.publishedSlots.map(slot => <label key={slot}>Bind {slot}<select required disabled={busy} value={bindings[slot] ? prepRefKey(bindings[slot]) : ''} onChange={e => { const source = sources.find(s => prepRefKey(prepSourceRef(s)) === e.target.value); if (source) setBindings(b => ({ ...b, [slot]: prepSourceRef(source) as PrepInput })); }}><option value="">Choose your input</option>{sources.filter(s => s.available).map(s => <option key={prepRefKey(prepSourceRef(s))} value={prepRefKey(prepSourceRef(s))}>{s.name ?? s.id}</option>)}</select></label>)}
          <button className="data-primary" disabled={busy || !name.trim() || selected.publishedSlots.some(s => !bindings[s])}>Create prepared dataset</button>
        </form>}
      </>}
    </div><footer><button disabled={busy} onClick={onClose}>Close</button></footer>
  </DataDialog>;
}
