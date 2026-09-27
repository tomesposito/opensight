import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorReducer, emptyDraft, loadDraft, saveDraft, validateDraft } from '../build/test/authoring.js';
import { importBundle } from '../build/test/bundle-authoring.js';
import { parameterValueError } from '../build/test/parameters.js';
const parameter = { name: 'Region', type: 'string', multiple: true, defaultValues: ['East'], values: ['East'] };
test('declared parameter values and defaults persist and invalid assignments are rejected', () => {
  let d = authorReducer(emptyDraft(), { type: 'parameter-add', parameter });
  d = authorReducer(d, { type: 'parameter-value', id: 'parameter-1', values: ['West', 'East'] });
  assert.deepEqual(d.parameters[0].values, ['West', 'East']);
  assert.deepEqual(d.parameters[0].defaultValues, ['East']);
  assert.deepEqual(authorReducer(d, { type: 'parameter-value', id: 'parameter-1', values: [3] }), d);
  let saved; const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  saveDraft(d, () => storage); assert.deepEqual(loadDraft(() => storage).draft, d);
  d.parameters[0].values = [true]; assert.throws(() => validateDraft(d));
});
test('single/multi values enforce type, integer, date and duplicate constraints', () => {
  for (const [p, values] of [[{ type: 'number' }, ['1']], [{ type: 'number' }, [Infinity]], [{ type: 'number', integer: true }, [1.5]], [{ type: 'string' }, ['A', 'B']], [{ type: 'datetime' }, ['2025-02-30']], [{ type: 'datetime' }, ['today']], [{ type: 'string', multiple: true }, ['A', 'A']]]) assert.ok(parameterValueError({ name: 'P', multiple: false, ...p }, values));
  assert.equal(parameterValueError({ name: 'P', type: 'datetime', multiple: false }, ['2025-02-28T00:00:00Z']), undefined);
});
test('four synthetic bundle declaration variants become typed live parameters', () => {
  const resource = JSON.parse(readFileSync(new URL('../../bundle-parser/test/fixtures/synthetic/analysis/feature-variants.json', import.meta.url)));
  const d = importBundle({ members: [{ path: 'analysis/feature-variants.json', resource }] });
  assert.deepEqual(d.parameters.map(p => [p.name, p.type, p.multiple, p.integer]), [['Region', 'string', true, undefined], ['AsOf', 'datetime', false, undefined], ['Periods', 'number', false, true], ['MinimumRevenue', 'number', false, false]]);
  assert.match(JSON.stringify(d.bundle.report), /live; static defaults imported/);
});

import { buildAuthorQuery, buildControlQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { activeSheet } from '../build/test/authoring.js';
test('fixture controls feed parameter filters and transitive calculated expressions', () => {
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' });
  d = authorReducer(d, { type: 'parameter-add', parameter });
  d = authorReducer(d, { type: 'filter-parameter', columnName: 'region', parameterName: 'Region' });
  const query = () => buildAuthorQuery(activeSheet(d).visuals[0], d.calculatedFields, d.parameters);
  assert.deepEqual(executeFixtureQuery(query()).rows, [{ revenue: 500 }]);
  d = authorReducer(d, { type: 'parameter-value', id: 'parameter-1', values: ['West'] });
  assert.deepEqual(executeFixtureQuery(query()).rows, [{ revenue: 400 }]);
  d = authorReducer(d, { type: 'parameter-add', parameter: { name: 'Scale', type: 'number', multiple: false, values: [2], defaultValues: [1] } });
  d = authorReducer(d, { type: 'calculation-add', field: { name: 'Scaled', expression: '{revenue} * ${Scale}', role: 'measure' } });
  d = authorReducer(d, { type: 'calculation-add', field: { name: 'Chained', expression: '{Scaled} + 1', role: 'measure' } });
  d = authorReducer(d, { type: 'assign', field: 'Chained', well: 'values' });
  assert.deepEqual(executeFixtureQuery(query()).rows, [{ Chained: 803 }]);
  d = authorReducer(d, { type: 'parameter-value', id: 'parameter-1', values: [] });
  assert.deepEqual(executeFixtureQuery(query()).rows, [{ Chained: null }]);
});
test('cascading option queries use parent selections and unrelated parameters do not alter visual requests', () => {
  const parameters = [{ ...parameter, id: 'parameter-1' }, { ...parameter, id: 'parameter-2', name: 'Category', values: ['Software'] }];
  const controls = [{ id: 'region', parameterId: 'parameter-1' }, { id: 'category', parameterId: 'parameter-2', source: { columnName: 'order_date', local: true }, cascade: [{ controlId: 'region', columnName: 'region' }, { controlId: 'software', columnName: 'category' }] }, { id: 'software', parameterId: 'parameter-2' }];
  // Choose category values narrowed by an explicit date parent in a second query.
  const regionOnly = buildControlQuery({ ...controls[1], source: { columnName: 'category', local: true }, cascade: [controls[1].cascade[0]] }, controls, parameters);
  assert.deepEqual(executeFixtureQuery(regionOnly).rows.map(r => r.category), ['Hardware', 'Software']);
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' });
  assert.deepEqual(buildAuthorQuery(activeSheet(d).visuals[0], [], parameters), buildAuthorQuery(activeSheet(d).visuals[0]));
});
