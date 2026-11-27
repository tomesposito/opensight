import { useEffect, useState } from 'react';
import { OEntry } from './OEntry.js';
import { emptyDraft, type AuthorDataset } from './authoring.js';
import type { createApiClient } from './api-client.js';

/** The app's existing Ask O surface, with an explicit hosted dataset selection. */
export function AskOPage({ client }: { client: ReturnType<typeof createApiClient> }) {
  const [datasets, setDatasets] = useState<AuthorDataset[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void client.listPrepSources().then(sources => {
      if (active) setDatasets(sources.flatMap(source => typeof source.ref === 'object' && 'dataset' in source.ref && source.available
        ? [{ id: source.ref.dataset, name: source.name ?? source.id, columns: source.columns }] : []));
    }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : 'DATASET_UNAVAILABLE'); });
    return () => { active = false; };
  }, [client]);
  const dataset = datasets.find(d => d.id === selected);
  return <section className="data-page"><h1>Ask O</h1>{error && <p role="alert">{error}</p>}
    <label>Dataset<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {dataset && <OEntry key={dataset.id} draft={{ ...emptyDraft(), dataset }} client={{ ...client, dataset }} />}
  </section>;
}
