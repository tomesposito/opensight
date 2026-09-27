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

import { act } from 'react';
import { create } from 'react-test-renderer';
test('control events emit typed selections and reset to declared defaults', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  for (const [kind, parameter, target, expected] of [
    ['dropdown', { ...p('string', true), defaultValues: ['East'] }, { selectedOptions: [{ value: 'East' }, { value: 'West' }] }, ['East', 'West']],
    ['dropdown', p('number', true), { selectedOptions: [{ value: '1' }, { value: '2' }] }, [1, 2]],
    ['slider', p('number'), { value: '2.5' }, [2.5]],
    ['date', p('datetime'), { value: '2025-03-01' }, ['2025-03-01T00:00:00Z']],
    ['text', p('string'), { value: "West' OR TRUE --" }, ["West' OR TRUE --"]],
  ]) {
    const changes = []; let renderer;
    await act(() => { renderer = create(createElement(ControlInput, { control: { id: 'c', label: 'P', kind, parameterId: parameter.id, min: 0, max: 5, step: 0.5, options: [] }, parameter, onChange: values => changes.push(values) })); });
    const input = renderer.root.findByType(kind === 'dropdown' ? 'select' : 'input');
    await act(() => input.props.onChange({ target })); assert.deepEqual(changes[0], expected);
    await act(() => renderer.root.findAllByType('button')[0].props.onClick()); assert.deepEqual(changes[1], parameter.defaultValues);
    await act(() => renderer.unmount());
  }
});
