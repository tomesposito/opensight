import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { sourceFixture, seedSources, policy } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { TenantMetadata } from '../dist/metadata.js';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata, metadataTables } from '../dist/metadata-schema.js';
const live = { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' };
const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const columns = [{ name: 'tenant', type: 'STRING' }, { name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }, { name: 'private', type: 'STRING' }, { name: 'day', type: 'DATETIME' }];
const principals = [{ type: 'user', id: 'admin' }];

test('H3 live PostgreSQL versus cached SQL: immutable tenant boundary, RLS OR/null/date and CLS dependency denials', live, async t => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), name = `h3_source_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => { await pool.query(`DROP TABLE IF EXISTS "${name}"`); await pool.end(); });
  await pool.query(`CREATE TABLE "${name}" (tenant TEXT, region TEXT, amount BIGINT, private TEXT, day TIMESTAMP)`);
  await pool.query(`INSERT INTO "${name}" VALUES ('tenant-one','east',10,'a','2026-01-01'),('tenant-one','west',20,'b','2026-01-02'),('tenant-one',NULL,30,'c',NULL),('tenant-two','east',999,'other','2026-01-01')`);
  const url = new URL(process.env.DATABASE_URL), endpoint = { id: 'reference', host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), tls: false, tenantColumn: 'tenant' };
  const f = await sourceFixture(t, { endpoints: [endpoint] }), a = await f.login(), data = new HostedData(f.sources);
  const credentials = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) || randomBytes(12).toString('hex') };
  const create = p => ({ connectorId: 'postgresql', endpointId: 'reference', schema: 'public', table: name, columns, credentials, policy: p });
  const predicates = [
    { column: 'region', operator: 'eq', value: 'east' },
    { any: [{ column: 'region', operator: 'eq', value: 'west' }, { column: 'region', operator: 'is-null' }] },
    { column: 'day', operator: 'gte', value: '2026-01-02' },
    { column: 'tenant', operator: 'in', values: ['tenant-one', 'tenant-two'] },
    { all: [{ column: 'amount', operator: 'gte', value: 10 }, { column: 'amount', operator: 'lt', value: 30 }] },
  ];
  for (const [i, predicate] of predicates.entries()) {
    const id = `source_${i}`, p = { rowLevel: true, rowRules: [{ id: 'match', principals, predicate }], protectedColumns: ['private'], columnGrants: [] };
    await f.sources.create(a, id, create(p));
    const direct = await data.execute(a, id, 'output', {});
    await data.refresh(a, id);
    assert.deepEqual(await data.execute(a, id, 'output', { mode: 'BLAZE' }), direct);
    assert.equal(JSON.stringify(direct).includes('999'), false);
    for (const r of direct.rows) { assert.equal(r.tenant, 'tenant-one'); assert.equal('private' in r, false); }
    assert.deepEqual(await data.execute(a, id, 'query', { query, mode: 'BLAZE' }), await data.execute(a, id, 'query', { query }));
    for (const mode of ['DIRECT_QUERY', 'BLAZE']) {
      await assert.rejects(data.execute(a, id, 'query', { mode, query: { ...query, calculatedFields: [{ name: 'leak', expression: 'strlen({private})' }], measures: [{ fieldId: 'leak', columnName: 'leak', aggregation: 'SUM' }] } }), { code: 'COLUMN_ACCESS_DENIED' });
      await assert.rejects(data.execute(a, id, 'output', { mode, columns: ['private'] }), { code: 'COLUMN_ACCESS_DENIED' });
    }
    if (!i) assert.deepEqual((await data.execute(a, id, 'query', { query })).rows, [{ total: 10 }]);
  }
  await f.sources.create(a, 'denied', create({ rowLevel: true, rowRules: [] }));
  await assert.rejects(data.execute(a, 'denied', 'output', {}), { code: 'ROW_ACCESS_DENIED' });
  await assert.rejects(data.admit(a, 'source_0', 'prep'), { code: 'PREP_SECURITY_REJECTED' });
  await f.sources.rotate(a, 'source_0', { expectedVersion: 1, credentials: { ...credentials, password: randomBytes(12).toString('hex') } });
  await assert.rejects(data.execute(a, 'source_0', 'query', { query, mode: 'BLAZE' }), { code: 'BLAZE_NOT_READY' });
});

test('H3 live PostgreSQL durable source/policy/secret composite references and tenant-role isolation survive new pools', live, async t => {
  const schema = `h3_metadata_${randomUUID().replaceAll('-', '')}`, role = `${schema}_tenant`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` }); let tenant;
  t.after(async () => { await tenant?.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); });
  await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
  const operator = new PostgresMetadataDatabase(admin); await initializeMetadata(operator, 'postgres'); await seedSources(operator);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  for (const table of metadataTables.filter(t => t !== 'migrations')) await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_${table} TO ${role}`);
  const url = new URL(process.env.DATABASE_URL); url.username = role; url.password = '';
  const newPool = () => new Pool({ connectionString: url.href, max: 1, options: `-c search_path=${schema}` }); tenant = newPool();
  const key = randomBytes(32).toString('base64'), endpoint = [{ id: 'reference', host: 'localhost', port: 5433, database: 'opensight', tls: false }];
  let metadata = new TenantMetadata(new PostgresMetadataDatabase(tenant, true), operator), sources = new HostedSources(metadata, key, endpoint);
  const login = namespaceId => metadata.authenticate(null, async () => ({ namespaceId, userId: 'admin' }));
  const register = password => ({ connectorId: 'postgresql', endpointId: 'reference', schema: 'public', table: 'unused', columns, credentials: { username: 'synthetic', password }, policy });
  const first = randomBytes(12).toString('hex'), second = randomBytes(12).toString('hex');
  await sources.create(await login('one'), 'same', register(first)); await sources.create(await login('two'), 'same', register(second));
  assert.deepEqual((await tenant.query("SELECT * FROM h1_resources WHERE kind = 'secret'")).rows, []);
  await assert.rejects(new PostgresMetadataDatabase(tenant, true).transaction(c => c.query('SELECT 1')), { code: 'TENANT_CONTEXT_REQUIRED' });
  await tenant.end(); tenant = newPool(); metadata = new TenantMetadata(new PostgresMetadataDatabase(tenant, true), operator); sources = new HostedSources(metadata, key, endpoint);
  for (const [namespace, password] of [['one', first], ['two', second]]) {
    const context = await login(namespace), source = await sources.get(context, 'same'); assert.equal((await sources.payload(context, source)).password, password);
    await assert.rejects(sources.create(context, 'bad', { ...register(password), policy: { rowLevel: true, rowRules: [{ id: 'unknown', principals: [{ type: 'user', id: 'foreign' }], predicate: { column: 'amount', operator: 'eq', value: 1 } }] } }), { code: 'METADATA_REFERENCE_INVALID' });
  }
  assert.deepEqual((await tenant.query('SELECT * FROM h1_tenants')).rows, []);
});
