import test from 'node:test';
import assert from 'node:assert/strict';
import { DescribeDBInstancesCommand, DescribeDBClustersCommand } from '@aws-sdk/client-rds';
import { discoverDatabaseSources, rdsSourceConfig, connectorDefinition, connectorState, validateConnectorConfig } from '@opensight/query-engine';
import { ExecutionCancelledError } from '../dist/prep-stream.js';

const config = { regionEnv: 'RDS_REGION' };
const environment = { RDS_REGION: 'us-east-1' };
const instance = (identifier, engine, extra = {}) => ({ DBInstanceIdentifier: identifier, Engine: engine, Endpoint: { Address: `${identifier}.abc123.us-east-1.rds.amazonaws.com`, Port: 5432 }, DBName: 'app', MasterUsername: 'admin', ...extra });
const cluster = (identifier, engine, extra = {}) => ({ DBClusterIdentifier: identifier, Engine: engine, Endpoint: `${identifier}.cluster-abc123.us-east-1.rds.amazonaws.com`, Port: 5432, DatabaseName: 'app', MasterUsername: 'admin', ...extra });
function fake(handlers = {}) {
  const calls = []; let destroyed = 0;
  const client = { async send(command, options) {
    calls.push(command);
    const handler = handlers[command.constructor.name];
    if (handler) return handler(command.input, options, calls);
    if (command instanceof DescribeDBInstancesCommand) return { DBInstances: [] };
    if (command instanceof DescribeDBClustersCommand) return { DBClusters: [] };
    throw new Error('Unexpected SDK command');
  }, destroy() { destroyed++; } };
  return { calls, client, get destroyed() { return destroyed; },
    options: { environment, clientFactory(settings) { assert.deepEqual(settings, { region: 'us-east-1', maxAttempts: 1, ignoreConfiguredEndpointUrls: true }); return client; } } };
}

test('discovery entries are registry discovery connectors with a region-name-only schema', () => {
  for (const id of ['rds', 'aurora', 'redshift']) {
    const definition = connectorDefinition(id);
    assert.equal(definition.implementation, 'discovery'); assert.equal(definition.category, 'AWS');
    assert.deepEqual(Object.keys(definition.schema), ['regionEnv']);
    assert.equal(connectorState(id, true).state, 'not_configured');
    assert.match(connectorState(id, true).message, /operator-configured discovery connection/);
    assert.equal(connectorState(id).state, 'needs_hosted_api');
  }
  for (const id of ['s3-analytics', 'iot-analytics']) assert.equal(connectorDefinition(id).implementation, 'hosted');
});

test('discovery classifies instances and clusters by engine into manual connectors', async () => {
  const f = fake({
    DescribeDBInstancesCommand: () => ({ DBInstances: [
      instance('pg-main', 'postgres'), instance('my-main', 'mysql'), instance('maria-main', 'mariadb'),
      instance('aur-pg', 'aurora-postgresql'), instance('aur-my', 'aurora-mysql'), instance('shift-main', 'redshift'),
    ] }),
    DescribeDBClustersCommand: () => ({ DBClusters: [cluster('aur-pg-cluster', 'aurora-postgresql'), cluster('aur-my-cluster', 'aurora-mysql')] }),
  });
  const found = await discoverDatabaseSources('rds', config, f.options);
  assert.deepEqual(found.map(d => [d.identifier, d.connectorId]), [
    ['pg-main', 'postgresql'], ['my-main', 'mysql'], ['maria-main', 'mariadb'],
    ['aur-pg', 'postgresql'], ['aur-my', 'mysql'], ['shift-main', 'redshift-manual'],
    ['aur-pg-cluster', 'postgresql'], ['aur-my-cluster', 'mysql'],
  ]);
  assert.deepEqual({ ...found[0] }, { kind: 'instance', identifier: 'pg-main', engine: 'postgres', connectorId: 'postgresql', endpoint: 'pg-main.abc123.us-east-1.rds.amazonaws.com', port: 5432, databaseName: 'app' });
  assert.equal(found[6].kind, 'cluster');
  assert.ok(Object.isFrozen(found) && Object.isFrozen(found[0]));
  assert.equal(f.destroyed, 1);
});

