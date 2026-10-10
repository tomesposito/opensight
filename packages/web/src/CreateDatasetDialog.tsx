import { useState } from 'react';
import { connectors, connectorState } from '@opensight/query-engine/browser';
import type { createApiClient } from './api-client.js';
import { useAccess } from './access.js';
import { DataDialog, DataTable } from './DataSectionUI.js';
import { ConnectorDetails } from './DataSources.js';
import { rawSources, useDataCatalog } from './data-section.js';

export type DatasetCreationClient = Pick<ReturnType<typeof createApiClient>, 'listPrepSources' | 'listPrepDatasets' | 'uploadFile' | 'validateConnector'>;
// MySQL is explicitly requested by the brief, but its registry status must stay visible.
export const creationConnectors = connectors.filter(connector => connector.category !== 'AWS' && (connector.implementation === 'upload' || connector.implementation === 'query' || connector.id === 'mysql'));
export function CreateDatasetDialog({ client, start = 'dataset', onClose, onPrep }: { client?: DatasetCreationClient; start?: 'dataset' | 'source' | 'file'; onClose: () => void; onPrep: (source: string) => void }) {
  const access = useAccess(), catalog = useDataCatalog(client);
  const [stage, setStage] = useState<'dataset' | 'source' | 'config'>(start === 'file' ? 'config' : start);
  const [search, setSearch] = useState(''), [selectedSource, setSelectedSource] = useState('');
  const [connectorId, setConnectorId] = useState(start === 'file' ? 'file' : '');
  const sources = rawSources(catalog.data?.sources ?? []);
  const matchingSources = sources.filter(source => (source.name ?? source.id).toLowerCase().includes(search.trim().toLowerCase()));
  const source = !catalog.loading && !catalog.error ? matchingSources.find(source => source.id === selectedSource && source.available) : undefined;
  const connector = creationConnectors.find(connector => connector.id === connectorId);
  const nextStage = (next: typeof stage) => { setStage(next); setSearch(''); setSelectedSource(''); };
  const upload = () => { setConnectorId('file'); nextStage('config'); };
  const title = stage === 'dataset' ? 'Create dataset' : stage === 'source' ? 'Create data source' : `${connector?.name ?? 'Data source'} setup`;
  const postgresSources = access.mode === 'hosted' ? sources.filter(source => source.connectorId === 'postgresql' && source.available) : [];
  return <DataDialog title={title} description={stage === 'dataset' ? 'Choose a data source to create a dataset.' : stage === 'source' ? 'Choose a connector for your data.' : undefined} onClose={onClose}>
    <div className="data-dialog-body">
      {stage === 'dataset' ? <>
        <div className="data-dialog-tools"><input aria-label="Search data sources" type="search" placeholder="Search data sources" value={search} onChange={event => { setSearch(event.target.value); setSelectedSource(''); }} /><button onClick={upload}>Upload file</button><button onClick={() => nextStage('source')}>Create data source</button></div>
        {catalog.loading ? <p role="status">Loading data sources…</p> : catalog.error ? <p role="alert">Could not load data sources. {catalog.error} <button onClick={catalog.reload}>Retry</button></p> : <DataTable headings={['Select', 'Name', 'Type']} empty={!matchingSources.length ? search ? 'No data sources match your search.' : 'No data sources yet. Upload a file or create a data source.' : undefined}>{matchingSources.map(item => <tr key={item.id}><td><input type="radio" aria-label={`Select ${item.name ?? item.id}`} name="data-source" disabled={!item.available} checked={selectedSource === item.id} onChange={() => setSelectedSource(item.id)} /></td><td>{item.name ?? item.id}{!item.available && <small> · {item.errorCode ?? 'SOURCE_UNAVAILABLE'}</small>}</td><td>{item.connectorId === 'file' ? 'File' : item.connectorId}</td></tr>)}</DataTable>}
      </> : stage === 'source' ? <>
        <div className="data-dialog-tools"><input aria-label="Search connectors" type="search" placeholder="Search data sources" value={search} onChange={event => { setSearch(event.target.value); setConnectorId(''); }} /></div>
        <div className="data-connector-grid">{creationConnectors.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase())).map(item => <label key={item.id} className="data-connector-tile" data-selected={connectorId === item.id}>
          <span aria-hidden="true">{item.id === 'file' ? '↑' : '▤'}</span><span><strong>{item.name}</strong><small>{item.id === 'file' ? '.csv, .tsv, .xlsx, .json, .xls' : connectorState(item.id, !!client).message}</small></span><input type="radio" name="connector" aria-label={item.name} checked={connectorId === item.id} disabled={item.implementation === 'unimplemented'} onChange={() => setConnectorId(item.id)} />
        </label>)}</div>
        {!creationConnectors.some(item => item.name.toLowerCase().includes(search.trim().toLowerCase())) && <p role="status">No connectors match your search.</p>}
      </> : connector && <>
        {connector.id === 'postgresql' && <><p>PostgreSQL credentials are configured by the operator through environment variables. This form cannot create a database connection.</p>
          <label>Configured source<select aria-label="Configured PostgreSQL source" value={selectedSource} onChange={event => setSelectedSource(event.target.value)}><option value="">Choose a source</option>{postgresSources.map(item => <option value={item.id} key={item.id}>{item.name ?? item.id}</option>)}</select></label>
          {catalog.loading ? <p role="status">Loading configured sources…</p> : catalog.error ? <p role="alert">{catalog.error}</p> : !postgresSources.length && <p role="status">No configured PostgreSQL sources. Needs hosted API and an operator-configured connection.</p>}</>}
        <ConnectorDetails key={connector.id} id={connector.id} client={client} local={access.mode === 'local'} onUploaded={onPrep} />
      </>}
      {!client && <p className="data-note">Static demo · Creating datasets needs a local or hosted API.</p>}
    </div>
    <footer>{stage !== 'dataset' && <button onClick={() => nextStage(stage === 'config' ? 'source' : 'dataset')}>Back</button>}<button onClick={onClose}>Cancel</button>
      {stage === 'dataset' && <button className="data-primary" disabled={!source} onClick={() => { if (source) onPrep(typeof source.ref === 'string' ? source.ref : source.id); }}>Select</button>}
      {stage === 'source' && <button className="data-primary" disabled={!connector || connector.implementation === 'unimplemented'} onClick={() => { if (connector && connector.implementation !== 'unimplemented') nextStage('config'); }}>Next</button>}
      {stage === 'config' && connector?.id === 'postgresql' && <button className="data-primary" disabled={!client || catalog.loading || !!catalog.error || !postgresSources.some(item => item.id === selectedSource)} onClick={() => { const item = postgresSources.find(item => item.id === selectedSource); if (client && !catalog.loading && !catalog.error && item) onPrep(typeof item.ref === 'string' ? item.ref : item.id); }}>Select</button>}
    </footer>
  </DataDialog>;
}
