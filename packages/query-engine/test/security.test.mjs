import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { executeLocal, planVisual, refreshLocal } from '@opensight/query-engine';
import { evaluateSqlPlan } from '../dist/evaluate.js';
import { evaluatePlan } from '@opensight/query-engine/browser';
import { calculation, fixtureRoot, read, request } from './helpers.mjs';

export const rule = (id = 'east', predicate = { column: 'region', operator: 'eq', value: 'East' }, principals = [{ type: 'group', id: 'east-team' }]) => ({ id, predicate, principals });
export function secured() {
  const r = request('revenue-by-region'); r.analysis.Definition.FilterGroups = [];
  r.localData.security.dataset = 'protected';
  r.security = { namespaceId: 'default', userId: 'alice', users: ['alice', 'bob'].map(id => ({ id, namespaceId: 'default' })), groups: [{ id: 'east-team', namespaceId: 'default', userIds: ['alice'] }],
    policy: { namespaceId: 'default', dataSetArn: r.localData.dataSetArn, rowLevel: true, rowRules: [rule()] } };
  return r;
}
test('RLS executes in DuckDB and PostgreSQL before aggregates, with OR rules and AND predicates', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE sales (order_id BIGINT, order_date TIMESTAMP, region TEXT, category TEXT, revenue DOUBLE PRECISION, profit DOUBLE PRECISION)');
  for (const line of read('sales.csv').trim().split('\n').slice(1)) await pg.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)', line.split(',').map(v => v === '' ? null : v));
  const run = async r => {
    const duck = await executeLocal(r, { dataRoot: fixtureRoot });
    const plan = planVisual(r, { dialect: 'postgres' });
    assert.match(plan.sql, /__opensight_security.*SELECT \* FROM "public"\."sales" WHERE/s);
    assert.doesNotMatch(plan.sql, /East|West|Hardware/);
    const pgRows = (await pg.query(plan.sql, [...plan.parameters])).rows;
    assert.deepEqual(plan.postProcess ? evaluateSqlPlan(plan, pgRows) : pgRows, duck.rows);
    return duck.rows;
  };
  const r = secured();
  assert.deepEqual(await run(r), [{ region: 'East', revenue: 500 }]);
  r.security.policy.rowRules.push(rule('west-hardware', { all: [{ column: 'region', operator: 'eq', value: 'West' }, { column: 'category', operator: 'in', values: ['Hardware'] }] }, [{ type: 'user', id: 'alice' }]));
  assert.deepEqual(await run(r), [{ region: 'East', revenue: 500 }, { region: 'West', revenue: 350 }]);
  r.security.policy.rowRules.push(rule('overlap'));
  assert.deepEqual(await run(r), [{ region: 'East', revenue: 500 }, { region: 'West', revenue: 350 }]);
  r.security.policy.rowRules = [rule('quoted', { column: 'region', operator: 'eq', value: "East' OR TRUE --" })];
  assert.deepEqual(await run(r), []);
  r.security.policy.rowRules = [rule('null', { any: [{ column: 'revenue', operator: 'is-null' }, { all: [{ column: 'order_date', operator: 'gte', value: '2025-04-01' }, { column: 'revenue', operator: 'gt', value: 0 }] }] })];
  await run(r);
  r.security.policy.rowRules = [rule()];
  calculation(r, 'sumOver({revenue}, [], PRE_FILTER)');
  assert.deepEqual(await run(r), [{ region: 'East', calculated: 2500 }]);
});
for (const dialect of ['duckdb', 'postgres', 'mysql']) test(`${dialect} RLS denies missing/unknown principals, unmatched policies and unresolved groups`, () => {
  for (const [change, code] of [
    [r => { delete r.security.userId; }, 'PRINCIPAL_REQUIRED'], [r => { r.security.userId = 'forged'; }, 'UNKNOWN_PRINCIPAL'],
    [r => { r.security.userId = 'bob'; }, 'ROW_ACCESS_DENIED'], [r => { r.security.policy.rowRules = []; }, 'ROW_ACCESS_DENIED'],
    [r => { r.security.groups[0].userIds.push('unknown'); }, 'UNKNOWN_PRINCIPAL'],
    [r => { r.security.policy.namespaceId = 'other'; }, 'NAMESPACE_ACCESS_DENIED'],
    [r => { r.security.policy.rowRules[0].principals[0].id = 'missing'; }, 'UNKNOWN_PRINCIPAL'],
  ]) { const r = secured(); change(r); assert.throws(() => planVisual(r, { dialect }), { code }); }
});
test('RLS precedes PRE_FILTER and cannot be evaluated or refreshed over unfiltered input', async () => {
  const r = secured(); calculation(r, 'sumOver({revenue}, [], PRE_FILTER)');
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ region: 'East', calculated: 2500 }]);
  const plan = planVisual(r); assert.equal(plan.postProcess, true); assert.match(plan.sql, /__opensight_security/);
  assert.throws(() => evaluatePlan(plan, []), { code: 'SECURITY_REJECTED' });
  await assert.rejects(refreshLocal(r, { dataRoot: '/absent' }), { code: 'SECURITY_REJECTED' });
});

