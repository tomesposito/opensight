import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { AuthorDataset } from './authoring.js';
import type { QueryClient } from './author-query.js';
import { prepMessage, type PrepSourceSummary } from './data-prep.js';

interface Props {
  client?: Pick<QueryClient, 'listPrepSources'>;
  sampleAvailable?: boolean;
  offline?: boolean;
  onSelect: (dataset?: AuthorDataset) => void;
  onCreateDataset?: () => void;
  onClose: () => void;
}
interface Choice {
  key: string;
  name: string;
  dataset?: AuthorDataset;
  source: 'file' | 'database' | 'sample' | 'unknown';
  sourceName: string;
  mode?: 'BLAZE' | 'Direct query';
  available: boolean;
  error?: string;
}

function choices(sources: PrepSourceSummary[], sampleAvailable: boolean, offline: boolean): Choice[] {
  const prepared: Choice[] = sources.flatMap(source => {
    if (!source.ref || typeof source.ref !== 'object' || !('dataset' in source.ref)) return [];
    return [{
      key: `dataset:${source.ref.dataset}`, name: source.name ?? source.id,
      dataset: { id: source.ref.dataset, name: source.name ?? source.id, columns: source.columns },
      source: source.connectorId === 'file' ? 'file' : source.connectorId === 'postgresql' ? 'database' : 'unknown',
      sourceName: source.connectorId === 'file' ? 'File' : source.connectorId === 'postgresql' ? 'PostgreSQL' : 'Unavailable',
      mode: source.execution?.mode === 'BLAZE' ? 'BLAZE' : source.execution?.mode === 'DIRECT_QUERY' ? 'Direct query' : undefined,
      available: source.available, error: source.available ? undefined : source.errorCode ?? 'DATASET_UNAVAILABLE',
    }];
  });
  return sampleAvailable ? [{ key: 'sample:sales', name: 'Sample sales data', source: 'sample', sourceName: 'Synthetic sample', mode: offline ? 'BLAZE' : 'Direct query', available: true }, ...prepared] : prepared;
}

function SourceIcon({ source }: { source: Choice['source'] }) {
  return <svg className="dataset-source-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    {source === 'file' || source === 'sample' ? <path d="M5 2h7l4 4v12H5V2Zm7 0v5h4" /> : source === 'database' ? <><ellipse cx="10" cy="4" rx="6" ry="2.5" /><path d="M4 4v11c0 3.3 12 3.3 12 0V4M4 9c0 3.3 12 3.3 12 0" /></> : <><circle cx="10" cy="10" r="7" /><path d="M8 7a2 2 0 0 1 4 0c0 2-2 2-2 4m0 2v1" /></>}
  </svg>;
}

