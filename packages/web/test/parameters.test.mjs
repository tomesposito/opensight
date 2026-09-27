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
