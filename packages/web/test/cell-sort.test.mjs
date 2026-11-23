import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCells } from '../build/test/cell-sort.js';

const sign = n => (n < 0 ? -1 : n > 0 ? 1 : 0);
const sorted = (cells, direction = 'ASC') => [...cells].sort((a, b) => compareCells(a, b, direction));

test('homogeneous cells keep their established order', () => {
  assert.deepEqual(sorted([10, 2, -1, 0, 2]), [-1, 0, 2, 2, 10]);
  assert.deepEqual(sorted([10, 2, -1, 0], 'DESC'), [10, 2, 0, -1]);
  assert.deepEqual(sorted(['banana', 'Apple', 'apple', '10', '2']), ['10', '2', 'Apple', 'apple', 'banana']);
  assert.deepEqual(sorted([true, false, true]), [false, true, true]);
  assert.deepEqual(sorted([Infinity, 5, -Infinity]), [-Infinity, 5, Infinity]);
});

test('null stays last in either direction', () => {
  assert.deepEqual(sorted([null, 1, null, 0]), [0, 1, null, null]);
  assert.deepEqual(sorted([null, 1, null, 0], 'DESC'), [1, 0, null, null]);
  assert.deepEqual(sorted([null, 'a', true, 1], 'DESC'), [true, 'a', 1, null]);
  assert.equal(compareCells(null, null, 'ASC'), 0);
});

test('the reported cycle triple orders consistently', () => {
  // Previously: 2 < 10 numerically, 10 < "15" textually, "15" < 2 textually.
  assert.ok(compareCells(2, 10, 'ASC') < 0);
  assert.ok(compareCells(10, '15', 'ASC') < 0);
  assert.ok(compareCells(2, '15', 'ASC') < 0);
  assert.deepEqual(sorted(['15', 10, 2]), [2, 10, '15']);
  assert.deepEqual(sorted(['15', 10, 2], 'DESC'), ['15', 10, 2]);
});

test('cross-type order is numbers, then strings, then booleans', () => {
  assert.deepEqual(sorted([true, 'a', 3, false, '0', -1]), [-1, 3, '0', 'a', false, true]);
  assert.ok(compareCells(999, '0', 'ASC') < 0);
  assert.ok(compareCells('zzz', false, 'ASC') < 0);
});

test('NaN sorts after other numbers and equal to itself', () => {
  assert.deepEqual(sorted([NaN, 1, -5]), [-5, 1, NaN]);
  assert.equal(compareCells(NaN, NaN, 'ASC'), 0);
  assert.ok(compareCells(NaN, 'a', 'ASC') < 0);
});

const MIXED = [2, 10, '15', 'abc', '2', -1, 0, true, false, null, NaN];

test('comparator is antisymmetric and transitive over mixed cells', () => {
  for (const direction of ['ASC', 'DESC']) {
    for (const a of MIXED) for (const b of MIXED) {
      assert.equal(sign(compareCells(a, b, direction)), 0 - sign(compareCells(b, a, direction)),
        `antisymmetry ${String(a)} vs ${String(b)} ${direction}`);
      if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) {
        assert.equal(compareCells(a, b, direction), 0, `reflexivity ${String(a)} ${direction}`);
      }
    }
    for (const a of MIXED) for (const b of MIXED) for (const c of MIXED) {
      if (compareCells(a, b, direction) <= 0 && compareCells(b, c, direction) <= 0) {
        assert.ok(compareCells(a, c, direction) <= 0,
          `transitivity ${String(a)} <= ${String(b)} <= ${String(c)} ${direction}`);
      }
    }
  }
});

function* permutations(items) {
  if (items.length <= 1) { yield items; return; }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

test('sorting is invariant under input permutation', () => {
  const subset = [2, 10, '15', 'abc', false, null];
  const expectedAsc = [2, 10, '15', 'abc', false, null];
  const expectedDesc = [false, 'abc', '15', 10, 2, null];
  let count = 0;
  for (const perm of permutations(subset)) {
    assert.deepEqual(sorted(perm), expectedAsc);
    assert.deepEqual(sorted(perm, 'DESC'), expectedDesc);
    count++;
  }
  assert.equal(count, 720);
});
