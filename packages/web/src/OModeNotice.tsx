import type { AIStatus } from './api-client.js';
import { useId } from 'react';

export function OModeNotice({ available = false, checked = false, onChange, state = 'not-configured', mode, credits }: { available?: boolean; checked?: boolean; onChange?: (value: boolean) => void; state?: string; mode?: AIStatus['mode']; credits?: AIStatus['credits'] }) {
  const id = useId();
  const exhausted = state === 'credit-limit';
  const month = credits ? new Date(`${credits.period}-01T00:00:00Z`).toLocaleString('en', { month: 'long', timeZone: 'UTC' }) : '';
  const reset = credits ? new Date(credits.resetsAt).toLocaleDateString('en', { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  return <div className="o-mode-notice">
    <label><input type="checkbox" role="switch" checked={available && checked} disabled={!available} onChange={e => onChange?.(e.target.checked)} aria-describedby={id} />Generative mode</label>
    {mode === 'managed' && <span className="o-managed-label">Managed AI</span>}
    <small id={id}>{exhausted ? "Generative mode is paused — this workspace's monthly credits are used up. Questions still answer below with the built-in interpreter, no AI involved." : available && mode === 'managed' ? "AI interpretation · Review before use. Runs on OpenSight's managed AI and uses this workspace's monthly credits." : available ? 'Uses the configured AI provider through the hosted API. Review generated suggestions before adding them.' : state === 'needs-approval' ? 'AI_BEDROCK_APPROVAL_REQUIRED: Bedrock needs explicit approval. Live AWS calls are disabled.' : 'Needs hosted API and API key via server env (not configured).'}</small>
    {mode === 'managed' && credits?.limit != null && <div className={`o-credits${exhausted ? ' empty' : ''}`}><span><b>{credits.remaining}</b> of {credits.limit} credits left</span><progress value={credits.remaining} max={credits.limit || 1} aria-label="Monthly Ask O credits remaining" /><span>{month}</span></div>}
    {exhausted && credits && <section className="o-credit-limit" role="status"><h3>Monthly Ask O credits are used up</h3><p>This workspace used all {credits.limit} of its {month} credits. Generative answers start again on {reset}, or when an admin moves the workspace to its own AI provider in Settings.</p><p>Nothing is blocked: the standard interpreter keeps answering questions it can parse, and dashboards, data and sharing are unaffected.</p></section>}
  </div>;
}
