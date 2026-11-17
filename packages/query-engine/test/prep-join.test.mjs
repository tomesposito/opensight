import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPrepJoinKeys } from '../dist/prep-join.js';

test('join suggestions match whole names ignoring case and require identical types', () => {
  const left = [{ name: 'ID', type: 'INTEGER' }, { name: 'name', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }, { name: 'day', type: 'DATETIME' }];
  const right = [{ name: 'id', type: 'INTEGER' }, { name: 'name', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }, { name: 'day', type: 'STRING' }, { name: 'other', type: 'DATETIME' }];
  const original = structuredClone([left, right]);
  assert.deepEqual(suggestPrepJoinKeys(left, right), [{ left: 'ID', right: 'id' }, { left: 'name', right: 'name' }]);
  assert.deepEqual([left, right], original);
  assert.deepEqual(suggestPrepJoinKeys(left, []), []);
  assert.deepEqual(suggestPrepJoinKeys([{ name: 'user_id', type: 'INTEGER' }], right), []);
});
test('ambiguous names never produce suggestions even if only one type matches', () => {
  const one = [{ name: 'id', type: 'INTEGER' }];
  const ambiguous = [...one, { name: 'ID', type: 'STRING' }];
  assert.deepEqual(suggestPrepJoinKeys(one, ambiguous), []);
  assert.deepEqual(suggestPrepJoinKeys(ambiguous, one), []);
});
