import { useEffect, useMemo, useRef, useState } from 'react';
import type { BundleDataSet } from '@opensight/bundle-parser';
import type { createApiClient } from './api-client.js';
import { useAccess } from './access.js';
import { browserDraftStorage, createDraftStore, draftStorageKey } from './local-drafts.js';
import { prepInputNodes, prepMessage, prepRefLabel } from './data-prep.js';
import { datasetBadges, datasetSource, objectValue, useDataCatalog, type DataCatalog } from './data-section.js';
import { DataDialog, DataMenu, DataTable, DataTabs } from './DataSectionUI.js';
import { DatasetRefresh } from './DatasetRefresh.js';
import { DatasetExecution } from './DatasetExecution.js';
import type { AuthorDataset } from './authoring.js';
import { AppLink, type Navigate } from './AppNavigation.js';

export type DatasetDetailClient = Pick<ReturnType<typeof createApiClient>, 'listPrepSources' | 'listPrepDatasets' | 'savePrep' | 'deletePrep' | 'getDatasetExecution' | 'setDatasetExecution' | 'refreshBlaze' | 'getPreparedRows'>;
export function DatasetDetail({ datasetId, client, navigate, onGenerate }: { datasetId: string; client?: DatasetDetailClient; navigate: Navigate; onGenerate: (dataset: AuthorDataset) => void }) {
  const catalog = useDataCatalog(client);
  const dataset = catalog.data?.datasets.find(dataset => dataset.dataSetId === datasetId);
  if (!dataset || !catalog.data) return <section className="data-page"><AppLink to={{ page: 'data' }} navigate={navigate}>‹ Datasets</AppLink>
    {catalog.loading ? <p role="status">Loading dataset…</p> : <p role="alert">{catalog.error ?? (!client ? 'Needs local or hosted API · Saved datasets are unavailable in the static demo.' : 'PREP_NOT_FOUND: This dataset is unavailable or was deleted.')}</p>}
    {client && <button onClick={catalog.reload}>Retry</button>}</section>;
  return <DatasetDetailContent key={dataset.dataSetId} dataset={dataset} data={catalog.data} client={client} navigate={navigate} onGenerate={onGenerate} onChanged={catalog.reload} />;
}
function DatasetDetailContent({ dataset, data, client, navigate, onGenerate, onChanged }: { onChanged: () => void; dataset: BundleDataSet; data: DataCatalog; client?: DatasetDetailClient; navigate: Navigate; onGenerate: (dataset: AuthorDataset) => void }) {
  const access = useAccess();
  const [tab, setTab] = useState<'Summary' | 'Refresh' | 'Permissions' | 'Usage'>('Summary');
  const [query, setQuery] = useState(''), [dialog, setDialog] = useState<'duplicate' | 'delete'>(), [name, setName] = useState(`${dataset.name} copy`);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const acting = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const source = datasetSource(dataset, data.sources), columns = source?.columns ?? [];
  const matches = columns.filter(column => column.name.toLowerCase().includes(query.trim().toLowerCase()));
  const usage = useMemo(() => {
    try {
      const store = createDraftStore(browserDraftStorage, access);
      const entries = store.list();
      if (entries.some(entry => entry.problem)) throw new Error('Some saved analyses cannot be read. Usage counts are unavailable.');
      return { analyses: entries.filter(entry => store.peek(entry.id).dataset?.id === dataset.dataSetId) };
    } catch (error) { return { analyses: [], error: prepMessage(error) }; }
  }, [dataset.dataSetId, draftStorageKey(access)]);
  const dependents = data.datasets.filter(item => item.opensightPrep && prepInputNodes(item.opensightPrep).some(node => typeof node.ref === 'object' && node.ref.dataset === dataset.dataSetId));
  const sourceNames = dataset.opensightPrep ? prepInputNodes(dataset.opensightPrep).map(node => {
    const ref = node.ref;
    return data.sources.find(item => JSON.stringify(item.ref ?? item.id) === JSON.stringify(ref))?.name ?? prepRefLabel(ref);
  }) : Object.values(dataset.physicalTableMap).map(table => table.relationalTable?.name).filter((name): name is string => !!name);
  const permissionNote = 'Needs hosted API support for dataset sharing. Access changes are unavailable here.';
  const generate = () => {
    if (!source?.available) return;
    try { onGenerate({ id: dataset.dataSetId, name: dataset.name, columns }); } catch (error) { setError(prepMessage(error)); }
  };
  const mutate = async () => {
    if (!client || acting.current || !dialog) return;
    if (dialog === 'duplicate' && (!name.trim() || !dataset.opensightPrep || name.trim().length > 128 || !!objectValue(dataset.rowLevelPermissionDataSet) || dataset.useAs === 'RLS_RULES' || dataset.columnLevelPermissionRules)) return;
    acting.current = true; setBusy(true); setError('');
    try {
      if (dialog === 'delete') { await client.deletePrep(dataset.dataSetId); if (mounted.current) navigate({ page: 'data' }); }
      else { const result = await client.savePrep(`prepared-${globalThis.crypto.randomUUID()}`, name.trim(), structuredClone(dataset.opensightPrep!)); if (mounted.current) navigate({ page: 'data', datasetId: result.resource.dataSetId }); }
      setDialog(undefined);
    } catch (error) { setError(prepMessage(error)); }
    finally { acting.current = false; setBusy(false); }
  };
  const protectedDataset = !!objectValue(dataset.rowLevelPermissionDataSet) || dataset.useAs === 'RLS_RULES' || !!dataset.columnLevelPermissionRules;
  return <section className="data-page data-detail" aria-labelledby="dataset-title">
    <nav className="data-breadcrumb" aria-label="Dataset breadcrumb"><AppLink to={{ page: 'data' }} navigate={navigate}>Datasets</AppLink><span aria-hidden="true">›</span><span>{dataset.name}</span></nav>
    <AppLink to={{ page: 'data' }} navigate={navigate}>‹ Datasets</AppLink>
    <div className="data-detail-heading"><h1 id="dataset-title">{dataset.name}</h1><div className="data-detail-actions"><div className="data-split"><button disabled={!source?.available} onClick={generate}>Generate analysis</button><DataMenu label="More analysis options"><button disabled={!source?.available} onClick={generate}>Create analysis</button></DataMenu></div>
      <button className="data-primary" disabled={!client || !dataset.opensightPrep} onClick={() => navigate({ page: 'data-prep', datasetId: dataset.dataSetId })}>Edit dataset</button>
      <DataMenu label="Dataset actions"><button disabled={!source?.available} onClick={() => { if (source?.available) navigate({ page: 'data-prep', baseDatasetId: dataset.dataSetId }); }}>Use in new dataset</button><button disabled={!client || !dataset.opensightPrep || protectedDataset} title={protectedDataset ? 'Protected datasets cannot be duplicated without their security policies.' : undefined} onClick={() => { setName(`${dataset.name} copy`); setError(''); setDialog('duplicate'); }}>Duplicate</button><button disabled title="Needs hosted API support for assigning prepared datasets to folders">Add to folder</button><button disabled={!client} onClick={() => { setError(''); setDialog('delete'); }}>Delete</button></DataMenu>
    </div></div>
    {!source?.available && <p role="alert">{source?.errorCode ?? 'DATASET_UNAVAILABLE'} · This dataset cannot be used for analysis until its sources and cached output are available.</p>}
    {error && !dialog && <p role="alert">{error}</p>}
    <DataTabs label="Dataset details" tabs={['Summary', 'Refresh', 'Permissions', 'Usage']} selected={tab} select={setTab} />
    <section role="tabpanel" aria-label={tab}>
    {tab === 'Summary' && <div className="data-summary"><section className="data-card"><h2>Columns ({columns.length})</h2><div className="data-tools"><input aria-label="Search columns" type="search" placeholder="Search columns" value={query} onChange={event => setQuery(event.target.value)} /></div><DataTable headings={['Name', 'Type', 'Description']} empty={!matches.length ? source?.available ? 'No columns match your search.' : 'Columns unavailable. Resolve the dataset error to load its schema.' : undefined}>
      {matches.map(column => <tr key={column.name}><td>{column.name}</td><td>{column.type}</td><td>{typeof objectValue(column)?.description === 'string' ? String(objectValue(column)?.description) : '—'}</td></tr>)}
    </DataTable></section><aside className="data-summary-cards" aria-label="Dataset information">
      <section className="data-card"><h2>About</h2><span className="data-badge">{source?.execution?.mode === 'BLAZE' ? 'BLAZE · Cached' : source?.execution?.mode === 'DIRECT_QUERY' ? 'Direct query' : 'Storage unavailable'}</span><p>Size: {source?.execution?.mode === 'BLAZE' ? `${source.execution.bytes.toLocaleString()} bytes` : 'Not available'}</p>
        <details><summary>Storage settings</summary><DatasetExecution client={client} datasetId={dataset.dataSetId} compact onChanged={onChanged} /></details></section>
      <section className="data-card"><h2>Refresh</h2><p>{source?.execution ? source.execution.mode === 'DIRECT_QUERY' ? 'Live queries · No cached refresh' : source.execution.state : 'Status unavailable'}</p>{source?.execution?.rowCount !== null && source?.execution?.rowCount !== undefined && <p>{source.execution.rowCount.toLocaleString()} rows imported</p>}<p>{source?.execution?.lastRefreshedAt ? <time dateTime={source.execution.lastRefreshedAt}>{source.execution.lastRefreshedAt}</time> : 'No successful refresh reported'}</p><button onClick={() => setTab('Refresh')}>View refresh</button></section>
      <section className="data-card"><h2>Access</h2><p>Row-level security: {objectValue(dataset.rowLevelPermissionDataSet) ? datasetBadges(dataset).includes('RLS enabled') ? 'Enabled' : 'Disabled' : 'Not configured'} <button onClick={() => navigate({ page: 'security' })}>Set up row-level security</button></p><p>Column-level security: {Array.isArray(dataset.columnLevelPermissionRules) && dataset.columnLevelPermissionRules.length ? 'Configured' : 'Not configured'} <button onClick={() => navigate({ page: 'security' })}>Set up column-level security</button></p><small>Security setup requires operator-managed policies.</small></section>
      <section className="data-card"><h2>Sources</h2>{sourceNames.length ? <ul>{[...new Set(sourceNames)].map(name => <li key={name}>{name}</li>)}</ul> : <p>Source details unavailable.</p>}</section>
      <section className="data-card"><h2>Usage</h2><p>Analyses on this device: {usage.error ? 'Unavailable' : usage.analyses.length}</p><p>Dashboards: Not available</p><p>Datasets in this catalog: {dependents.length}</p><button onClick={() => setTab('Usage')}>View usage</button></section>
    </aside></div>}
    {tab === 'Refresh' && <DatasetRefresh client={client} datasetId={dataset.dataSetId} />}
    {tab === 'Permissions' && <section className="data-card"><div className="data-toolbar"><div><h2>Manage dataset permissions</h2><p>{permissionNote}</p></div><button disabled title={permissionNote}>Add users &amp; groups</button></div>
      <DataTable headings={['Username/Group name', 'Permissions', 'Actions']} empty={access.mode !== 'hosted' || !access.session ? 'Local datasets have no user or group grants. This workspace is shared by its users.' : undefined}>
        {access.mode === 'hosted' && access.session && <tr><td>{access.session.name}</td><td><select aria-label={`Permissions for ${access.session.name}`} value="Owner" disabled title={permissionNote}><option>Owner</option><option>Viewer</option></select></td><td><button disabled title="The dataset owner cannot revoke their own access">Revoke access</button></td></tr>}
      </DataTable><p className="data-note">The dataset API lists only datasets owned by the current principal. It does not expose shared grants.</p>
    </section>}
    {tab === 'Usage' && <section className="data-card"><h2>Dataset usage</h2><p>Saved analyses on this device and dependent datasets in this catalog. Hosted analysis and dashboard usage needs a hosted usage API.</p>{usage.error && <p role="alert">{usage.error}</p>}
      <DataTable headings={['Name', 'Type', 'Users', 'Actions']} empty={!usage.analyses.length && !dependents.length ? 'No linked resources found in this catalog or on this device.' : undefined}>
        {usage.analyses.map(entry => <tr key={entry.id}><td><AppLink to={{ page: 'author', draftId: entry.id }} navigate={navigate}>{entry.name}</AppLink></td><td>Analysis · This device</td><td>Not available</td><td><button disabled title={permissionNote}>Revoke access</button></td></tr>)}
        {dependents.map(item => <tr key={item.dataSetId}><td><AppLink to={{ page: 'data', datasetId: item.dataSetId }} navigate={navigate}>{item.name}</AppLink></td><td>Dataset</td><td>Not available</td><td><button disabled title={permissionNote}>Revoke access</button></td></tr>)}
      </DataTable>
    </section>}
    </section>
    {dialog && <DataDialog title={dialog === 'delete' ? 'Delete dataset' : 'Duplicate dataset'} onClose={() => { if (!busy) setDialog(undefined); }}><form onSubmit={event => { event.preventDefault(); void mutate(); }}><div className="data-dialog-body">
      {dialog === 'delete' ? <p>Delete “{dataset.name}”? Its saved pipeline and cached output will be removed. Analyses using it will no longer load its data.</p> : <><label>Dataset name<input aria-label="Dataset name" value={name} required maxLength={128} disabled={busy} onChange={event => setName(event.target.value)} /></label><p>The copy gets a separate pipeline. Source data stays shared; cache settings and refresh schedules are not copied.</p></>}{error && <p role="alert">{error}</p>}
    </div><footer><button type="button" disabled={busy} onClick={() => setDialog(undefined)}>Cancel</button><button type="submit" className="data-primary" disabled={busy || (dialog === 'duplicate' && (!name.trim() || name.trim().length > 128 || protectedDataset))}>{busy ? 'Working…' : dialog === 'delete' ? 'Delete dataset' : 'Duplicate dataset'}</button></footer></form></DataDialog>}
  </section>;
}
