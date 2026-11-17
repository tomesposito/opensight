import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { PrepJoinEditor } from '../build/test/PrepJoinEditor.js';
import { newPrepStep } from '../build/test/data-prep.js';
const columns = [{ name: 'id', type: 'INTEGER' }, { name: 'amount', type: 'DECIMAL' }];
async function mount(t, component, props) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(component, props)); });
  t.after(async () => { await act(async () => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  return ui;
}
test('new joins have no keys; suggestions apply only after an explicit confirmation', async t => {
  const step = newPrepStep('join', columns, [{ id: 'a', columns, connectorId: 'file', available: true }], 'a');
  assert.deepEqual(step.config.keys, []);
  const changes = [];
  const props = { config: step.config, leftColumns: columns, rightColumns: columns, leftInput: 'Left', rightInput: 'Right', outputs: null, change: c => changes.push(c) };
  const ui = await mount(t, PrepJoinEditor, props);
  assert.equal(changes.length, 0);
  const suggestion = ui.root.findAllByType('button').find(b => [].concat(b.props.children).join('') === 'Use suggested key: id = id');
  await act(async () => suggestion.props.onClick());
  assert.deepEqual(changes[0].keys, [{ left: 'id', right: 'id' }]);
  await act(async () => ui.update(createElement(PrepJoinEditor, { ...props, config: changes[0] })));
  assert.equal(ui.root.findAllByType('button').filter(b => [].concat(b.props.children).join('') === 'Use suggested key: id = id').length, 0);
  assert.deepEqual(step.config.keys, []);
});
