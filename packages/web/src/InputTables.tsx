import { useEffect, useRef, useState } from 'react';
import type { createApiClient } from './api-client.js';
import type { InputAuditEntry, InputCellValue, InputColumn, InputColumnType, InputTableFull, InputTableSummary } from './input-tables.js';
import { DataTable } from './DataSectionUI.js';

export type InputTableClient = Partial<Pick<ReturnType<typeof createApiClient>,
  'listInputTables' | 'getInputTable' | 'createInputTable' | 'updateInputTable' | 'deleteInputTable'
  | 'setInputTableEditors' | 'addInputTableRow' | 'updateInputTableRow' | 'deleteInputTableRow' | 'getInputTableAudit'>>;

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const cellText = (value: InputCellValue): string => value === null ? '' : String(value);
function parseCell(column: InputColumn, raw: string): InputCellValue {
  if (column.type === 'number') return raw.trim() === '' ? null : Number(raw);
  if (column.type === 'boolean') return raw === '' ? null : raw === 'true';
  return raw === '' ? null : raw;
}
const draftsOf = (table: InputTableFull): Record<string, Record<string, string>> =>
  Object.fromEntries(table.rows.map(row => [row.id, Object.fromEntries(table.columns.map(c => [c.name, cellText(row.values[c.name] ?? null)]))]));

/** Governed input tables (issue #161): OpenSight-owned tables a workspace edits in place.
 * Source systems are never mutated; editing needs an editor grant plus an author-class role. */
export function InputTablesPanel({ client }: { client?: InputTableClient }) {
  const available = !!(client?.listInputTables && client.getInputTable && client.createInputTable && client.addInputTableRow && client.updateInputTableRow && client.deleteInputTableRow);
  const [tables, setTables] = useState<InputTableSummary[]>(), [table, setTable] = useState<InputTableFull>();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({}), [newRow, setNewRow] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<InputAuditEntry[]>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false), [revision, setRevision] = useState(0);
  const acting = useRef(false);
  useEffect(() => {
    if (!available) return;
    const abort = new AbortController(); setTables(undefined); setError('');
    void client!.listInputTables!().then(result => { if (!abort.signal.aborted) setTables(result.tables); })
      .catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [client, available, revision]);
  const action = async (work: () => Promise<void>) => {
    if (acting.current) return; acting.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(message(e)); } finally { acting.current = false; setBusy(false); }
  };
  const open = (id: string) => void action(async () => {
    const full = await client!.getInputTable!(id);
    setTable(full); setDrafts(draftsOf(full)); setNewRow({}); setAudit(undefined);
  });
  const reloadTable = async (id: string) => { const full = await client!.getInputTable!(id); setTable(full); setDrafts(draftsOf(full)); };
  if (!available) return <section className="data-card"><h2>Input tables</h2><p>Needs a local or hosted API. Input tables are governed, editable tables owned by OpenSight; this static demo has no input-table store.</p></section>;
  return <section className="input-tables" aria-label="Input tables">
    <div className="data-toolbar"><div><h2>Input tables</h2><p>Tables this workspace owns and edits in place. Connected sources are never changed. Every edit is recorded in the table's audit trail.</p></div>
      <button className="data-primary" disabled={busy} onClick={() => setCreating(current => !current)}>{creating ? 'Close' : 'Create input table'}</button></div>
    {error && <p role="alert">{error}</p>}
    {creating && <CreateInputTable busy={busy} onCreate={async (name, boundDatasetId, columns) => {
      await action(async () => { const created = await client!.createInputTable!({ name, boundDatasetId, columns }); setCreating(false); setRevision(n => n + 1); await open(created.id); });
    }} />}
    {!tables && !error && <p role="status">Loading input tables…</p>}
    {tables && <DataTable headings={['Name', 'Columns', 'Rows', 'Your access', 'Action']} empty={!tables.length ? 'No input tables yet. Create one to collect governed, editable data next to your datasets.' : undefined}>
      {tables.map(summary => <tr key={summary.id}>
        <td><button className="data-name" onClick={() => void open(summary.id)}>{summary.name}</button></td>
        <td>{summary.columnCount}</td><td>{summary.rowCount}</td>
        <td>{summary.canManage ? 'Owner / manager' : summary.canEdit ? 'Editor' : 'Read-only'}</td>
        <td>{summary.canManage && <button disabled={busy} onClick={() => void action(async () => { await client!.deleteInputTable!(summary.id); if (table?.id === summary.id) setTable(undefined); setRevision(n => n + 1); })}>Delete {summary.name}</button>}</td>
      </tr>)}
    </DataTable>}
    {table && <section aria-label={`Grid for ${table.name}`}>
      <h3>{table.name}</h3>
      {!table.canEdit && <p>Read-only: editing needs an editor grant from the table owner and an author-class role. Readers never write.</p>}
      <DataTable headings={[...table.columns.map(c => `${c.name} (${c.type}${c.required ? ', required' : ''})`), ...(table.canEdit ? ['Action'] : [])]}>
        {table.rows.map(row => <tr key={row.id}>
          {table.columns.map(column => <td key={column.name}>{table.canEdit
            ? column.type === 'boolean'
              ? <select aria-label={`${column.name} for row ${row.id}`} value={drafts[row.id]?.[column.name] ?? ''} onChange={event => setDrafts(current => ({ ...current, [row.id]: { ...current[row.id], [column.name]: event.target.value } }))}><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
              : <input aria-label={`${column.name} for row ${row.id}`} type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} value={drafts[row.id]?.[column.name] ?? ''} onChange={event => setDrafts(current => ({ ...current, [row.id]: { ...current[row.id], [column.name]: event.target.value } }))} />
            : cellText(row.values[column.name] ?? null) || '—'}</td>)}
          {table.canEdit && <td>
            <button disabled={busy} onClick={() => void action(async () => { await client!.updateInputTableRow!(table.id, row.id, Object.fromEntries(table.columns.map(c => [c.name, parseCell(c, drafts[row.id]?.[c.name] ?? '')]))); await reloadTable(table.id); setRevision(n => n + 1); })}>Save</button>
            <button disabled={busy} onClick={() => void action(async () => { await client!.deleteInputTableRow!(table.id, row.id); await reloadTable(table.id); setRevision(n => n + 1); })}>Delete row</button>
          </td>}
        </tr>)}
        {table.canEdit && <tr>
          {table.columns.map(column => <td key={column.name}>{column.type === 'boolean'
            ? <select aria-label={`New row ${column.name}`} value={newRow[column.name] ?? ''} onChange={event => setNewRow(current => ({ ...current, [column.name]: event.target.value }))}><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
            : <input aria-label={`New row ${column.name}`} type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} value={newRow[column.name] ?? ''} onChange={event => setNewRow(current => ({ ...current, [column.name]: event.target.value }))} />}</td>)}
          <td><button disabled={busy} onClick={() => void action(async () => { await client!.addInputTableRow!(table.id, Object.fromEntries(table.columns.map(c => [c.name, parseCell(c, newRow[c.name] ?? '')]))); setNewRow({}); await reloadTable(table.id); setRevision(n => n + 1); })}>Add row</button></td>
        </tr>}
      </DataTable>
      {table.canManage && client.setInputTableEditors && <EditorsControl table={table} busy={busy} onSave={async editors => { await action(async () => { const updated = await client.setInputTableEditors!(table.id, editors); setTable(updated); setDrafts(draftsOf(updated)); }); }} />}
      <button disabled={busy} onClick={() => void action(async () => { setAudit(audit ? undefined : (await client!.getInputTableAudit!(table.id)).entries); })}>{audit ? 'Hide audit trail' : 'Show audit trail'}</button>
      {audit && <DataTable headings={['When', 'Who', 'Change', 'Detail']} empty={!audit.length ? 'No changes recorded yet.' : undefined}>
        {audit.map(entry => <tr key={entry.id}><td>{entry.at}</td><td>{entry.actorId}</td><td>{entry.action}</td><td><code>{JSON.stringify(entry.detail).slice(0, 200)}</code></td></tr>)}
      </DataTable>}
    </section>}
    <button disabled={busy} onClick={() => setRevision(n => n + 1)}>Refresh input tables</button>
  </section>;
}

