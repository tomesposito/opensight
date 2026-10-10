import { useState } from 'react';
import type { BundleDataSet } from '@opensight/bundle-parser';
import { useAccess } from './access.js';
import { DataMenu, DataTable, DataTabs } from './DataSectionUI.js';
import { datasetBadges, datasetSource, filterDatasets, rawSources, useDataCatalog, type DataCatalogClient, type DatasetFilter } from './data-section.js';
import type { PrepSourceSummary } from './data-prep.js';

export function DataLanding({ client, initialTab = 'Datasets', onCreate, onCreateSource, onOpen, onEdit, onPrep }: {
  client?: DataCatalogClient; initialTab?: 'Datasets' | 'Data sources'; onCreate: () => void; onCreateSource: () => void;
  onOpen: (dataset: BundleDataSet) => void; onEdit: (dataset: BundleDataSet) => void; onPrep: (source: PrepSourceSummary) => void;
}) {
  const access = useAccess(), catalog = useDataCatalog(client);
  const [tab, setTab] = useState<'Datasets' | 'Topics' | 'Data sources'>(initialTab);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<DatasetFilter>('all');
  const data = catalog.data ?? { datasets: [], sources: [] };
  const rows = filterDatasets(data, search, filter, access.mode === 'hosted');
  const sources = rawSources(data.sources).filter(source => (source.name ?? source.id).toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="data-page" aria-labelledby="data-title"><h1 id="data-title">Data</h1>
    <div className="data-card"><div className="data-toolbar"><DataTabs label="Data" tabs={['Datasets', 'Topics', 'Data sources']} selected={tab} select={next => { setTab(next); setSearch(''); }} />
      <div className="data-split"><button className="data-primary" onClick={onCreate}>Create dataset</button><details className="data-menu"><summary aria-label="More create options">⌄</summary><div className="data-menu-items"><button onClick={onCreateSource}>Create data source</button></div></details></div></div>
      <section role="tabpanel" aria-label={tab}>
      {tab === 'Topics' ? <div className="data-empty"><h2>No topics available</h2><p>Topics need a hosted API with topic support.</p></div> : <>
        <div className="data-tools"><label><span className="sr-only">{tab === 'Datasets' ? 'Search datasets by name' : 'Search data sources'}</span><input type="search" placeholder={tab === 'Datasets' ? 'Search datasets by name' : 'Search data sources'} value={search} onChange={event => setSearch(event.target.value)} /></label>
          {tab === 'Datasets' ? <select aria-label="Filter datasets" value={filter} onChange={event => setFilter(event.target.value as DatasetFilter)}><option value="all">All datasets</option><option value="mine" disabled={access.mode !== 'hosted'}>Owned by me</option><option value="cached">Cached datasets</option><option value="direct">Direct query datasets</option><option value="rls">RLS enabled</option><option value="rules">Rules datasets</option></select> : <button onClick={onCreateSource}>Create data source</button>}
          {client && <button className="data-reload" onClick={catalog.reload}>Reload data</button>}</div>
        {catalog.loading ? <p role="status">Loading data…</p> : catalog.error ? <p role="alert">Could not load data. {catalog.error}</p> : tab === 'Datasets' ? <>
          <DataTable headings={['Name', 'Owner', 'Last Modified', 'Action']}>{rows.map(dataset => <tr key={dataset.dataSetId}>
            <td><button className="data-name" onClick={() => onOpen(dataset)}>{dataset.name}</button><span className="data-badges">{datasetBadges(dataset, datasetSource(dataset, data.sources)).map(badge => <span className="data-badge" key={badge}>{badge}</span>)}</span></td>
            <td>{access.mode === 'hosted' ? 'Me' : 'Local workspace'}</td><td><span title="Modification time is not supplied by the dataset API">Not available</span></td>
            <td><DataMenu label={`Actions for ${dataset.name}`}><button onClick={() => onOpen(dataset)}>View dataset</button><button onClick={() => onEdit(dataset)}>Edit dataset</button></DataMenu></td>
          </tr>)}</DataTable>
          {!rows.length && <div className="data-empty"><span aria-hidden="true">▤</span><h2>{data.datasets.length ? 'No datasets match your filters' : 'No datasets yet'}</h2><p>{data.datasets.length ? 'Try another name or dataset type.' : 'Create a dataset to prepare data for your analyses.'}</p>{!data.datasets.length && <button onClick={onCreate}>Create dataset</button>}</div>}
        </> : <DataTable headings={['Name', 'Type', 'Action']} empty={!sources.length ? search ? 'No data sources match your search.' : 'No data sources yet. Upload a file or configure a data source to get started.' : undefined}>{sources.map(source => <tr key={source.id}><td>{source.name ?? source.id}</td><td>{source.connectorId === 'file' ? 'File' : source.connectorId}</td><td><button disabled={!source.available} onClick={() => onPrep(source)}>Create dataset</button>{!source.available && <span>{source.errorCode ?? 'SOURCE_UNAVAILABLE'}</span>}</td></tr>)}</DataTable>}
      </>}
      </section>
      {!client && <p className="data-note">Static demo · Dataset storage and uploads need a local or hosted API.</p>}
    </div>
  </section>;
}
