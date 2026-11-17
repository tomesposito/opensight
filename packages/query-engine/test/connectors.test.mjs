import test from 'node:test';
import assert from 'node:assert/strict';
import { connectors, connectorDefinition, validateConnectorConfig, connectConnector, connectorState, connectorDialect } from '@opensight/query-engine';
test('MySQL metadata exposes the API path but connect still requires operator configuration', () => {
  assert.equal(connectorDefinition('mysql').implementation, 'query');
  const config = { hostEnv: 'DB_HOST', portEnv: 'DB_PORT', databaseEnv: 'DB_NAME', userEnv: 'DB_USER', passwordEnv: 'DB_PASSWORD' };
  for (const apiAvailable of [false, true]) assert.deepEqual(connectConnector('mysql', config, apiAvailable), connectorState('postgresql', apiAvailable));
});
test('availability copy describes the missing capability, including an existing local API', () => {
  assert.match(connectorState('file').message, /Uploads are unavailable in the static demo/);
  assert.equal(connectorState('file', true).state, 'ready');
  assert.equal(connectorState('postgresql', true).message, 'Needs an operator-configured connection');
  assert.match(connectorState('postgresql').message, /hosted API and an operator-configured connection/);
  for (const apiAvailable of [false, true]) assert.equal(connectorState('github', apiAvailable).message, 'Needs a hosted connector implementation');
});
for (const connector of connectors) {
  const config = Object.fromEntries(Object.entries(connector.schema).filter(([, f]) => f.required).map(([k, f]) => [k, f.kind === 'choice' ? f.values[0] : k === 'bucket' ? 'example-bucket' : 'OPENSIGHT_TEST_VALUE']));
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

test('Redshift manual is a database query connector; discovery is an AWS discovery connector', () => {
  const manual = connectorDefinition('redshift-manual'), discovery = connectorDefinition('redshift');
  assert.equal(manual.implementation, 'query'); assert.equal(manual.category, 'Database');
  assert.equal(connectorDialect(manual.id), 'redshift');
  assert.deepEqual(manual.schema, connectorDefinition('mysql').schema);
  assert.equal(discovery.implementation, 'discovery'); assert.equal(discovery.category, 'AWS');
  assert.deepEqual(Object.keys(discovery.schema), ['regionEnv']);
  assert.throws(() => connectorDialect(discovery.id), { code: 'CONNECTOR_NOT_IMPLEMENTED' });
});

test('Athena has a dedicated environment-name schema and query dialect; other AWS stubs are unchanged', () => {
  const athena = connectorDefinition('athena');
  assert.equal(athena.implementation, 'query'); assert.equal(athena.category, 'AWS');
  assert.equal(connectorDialect('athena'), 'athena');
  assert.deepEqual(Object.keys(athena.schema), ['regionEnv', 'databaseEnv', 'workGroupEnv', 'outputLocationEnv']);
  for (const [key, field] of Object.entries(athena.schema)) {
    assert.equal(field.kind, 'environment'); assert.equal(field.required, key !== 'workGroupEnv');
  }
  const config = { regionEnv: 'ATHENA_REGION', databaseEnv: 'ATHENA_DATABASE', outputLocationEnv: 'ATHENA_OUTPUT' };
  for (const key of ['credentialsEnv', 'resourceEnv', 'accessKeyId', 'secretAccessKey']) assert.throws(() => validateConnectorConfig('athena', { ...config, [key]: 'SECRET' }), { code: 'INVALID_CONNECTOR_CONFIG' });
  for (const id of ['s3-analytics', 'iot-analytics']) {
    assert.equal(connectorDefinition(id).implementation, 'hosted');
    assert.deepEqual(Object.keys(connectorDefinition(id).schema), ['regionEnv', 'resourceEnv', 'credentialsEnv']);
  }
});

const s3Config = { regionEnv: 'S3_REGION', accessKeyIdEnv: 'S3_ACCESS_KEY_ID', secretAccessKeyEnv: 'S3_SECRET_ACCESS_KEY', bucket: 'example-bucket', key: 'data/sales.csv', prefix: 'data/' };
test('S3 is a file pipeline connector with environment-name credentials and bounded plain object coordinates', () => {
  assert.equal(connectorDefinition('s3').implementation, 'upload');
  assert.equal(connectorDialect('s3'), 'duckdb');
  assert.equal(connectorState('s3', true).state, 'not_configured');
  assert.equal(connectorState('s3').state, 'needs_hosted_api');
  assert.deepEqual({ ...validateConnectorConfig('s3', s3Config) }, s3Config);
  assert.deepEqual(JSON.parse(JSON.stringify(validateConnectorConfig('s3', s3Config))), s3Config);
  for (const change of [{ bucket: '' }, { bucket: 'ab' }, { bucket: 'a'.repeat(64) }, { bucket: 'bucket\0' }, { bucket: 'UPPER' }, { bucket: '127.0.0.1' }, { bucket: 's3://example-bucket' }, { key: '' }, { key: ' ' }, { key: 'data/a\0b' }, { key: 'data/' + 'é'.repeat(510) }, { key: 'https://example.invalid/secret' }, { key: 'outside.csv' }, { prefix: '' }, { secretAccessKey: 'raw-value' }, { accessKeyIdEnv: 'raw-value' }, { regionEnv: 'us-east-1' }]) {
    assert.throws(() => validateConnectorConfig('s3', { ...s3Config, ...change }), { code: 'INVALID_CONNECTOR_CONFIG' });
  }
  assert.equal(validateConnectorConfig('s3', { ...s3Config, key: 'data/' + 'a'.repeat(1019) }).key.length, 1024);
  assert.equal(validateConnectorConfig('s3', { ...s3Config, sessionTokenEnv: 'S3_SESSION_TOKEN' }).sessionTokenEnv, 'S3_SESSION_TOKEN');
});
