import { useId } from 'react';

/** This UI has no provider client or key input. A configured data API is not an LLM. */
export function OModeNotice() {
  const id = useId();
  return <div className="o-mode-notice">
    <label><input type="checkbox" role="switch" checked={false} disabled aria-describedby={id} />Generative mode</label>
    <small id={id}>Needs hosted API and API key via server env (not configured). Generative mode is not implemented.</small>
  </div>;
}
