import type { PrepPipeline, PrepStep } from '@opensight/bundle-parser/prep';
import { prepMessage, prepStepPlan, type PrepSourceSummary, type PrepSchemaContext } from './data-prep.js';

/** Display compiler output verbatim; parameters stay separate from SQL. */
export function PrepSqlView({ pipeline, step, sources, context }: {
  pipeline: PrepPipeline; step: PrepStep; sources: readonly PrepSourceSummary[]; context?: PrepSchemaContext;
}) {
  let plan: ReturnType<typeof prepStepPlan> | undefined, error = '';
  try { plan = prepStepPlan(pipeline, step, sources, context); }
  catch (e) { error = prepMessage(e); }
  return <details className="prep-sql-view"><summary>SQL through this step</summary>
    {plan ? <><p>Read-only · {plan.dialect} · Generated from canvas source bindings. The API resolves physical table bindings when executing. Preview output limit: {plan.limit} rows plus one truncation check.</p>
      <pre aria-label="Generated step SQL"><code>{plan.sql}</code></pre>
      {plan.parameters.length > 0 && <><p>Bound parameters (in order)</p><pre aria-label="SQL parameters">{JSON.stringify(plan.parameters, null, 2)}</pre></>}
    </> : <p className="prep-error" role="alert">{error}</p>}
  </details>;
}
