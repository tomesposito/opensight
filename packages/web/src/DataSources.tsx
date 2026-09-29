import { useState } from 'react';
import { connectors, connectorDefinition, connectorState, validateConnectorConfig, type ConnectorState } from '@opensight/query-engine/browser';
import type { createApiClient } from './api-client.js';
import type { UploadSummary } from '@opensight/query-engine';

type Client = Pick<ReturnType<typeof createApiClient>, 'uploadFile' | 'validateConnector'>;
export function DataSources({ client, onPrep }: { client?: Client; onPrep?: () => void }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('file');
  const visible = connectors.filter(c => `${c.name} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="data-sources" aria-labelledby="data-sources-title">
    <div className="data-sources-heading"><div><p className="eyebrow">DATA SOURCES</p><h1 id="data-sources-title">Create a data set</h1><p>Choose a source to explore its setup and availability.</p></div>{onPrep && <button onClick={onPrep}>Prepare data</button>}<span className="connector-count">{connectors.length} connectors</span></div>
    {!client && <p className="connector-demo-notice">Static demo · File uploads and credentialed connections need a hosted API. No data is uploaded or connections made here.</p>}
    <div className="connector-layout"><div className="connector-picker"><label className="connector-search">Find a data source<input type="search" value={search} placeholder="Search files, databases, AWS or SaaS" onChange={e => setSearch(e.target.value)} /></label>
      <div className="connector-grid">{visible.map(c => <button type="button" key={c.id} className={`connector-card${selected === c.id ? ' selected' : ''}`} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)}>
        <span className={`connector-symbol category-${c.category.toLowerCase()}`} aria-hidden="true">{c.category === 'File' ? '↑' : c.category === 'AWS' ? '☁' : c.category === 'SaaS' ? '◇' : '▤'}</span>
        <span className="connector-name">{c.name}</span><span className="connector-category">{c.category}</span><span className="connector-state">{c.implementation === 'upload' && client ? 'Upload available' : c.implementation === 'unimplemented' ? 'Not yet implemented' : 'Needs hosted API / not configured'}</span>
      </button>)}</div>{visible.length === 0 && <p role="status">No data sources match your search.</p>}</div>
      <ConnectorDetails key={selected} id={selected} client={client} />
    </div>
  </section>;
}
function ConnectorDetails({ id, client }: { id: string; client?: Client }) {
  const connector = connectorDefinition(id), fileSource = id === 'file';
  const [config, setConfig] = useState<Record<string, string>>(fileSource ? { format: 'csv' } : {});
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ConnectorState>(() => connectorState(id, !!client));
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<UploadSummary>();
  const update = (key: string, value: string) => { setError(''); setUpload(undefined); setStatus(connectorState(id, !!client)); setConfig(current => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; if (key === 'format') { delete next.delimiter; delete next.sheet; } return next; }); };
  const submit = async () => {
    if (!client || busy) return;
    setBusy(true); setError(''); setUpload(undefined);
    try {
      const validated = validateConnectorConfig(id, config);
      if (fileSource) {
        if (!file) throw new Error('Choose a file to upload.');
        // Base64 and JSON overhead must fit the API's 1 MiB envelope.
        if (file.size > 640 * 1024) throw new Error('This upload form accepts files up to 640 KiB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        setUpload(await client.uploadFile({ config: validated, base64: btoa(binary) }));
      } else setStatus(await client.validateConnector(id, validated));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to process the source.'); }
    finally { setBusy(false); }
  };
  return <aside className="connector-details" aria-label={`${connector.name} setup`}><p className="eyebrow">SOURCE DETAILS</p><h2>{connector.name}</h2><p className="connector-availability" role="status">{status.message}</p>
    <p>{fileSource ? 'CSV, TSV, JSON, XLS and XLSX. The hosted API validates every row and reports the staged schema and row count.' : connector.implementation === 'unimplemented' ? 'Configuration is documented for future connection support.' : 'Connection settings are configured through server environment variables. Validation does not establish a connection.'}</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {fileSource && <label>File<input type="file" accept=".csv,.tsv,.json,.xls,.xlsx" disabled={!client || busy} onChange={e => { const next = e.target.files?.[0]; setFile(next); setUpload(undefined); setError(''); if (next) { const format = next.name.split('.').at(-1)?.toLowerCase(); if (format && ['csv', 'tsv', 'json', 'xls', 'xlsx'].includes(format)) setConfig({ format }); } }} /></label>}
      {Object.entries(connector.schema).filter(([key]) => key !== 'delimiter' || ['csv', 'tsv'].includes(config.format ?? '')).filter(([key]) => key !== 'sheet' || ['xls', 'xlsx'].includes(config.format ?? '')).map(([key, field]) => <label key={key}>{field.label}{field.required ? ' *' : ' (optional)'}{field.kind === 'choice' ? <select value={config[key] ?? ''} disabled={!client || busy} required={field.required} onChange={e => update(key, e.target.value)}>{!field.required && <option value="">Automatic</option>}{field.values.map(v => <option key={v} value={v}>{v === '\t' ? 'Tab' : v === ',' ? 'Comma' : v === ';' ? 'Semicolon' : v === '|' ? 'Pipe' : v.toUpperCase()}</option>)}</select> : <input value={config[key] ?? ''} disabled={!client || busy} required={field.required} maxLength={256} placeholder={field.kind === 'environment' ? `OPENSIGHT_${key.replace(/Env$/, '').toUpperCase()}` : 'Worksheet name'} onChange={e => update(key, e.target.value)} />}</label>)}
      <button className="connector-submit" type="submit" disabled={!client || busy}>{busy ? 'Processing…' : fileSource ? 'Upload to staging' : 'Validate configuration'}</button>
    </form>
    {error && <p className="connector-error" role="alert">{error}</p>}
    {upload && <div className="upload-result" role="status"><h3>Upload staged</h3><p>{upload.rowCount.toLocaleString()} rows · {upload.columns.length} columns</p><table><thead><tr><th>Column</th><th>Type</th></tr></thead><tbody>{upload.columns.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.type}</td></tr>)}</tbody></table><p>Private staging for this session. Use Data preparation to transform this upload. Analysis publication is not yet available.</p></div>}
    {fileSource && <p className="connector-help">Hosted form limit: 640 KiB. Staging is private to your user and namespace and is cleared when the API restarts.</p>}
  </aside>;
}
