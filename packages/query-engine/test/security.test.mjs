import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { executeLocal, planVisual, refreshLocal } from '@opensight/query-engine';
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
    assert.deepEqual((await pg.query(plan.sql, [...plan.parameters])).rows, duck.rows);
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
});
for (const dialect of ['duckdb', 'postgres']) test(`${dialect} RLS denies missing/unknown principals, unmatched policies and unresolved groups`, () => {
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
