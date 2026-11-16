import test from 'node:test';
import assert from 'node:assert/strict';
import { planSourceRead } from '@opensight/query-engine';
import { boundedPrepSql } from '../dist/prep-stream.js';
const columns = [{ name: 'tenant', type: 'STRING' }, { name: 'day', type: 'DATETIME' }, { name: 'region`?', type: 'STRING' }];
const read = {
  source: { id: 'test', table: 'table`?', schema: 'database', connectorId: 'mysql', columns, security: 'protected' },
  columns: columns.map(c => c.name),
  tenantPredicate: { column: 'tenant', operator: 'eq', value: 'one' },
  security: { namespaceId: 'ns', userId: 'user', users: [{ id: 'user', namespaceId: 'ns' }], groups: [],
    policy: { namespaceId: 'ns', dataSetArn: 'source', rowLevel: true, rowRules: [{ id: 'rule', principals: [{ type: 'user', id: 'user' }],
      predicate: { all: [{ column: 'region`?', operator: 'in', values: ['east', 'west'] }, { column: 'day', operator: 'gte', value: '2026-01-02' }] } }] } },
};
const limits = { maxRows: 12, cellChars: 64 };
test('MySQL source plans quote identifiers, preserve tenant/RLS parameter order and project UTC milliseconds', () => {
  const plan = planSourceRead(read, limits, 'mysql');
  assert.match(plan.sql, /FROM `database`\.`table``\?`/);
  assert.match(plan.sql, /`region``\?` COLLATE utf8mb4_0900_bin IN \(\?, \?\)/);
  assert.match(plan.sql, /CONCAT\(DATE_FORMAT\(`day`, '%Y-%m-%dT%H:%i:%s\.'\), LEFT\(DATE_FORMAT\(`day`, '%f'\), 3\), 'Z'\)/);
  assert.match(plan.sql, /`tenant` COLLATE utf8mb4_0900_bin = \?/);
  assert.match(plan.sql, /CAST\(REPLACE\(REPLACE\(\?, 'T', ' '\), 'Z', ''\) AS DATETIME\(3\)\)/);
  assert.match(plan.sql, /LIMIT 13$/);
  assert.deepEqual(plan.parameters, ['one', 'east', 'west', '2026-01-02']);
  const maria = planSourceRead(read, limits, 'mysql', { mysqlVariant: 'mariadb' });
  assert.equal(maria.sql, plan.sql.replaceAll('utf8mb4_0900_bin', 'utf8mb4_bin'));
  assert.deepEqual(maria.parameters, plan.parameters);
  const bounded = boundedPrepSql(plan, limits, 'mysql');
  assert.match(bounded, /CHAR_LENGTH\(CAST\(`day` AS CHAR\)\)/);
  assert.match(bounded, /AS `oversized` FROM/);
  assert.match(bounded, /THEN NULL ELSE `region``\?` END AS `v2`/);
});
test('Source read validation denies columns before planning on every dialect', () => {
  const denied = structuredClone(read); denied.security.policy.protectedColumns = ['day'];
  for (const dialect of ['mysql', 'postgres', 'duckdb']) {
    assert.throws(() => planSourceRead(denied, limits, dialect), { code: 'COLUMN_ACCESS_DENIED' });
    const plan = planSourceRead(read, limits, dialect);
    if (dialect !== 'mysql') {
      assert.match(plan.sql, /"tenant" = \$1/);
      assert.match(plan.sql, dialect === 'postgres' ? /TO_CHAR/ : /STRFTIME/);
      assert.deepEqual(plan.parameters, ['one', 'east', 'west', '2026-01-02']);
    }
  }
});
