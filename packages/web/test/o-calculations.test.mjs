import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { suggestCalculation } from '@opensight/o-interpreter';
import { CalculationDialog } from '../build/test/Author.js';
import { BuildForMe } from '../build/test/BuildForMe.js';
import { dataFields, defaults, expressionError } from '../build/test/authoring.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
test('all generated templates validate and execute in the Phase 2c library', () => {
  const names = [{ name: 'first_name', expression: "'Ada'", role: 'dimension' }, { name: 'last_name', expression: "'Lovelace'", role: 'dimension' }];
  for (const prompt of ['profit margin', 'year over year sales growth', 'full name']) {
    const c = suggestCalculation(prompt, dataFields(names)).suggestion; assert.ok(c);
    assert.equal(expressionError(c.expression, dataFields(names)), undefined);
    const calculations = [...names, c];
    const v = { ...defaults(), id: 'visual-1', kind: c.role === 'dimension' ? 'table' : prompt.includes('growth') ? 'line' : 'kpi', title: '', donut: false,
      dimension: c.role === 'dimension' ? c.name : prompt.includes('growth') ? 'order_date' : null,
      rows: c.role === 'dimension' ? [c.name] : [], measures: [c.role === 'dimension' ? 'revenue' : c.name] };
    const r = executeFixtureQuery(buildAuthorQuery(v, calculations)); assert.ok(r.rows, r.message);
    if (prompt === 'profit margin') assert.equal(r.rows[0][c.name], 135 / 900);
    if (prompt === 'full name') assert.equal(r.rows[0][c.name], 'Ada Lovelace');
    if (prompt.includes('growth')) assert.ok(r.rows.every(row => row[c.name] === null));
  }
});
test('Build for me insert changes the editor; discard preserves it; save remains explicit', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; const saved = [];
  await act(() => { renderer = create(createElement(CalculationDialog, { fields: [], onSave: f => saved.push(f), onClose() {} })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const label = text => renderer.root.findAllByType('label').find(n => n.children[0] === text);
  const button = text => renderer.root.findAllByType('button').find(n => n.props.children === text);
  const change = async (node, value) => act(() => node.props.onChange({ target: { value } }));
  const click = async text => { assert.ok(button(text), text); await act(() => button(text).props.onClick()); };
  await change(label('Name').findByType('input'), 'My margin');
  await change(label('Expression').findByType('textarea'), '123');
  await change(label('Describe a calculated field').findByType('input'), 'profit margin');
  await click('Suggest expression'); await click('DISCARD');
  assert.equal(label('Expression').findByType('textarea').props.value, '123'); assert.equal(saved.length, 0);
  await click('Suggest expression'); await click('INSERT EXPRESSION');
  assert.equal(label('Expression').findByType('textarea').props.value, 'sum({profit}) / nullIf(sum({revenue}), 0)');
  assert.equal(label('Name').findByType('input').props.value, 'My margin'); assert.equal(saved.length, 0);
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saved.length, 1); assert.equal(saved[0].name, 'My margin');
  await change(label('Describe a calculated field').findByType('input'), 'forecast(revenue)'); await click('Suggest expression');
  assert.match(JSON.stringify(renderer.toJSON()), /forecast/); assert.equal(button('INSERT EXPRESSION'), undefined);
});
test('changing a generation request removes stale suggestions before insert', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(BuildForMe, { fields: [], onInsert() { assert.fail('No insert expected'); } })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const change = value => act(() => renderer.root.findAllByType('input').find(n => n.props.maxLength === 2000).props.onChange({ target: { value } }));
  await change('profit margin');
  await act(() => renderer.root.findAllByType('button')[0].props.onClick());
  assert.equal(renderer.root.findAllByType('pre').length, 1);
  await change('unsupported'); assert.equal(renderer.root.findAllByType('pre').length, 0);
});
