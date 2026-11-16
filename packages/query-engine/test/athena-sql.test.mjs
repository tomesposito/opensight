import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual } from '@opensight/query-engine';
import { athenaBindings } from '../dist/athena-sql.js';
import { request } from './helpers.mjs';

test('Athena plans double-quoted identifiers and ordered positional execution parameters', () => {
  const p = planVisual(request('revenue-by-region'), { dialect: 'athena' });
  assert.equal(p.sql, 'WITH "__opensight_filtered" AS (SELECT * FROM "public"."sales" WHERE "region" = ?)\nSELECT "region" AS "region", SUM("revenue") AS "revenue"\nFROM "__opensight_filtered"\nGROUP BY 1\nORDER BY 1 ASC NULLS FIRST');
  assert.equal(p.tableSchema, 'public');
  assert.deepEqual(p.parameters, ['East']);
  assert.deepEqual(athenaBindings(`SELECT "$1""$2", '$2''$1', $2, $1, $2`, ['one', 2]), {
    sql: `SELECT "$1""$2", '$2''$1', ?, ?, ?`, parameters: [2, 'one', 2],
  });
  assert.throws(() => athenaBindings('$1', []), { code: 'INVALID_INPUT' });
  assert.throws(() => athenaBindings('$1', [null]), { code: 'UNSUPPORTED_FEATURE' });
});
