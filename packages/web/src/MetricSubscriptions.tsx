import { useEffect, useRef, useState } from 'react';
import type { createApiClient } from './api-client.js';
import type { MetricSummary } from './governed-metrics.js';
import { formatMetric } from './governed-metrics.js';
import type { MetricSubscription, MetricDigestPreview } from './metric-digests.js';
export type DigestClient = Partial<Pick<ReturnType<typeof createApiClient>, 'getMetric' | 'listMetricSubscriptions' | 'subscribeMetric' | 'unsubscribeMetric' | 'previewMetricDigest'>>;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
export function MetricSubscriptions({ metric, columns = [], client }: { metric: MetricSummary; columns?: { name: string; type: string }[]; client: DigestClient }) {
  const [items, setItems] = useState<MetricSubscription[]>(), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [cadence, setCadence] = useState<'weekly' | 'daily'>('weekly'), [timeColumn, setTimeColumn] = useState(columns.find(c => c.type === 'DATETIME')?.name ?? '');
  const [dimensions, setDimensions] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState<MetricDigestPreview>();
  const acting = useRef(false);
  useEffect(() => {
    const abort = new AbortController(); setItems(undefined); setError('');
    void client.listMetricSubscriptions?.(metric.id, abort.signal).then(items => { if (!abort.signal.aborted) setItems(items); }).catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [client, metric.id, revision]);
  const action = async (work: () => Promise<void>) => {
    if (acting.current) return; acting.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(message(e)); } finally { acting.current = false; setBusy(false); }
  };
  const value = (n: number | null) => formatMetric(n, metric.published?.format) ?? 'No data';
  return <section aria-label="Metric digests" className="metric-definition-form"><h3>Email digests</h3>
    <p>Subscribe your own inbox. Weekly digests arrive Monday at 09:00 UTC and compare the last complete week with the week before. Daily digests arrive at 09:00 UTC.</p>
    {error && <p role="alert">{error.includes('HOSTED_API_REQUIRED') ? 'Needs hosted API. Email subscriptions are unavailable in the local workspace.' : error}</p>}
    {items && <><form onSubmit={e => { e.preventDefault(); void action(async () => {
      await client.subscribeMetric!(metric.id, { cadence, timeColumn, dimensions: dimensions.split('\n').map(s => s.trim()).filter(Boolean) }); setRevision(n => n + 1);
    }); }}>
      <label>Digest cadence<select value={cadence} disabled={busy} onChange={e => setCadence(e.target.value as typeof cadence)}><option value="weekly">Weekly</option><option value="daily">Daily</option></select></label>
      <label>Period date field{columns.length ? <select required value={timeColumn} disabled={busy} onChange={e => setTimeColumn(e.target.value)}><option value="">Choose a date field</option>{columns.filter(c => c.type === 'DATETIME').map(c => <option key={c.name}>{c.name}</option>)}</select> : <input required value={timeColumn} disabled={busy} onChange={e => setTimeColumn(e.target.value)} />}</label>
      <label>Driver dimensions (one field per line)<textarea value={dimensions} disabled={busy} onChange={e => setDimensions(e.target.value)} /></label>
      {!!columns.length && <p>Available dimensions: {columns.filter(c => !['DATETIME', 'BOOLEAN'].includes(c.type)).map(c => c.name).join(', ') || 'None'}</p>}
      <button type="submit" className="data-primary" disabled={busy || !timeColumn || !client.subscribeMetric || !metric.published}>Subscribe to email digest</button>
    </form><ul>{items.map(s => <li key={s.id}>{s.cadence === 'weekly' ? 'Weekly' : 'Daily'} · {s.timeColumn} · Next: {s.nextRun ?? 'Stopped'}
      <button disabled={busy || !client.previewMetricDigest} onClick={() => { void action(async () => setPreview(await client.previewMetricDigest!(s.id))); }}>View digest</button>
      <button disabled={busy || !client.unsubscribeMetric} onClick={() => { void action(async () => { await client.unsubscribeMetric!(s.id); setPreview(undefined); setRevision(n => n + 1); }); }}>Unsubscribe</button>
    </li>)}</ul>{!items.length && <p>No active subscriptions.</p>}</>}
    {preview && <section aria-label="Digest preview"><h3>{preview.change === 0 ? 'No change' : preview.change === null ? 'Comparison unavailable' : `Change: ${value(preview.change)}`}</h3>
      <p>{preview.periods.current.start.slice(0, 10)} to {preview.periods.current.end.slice(0, 10)} (end exclusive, UTC)</p><p>Current: {value(preview.current)} · Previous: {value(preview.previous)}</p>
      <p>Top dimension changes, evaluated separately with the governed aggregation:</p><ul>{preview.drivers.map(d => <li key={JSON.stringify([d.dimension, d.value])}>{d.dimension}: {d.value === null ? '(null)' : String(d.value)} · {value(d.previous)} → {value(d.current)} · Change: {value(d.change)}</li>)}</ul></section>}
  </section>;
}
export function MetricDetail({ id, client }: { id: string; client?: DigestClient }) {
  const [metric, setMetric] = useState<MetricSummary>(), [error, setError] = useState('');
  useEffect(() => { const abort = new AbortController(); setMetric(undefined); setError('');
    void client?.getMetric?.(id, abort.signal).then(m => { if (!abort.signal.aborted) setMetric(m); }).catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [id, client]);
  if (!client) return <section className="data-page"><div className="data-card"><h2>Metric digests</h2><p>Needs hosted API.</p></div></section>;
  return <section className="data-page metric-detail"><div className="data-card"><h2>{metric?.published?.name ?? 'Governed metric'}</h2>{error && <p role="alert">{error}</p>}
    {metric?.published && <><p>{metric.published.description}</p><p>Published version {metric.published.version}</p><pre>{metric.published.expression}</pre><MetricSubscriptions metric={metric} client={client} /></>}
  </div></section>;
}
