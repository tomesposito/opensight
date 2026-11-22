import { useEffect, useState } from 'react';
import type { BundleDataSet } from '@opensight/bundle-parser';
import { ComputedTable, computedStateLabel } from './ComputedTable.js';
import { InputTablesPanel } from './InputTables.js';
import type { InputTableSummary } from './input-tables.js';
import { DataTable } from './DataSectionUI.js';
import { datasetSource, type DataCatalog, type DataCatalogClient } from './data-section.js';
import { prepMessage } from './data-prep.js';
/** Input tables are a local-store capability: a hosted API answers their list
 * route with 404 RESOURCE_NOT_FOUND (#307; older hosted builds used the generic
 * 503 HOSTED_CAPABILITY_UNAVAILABLE). Either code means "not available here",
 * never a page failure — computed tables must stay visible. Every other error
 * (authorization included) still fails the page. */
const inputTablesUnavailable = (e: unknown): boolean => {
  const code = e && typeof e === 'object' && 'errorCode' in e ? (e as { errorCode?: unknown }).errorCode : undefined;
  return code === 'RESOURCE_NOT_FOUND' || code === 'HOSTED_CAPABILITY_UNAVAILABLE';
};
const inputUnavailableNotice = <p role="note">Input tables are not available in this workspace — they need a local API. Computed tables are unaffected.</p>;
export function Tables({ client, catalog, loading, catalogError, onCreate, onEdit, onChanged }: {
  client?: DataCatalogClient; catalog: DataCatalog; loading: boolean; catalogError?: string;
  onCreate: () => void; onEdit: (dataset: BundleDataSet) => void; onChanged: () => void;
}) {
  const [inputs, setInputs] = useState<InputTableSummary[]>(), [error, setError] = useState('');
  const [inputsUnavailable, setInputsUnavailable] = useState(false);
  const [selected, setSelected] = useState<{ kind: 'computed' | 'input'; id: string }>();
  useEffect(() => {
    let active = true; setInputs(undefined); setError(''); setInputsUnavailable(false);
    if (!client?.listInputTables) { setInputs([]); return; }
    void client.listInputTables().then(value => { if (active) setInputs(value.tables); }).catch(e => {
      if (!active) return;
      if (inputTablesUnavailable(e)) { setInputs([]); setInputsUnavailable(true); } else setError(prepMessage(e));
    });
    return () => { active = false; };
  }, [client, selected?.id]);
  const computed = catalog.datasets.flatMap(dataset => {
    const status = datasetSource(dataset, catalog.sources)?.execution;
    return status?.mode === 'STORED' ? [{ dataset, status }] : [];
  });
  const opened = selected?.kind === 'computed' ? computed.find(row => row.dataset.dataSetId === selected.id) : undefined;
  if (selected?.kind === 'input') return <><button onClick={() => setSelected(undefined)}>‹ Tables</button><InputTablesPanel client={client} initialTableId={selected.id} /></>;
  if (opened) return <><div className="data-tools"><button onClick={() => setSelected(undefined)}>‹ Tables</button><button onClick={() => onEdit(opened.dataset)}>Edit pipeline</button></div><ComputedTable key={opened.dataset.dataSetId} client={client} datasetId={opened.dataset.dataSetId} name={opened.dataset.name} status={opened.status} onChanged={onChanged} /></>;
  if (catalogError || error) return <p role="alert">Could not load tables. {catalogError ?? error}</p>;
  if (loading || !inputs) return <p role="status">Loading tables…</p>;
  if (!computed.length && !inputs.length) return <div className="data-empty"><h2>No tables yet</h2><p>Create a computed table from a dataset pipeline.</p><button onClick={onCreate}>Create from a dataset</button>{!client && <p>Publishing tables needs a local or hosted API.</p>}{inputsUnavailable && inputUnavailableNotice}</div>;
  return <section aria-label="Tables"><DataTable headings={['Name', 'Kind', 'Rows', 'Size', 'Last refreshed / updated', 'State']}>
    {computed.map(({ dataset, status }) => <tr key={`computed-${dataset.dataSetId}`}><td><button className="data-name" onClick={() => setSelected({ kind: 'computed', id: dataset.dataSetId })}>{dataset.name}</button></td><td>computed</td><td>{status.rowCount ?? '—'}</td><td>{status.bytes ?? 0} bytes</td><td>{status.lastRefreshedAt ?? 'Never'}</td><td><span className={`computed-state ${status.state}`}>{computedStateLabel(status)}</span></td></tr>)}
    {inputs.map(table => <tr key={`input-${table.id}`}><td><button className="data-name" onClick={() => setSelected({ kind: 'input', id: table.id })}>{table.name}</button></td><td>input</td><td>{table.rowCount}</td><td>—</td><td>{table.updatedAt}</td><td>{table.canEdit ? 'Editable' : 'Read-only'}</td></tr>)}
  </DataTable>{inputsUnavailable && inputUnavailableNotice}<div className="data-tools"><button onClick={onCreate}>Create from a dataset</button></div></section>;
}
