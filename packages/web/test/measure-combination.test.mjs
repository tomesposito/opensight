import test from 'node:test';
import assert from 'node:assert/strict';
import { combineGroupedValues } from '../build/test/measure-combination.js';

const fail = message => { throw new Error(message); };
test('grouped measure combination preserves nulls, zero and negative extrema (#313)', () => {
  for (const [mode, expected] of [['SUM', -20], ['MIN', -30], ['MAX', 10]]) {
    assert.equal(combineGroupedValues([null, 10, -30, 0, null], mode, fail), expected);
    assert.equal(combineGroupedValues([], mode, fail), null);
    assert.equal(combineGroupedValues([null, null], mode, fail), null);
    assert.equal(combineGroupedValues([null, 0], mode, fail), 0);
  }
});
test('grouped measure combination rejects unproven modes and nonfinite totals (#313)', () => {
  for (const values of [[10, 30], [null, null], []]) {
    assert.throws(() => combineGroupedValues(values, 'NONE', fail), /^Error: NONADDITIVE_MEASURE_COMBINATION:/);
  }
  assert.throws(() => combineGroupedValues([Number.MAX_VALUE, Number.MAX_VALUE], 'SUM', fail), /total must be finite/);
  for (const mode of ['SUM', 'MIN', 'MAX']) for (const value of [Infinity, -Infinity, NaN]) {
    assert.throws(() => combineGroupedValues([value], mode, fail), /total must be finite/);
  }
});
