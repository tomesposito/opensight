import test from 'node:test';
import assert from 'node:assert/strict';
import { connectors, connectorDefinition, validateConnectorConfig, connectConnector, connectorState, connectorDialect } from '@opensight/query-engine';
test('MySQL metadata and connect cannot imply an API query path', () => {
  assert.equal(connectorDefinition('mysql').implementation, 'unimplemented');
  const config = { hostEnv: 'DB_HOST', portEnv: 'DB_PORT', databaseEnv: 'DB_NAME', userEnv: 'DB_USER', passwordEnv: 'DB_PASSWORD' };
  for (const apiAvailable of [false, true]) assert.deepEqual(connectConnector('mysql', config, apiAvailable), { state: 'not_implemented', message: 'Not yet implemented' });
});
test('availability copy describes the missing capability, including an existing local API', () => {
  assert.match(connectorState('file').message, /Uploads are unavailable in the static demo/);
  assert.equal(connectorState('file', true).state, 'ready');
  assert.equal(connectorState('postgresql', true).message, 'Needs an operator-configured connection');
  assert.match(connectorState('postgresql').message, /hosted API and an operator-configured connection/);
  for (const apiAvailable of [false, true]) assert.equal(connectorState('github', apiAvailable).message, 'Needs a hosted connector implementation');
});
for (const connector of connectors) {
  const config = Object.fromEntries(Object.entries(connector.schema).filter(([, f]) => f.required).map(([k, f]) => [k, f.kind === 'choice' ? f.values[0] : 'OPENSIGHT_TEST_VALUE']));
  test(`${connector.name}: validates config, missing/invalid/unknown fields fail closed`, () => {
    assert.deepEqual({ ...validateConnectorConfig(connector.id, config) }, config);
    for (const key of Object.keys(config)) {
      const absent = { ...config }; delete absent[key];
      for (const bad of [absent, { ...config, [key]: null }, { ...config, [key]: 'secret://value' }]) assert.throws(() => validateConnectorConfig(connector.id, bad), { code: 'INVALID_CONNECTOR_CONFIG' });
    }
    for (const bad of [null, [], 1, { ...config, password: 'private' }, { ...config, typo: true }]) assert.throws(() => validateConnectorConfig(connector.id, bad), { code: 'INVALID_CONNECTOR_CONFIG' });
  });
  test(`${connector.name}: connect reports honest state without I/O`, () => {
    assert.notEqual(connectConnector(connector.id, config).state, 'ready');
    assert.equal(connectorState(connector.id, true).state, connector.id === 'file' ? 'ready' : connector.implementation === 'unimplemented' ? 'not_implemented' : 'not_configured');
  });
  test(`${connector.name}: explicit dialect mapping or named unavailable error`, () => {
    if (connector.dialect) assert.equal(connectorDialect(connector.id), connector.dialect);
    else assert.throws(() => connectorDialect(connector.id), { code: 'CONNECTOR_NOT_IMPLEMENTED' });
  });
}
test('unknown connectors, forged prototypes and incompatible file options fail closed', () => {
  for (const id of ['missing', '__proto__', 'constructor']) assert.throws(() => connectorDefinition(id), { code: 'UNKNOWN_CONNECTOR' });
  for (const config of [{ format: 'json', delimiter: ',' }, { format: 'csv', sheet: 'Data' }, { format: 'tsv', delimiter: ',' }, Object.create({ format: 'csv' })]) assert.throws(() => validateConnectorConfig('file', config), { code: 'INVALID_CONNECTOR_CONFIG' });
});