export function CreateAnalysisDialog({ client, sampleAvailable = false, offline = false, onSelect, onCreateDataset, onClose }: Props) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState('');
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(25), [revision, setRevision] = useState(0);
  const list = client?.listPrepSources;
  const [state, setState] = useState<{ list: typeof list; revision: number; sources: PrepSourceSummary[]; error?: string }>();
  useLayoutEffect(() => {
    const dialog = ref.current, previous = dialog?.ownerDocument.activeElement;
    dialog?.showModal(); searchRef.current?.focus();
    return () => {
      dialog?.close();
      if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setSelected(''); setPage(0);
    if (list) void Promise.resolve().then(list).then(sources => {
      if (active) setState({ list, revision, sources });
    }).catch((error: unknown) => { if (active) setState({ list, revision, sources: [], error: prepMessage(error) }); });
    return () => { active = false; };
  }, [list, revision]);
  const current = state && state.list === list && state.revision === revision ? state : undefined;
  const loading = !!list && !current;
  const rows = choices(current?.sources ?? [], sampleAvailable, offline).filter(row => row.name.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  // A hidden, denied, failed or stale catalog row can never be submitted.
  const selection = !loading && !current?.error ? visible.find(row => row.key === selected && row.available) : undefined;
  const changePage = (next: number) => { setPage(next); setSelected(''); };
  return <dialog ref={ref} className="create-analysis-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (selection) onSelect(selection.dataset); }}>
      <header className="create-analysis-heading"><div><h2 id={`${id}-title`}>Create Analysis</h2><p id={`${id}-description`}>Choose a dataset or topic to create an analysis.</p></div><button type="button" aria-label="Close Create Analysis" onClick={onClose}>×</button></header>
      <div className="create-analysis-tools">
        <div className="dataset-picker-tabs" role="tablist" aria-label="Analysis source"><button type="button" role="tab" id={`${id}-datasets`} aria-selected="true" aria-controls={`${id}-panel`}>Datasets</button><button type="button" role="tab" aria-selected="false" disabled aria-describedby={`${id}-topics`}>Topics</button></div>
        <label className="dataset-picker-search"><span className="sr-only">Search datasets by name</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="5" /><path d="m12 12 5 5" /></svg><input ref={searchRef} type="search" placeholder="Search datasets by name" value={query} onChange={event => { setQuery(event.target.value); changePage(0); }} /></label>
        <button type="button" className="create-dataset-button" disabled={!onCreateDataset} onClick={onCreateDataset}>Create dataset</button>
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-datasets`}>
        <div className="dataset-picker-table" tabIndex={0} role="region" aria-label="Available datasets" aria-busy={loading}>
          <table><thead><tr><th scope="col"><span className="sr-only">Select dataset</span></th><th scope="col">Dataset name</th><th scope="col">Type</th><th scope="col">Source</th><th scope="col">Owner</th><th scope="col">Last modified</th></tr></thead>
            <tbody>{visible.map(row => <tr key={row.key} data-selected={selection?.key === row.key || undefined}>
              <td><input type="radio" name={`${id}-selection`} id={`${id}-${row.key}`} checked={selected === row.key} disabled={!row.available || loading || !!current?.error} onChange={() => setSelected(row.key)} /></td>
              <td><label htmlFor={`${id}-${row.key}`}>{row.name}</label>{row.error && <small className="dataset-picker-error">{row.error}</small>}</td>
              <td>{row.mode ? <span className={row.mode === 'BLAZE' ? 'dataset-picker-badge' : undefined}>{row.mode}</span> : <span title="Execution mode is not supplied by the dataset catalog">Not available</span>}</td>
              <td><span className="dataset-picker-source"><SourceIcon source={row.source} />{row.sourceName}</span></td>
              <td><span title="Owner is not supplied by the dataset catalog">Not available</span></td><td><span title="Modification date is not supplied by the dataset catalog">Not available</span></td>
            </tr>)}</tbody>
          </table>
          {loading ? <p className="dataset-picker-status" role="status">Loading datasets…</p> : current?.error ? <p className="dataset-picker-status" role="alert">Could not load datasets. {current.error}</p> : !rows.length && <p className="dataset-picker-status" role="status">{query.trim() ? 'No datasets match your search.' : 'No datasets yet. Create a dataset to get started.'}</p>}
        </div>
        <div className="dataset-picker-pagination">
          {list && <button type="button" className="dataset-picker-refresh" onClick={() => { setRevision(value => value + 1); setSelected(''); }}>Refresh datasets</button>}
          <label>Items per page <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); changePage(0); }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          <button type="button" aria-label="Previous page" disabled={currentPage === 0 || loading} onClick={() => changePage(currentPage - 1)}>‹</button><span role="status">{currentPage + 1} of {pageCount}</span><button type="button" aria-label="Next page" disabled={currentPage + 1 >= pageCount || loading} onClick={() => changePage(currentPage + 1)}>›</button>
        </div>
      </div>
      <p id={`${id}-topics`} className="dataset-picker-note">Topics need a hosted API with topic support.{!onCreateDataset && ' Creating datasets needs a local or hosted API.'}</p>
      <footer className="create-analysis-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="dataset-picker-select" disabled={!selection}>Select</button></footer>
    </form>
  </dialog>;
}
