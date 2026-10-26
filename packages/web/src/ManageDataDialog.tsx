import { useEffect, useState } from 'react';
import type { AuthorDataset } from './authoring.js';
import { SALES_FIELDS } from './authoring.js';
import type { QueryClient } from './author-query.js';
import type { PrepSourceSummary } from './data-prep.js';
import { DataDialog, DataTable } from './DataSectionUI.js';

export type ManageDataClient = Pick<QueryClient, 'listPrepSources'>;

/**
 * Shimmer table placeholder shown while the dataset source list loads (issue
 * #108 polish). The dialog body reserves 320px, so the skeleton only needs to
 * approximate the loaded table (header + a few rows); the loading -> loaded
 * swap never moves the dialog footer. Reuses the shimmer row shapes from
 * style.css; static under prefers-reduced-motion.
 */
export function ManageDataSkeleton() {
  const rows = Array.from({ length: 3 }, (_, index) => index);
  return <div className="manage-data-skeleton" role="status" aria-label="Loading datasets">
    <span className="sr-only">Loading datasets…</span>
    <div className="skeleton-rows" aria-hidden="true">
      {rows.map(index => <span key={index} className="skeleton-shape skeleton-row" />)}
    </div>
  </div>;
}

/** Bundled sample dataset id, matching the Data panel picker's 'sales' option. */
export const SAMPLE_DATASET_ID = 'sales';
export const sampleDataset = (): AuthorDataset => ({
  id: SAMPLE_DATASET_ID,
  name: 'Sample sales data',
  columns: SALES_FIELDS.map(({ name, type }) => ({ name, type })),
});

/**
 * Honest type label for the Type column. QuickSight shows SPICE here; we name
 * what OpenSight actually uses. 'Unknown' when no source entry matches —
 * never claim a type we have not checked.
 */
export function datasetTypeLabel(dataset: AuthorDataset, source?: PrepSourceSummary): string {
  if (dataset.id === SAMPLE_DATASET_ID && !source) return 'Sample';
  if (source?.execution?.mode === 'BLAZE') return 'BLAZE · Cached';
  if (source?.execution?.mode === 'DIRECT_QUERY') return 'Direct query';
  if (source && typeof source.ref === 'object' && 'dataset' in source.ref) return 'Prepared';
  return source ? 'Direct query' : 'Unknown';
}

const datasetIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <ellipse cx="12" cy="6" rx="8" ry="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const overflowIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="5" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" />
  </svg>
);

/** Sources eligible as a replacement: prepared datasets with columns, available now. */
export function replaceableSources(sources: readonly PrepSourceSummary[], currentId: string): PrepSourceSummary[] {
  return sources.filter(source => source.id !== currentId && source.available && typeof source.ref === 'object' && 'dataset' in source.ref);
}