function EditorsControl({ table, busy, onSave }: { table: InputTableFull; busy: boolean; onSave: (editors: string[]) => Promise<void> }) {
  const [candidate, setCandidate] = useState('');
  return <div className="input-table-editors"><h4>Editors</h4>
    <p>Editors can change rows. Viewers stay read-only, and a reader-role user cannot edit even when listed here.</p>
    <ul>{table.editors.map(editor => <li key={editor}>{editor} <button disabled={busy} onClick={() => void onSave(table.editors.filter(e => e !== editor))}>Remove {editor}</button></li>)}</ul>
    <label>Workspace user id<input value={candidate} onChange={event => setCandidate(event.target.value)} /></label>
    <button disabled={busy || !candidate.trim()} onClick={() => { void onSave([...table.editors, candidate.trim()]); setCandidate(''); }}>Add editor</button>
  </div>;
}

function CreateInputTable({ busy, onCreate }: { busy: boolean; onCreate: (name: string, boundDatasetId: string | null, columns: InputColumn[]) => Promise<void> }) {
  const [name, setName] = useState(''), [bound, setBound] = useState('');
  const [columns, setColumns] = useState<InputColumn[]>([{ name: '', type: 'text', required: true }]);
  const setColumn = (index: number, patch: Partial<InputColumn>) => setColumns(current => current.map((c, i) => i === index ? { ...c, ...patch } : c));
  return <form className="input-table-create" onSubmit={event => { event.preventDefault(); void onCreate(name, bound.trim() ? bound.trim() : null, columns); }}>
    <h3>New input table</h3>
    <label>Table name<input value={name} onChange={event => setName(event.target.value)} required /></label>
    <label>Bound dataset id (optional)<input value={bound} onChange={event => setBound(event.target.value)} /></label>
    {columns.map((column, index) => <div key={index} className="input-table-column">
      <label>Column name<input value={column.name} onChange={event => setColumn(index, { name: event.target.value })} required /></label>
      <label>Type<select value={column.type} onChange={event => setColumn(index, { type: event.target.value as InputColumnType })}><option value="text">text</option><option value="number">number</option><option value="date">date</option><option value="boolean">boolean</option></select></label>
      <label>Required<input type="checkbox" checked={column.required} onChange={event => setColumn(index, { required: event.target.checked })} /></label>
      {columns.length > 1 && <button type="button" onClick={() => setColumns(current => current.filter((_, i) => i !== index))}>Remove column</button>}
    </div>)}
    <button type="button" disabled={columns.length >= 32} onClick={() => setColumns(current => [...current, { name: '', type: 'text', required: false }])}>Add column</button>
    <button type="submit" disabled={busy}>Create table</button>
    <p>Column types are fixed when the table is created in v1. Choose them before adding rows.</p>
  </form>;
}
