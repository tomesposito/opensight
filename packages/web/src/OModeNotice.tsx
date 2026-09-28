import { useId } from 'react';

export function OModeNotice({ available = false, checked = false, onChange, state = 'not-configured' }: { available?: boolean; checked?: boolean; onChange?: (value: boolean) => void; state?: string }) {
  const id = useId();
  return <div className="o-mode-notice">
    <label><input type="checkbox" role="switch" checked={available && checked} disabled={!available} onChange={e => onChange?.(e.target.checked)} aria-describedby={id} />Generative mode</label>
    <small id={id}>{available ? 'Uses the configured AI provider through the hosted API. Review generated suggestions before adding them.' : state === 'needs-approval' ? 'AI_BEDROCK_APPROVAL_REQUIRED: Bedrock needs explicit approval. Live AWS calls are disabled.' : 'Needs hosted API and API key via server env (not configured).'}</small>
  </div>;
}
