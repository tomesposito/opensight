import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../build/test/authoring.js';
import { projectDefinition } from '../build/test/definition-converter.js';
import { baselineInputs, input } from './fixtures/table-row-sort-inputs.mjs';

const config = value => Object.values(value.definition)[0].chartConfiguration;
const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
const sortBy = (fieldId = 'region', direction = 'ASC') => [{ fieldSort: { fieldId, direction } }];
const sorted = (value = input(), fieldId = 'region', direction = 'ASC') => {
  config(value).sortConfiguration = { rowSort: sortBy(fieldId, direction) };
  return value;
};
const definition = visual => ({ dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', name: 'Sheet', visuals: [visual] }] });
const dialect = (value, source) => source === 'api' ? { ...value, source, definition: projectDefinition(definition(value.definition)).Sheets[0].Visuals[0] } : value;
const normalize = value => normalizeVisual(value.source, value.definition, value.path);
const malformed = [null, {}, 'sort', [null], [{}], [{ fieldSort: null }], [{ fieldSort: {} }],
  sortBy('region', 'DOWN'), sortBy('region', null), sortBy('region', 'asc'),
  [{ fieldSort: { fieldId: 'region', direction: 'ASC', extra: true } }],
  [{ fieldSort: { fieldId: 'region', direction: 'ASC' }, extra: true }],
  sortBy('missing'), [...sortBy(), ...sortBy()], sortBy('')];

for (const source of ['bundle', 'api']) {
  test(`${source}: table parses bound dimensions and measures, default ASC and empty list`, () => {
    for (const fieldId of ['category', 'region', 'revenue', 'profit']) for (const direction of ['ASC', 'DESC']) {
      assert.deepEqual(normalize(dialect(sorted(input(), fieldId, direction), source)).sort, { fieldId, direction });
    }
    const value = sorted();
    delete config(value).sortConfiguration.rowSort[0].fieldSort.direction;
    assert.deepEqual(normalize(dialect(value, source)).sort, { fieldId: 'region', direction: 'ASC' });
    config(value).sortConfiguration.rowSort = [];
    assert.equal(normalize(dialect(value, source)).sort, undefined);
  });
  test(`${source}: malformed row sorts fail closed with CompileError`, () => {
    for (const rowSort of malformed) {
      const value = input();
      config(value).sortConfiguration = { rowSort };
      assert.throws(() => normalize(dialect(value, source)), CompileError, JSON.stringify(rowSort));
    }
    const value = sorted();
    config(value).sortConfiguration.rowSort.push(...sortBy());
    assert.throws(() => normalize(dialect(value, source)), /only one field sort is supported/);
    config(value).sortConfiguration.rowSort = sortBy('missing');
    assert.throws(() => normalize(dialect(value, source)), /sort references an unbound field/);
  });
  test(`${source}: sort keys and display options stay confined to their visual kinds`, () => {
    for (const key of ['categorySort', 'categoryItemsLimit', 'smallMultiplesSort', 'smallMultiplesLimitConfiguration', 'breakdownItemsLimit', 'extra']) {
      const value = sorted();
      config(value).sortConfiguration[key] = [];
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
    for (const key of ['dataLabels', 'tooltip', 'legend']) {
      const value = input();
      config(value)[key] = {};
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
    }
    for (const kind of ['bar', 'pivot', 'kpi', 'insight']) {
      const value = { ...input(), definition: serializeVisual(selected(authorReducer(emptyDraft(), { type: 'add', kind }))) };
      config(value).sortConfiguration = { rowSort: [] };
      assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
      if (kind !== 'bar') {
        config(value).sortConfiguration = {};
        assert.throws(() => normalize(dialect(value, source)), /unsupported property/);
      }
    }
  });
}

for (const direction of ['ASC', 'DESC']) {
  test(`${direction}: string, numeric and mixed cells use typed ordering with null last`, () => {
    for (const [cells, asc, desc] of [
      [['Z', null, 'A', 'M'], ['A', 'M', 'Z', null], ['Z', 'M', 'A', null]],
      [[10, null, 2, 30], [2, 10, 30, null], [30, 10, 2, null]],
      [[false, null, 'A', true], ['A', false, true, null], [true, false, 'A', null]],
    ]) {
      const value = input({ data: cells.map((category, i) => ({ category, region: String(i), revenue: i, profit: i })) });
      const original = structuredClone(value.rows);
      assert.deepEqual(compileVisual(sorted(value, 'category', direction)).table.rows.map(r => r[0]), direction === 'ASC' ? asc : desc);
      assert.deepEqual(value.rows, original, 'caller rows are not mutated');
    }
  });
  test(`${direction}: measures and later groupBy dimensions sort plain table rows stably`, () => {
    const byMeasure = compileVisual(sorted(input(), 'revenue', direction)).table.rows;
    assert.deepEqual(byMeasure.map(r => r[2]), direction === 'ASC' ? [10, 20, 30, 40, null] : [40, 30, 20, 10, null]);
    const byRegion = compileVisual(sorted(input(), 'region', direction)).table.rows;
    assert.deepEqual(byRegion.map(r => r.slice(0, 2)), direction === 'ASC'
      ? [['B', 'East'], ['A', 'East'], [null, 'North'], ['A', 'West'], ['B', 'West']]
      : [['A', 'West'], ['B', 'West'], [null, 'North'], ['B', 'East'], ['A', 'East']]);
  });
}
for (const totals of [false, true]) for (const subtotals of [false, true]) {
  if (!totals && !subtotals) continue;
  test(`totals=${totals}, subtotals=${subtotals}: interleaved measure sort keeps groups and rollup values intact`, () => {
    const value = input({ totals, subtotals });
    const unsorted = compileVisual(value).table;
    const table = compileVisual(sorted(value, 'revenue', 'DESC')).table;
    assert.deepEqual(table.rows.filter((_, i) => table.rowKinds[i] === 'detail'), [
      ['B', 'East', 40, 4], ['B', 'West', 20, 2], ['A', 'East', 30, 3], ['A', 'West', 10, 1], [null, 'North', null, null],
    ]);
    const rollups = table => Object.fromEntries(table.rows.flatMap((row, i) => table.rowKinds[i] === 'detail' ? [] : [[JSON.stringify(row.slice(0, 2)), row.slice(2)]]));
    assert.deepEqual(rollups(table), rollups(unsorted));
    if (totals) assert.deepEqual(table.rows.at(-1), ['Grand total', '', 100, 10]);
    if (subtotals) {
      assert.deepEqual(table.rowKinds.slice(0, 6), ['detail', 'detail', 'subtotal', 'detail', 'detail', 'subtotal']);
      assert.deepEqual(table.rows[2], ['B', 'Subtotal', 60, 6]);
      assert.deepEqual(table.rows[5], ['A', 'Subtotal', 40, 4]);
    }
  });
}
test('totals group numeric, string and null keys independently regardless of sorted contiguity', () => {
  const data = [1, '1', null, 1, '1', null].map((category, i) => ({ category, region: String(i), revenue: i + 1, profit: 1 }));
  const table = compileVisual(sorted(input({ data, totals: true, subtotals: true }), 'revenue', 'DESC')).table;
  assert.deepEqual(table.rows, [
    [null, '5', 6, 1], [null, '2', 3, 1], [null, 'Subtotal', 9, 2],
    ['1', '4', 5, 1], ['1', '1', 2, 1], ['1', 'Subtotal', 7, 2],
    [1, '3', 4, 1], [1, '0', 1, 1], [1, 'Subtotal', 5, 2], ['Grand total', '', 21, 6],
  ]);
});

// Captured from ddb9ea7689d32281384e75b2ee438d66d143b3d1 before compiler edits.
// Hash all compiled output, including function source, following the facet-sort precedent.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/table-row-sort-baseline.json', import.meta.url), 'utf8'));
for (const [name, value] of Object.entries(baselineInputs())) test(`unset rowSort preserves base output bytes: ${name}`, () => {
  const compiled = compileVisual(value);
  const bytes = JSON.stringify(compiled, (_, v) => typeof v === 'function' ? v.toString() : v);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), baseline.hashes[name]);
  config(value).sortConfiguration = { rowSort: [] };
  assert.deepEqual(compileVisual(value), compiled);
});