test('unclassifiable engines and endpoint-less resources stay unlisted, never guessed', async () => {
  const f = fake({
    DescribeDBInstancesCommand: () => ({ DBInstances: [
      instance('oracle-main', 'oracle-ee'), instance('mssql-main', 'sqlserver-ex'),
      instance('creating', 'postgres', { Endpoint: undefined }),
      { DBInstanceIdentifier: 'no-engine-endpoint', Engine: 'custom' },
    ] }),
    DescribeDBClustersCommand: () => ({ DBClusters: [cluster('plain-pg-cluster', 'postgres'), cluster('ok-cluster', 'aurora-mysql')] }),
  });
  const found = await discoverDatabaseSources('aurora', config, f.options);
  assert.deepEqual(found.map(d => d.identifier), ['ok-cluster']);
});

test('discovery returns endpoints and identifiers only — never credentials or master usernames', async () => {
  const f = fake({
    DescribeDBInstancesCommand: () => ({ DBInstances: [instance('pg-main', 'postgres', { MasterUserPassword: 'do-not-return', VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-123' }] })] }),
    DescribeDBClustersCommand: () => ({ DBClusters: [cluster('aur', 'aurora-mysql', { MasterUserPassword: 'do-not-return' })] }),
  });
  const found = await discoverDatabaseSources('redshift', config, f.options);
  const serialized = JSON.stringify(found);
  for (const leaked of ['admin', 'do-not-return', 'MasterUsername', 'sg-123']) assert.ok(!serialized.includes(leaked), `discovery leaked ${leaked}`);
  for (const entry of found) assert.deepEqual(Object.keys(entry).sort(), ['connectorId', 'databaseName', 'endpoint', 'engine', 'identifier', 'kind', 'port']);
});

test('discovery follows Markers for both lists with bounded page size', async () => {
  const f = fake({
    DescribeDBInstancesCommand: input => input.Marker
      ? { DBInstances: [instance('pg-2', 'postgres')] }
      : { DBInstances: [instance('pg-1', 'postgres')], Marker: 'next-1' },
    DescribeDBClustersCommand: input => input.Marker
      ? { DBClusters: [cluster('c-2', 'aurora-postgresql')] }
      : { DBClusters: [cluster('c-1', 'aurora-postgresql')], Marker: 'next-2' },
  });
  const found = await discoverDatabaseSources('rds', config, f.options);
  assert.deepEqual(found.map(d => d.identifier), ['pg-1', 'pg-2', 'c-1', 'c-2']);
  assert.deepEqual(f.calls.map(c => [c.constructor.name, c.input]), [
    ['DescribeDBInstancesCommand', { MaxRecords: 100 }],
    ['DescribeDBInstancesCommand', { MaxRecords: 100, Marker: 'next-1' }],
    ['DescribeDBClustersCommand', { MaxRecords: 100 }],
    ['DescribeDBClustersCommand', { MaxRecords: 100, Marker: 'next-2' }],
  ]);
});

test('duplicate markers, duplicate identifiers and malformed pages fail closed', async () => {
  const dupMarker = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [], Marker: 'loop' }) });
  await assert.rejects(discoverDatabaseSources('rds', config, dupMarker.options), { code: 'RDS_INVALID_RESPONSE' });
  const dupId = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [instance('pg', 'postgres'), instance('pg', 'postgres')] }) });
  await assert.rejects(discoverDatabaseSources('rds', config, dupId.options), { code: 'RDS_INVALID_RESPONSE' });
  const badList = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: 'nope' }) });
  await assert.rejects(discoverDatabaseSources('rds', config, badList.options), { code: 'RDS_INVALID_RESPONSE' });
  const badPort = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [instance('pg', 'postgres', { Endpoint: { Address: 'h.example.com', Port: 0 } })] }) });
  await assert.rejects(discoverDatabaseSources('rds', config, badPort.options), { code: 'RDS_INVALID_RESPONSE' });
  const badHost = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [instance('pg', 'postgres', { Endpoint: { Address: 'not a host', Port: 5432 } })] }) });
  await assert.rejects(discoverDatabaseSources('rds', config, badHost.options), { code: 'RDS_INVALID_RESPONSE' });
});