for (const dialect of ['duckdb', 'postgres', 'mysql']) test(`${dialect} CLS deny wins over user/group allows and checks every reachable dependency`, () => {
  const r = secured();
  r.security.policy.protectedColumns = ['revenue', 'profit'];
  r.security.policy.columnGrants = [
    { id: 'revenue', column: 'revenue', effect: 'allow', principals: [{ type: 'group', id: 'east-team' }] },
    { id: 'profit', column: 'profit', effect: 'allow', principals: [{ type: 'user', id: 'alice' }] },
    { id: 'deny', column: 'profit', effect: 'deny', principals: [{ type: 'group', id: 'east-team' }] },
  ];
  assert.doesNotThrow(() => planVisual(r, { dialect }));
  calculation(r, '{Indirect}');
  r.analysis.Definition.CalculatedFields.push({ Name: 'Indirect', DataSetIdentifier: 'sales_data', Expression: '{profit} + 1' });
  assert.throws(() => planVisual(r, { dialect }), { code: 'COLUMN_ACCESS_DENIED' });
  r.analysis.Definition.CalculatedFields.at(-1).Expression = 'sumOver({profit}, [], PRE_FILTER)';
  assert.throws(() => planVisual(r, { dialect }), { code: 'COLUMN_ACCESS_DENIED' });
  r.security.policy.columnGrants = r.security.policy.columnGrants.filter(g => g.id !== 'deny');
  assert.doesNotThrow(() => planVisual(r, { dialect }));
  r.security.policy.columnGrants = [];
  assert.throws(() => planVisual(r, { dialect }), { code: 'COLUMN_ACCESS_DENIED' });
});
for (const dialect of ['duckdb', 'postgres', 'mysql']) test(`${dialect} CLS rejects denied filters, dimensions, partitions and parameter filters`, () => {
  for (const change of [
    r => { r.security.policy.protectedColumns = ['region']; },
    r => { r.analysis.Definition.FilterGroups = request().analysis.Definition.FilterGroups; r.security.policy.protectedColumns = ['region']; r.visualId = 'total-revenue'; },
    r => { calculation(r, 'sumOver({revenue}, [{category}], PRE_FILTER)'); },
    r => { r.parameterDeclarations = [{ name: 'c', type: 'string', multiple: false }]; r.parameterBindings = { c: ['Hardware'] }; r.parameterFilters = [{ columnName: 'category', parameterName: 'c' }]; },
  ]) {
    const r = secured(); r.security.policy.protectedColumns = ['category']; change(r);
    assert.throws(() => planVisual(r, { dialect }), { code: 'COLUMN_ACCESS_DENIED' });
  }
});
test('CLS excludes unrequested denied physical columns from SQL multirow projections without dropping requested fields', async () => {
  const r = secured(); r.security.policy.protectedColumns = ['profit'];
  calculation(r, 'percentOfTotal(sum({revenue}))');
  for (const dialect of ['duckdb', 'postgres', 'mysql']) {
    const plan = planVisual(r, { dialect });
    assert.equal(plan.postProcess, true);
    assert.doesNotMatch(plan.sql, /"profit"/);
  }
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ region: 'East', calculated: 1 }]);
});

