/** Local first-run guidance; the static demo never renders this component. */
export function LocalEmptyState({ title = 'Start with your data', onSources, onSample }: { title?: string; onSources?: () => void; onSample?: () => void }) {
  return <section className="local-empty-state">
    <h2>{title}</h2>
    <p>Upload a file, prepare your data, then build your first analysis.</p>
    <div className="local-empty-actions">
      {onSources && <button type="button" className="primary-button" onClick={onSources}>Upload or connect data</button>}
      {onSample && <button type="button" onClick={onSample}>Try sample data</button>}
    </div>
    <p>Files stay on this computer. Remote connections need a hosted API.</p>
  </section>;
}