export function ManageDataDialog({ client, datasets, sampleLoaded, noDataset, onClose, onReplace, onRemove, onAddData }: {
  client?: ManageDataClient;
  /** The analysis's datasets (local author: the single draft dataset, if any). */
  datasets: readonly AuthorDataset[];
  /** Sample data is available for implicit fallback or explicit replacement. */
  sampleLoaded?: boolean;
  /** Explicit removal suppresses implicit sample fallback, even while sample data is available. */
  noDataset?: boolean;
  onClose: () => void;
  onReplace: (dataset: AuthorDataset) => void;
  onRemove: (dataset: AuthorDataset) => void;
  onAddData?: () => void;
}) {
  const [sources, setSources] = useState<PrepSourceSummary[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  useEffect(() => {
    let active = true;
    const list = client?.listPrepSources;
    if (!list) { setSources([]); return; }
    setSources(undefined);
    void list()
      .then(value => { if (active) { setSources(value); setError(''); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { active = false; };
  }, [client]);
  // Demo mode: the analysis runs on the bundled sample dataset without a draft dataset.
  const rows = noDataset ? [] : datasets.length ? [...datasets] : sampleLoaded ? [sampleDataset()] : [];
  const sourceFor = (dataset: AuthorDataset) => sources?.find(source => source.id === dataset.id);
  const replacingDataset = replacing ? rows.find(row => row.id === replacing) : undefined;
  const removingDataset = removing ? rows.find(row => row.id === removing) : undefined;
  const candidates = replacing ? replaceableSources(sources ?? [], replacing) : [];
  const confirmReplace = () => {
    if (!replacing) return;
    if (choice === SAMPLE_DATASET_ID && sampleLoaded) { onReplace(sampleDataset()); return; }
    const selected = candidates.find(source => source.id === choice);
    if (selected) onReplace({ id: selected.id, name: selected.name ?? selected.id, columns: selected.columns });
  };
  return <DataDialog title="Manage data" description="Review the datasets this analysis uses, replace one, or add data." onClose={onClose}>
    <div className="data-dialog-body">
      {error ? <p role="alert">Could not load data sources. {error} <button type="button" onClick={() => { setSources(undefined); setError(''); const list = client?.listPrepSources; if (!list) setSources([]); else void list().then(value => setSources(value)).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))); }}>Retry</button></p>
        : sources === undefined ? <ManageDataSkeleton />
        : <DataTable headings={['Dataset', 'Type', 'Status', '']} empty={rows.length ? undefined : 'No datasets in this analysis yet.'}>
          {rows.map(dataset => {
            const source = sourceFor(dataset);
            const available = dataset.id === SAMPLE_DATASET_ID && !source ? true : source?.available ?? false;
            return <tr key={dataset.id}>
              <td><span className="data-dataset-cell">{datasetIcon}<span>{dataset.name}</span></span></td>
              <td><span className="data-badge">{datasetTypeLabel(dataset, source)}</span></td>
              <td>{available ? 'Available' : <>Unavailable{source?.errorCode ? <small> · {source.errorCode}</small> : null}</>}</td>
              <td className="data-row-actions">
                <button type="button" onClick={() => { setReplacing(dataset.id); setRemoving(null); setChoice(''); }}>Replace</button>
                <details className="data-row-menu">
                  <summary aria-label={`More actions for ${dataset.name}`}>{overflowIcon}</summary>
                  <div><button type="button" onClick={() => { setRemoving(dataset.id); setReplacing(null); }}>Remove dataset</button></div>
                </details>
              </td>
            </tr>;
          })}
        </DataTable>}
      {replacingDataset && <div className="data-inline-panel" aria-label={`Replace ${replacingDataset.name}`}>
        <label>Replace <strong>{replacingDataset.name}</strong> with <select aria-label="Replacement dataset" value={choice} onChange={event => setChoice(event.target.value)}>
          <option value="">Choose a dataset…</option>
          {sampleLoaded && replacingDataset.id !== SAMPLE_DATASET_ID && <option value={SAMPLE_DATASET_ID}>Sample sales data</option>}
          {candidates.map(source => <option key={source.id} value={source.id}>{source.name ?? source.id}</option>)}
        </select></label>
        <p>Sheets, visuals, parameters, and calculated fields are kept. Missing or incompatible fields are listed in the Data panel. Affected visuals show an unavailable-field state, and your draft can still save.</p>
        <div className="data-inline-actions">
          <button type="button" onClick={() => setReplacing(null)}>Cancel</button>
          <button type="button" className="data-primary" disabled={!choice} onClick={confirmReplace}>Replace dataset</button>
        </div>
      </div>}
      {removingDataset && <div className="data-inline-panel" role="alertdialog" aria-label={`Remove ${removingDataset.name}`}>
        <p>Remove <strong>{removingDataset.name}</strong>? The analysis keeps its sheets and visuals but returns to the no-dataset empty state until you add data. This can be undone.</p>
        <div className="data-inline-actions">
          <button type="button" onClick={() => setRemoving(null)}>Cancel</button>
          <button type="button" className="data-danger" onClick={() => onRemove(removingDataset)}>Remove dataset</button>
        </div>
      </div>}
    </div>
    <footer>
      <button type="button" onClick={onClose}>Cancel</button>
      {onAddData && <button type="button" className="data-primary" onClick={onAddData}>Add data</button>}
    </footer>
  </DataDialog>;
}
