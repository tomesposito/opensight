import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, normalizeVisual, CompileError } from '../build/test/compiler.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual } from '../build/test/authoring.js';
import { projectDefinition } from '../build/test/definition-converter.js';
import { input } from './fixtures/table-row-sort-inputs.mjs';

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
