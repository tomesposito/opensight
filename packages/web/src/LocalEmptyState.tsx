import type { ReactNode } from 'react';

/** Decorative, dependency-free artwork shared by the empty collection pages. */
function EmptyPageIllustration() {
  return <svg className="empty-page-illustration" viewBox="0 0 120 104" aria-hidden="true" focusable="false">
    <ellipse cx="58" cy="52" rx="44" ry="44" fill="#eeebf7" />
    <g transform="rotate(-12 45 50)">
      <rect x="24" y="20" width="44" height="64" rx="4" fill="#e0d8f0" />
      <rect x="31" y="28" width="25" height="4" rx="2" fill="#b9a7d8" />
      <path d="M33 69V56h6v13zm10 0V47h6v22zm10 0V39h6v30z" fill="#b9a7d8" />
    </g>
    <g transform="rotate(10 72 52)">
      <rect x="53" y="24" width="40" height="60" rx="4" fill="#fff" />
      <path d="M62 37h22M62 47h16M62 57h22M62 67h14" stroke="#e0d8f0" strokeWidth="4" strokeLinecap="round" />
    </g>
    <circle cx="93" cy="81" r="13" fill="#9678c9" />
    <path d="M93 75v12m-6-6h12" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

export function EmptyPageState({ guidance, children }: { guidance: string; children: ReactNode }) {
  return <div className="empty-page-state">
    <EmptyPageIllustration />
    <p>{guidance}</p>
    {children}
  </div>;
}

/** Local first-run guidance; the static demo never renders this component. */
export function LocalEmptyState({ title, onSources, onSample }: { title?: string; onSources?: () => void; onSample?: () => void }) {
  return <section className="local-empty-state">
    {title && <h2>{title}</h2>}
    <EmptyPageState guidance="Add your data to build your first analysis.">
      {onSources && <button type="button" className="primary-button" onClick={onSources}>Upload or connect data</button>}
      {onSample && <button type="button" className="empty-state-secondary" onClick={onSample}>Try sample data</button>}
    </EmptyPageState>
  </section>;
}
