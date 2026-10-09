import { useRef, useState, type ReactNode } from 'react';

/** Shared landing-page hierarchy; decoration never stands in for real data. */
export function CollectionPage({ title, introduction, description, actions, children }: {
  title: string; introduction: string; description: string; actions?: ReactNode; children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  return <section className="collection-page">
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    {!dismissed && <aside className="collection-banner" aria-label={`${title} introduction`}>
      <div><h2>{introduction}</h2><p>{description}</p><button type="button" onClick={() => { setDismissed(true); heading.current?.focus(); }}>Dismiss</button></div>
      <svg viewBox="0 0 220 116" aria-hidden="true" focusable="false">
        <rect x="8" y="8" width="204" height="100" rx="6" fill="#fff" opacity=".12" />
        <path d="M28 88h164M28 28v60" fill="none" stroke="#d0e0e8" />
        <path d="M46 86V66h22v20zm42 0V48h22v38zm42 0V56h22v30zm42 0V30h22v56z" fill="#72d3d4" />
        <path d="m46 50 52-22 42 8 44-20" fill="none" stroke="#fff" strokeWidth="3" />
      </svg>
    </aside>}
    <div className="collection-card">
      {actions && <div className="collection-tools">{actions}</div>}
      {children}
    </div>
  </section>;
}
