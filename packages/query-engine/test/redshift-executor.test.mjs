import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, types } from 'pg';
import { executeRedshift, executeConnector } from '@opensight/query-engine';
import { redshiftHarness } from './redshift-harness.mjs';
import { request, calculation } from './helpers.mjs';
const config = { hostEnv: 'DB_HOST', portEnv: 'DB_PORT', databaseEnv: 'DB_NAME', userEnv: 'DB_USER', passwordEnv: 'DB_PASSWORD' };
const environment = { DB_HOST: '127.0.0.1', DB_PORT: '5439', DB_NAME: 'synthetic_sales', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic-password' };
const options = { config, environment, allowInsecureLoopback: true };
function redshiftRequest(id = 'revenue-by-region') {
  const r = request(id), s = r.dataSource.DataSource; s.Type = 'REDSHIFT';
  s.DataSourceParameters = { RedshiftParameters: s.DataSourceParameters.PostgreSqlParameters }; return r;
}
test('Redshift library executor uses real pg wire binding, exact session SQL, manual metadata and a separate database/schema', async t => {
  const harness = await redshiftHarness(t, { evaluate(sql, values) {
    assert.match(sql, /FROM "public"\."sales"/); assert.match(sql, /"region" = \$1/); assert.deepEqual(values, ['East']);
    return { fields: [{ name: 'region', oid: 1043 }, { name: 'revenue', oid: 1700 }], rows: [['East', '9007199254740993']] };
  } });
  const parser = types.getTypeParser(1700);
  const result = await executeRedshift(redshiftRequest(), { ...options, environment: { ...environment, DB_PORT: String(harness.port) } });
  assert.equal(result.plan.dialect, 'redshift'); assert.equal(result.plan.tableDatabase, 'synthetic_sales');
  assert.deepEqual(result.rows, [{ region: 'East', revenue: '9007199254740993' }]);
  assert.deepEqual(harness.sessions, ["SET TIME ZONE 'UTC'", 'SET statement_timeout TO 10000']);
  assert.equal(harness.startups[0].database, 'synthetic_sales'); assert.deepEqual(harness.errors, []);
  assert.equal(types.getTypeParser(1700), parser);
});
test('Redshift config, database mismatch, unsupported SQL and security reject before connecting', async t => {
  const connect = t.mock.method(Client.prototype, 'connect', async () => { throw new Error('must not connect'); });
  await assert.rejects(executeRedshift(redshiftRequest(), { ...options, config: { ...config, password: 'secret' } }), { code: 'INVALID_CONNECTOR_CONFIG' });
  await assert.rejects(executeRedshift(redshiftRequest(), { ...options, environment: {} }), { code: 'CONNECTOR_NOT_CONFIGURED' });
  for (const DB_PORT of ['0', '65536', '54x']) await assert.rejects(executeRedshift(redshiftRequest(), { ...options, environment: { ...environment, DB_PORT } }), { code: 'INVALID_CONNECTOR_CONFIG' });
  for (const patch of [{ DB_NAME: 'public' }, { DB_HOST: 'remote.invalid' }, { DB_HOST: 'localhost' }]) await assert.rejects(executeRedshift(redshiftRequest(), { ...options, environment: { ...environment, ...patch } }), { code: 'INVALID_CONNECTOR_CONFIG' });
  const r = redshiftRequest(); r.localData.security.dataset = 'protected';
  await assert.rejects(executeRedshift(r, options), { code: 'SECURITY_REJECTED' });
  const unsupported = redshiftRequest(); calculation(unsupported, "parseInt('2')");
  await assert.rejects(executeRedshift(unsupported, options), { code: 'UNSUPPORTED_FEATURE' });
  await assert.rejects(executeConnector('redshift-manual', config, redshiftRequest(), {}), { code: 'CONNECTOR_NOT_CONFIGURED' });
  await assert.rejects(executeConnector('redshift', { regionEnv: 'REGION', resourceEnv: 'RESOURCE', credentialsEnv: 'CREDS' }, r), { code: 'CONNECTOR_NOT_CONFIGURED' });
  assert.equal(connect.mock.callCount(), 0);
});
test('Redshift production connection verifies TLS and pins connect/query timeouts', async t => {
  let actual;
  t.mock.method(Client.prototype, 'connect', async function () { actual = this; throw new Error('private-host synthetic-password'); });
  t.mock.method(Client.prototype, 'end', async () => {});
  await assert.rejects(executeConnector('redshift-manual', { ...config, caEnv: 'CA' }, redshiftRequest(), { ...environment, CA: 'synthetic-ca' }), { code: 'EXECUTION_ERROR', message: '$.redshift: Redshift connection or query failed' });
  assert.deepEqual(actual.connectionParameters.ssl, { rejectUnauthorized: true, ca: 'synthetic-ca' });
  assert.equal(actual._connectionTimeoutMillis, 3000); assert.equal(actual.connectionParameters.query_timeout, 10000);
});
for (const mode of ['error', 'drop', 'bad-auth', 'tls-required', 'unknown-type', 'empty-unknown-type', 'nonfinite']) test(`Redshift wire failure is sanitized and closes: ${mode}`, async t => {
  const harness = await redshiftHarness(t, { evaluate: () => ({ fields: [{ name: 'result', oid: mode === 'nonfinite' ? 701 : 4000 }], rows: mode === 'empty-unknown-type' ? [] : [[mode === 'nonfinite' ? 'NaN' : null]] }) });
  harness.mode = mode;
  await assert.rejects(executeRedshift(redshiftRequest(), { ...options, allowInsecureLoopback: mode !== 'tls-required', environment: { ...environment, DB_PORT: String(harness.port), ...(mode === 'bad-auth' ? { DB_PASSWORD: 'wrong-synthetic-password' } : {}) } }), e => {
    assert.equal(e.code, mode.includes('unknown-type') ? 'UNSUPPORTED_FEATURE' : 'EXECUTION_ERROR');
    for (const secret of ['synthetic-password', '127.0.0.1', 'private-host']) assert.equal(String(e).includes(secret), false);
    return true;
  });
  if (mode === 'tls-required') { assert.equal(harness.sslRequests, 1); assert.equal(harness.authentications.length, 0); }
  assert.deepEqual(harness.errors, []);
});