test('both executors deny forged, omitted and unsupported security before file/connection access', async t => {
  const { Client } = await import('pg'); const { executePostgres } = await import('@opensight/query-engine');
  const connect = t.mock.method(Client.prototype, 'connect', () => { throw new Error('Must not connect'); });
  for (const [mutate, code] of [
    [r => { delete r.security; }, 'SECURITY_REJECTED'], [r => { delete r.security.userId; }, 'PRINCIPAL_REQUIRED'],
    [r => { r.security.userId = 'forged'; }, 'UNKNOWN_PRINCIPAL'], [r => { r.security.userId = 'bob'; }, 'ROW_ACCESS_DENIED'],
    [r => { r.security.policy.rowLevel = false; r.security.policy.rowRules = []; }, 'SECURITY_REJECTED'],
    [r => { r.security.policy.protectedColumns = ['revenue']; }, 'COLUMN_ACCESS_DENIED'],
    [r => { r.security.policy.rowRules[0].predicate = { sql: 'TRUE' }; }, 'INVALID_SECURITY_POLICY'],
    [r => { r.security.policy.rowRules[0].predicate.value = null; }, 'INVALID_SECURITY_POLICY'],
    [r => { r.dataSet.DataSet.RowLevelPermissionDataSet = {}; }, 'SECURITY_REJECTED'],
    [r => { r.dataSource.DataSource.Permissions = []; }, 'SECURITY_REJECTED'],
  ]) {
    const r = secured(); mutate(r);
    await assert.rejects(executeLocal(r, { dataRoot: '/deliberately-absent' }), { code });
    await assert.rejects(executePostgres(r, { connectionString: 'postgres://unused.invalid/test' }), { code });
  }
  assert.equal(connect.mock.callCount(), 0);
});
test('Postgres executor sends the secured SQL and parameters to the driver', async t => {
  const { Client, types } = await import('pg'); const { executePostgres } = await import('@opensight/query-engine');
  t.mock.method(Client.prototype, 'connect', async () => {});
  const query = t.mock.method(Client.prototype, 'query', async config => typeof config === 'string' ? { rows: [] } : {
    fields: [{ name: 'region', dataTypeID: types.builtins.TEXT }, { name: 'revenue', dataTypeID: types.builtins.FLOAT8 }], rows: [['East', '500']],
  });
  const end = t.mock.method(Client.prototype, 'end', async () => {});
  const result = await executePostgres(secured(), { connectionString: 'postgres://unused.invalid/test' });
  const config = query.mock.calls[1].arguments[0];
  assert.match(config.text, /FROM "public"\."sales" WHERE \("region" = \$1\)/);
  assert.deepEqual(config.values, ['East']); assert.deepEqual(result.rows, [{ region: 'East', revenue: 500 }]); assert.equal(end.mock.callCount(), 1);
});
for (const dialect of ['duckdb', 'postgres', 'mysql']) test(`${dialect} malformed optional policies, excess nesting and unknown policy fields cannot disable protection`, () => {
  for (const mutate of [
    r => { r.security.policy.columnGrants = null; }, r => { r.security.policy.protectedColumns = null; },
    r => { r.security.policy.rowRules[0].predicate = { column: 'order_id', operator: 'eq', value: 1.5 }; },
    r => { r.security.policy.rowLevel = null; }, r => { r.security.policy.bypass = true; },
    r => { r.security.policy.rowRules.push(structuredClone(r.security.policy.rowRules[0])); },
    r => { for (let i = 0; i < 18; i++) r.security.policy.rowRules[0].predicate = { all: [r.security.policy.rowRules[0].predicate] }; },
  ]) {
    const r = secured(); mutate(r); assert.throws(() => planVisual(r, { dialect }), { code: 'INVALID_SECURITY_POLICY' });
  }
});
