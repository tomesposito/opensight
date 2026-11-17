import { useEffect, useState } from 'react';
import type { PrepPipeline, PrepStep } from '@opensight/bundle-parser/prep';
import type { PrepJoinDiagnostics as Diagnostics } from '@opensight/query-engine/browser';
import { prepMessage, prepPrefix, prepStepPlan, type PrepSchemaContext, type PrepSourceSummary } from './data-prep.js';

export type JoinDiagnosticsClient = { joinDiagnostics(id: string, pipeline: PrepPipeline, through: string): Promise<Diagnostics> };
export function PrepJoinDiagnostics({ pipeline, step, sources, context, client, datasetId }: {
  pipeline: PrepPipeline; step: PrepStep; sources: readonly PrepSourceSummary[]; context?: PrepSchemaContext;
  client?: JoinDiagnosticsClient; datasetId?: string;
}) {
  const [state, setState] = useState<{ key: string; result?: Diagnostics; error?: string }>();
  const index = pipeline.steps.findIndex(s => s.id === step.id), prefix = prepPrefix(pipeline, index < 0 ? pipeline.steps.length : index);
  const draft = { ...prefix, steps: [...prefix.steps, step] };
  let problem = '';
  try { prepStepPlan(pipeline, step, sources, context); } catch (error) { problem = prepMessage(error); }
  const key = JSON.stringify([datasetId, draft, sources, context]);
  useEffect(() => {
    if (step.kind !== 'join' || problem || !client || !datasetId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.joinDiagnostics(datasetId, draft, step.id).then(result => {
        if (!cancelled) setState({ key, result });
      }).catch(error => { if (!cancelled) setState({ key, error: prepMessage(error) }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, client, problem]);
  if (step.kind !== 'join') return null;
  const current = state?.key === key ? state : undefined, result = current?.result;
  return <section className="prep-join-diagnostics" aria-label="Join match diagnostics"><h4>Join match diagnostics · Preview-based</h4>
    {problem ? <p className="prep-error" role="alert">{problem}</p>
      : !client || !datasetId ? <p>Unavailable · Needs local or hosted API. The static demo has sample schema only.</p>
      : current?.error ? <p className="prep-error" role="alert">{current.error}</p>
      : !result ? <p role="status">Loading bounded join diagnostics…</p>
      : <><p>Preview-based — computed on a bounded sample: {result.leftRowsSampled.toLocaleString('en-US')} left rows, {result.rightRowsSampled.toLocaleString('en-US')} right rows. Limit: {result.sampleLimit.toLocaleString('en-US')} rows per input.</p>
        <dl><div><dt>Matched output rows</dt><dd>{result.matchedRows.toLocaleString('en-US')}</dd></div><div><dt>Unmatched left rows</dt><dd>{result.unmatchedLeft.toLocaleString('en-US')}</dd></div><div><dt>Unmatched right rows</dt><dd>{result.unmatchedRight.toLocaleString('en-US')}</dd></div></dl>
        {(result.leftTruncated || result.rightTruncated) && <p>Truncated sample: {[result.leftTruncated && 'left', result.rightTruncated && 'right'].filter(Boolean).join(' and ')} input or upstream source reached the sample limit. Counts describe these samples, not whole sources.</p>}
        {result.fanOut && <p className="prep-join-warning" role="status">Fan-out warning: duplicate matched keys multiply rows. Maximum matched-key multiplicity: {result.maxLeftMultiplicity.toLocaleString('en-US')} left × {result.maxRightMultiplicity.toLocaleString('en-US')} right (maxima may occur on different keys).</p>}
        <p>NULL keys never match. Unmatched rows have no match in the other input’s sample.</p></>}
  </section>;
}
