import { useEffect, useState } from 'react';
import { connectors, connectorDefinition, connectorState, validateConnectorConfig, type ConnectorState } from '@opensight/query-engine/browser';
import type { createApiClient } from './api-client.js';
import type { UploadSummary } from '@opensight/query-engine';

type Client = Pick<ReturnType<typeof createApiClient>, 'uploadFile' | 'validateConnector' | 'listPrepSources'>;
export function DataSources({ client, local = false, onPrep }: { client?: Client; local?: boolean; onPrep?: (source?: string) => void }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('file');
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [discovery, setDiscovery] = useState<{ client: Client; source?: string; error?: string }>();
  useEffect(() => {
    setDiscovery(undefined);
    if (!client || local) return;
    let active = true;
    void client.listPrepSources().then(sources => {
      // An API client alone is not proof of a usable hosted connection.
      const source = sources.find(s => s.connectorId === 'postgresql' && s.available && (!s.ref || typeof s.ref === 'string'));
      if (active) setDiscovery({ client, source: source?.id });
    }).catch(error => {
      if (active) setDiscovery({ client, error: error instanceof Error ? error.message : 'Source discovery failed' });
    });
    return () => { active = false; };
  }, [client, local]);
  const postgresSource = !local && discovery?.client === client && onPrep ? discovery?.source : undefined;
  const usable = (id: string) => id === 'file' || (id === 'postgresql' && !!postgresSource);
  const current = usable(selected) || showUnavailable ? selected : 'file';
  const matches = connectors.filter(c => `${c.name} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
  const available = matches.filter(c => usable(c.id)), unavailable = matches.filter(c => !usable(c.id));
  const cards = (items: typeof connectors) => <div className="connector-grid">{items.map(c => <button type="button" key={c.id} className={`connector-card${c.id === 'file' ? ' connector-featured' : ''}${current === c.id ? ' selected' : ''}`} aria-pressed={current === c.id} onClick={() => setSelected(c.id)}>
    <span className={`connector-symbol category-${c.category.toLowerCase()}`} aria-hidden="true">{c.category === 'File' ? '↑' : c.category === 'AWS' ? '☁' : c.category === 'SaaS' ? '◇' : '▤'}</span>
    <span className="connector-name">{c.name}</span><span className="connector-category">{c.id === 'file' ? 'CSV, TSV, JSON and Excel' : c.category}</span>
    {c.id === 'file' && <span className="connector-description">{client ? 'Upload now, prepare your data, then build a chart.' : 'Explore the file setup. Uploads are unavailable in the static demo.'}</span>}
    <span className="connector-state">{c.id === 'file' && client ? 'Upload available' : c.id === 'postgresql' && postgresSource ? 'Needs setup' : connectorState(c.id, !!client).message}</span>
  </button>)}</div>;
  return <section className="data-sources" aria-labelledby="data-sources-title">
    <div className="data-sources-heading"><div><p className="eyebrow">DATA SOURCES</p><h1 id="data-sources-title">Create a data set</h1><p>{client ? 'Start with a file: upload → prepare → build a chart.' : 'Explore file setup, then run a local or hosted API to upload your data.'}</p></div>{onPrep && <button onClick={() => onPrep()}>Prepare data</button>}</div>
    {!client && <p className="connector-demo-notice">Static demo · Uploads are unavailable in the static demo. Run a local or hosted API to upload a file. No data is uploaded or connections made here.</p>}
    <div className="connector-layout"><div className="connector-picker"><label className="connector-search">Find a data source<input type="search" value={search} placeholder="Search data sources" onChange={e => setSearch(e.target.value)} /></label>
      {cards(available)}
      <label className="connector-toggle"><input type="checkbox" checked={showUnavailable} onChange={e => { setShowUnavailable(e.target.checked); if (!e.target.checked && !usable(selected)) setSelected('file'); }} />Show unavailable connectors</label>
      {showUnavailable && <section className="connector-unavailable" aria-labelledby="unavailable-connectors-title"><h2 id="unavailable-connectors-title">Not yet available</h2><p>These sources cannot be connected from this gallery. Select one to see what is missing.</p>{!local && discovery?.client === client && discovery?.error && <p role="status">Could not check configured connections: {discovery.error}</p>}{cards(unavailable)}</section>}
      {available.length === 0 && (!showUnavailable || unavailable.length === 0) && <p role="status">No data sources match your search.{!showUnavailable && ' Turn on Show unavailable connectors to search the full catalog.'}</p>}</div>
      <ConnectorDetails key={`${current}-${!!client}-${local}-${current === 'postgresql' ? postgresSource ?? '' : ''}`} id={current} client={client} local={local} postgresSource={postgresSource} onPrep={onPrep} />
    </div>
  </section>;
}
export function ConnectorDetails({ id, client, local, postgresSource, onPrep, onUploaded }: { id: string; client?: Client; local: boolean; postgresSource?: string; onPrep?: (source?: string) => void; onUploaded?: (source: string) => void }) {
  const connector = connectorDefinition(id), fileSource = id === 'file';
  const enabled = !!client && fileSource;
  const [config, setConfig] = useState<Record<string, string>>(fileSource ? { format: 'csv' } : {});
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const availability = (): ConnectorState => id === 'postgresql' && postgresSource ? { state: 'not_configured', message: 'Needs setup · Prepare an operator-configured connection.' } : connectorState(id, !!client);
  const [status, setStatus] = useState<ConnectorState>(availability);
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<UploadSummary>();
  const update = (key: string, value: string) => { setError(''); setUpload(undefined); setStatus(availability()); setConfig(current => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; if (key === 'format') { delete next.delimiter; delete next.sheet; } return next; }); };
  const submit = async () => {
    if (!client || !enabled || busy) return;
    setBusy(true); setError(''); setUpload(undefined);
    try {
      const validated = validateConnectorConfig(id, config);
      if (fileSource) {
        if (!file) throw new Error('Choose a file to upload.');
        const limit = local ? 8 * 1024 * 1024 : 640 * 1024;
        if (file.size > limit) throw new Error(`This upload form accepts files up to ${local ? '8 MiB' : '640 KiB'}.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const chunks: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
        const binary = chunks.join('');
        const uploaded = await client.uploadFile({ config: validated, base64: btoa(binary) });
        setUpload(uploaded); onUploaded?.(uploaded.id);
      } else setStatus(await client.validateConnector(id, validated));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to process the source.'); }
    finally { setBusy(false); }
  };
  return <aside className="connector-details" aria-label={`${connector.name} setup`}><p className="eyebrow">SOURCE DETAILS</p><h2>{connector.name}</h2><p className="connector-availability" role="status">{status.message}</p>
    <p>{fileSource ? 'CSV, TSV, JSON, XLS and XLSX. The API validates every row and reports the staged schema and row count.' : id === 'postgresql' ? local ? 'PostgreSQL requires an operator-provisioned hosted source. Connection setup is unavailable in this local workspace.' : 'A hosted operator must provision the source and its credentials. This gallery cannot create a connection.' : 'Configuration is documented for future connection support. This connector has no product API connection path.'}</p>
    {id === 'postgresql' && postgresSource && onPrep && <button onClick={() => onPrep(postgresSource)}>Prepare PostgreSQL data</button>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {fileSource && <label>File<input type="file" accept=".csv,.tsv,.json,.xls,.xlsx" disabled={!enabled || busy} onChange={e => { const next = e.target.files?.[0]; setFile(next); setUpload(undefined); setError(''); if (next) { const format = next.name.split('.').at(-1)?.toLowerCase(); if (format && ['csv', 'tsv', 'json', 'xls', 'xlsx'].includes(format)) setConfig({ format }); } }} /></label>}
      {Object.entries(connector.schema).filter(([key]) => key !== 'delimiter' || ['csv', 'tsv'].includes(config.format ?? '')).filter(([key]) => key !== 'sheet' || ['xls', 'xlsx'].includes(config.format ?? '')).map(([key, field]) => <label key={key}>{field.label}{field.required ? ' *' : ' (optional)'}{field.kind === 'choice' ? <select value={config[key] ?? ''} disabled={!enabled || busy} required={field.required} onChange={e => update(key, e.target.value)}>{!field.required && <option value="">Automatic</option>}{field.values.map(v => <option key={v} value={v}>{v === '\t' ? 'Tab' : v === ',' ? 'Comma' : v === ';' ? 'Semicolon' : v === '|' ? 'Pipe' : v.toUpperCase()}</option>)}</select> : <input value={config[key] ?? ''} disabled={!enabled || busy} required={field.required} maxLength={256} placeholder={field.kind === 'environment' ? `OPENSIGHT_${key.replace(/Env$/, '').toUpperCase()}` : 'Worksheet name'} onChange={e => update(key, e.target.value)} />}</label>)}
      <button className="connector-submit" type="submit" disabled={!enabled || busy}>{busy ? 'Processing…' : fileSource ? 'Upload to staging' : 'Validate configuration'}</button>
    </form>
    {error && <p className="connector-error" role="alert">{error}</p>}
    {upload && <div className="upload-result" role="status"><h3>Upload staged</h3><p>{upload.rowCount.toLocaleString()} rows · {upload.columns.length} columns</p><table><thead><tr><th>Column</th><th>Type</th></tr></thead><tbody>{upload.columns.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.type}</td></tr>)}</tbody></table><p>{local ? 'Local staging on this computer.' : 'Private staging for this session.'} Use Data preparation to transform this upload.</p>{upload.expiresAt && <p>Local-only · Expires <time dateTime={upload.expiresAt}>{upload.expiresAt}</time>. Survives API restarts.</p>}{onPrep && <button onClick={() => onPrep(upload.id)}>Prepare this upload</button>}</div>}
    {fileSource && client && <p className="connector-help">{local ? 'Local form limit: 8 MiB. Files stay on this computer, survive API restarts and expire after 24 hours. This local workspace is shared by its users.' : 'Hosted form limit: 640 KiB. Staging is private to your user and namespace and is cleared when the API restarts.'}</p>}
  </aside>;
}
