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
test('Venn picker exposes exactly four labeled compiler join types and keyboard navigation', async t => {
  const config = { source: 'b', joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' };
  const changes = [];
  const ui = await mount(t, PrepJoinEditor, { config, leftColumns: columns, rightColumns: columns, change: c => changes.push(c) });
  const radios = ui.root.findAllByProps({ role: 'radio' });
  assert.deepEqual(radios.map(r => r.props['aria-label']), ['Left join', 'Inner join', 'Right join', 'Full join']);
  assert.equal(radios.filter(r => r.props['aria-checked']).length, 1);
  for (const [i, radio] of radios.entries()) {
    assert.equal(radio.findByType('span').props.children, radio.props['aria-label']);
    assert.equal(radio.findByType('svg').findAllByType('circle').length, 2);
    assert.equal(radio.findByType('svg').findAllByType('path').length, [2,1,2,3][i]);
    await act(async () => radio.props.onClick());
  }
  assert.deepEqual(changes.map(c => c.joinType), ['left', 'inner', 'right', 'full']);
  for (const [index, key, expected] of [[0,'ArrowRight','inner'],[0,'ArrowLeft','full'],[2,'Home','left'],[1,'End','full']]) {
    await act(async () => radios[index].props.onKeyDown({ key, preventDefault() {}, currentTarget: {} }));
    assert.equal(changes.at(-1).joinType, expected);
    assert.deepEqual(changes.at(-1).keys, config.keys);
  }
});
