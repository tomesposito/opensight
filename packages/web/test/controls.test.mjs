import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ControlInput } from '../build/test/ControlInput.js';
import { controlError, validateControls } from '../build/test/controls.js';
const p = (type, multiple = false) => ({ id: 'parameter-1', name: 'P', type, multiple, values: [], defaultValues: [] });
test('all four control kinds bind compatible parameters and render native inputs', () => {
  for (const [kind, parameter, pattern] of [['dropdown', p('string'), /<select/], ['dropdown', p('string', true), /multiple=""/], ['slider', p('number'), /type="range"/], ['date', p('datetime'), /type="date"/], ['text', p('string'), /type="text"/]]) {
    const control = { id: 'c', parameterId: parameter.id, label: 'Selection', kind, ...(kind === 'slider' ? { min: 0, max: 100, step: 1 } : {}) };
    assert.equal(controlError(control, [parameter]), undefined);
    assert.match(renderToStaticMarkup(createElement(ControlInput, { control, parameter, onChange() {} })), pattern);
  }
  assert.ok(controlError({ kind: 'slider', parameterId: 'parameter-1', min: 0, max: 5, step: 1 }, [p('string')]));
  assert.ok(controlError({ kind: 'text', parameterId: 'parameter-1' }, [p('string', true)]));
});
test('cascading controls reject unresolved parents and cycles', () => {
  const base = { label: 'C', kind: 'dropdown', parameterId: 'parameter-1', source: { columnName: 'region', dataSetIdentifier: 'sales_data', local: true } };
  const controls = [{ ...base, id: 'a', cascade: [{ controlId: 'b', columnName: 'category' }] }, { ...base, id: 'b', cascade: [{ controlId: 'a', columnName: 'region' }] }];
  assert.throws(() => validateControls(controls, [p('string')]), /cycle/);
  assert.throws(() => validateControls(controls.slice(0, 1), [p('string')]), /cascade/);
});