test('discovery validates config and region before any SDK call', async () => {
  const f = fake();
  await assert.rejects(discoverDatabaseSources('rds', { regionEnv: 'RDS_REGION', credentialsEnv: 'CREDS' }, f.options), { code: 'INVALID_CONNECTOR_CONFIG' });
  await assert.rejects(discoverDatabaseSources('rds', config, { ...f.options, environment: {} }), { code: 'CONNECTOR_NOT_CONFIGURED' });
  await assert.rejects(discoverDatabaseSources('rds', config, { ...f.options, environment: { RDS_REGION: 'not a region' } }), { code: 'CONNECTOR_NOT_CONFIGURED' });
  await assert.rejects(discoverDatabaseSources('mysql', config, f.options), { code: 'CONNECTOR_NOT_IMPLEMENTED' });
  await assert.rejects(discoverDatabaseSources('missing', config, f.options), { code: 'UNKNOWN_CONNECTOR' });
  assert.equal(f.calls.length, 0);
});

test('AWS failures surface sanitized named errors without vendor text', async () => {
  const denied = fake({ DescribeDBInstancesCommand: () => { const e = new Error('secret account detail'); e.name = 'AccessDeniedException'; throw e; } });
  await assert.rejects(discoverDatabaseSources('rds', config, denied.options), error => error.code === 'RDS_ACCESS_DENIED' && !error.message.includes('secret'));
  const broken = fake({ DescribeDBClustersCommand: () => { throw new Error('socket detail'); } });
  await assert.rejects(discoverDatabaseSources('rds', config, broken.options), error => error.code === 'RDS_REQUEST_FAILED' && !error.message.includes('socket'));
});

test('discovery honors the hard timeout and caller abort', async () => {
  const hanging = fake({ DescribeDBInstancesCommand: () => new Promise(() => {}) });
  await assert.rejects(discoverDatabaseSources('rds', config, { ...hanging.options, timeoutMs: 10 }), { code: 'RDS_TIMEOUT' });
  const f = fake();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discoverDatabaseSources('rds', config, { ...f.options, signal: controller.signal }), error => error instanceof ExecutionCancelledError);
});

test('source creation builds validated manual-connector configs from user-supplied env names', async () => {
  const f = fake({
    DescribeDBInstancesCommand: () => ({ DBInstances: [instance('pg-main', 'postgres'), instance('my-main', 'mysql')] }),
  });
  const [pg, my] = await discoverDatabaseSources('rds', config, f.options);
  const pgConfig = rdsSourceConfig(pg, { connectionEnv: 'PG_CONNECTION' });
  assert.deepEqual({ ...pgConfig }, { connectionEnv: 'PG_CONNECTION' });
  assert.deepEqual({ ...validateConnectorConfig('postgresql', pgConfig) }, { connectionEnv: 'PG_CONNECTION' });
  const myConfig = rdsSourceConfig(my, { hostEnv: 'MY_HOST', portEnv: 'MY_PORT', databaseEnv: 'MY_DB', userEnv: 'MY_USER', passwordEnv: 'MY_PASSWORD', caEnv: 'MY_CA' });
  assert.deepEqual({ ...validateConnectorConfig('mysql', myConfig) }, { hostEnv: 'MY_HOST', portEnv: 'MY_PORT', databaseEnv: 'MY_DB', userEnv: 'MY_USER', passwordEnv: 'MY_PASSWORD', caEnv: 'MY_CA' });
  // Credential values are not env names and fail the manual connector's own validation.
  assert.throws(() => rdsSourceConfig(my, { hostEnv: 'db.internal', portEnv: 'MY_PORT', databaseEnv: 'MY_DB', userEnv: 'MY_USER', passwordEnv: 'MY_PASSWORD' }), { code: 'INVALID_CONNECTOR_CONFIG' });
  assert.throws(() => rdsSourceConfig(my, { hostEnv: 'MY_HOST' }), { code: 'INVALID_CONNECTOR_CONFIG' });
  assert.throws(() => rdsSourceConfig(pg, { connectionEnv: 'PG_CONNECTION', passwordEnv: 'MY_PASSWORD' }), { code: 'INVALID_CONNECTOR_CONFIG' });
  assert.throws(() => rdsSourceConfig({ connectorId: 's3' }, { connectionEnv: 'X' }), { code: 'INVALID_CONNECTOR_CONFIG' });
});
