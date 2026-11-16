import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, registration, endpoints, credentials } from './source-helpers.mjs';
import { sourceEndpoints, sourceBody } from '../dist/source-schema.js';

test('Source endpoint protocol defaults to PostgreSQL and rejects unknown or cross-protocol bindings', async t => {
  assert.deepEqual(sourceEndpoints({ OPENSIGHT_SOURCE_ENDPOINTS: JSON.stringify(endpoints) }), endpoints);
  for (const connectorId of ['file', 'unknown', null, 123]) assert.throws(() => sourceEndpoints({ OPENSIGHT_SOURCE_ENDPOINTS: JSON.stringify([{ ...endpoints[0], connectorId }]) }), { code: 'SOURCE_ENDPOINT_CONFIG_INVALID' });
  const configured = [...endpoints, ...['mysql', 'mariadb'].map(connectorId => ({ ...endpoints[0], id: connectorId, connectorId }))];
  assert.deepEqual(sourceEndpoints({ OPENSIGHT_SOURCE_ENDPOINTS: JSON.stringify(configured) }), configured);
  const f = await sourceFixture(t, { endpoints: configured }), a = await f.login();
  for (const connectorId of ['mysql', 'mariadb']) {
    await assert.rejects(f.sources.create(a, 'bad', { ...registration(), connectorId }), { code: 'SOURCE_ENDPOINT_DENIED' });
    await f.sources.create(a, connectorId, { ...registration(), connectorId, endpointId: connectorId });
    await assert.rejects(f.sources.bind(a, connectorId, { expectedVersion: 1, endpointId: 'reference' }), { code: 'SOURCE_ENDPOINT_DENIED' });
    await f.sources.bind(a, connectorId, { expectedVersion: 1, table: 'other_table' });
    const replacement = credentials();
    await f.sources.rotate(a, connectorId, { expectedVersion: 2, credentials: replacement });
    const stored = await f.sources.get(a, connectorId);
    assert.equal(stored.binding.connectorId, connectorId); assert.equal(stored.binding.table, 'other_table');
    assert.deepEqual(await f.sources.payload(a, stored), replacement);
    for (const invalid of [{ expiresAt: '2099-01-01T00:00:00.000Z' }, { rowCount: 1 }, { schema: undefined }, { table: undefined }, { state: 'expired' }]) {
      assert.throws(() => sourceBody({ binding: { ...stored.binding, ...invalid }, secretId: stored.secretId, policy: stored.policy }));
    }
    f.sources.endpoints.find(e => e.id === connectorId).connectorId = 'postgresql';
    await assert.rejects(f.sources.get(a, connectorId), { code: 'SOURCE_ENDPOINT_DENIED' });
  }
});
