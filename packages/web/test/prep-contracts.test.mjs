import test from 'node:test';
import assert from 'node:assert/strict';
import { prepSources } from '../build/test/prep-contracts.js';

const resource = (id, name) => ({ resourceType: 'dataset', dataSetId: id, name, physicalTableMap: {}, importMode: 'DIRECT_QUERY',
  opensightPrep: { version: 1, input: 'upload-1', steps: [] } });
const saved = {
  datasets: [{ resource: resource('ds-1', 'Current'), version: 2, execution: { mode: 'DIRECT_QUERY', intervalMinutes: null } }],
  unavailable: [{ id: 'ds-2', errorCode: 'UPLOAD_EXPIRED' }],
  persistence: 'durable',
};
const sources = [{ id: 'upload-1', connectorId: 'file', columns: [{ name: 'region', type: 'STRING' }], available: true }];

test('prepSources lists unavailable hosted datasets as expired entries', () => {
  const combined = prepSources(saved, sources);
  assert.deepEqual(combined.find(s => s.id === 'ds-2'),
    { id: 'ds-2', ref: { dataset: 'ds-2' }, name: 'ds-2', connectorId: 'prepared', columns: [], available: false, errorCode: 'UPLOAD_EXPIRED' });
  const healthy = combined.find(s => s.id === 'ds-1');
  assert.equal(healthy.available, true);
  assert.ok(healthy.columns.length > 0);
  assert.ok(combined.some(s => s.id === 'upload-1' && s.available === true));
});

test('prepSources tolerates a durable response without the unavailable array', () => {
  const combined = prepSources({ datasets: saved.datasets, persistence: 'durable' }, sources);
  assert.deepEqual(combined.map(s => s.id).sort(), ['ds-1', 'upload-1']);
});
