import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, dataFields, emptyDraft, fieldGroup, SALES_FIELDS } from '../build/test/authoring.js';

async function mount(t, initial = authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' })) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft;
  function Harness() {
    const [state, dispatch] = useReducer(authorReducer, initial); draft = state;
    return createElement(AuthorCanvas, { draft, dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const groups = () => renderer.root.findAllByProps({ className: 'field-group' });
  const group = name => groups().find(g => g.findByType('summary').children.includes(name));
  const button = name => renderer.root.findByProps({ 'aria-label': name });
  return { renderer, groups, group, button, state: () => draft,
    toggle: async (name, open) => act(() => group(name).props.onToggle({ currentTarget: { open } })),
    search: async value => act(() => renderer.root.findByProps({ type: 'search' }).props.onChange({ target: { value } })),
    click: async name => act(() => button(name).props.onClick()),
  };
}

test('derived groups partition base and calculated fields once without changing roles or source fields', () => {
  const source = structuredClone(SALES_FIELDS);
  const calculations = [{ name: 'region_id', role: 'measure', expression: '{revenue} - {profit}' }];
  const fields = dataFields(calculations);
  assert.deepEqual(fields.map(f => [f.name, f.group]), [
    ['order_id', 'Metadata'], ['order_date', 'Metadata'], ['region', 'Geography'],
    ['category', 'Sales'], ['revenue', 'Sales'], ['profit', 'Sales'], ['region_id', 'Calculated'],
  ]);
  assert.equal(new Set(fields.map(f => f.name)).size, fields.length);
  assert.deepEqual(fields.map(({ group, ...f }) => f), [...source, { name: 'region_id', role: 'measure', type: 'DECIMAL' }]);
  assert.deepEqual(SALES_FIELDS, source);
  assert.deepEqual(calculations, [{ name: 'region_id', role: 'measure', expression: '{revenue} - {profit}' }]);
  assert.equal(fieldGroup({ name: 'future_field', type: 'BOOLEAN', role: 'dimension' }), 'Sales');
  assert.equal(fieldGroup({ name: 'created_at', type: 'DATETIME', role: 'dimension' }), 'Metadata');
});

test('folder sections default expanded, contain each field once, and collapse independently of draft state', async t => {
  const ui = await mount(t);
  assert.equal(ui.groups().length, 3);
  assert.ok(ui.groups().every(g => g.props.open));
  assert.equal(ui.groups().flatMap(g => g.findAllByType('button')).length, SALES_FIELDS.length);
  for (const field of dataFields()) assert.ok(ui.group(field.group).findByProps({ 'aria-label': `Assign ${field.name}` }));
  const before = structuredClone(ui.state());
  await ui.toggle('Metadata', false);
  assert.equal(ui.group('Metadata').props.open, false);
  assert.equal(ui.group('Geography').props.open, true);
  assert.deepEqual(ui.state(), before);
  await ui.toggle('Metadata', true);
  assert.equal(ui.group('Metadata').props.open, true);
});

test('semantic folders preserve assignment to the selected columns well and numeric values', async t => {
  const ui = await mount(t);
  const columnsWell = ui.renderer.root.findAllByType('fieldset').find(f => f.findByType('legend').children.includes('COLUMNS'));
  await act(() => columnsWell.props.onClick());
  await ui.click('Assign category');
  await ui.click('Assign profit');
  const visual = activeSheet(ui.state()).visuals[0];
  assert.deepEqual(visual.columns, ['category']);
  assert.deepEqual(visual.rows, ['region']);
  assert.deepEqual(visual.measures, ['revenue', 'profit']);
});

test('calculated fields have their own expanded section and preserve assign labels', async t => {
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  draft = authorReducer(draft, { type: 'calculation-add', field: { name: 'Net', role: 'measure', expression: '{revenue} - {profit}' } });
  const ui = await mount(t, draft);
  assert.equal(ui.group('Calculated').props.open, true);
  assert.equal(ui.group('Calculated').findAllByType('button').length, 1);
  await ui.click('Assign Net');
  assert.ok(activeSheet(ui.state()).visuals[0].measures.includes('Net'));
});

test('assignment buttons retain their names and reference accessible type or geography descriptions', async t => {
  const ui = await mount(t);
  for (const [name, label] of [['order_id', 'Integer'], ['order_date', 'Date and time'], ['region', 'Geography · Text'], ['category', 'Text'], ['revenue', 'Decimal']]) {
    const button = ui.button(`Assign ${name}`);
    const icon = button.findByProps({ role: 'img' });
    assert.equal(icon.props['aria-label'], label);
    assert.equal(button.props['aria-describedby'], icon.props.id);
    assert.equal(icon.props['aria-hidden'], undefined);
  }
});

test('search matches across folders, hides empty groups and restores previous collapse choices', async t => {
  const ui = await mount(t);
  await ui.toggle('Metadata', false);
  const before = structuredClone(ui.state());
  await ui.search('  OrDeR  ');
  assert.equal(ui.groups().length, 1);
  assert.equal(ui.group('Metadata').props.open, true);
  assert.equal(ui.group('Metadata').findAllByType('button').length, 2);
  await ui.toggle('Metadata', false);
  assert.equal(ui.group('Metadata').props.open, false);
  await ui.search('order_date');
  assert.equal(ui.group('Metadata').props.open, true);
  assert.equal(ui.group('Metadata').findAllByType('button').length, 1);
  await ui.search('re');
  assert.ok(ui.group('Geography'));
  assert.ok(ui.group('Sales'));
  assert.equal(ui.group('Metadata'), undefined);
  await ui.search('');
  assert.equal(ui.group('Metadata').props.open, false);
  assert.equal(ui.groups().length, 3);
  assert.deepEqual(ui.state(), before);
});

test('search includes calculations, supports assignment of results and exposes one empty state', async t => {
  let initial = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  initial = authorReducer(initial, { type: 'calculation-add', field: { name: 'Net profit', role: 'measure', expression: '{revenue} - {profit}' } });
  const ui = await mount(t, initial);
  await ui.search('PROFIT');
  assert.equal(ui.groups().length, 2);
  assert.equal(ui.group('Calculated').findAllByType('button').length, 1);
  await ui.click('Assign Net profit');
  assert.ok(activeSheet(ui.state()).visuals[0].measures.includes('Net profit'));
  await ui.search('missing_xyz');
  assert.equal(ui.groups().length, 0);
  const empty = ui.renderer.root.findAllByType('p').filter(p => p.props.children === 'No matching fields.');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].props.role, 'status');
});
