import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { DataLanding } from '../build/test/DataLanding.js';
import { ComputedTable } from '../build/test/ComputedTable.js';
import { AccessProvider } from '../build/test/access.js';
import { createApiClient } from '../build/test/api-client.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const status = { mode: 'STORED', intervalMinutes: null, state: 'current', lastRefreshedAt: '2026-11-17T00:00:00.000Z', rowCount: 240, bytes: 1024, nextRefreshAt: null, error: null };
const dataset = (id, name) => ({ resourceType: 'dataset', dataSetId: id, name, importMode: 'DIRECT_QUERY', physicalTableMap: {}, opensightPrep: { version: 1, input: 'source', steps: [] } });
const button = (ui, label) => ui.root.findAllByType('button').find(node => node.children.join('') === label);
async function mount(t, element) { let ui; await act(async () => { ui = create(element); }); t.after(() => act(() => ui.unmount())); return ui; }
const landing = props => createElement(AccessProvider, { access: { mode: 'local' } }, createElement(DataLanding, { onCreate() {}, onCreateSource() {}, onOpen() {}, onEdit() {}, onPrep() {}, ...props }));
test('Tables renders both kinds, all computed states and opens stored rows through their API', async t => {
  const datasets = [dataset('current', 'Current table'), dataset('stale', 'Stale table'), dataset('refresh-failed', 'Failed table')], reads = [];
  const client = {
    listPrepDatasets: async () => ({ datasets, persistence: 'file' }),
    listPrepSources: async () => datasets.map(d => ({ id: d.dataSetId, ref: { dataset: d.dataSetId }, columns: [{ name: 'amount', type: 'INTEGER' }], available: true, execution: { ...status, state: d.dataSetId } })),
    listInputTables: async () => ({ tables: [{ id: 'input', name: 'Forecast input', rowCount: 4, updatedAt: '2026-11-16', canEdit: true }] }),
    getPreparedRows: async id => { reads.push(id); return { columns: [{ name: 'amount', type: 'INTEGER' }], rows: [{ amount: 41 }], rowCount: 240, truncated: true }; },
  };
  const ui = await mount(t, landing({ client })); await act(async () => button(ui, 'Tables').props.onClick());
  const body = JSON.stringify(ui.toJSON()); for (const label of ['computed', 'input', 'current', 'stale', 'refresh failed', 'Forecast input']) assert.ok(body.includes(label), label);
  await act(async () => button(ui, 'Stale table').props.onClick());
  assert.deepEqual(reads, ['stale']); assert.match(JSON.stringify(ui.toJSON()), /Stored rows remain available/); assert.match(JSON.stringify(ui.toJSON()), /41/);
});
test('Tables empty state has one creation action and no sample or staged table', async t => {
  let created = 0; const ui = await mount(t, landing({ onCreate: () => created++ }));
  await act(async () => button(ui, 'Tables').props.onClick());
  const panel = ui.root.findByProps({ role: 'tabpanel', 'aria-label': 'Tables' });
  assert.deepEqual(panel.findAllByType('button').map(node => node.children.join('')), ['Create from a dataset']);
  await act(async () => button(ui, 'Create from a dataset').props.onClick()); assert.equal(created, 1);
  assert.doesNotMatch(JSON.stringify(ui.toJSON()), /demo-sales|Forecast|Sample table/);
});
test('computed header hides downloads when workspace disables them and shows named failure/time', async t => {
  const ui = await mount(t, createElement(ComputedTable, { datasetId: 'computed', name: 'Computed', compact: true,
    status: { ...status, downloadsEnabled: false, state: 'refresh-failed', failedAt: '2026-11-17T01:00:00.000Z', error: { code: 'PREP_SCHEMA_MISMATCH', message: 'Expected column amount' } },
    client: { downloadStoredTable: async () => new Blob(), refreshBlaze: async () => status } }));
  assert.equal(ui.root.findAllByType('button').filter(node => node.children.join('').includes('Download')).length, 0);
  const body = JSON.stringify(ui.toJSON()); assert.match(body, /PREP_SCHEMA_MISMATCH/); assert.match(body, /2026-11-17T01:00:00.000Z/); assert.ok(button(ui, 'Refresh'));
});
test('first publish updates the computed header to Refresh and download actions', async t => {
  let publishes = 0;
  const ui = await mount(t, createElement(ComputedTable, { datasetId: 'computed', name: 'Computed', compact: true,
    status: { ...status, state: 'empty', lastRefreshedAt: null, rowCount: null, bytes: 0 },
    client: { publishStoredTable: async () => { publishes++; return status; }, refreshBlaze: async () => status, downloadStoredTable: async () => new Blob() } }));
  await act(async () => button(ui, 'Publish').props.onClick()); assert.equal(publishes, 1);
  assert.ok(button(ui, 'Refresh')); assert.ok(button(ui, 'Download CSV')); assert.ok(button(ui, 'Download XLSX')); assert.equal(button(ui, 'Publish'), undefined);
});
test('API client downloads binary bytes and keeps named download errors', async () => {
  const calls = [], client = createApiClient('http://localhost', async (url, options) => { calls.push([url, options]); return new Response('id,amount\r\n1,2\r\n', { headers: { 'Content-Type': 'text/csv' } }); });
  assert.equal(await (await client.downloadStoredTable('computed', 'csv')).text(), 'id,amount\r\n1,2\r\n');
  assert.equal(calls[0][0], 'http://localhost/api/datasets/computed/download'); assert.deepEqual(JSON.parse(calls[0][1].body), { format: 'csv' });
  const denied = createApiClient('http://localhost', async () => Response.json({ errorCode: 'DOWNLOADS_DISABLED' }, { status: 403 }));
  await assert.rejects(denied.downloadStoredTable('computed', 'xlsx'), error => error.errorCode === 'DOWNLOADS_DISABLED');
});
