import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDefinition, validateRows, reportSchema } from '../dist/index.js';
import { definition, rows } from './fixture.mjs';

test('report JSON Schema validates without mutating or coercing', () => {
  const d = definition(), before = structuredClone(d);
  validateDefinition(d); validateRows(d, rows(2)); assert.deepEqual(d, before);
  assert.equal(reportSchema.$schema, 'http://json-schema.org/draft-07/schema#');
  for (const size of ['A4', 'Letter', 'Legal']) for (const orientation of ['portrait', 'landscape']) validateDefinition({ ...d, pageSetup: { ...d.pageSetup, size, orientation } });
});
test('malformed definitions and unsupported kinds fail with named errors', () => {
  for (const mutate of [d => d.version = '1', d => d.pageSetup.margins.left = -1, d => d.pageSetup.margins.top = 149,
    d => d.pageSetup.margins.right = 149, d => d.date = '2026-02-30', d => d.extra = true,
    d => d.footer.runs = [{ field: 'unknown' }], d => d.body[0].columns[0].field.dataSetIdentifier = 'other',
    d => d.body.push(d.body[0]), d => d.body[0].summary = [1], d => d.body[0].style = { fontSize: '12' },
  ]) {
    const d = definition(); mutate(d);
    // Excessive margins need both sides to exceed available geometry.
    if (d.pageSetup.margins.top === 149) d.pageSetup.margins.bottom = 149;
    if (d.pageSetup.margins.right === 149) d.pageSetup.margins.left = 149;
    assert.throws(() => validateDefinition(d), { code: 'REPORT_INVALID_DEFINITION' });
  }
  const d = definition(); d.body[0].kind = 'chart';
  assert.throws(() => validateDefinition(d), { code: 'REPORT_UNSUPPORTED_BAND' });
});
test('rows require explicit bindings and declared column types; no silent missing data', () => {
  const d = definition(); validateRows(d, { sales: [] });
  for (const r of [{}, { sales: [{ region: 'x' }] }, { sales: [{ region: 'x', amount: '1' }] }, { sales: [{ region: 'x', amount: Infinity }] }, { sales: [], other: [] }]) assert.throws(() => validateRows(d, r), { code: 'REPORT_INVALID_ROWS' });
  assert.throws(() => validateRows(d, rows(10001)), { code: 'REPORT_LIMIT_EXCEEDED' });
});
