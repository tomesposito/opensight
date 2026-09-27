import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { AuthorCanvas } from '../build/test/Author.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { authorReducer, emptyDraft, activeSheet } from '../build/test/authoring.js';
const p = (name, values = ['East']) => ({ name, type: 'string', multiple: false, values, defaultValues: values });
async function mount(t, initial, client) {
  const old = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let draft, dispatch, renderer;
  function Harness() { [draft, dispatch] = useReducer(authorReducer, initial); return createElement(AuthorCanvas, { draft, dispatch, client }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = old; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  const click = async name => { const b = find('button', p => (Array.isArray(p.children) ? p.children.join('') : p.children) === name || p['aria-label'] === name); assert.ok(b, name); await act(() => b.props.onClick({ stopPropagation() {} })); };
  const change = async (node, value) => { assert.ok(node); await act(() => node.props.onChange({ target: { value, checked: value, selectedOptions: Array.isArray(value) ? value.map(value => ({ value })) : [] } })); };
  return { find, click, change, renderer, state: () => draft, dispatch: async a => act(() => dispatch(a)), label: label => renderer.root.findAllByType('label').find(n => n.children[0] === label) };
}
const initial = () => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }), { type: 'parameter-add', parameter: p('Region') });
test('sheet controls can be created, reordered, rebound and removed; selections recompute fixture visuals', async t => {
  const ui = await mount(t, initial());
  await ui.click('+ Add control');
  await ui.change(ui.label('Control label').findByType('input'), 'Region choice');
  await ui.change(ui.label('Options (one per line)').findByType('textarea'), 'East\nWest');
  await act(() => ui.find('form', p => p['aria-label'] === 'Add control').props.onSubmit({ preventDefault() {} }));
  await ui.click('Apply parameter filter');
  assert.deepEqual(ui.renderer.root.findByType(VisualCard).props.visual.rows, [{ revenue: 500 }]);
  await ui.change(ui.find('select', p => p['aria-label'] === 'Region choice'), 'West');
  assert.deepEqual(ui.state().parameters[0].values, ['West']);
  assert.deepEqual(ui.renderer.root.findByType(VisualCard).props.visual.rows, [{ revenue: 400 }]);
  await ui.click('Reset Region choice');
  assert.deepEqual(ui.state().parameters[0].values, ['East']);
  await ui.dispatch({ type: 'parameter-add', parameter: p('Other', ['West']) });
  await ui.dispatch({ type: 'control-add', control: { label: 'Other choice', kind: 'text', parameterId: 'parameter-2' } });
  await ui.click('Move Other choice left');
  assert.equal(activeSheet(ui.state()).controls[0].label, 'Other choice');
  await ui.change(ui.find('select', p => p['aria-label'] === 'Bind Region choice'), 'parameter-2');
  assert.equal(activeSheet(ui.state()).controls[1].parameterId, 'parameter-2');
  await ui.click('Remove Other choice'); assert.equal(activeSheet(ui.state()).controls.length, 1);
  await ui.click('+ Add sheet'); assert.equal(activeSheet(ui.state()).controls.length, 0);
});
test('data-supported cascading options narrow immediately in fixtures mode', async t => {
  let d = initial();
  d = authorReducer(d, { type: 'parameter-add', parameter: { name: 'Day', type: 'datetime', multiple: false, values: ['2025-03-01T00:00:00Z'], defaultValues: [] } });
  d = authorReducer(d, { type: 'parameter-add', parameter: p('Category', ['Hardware']) });
  d = authorReducer(d, { type: 'control-add', control: { label: 'Region', kind: 'dropdown', parameterId: 'parameter-1', options: ['East', 'West'] } });
  d = authorReducer(d, { type: 'control-add', control: { label: 'Day', kind: 'date', parameterId: 'parameter-2' } });
  d = authorReducer(d, { type: 'control-add', control: { label: 'Category', kind: 'dropdown', parameterId: 'parameter-3', source: { columnName: 'category', dataSetIdentifier: 'sales_data', local: true }, cascade: [{ controlId: 'control-1', columnName: 'region' }, { controlId: 'control-2', columnName: 'order_date' }] } });
  const ui = await mount(t, d);
  const available = () => ui.find('select', p => p['aria-label'] === 'Category').findAllByType('option').filter(n => !JSON.stringify(n.children).includes('unavailable')).map(n => n.props.value);
  assert.deepEqual(available(), ['Hardware']);
  await ui.change(ui.find('select', p => p['aria-label'] === 'Region'), 'West');
  assert.deepEqual(available(), ['Software']);
  assert.deepEqual(ui.state().parameters[2].values, ['Hardware']); // Keep explicit selection; show it as unavailable.
});

import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
test('parameters created on new sheets of an imported analysis stay in that resource', async t => {
  const bundle = exportBundle(initial()), second = structuredClone(bundle.members[0]);
  second.path = 'analysis/second.json'; second.resource.analysisId = 'second';
  second.resource.definition.parameterDeclarations[0].stringParameterDeclaration.name = 'NewRegion';
  bundle.members.push(second);
  const ui = await mount(t, importBundle(bundle));
  await ui.click('+ Add sheet'); await ui.click('+ Parameter');
  await ui.change(ui.label('Parameter name').findByType('input'), 'NewRegion');
  await ui.change(ui.label('Default values').findByType('textarea'), 'West');
  await act(() => ui.find('form', p => p['aria-label'] === 'Create parameter').props.onSubmit({ preventDefault() {} }));
  const created = ui.state().parameters.at(-1);
  assert.equal(created.name, 'NewRegion'); assert.equal(created.memberPath, 'analysis/authored-analysis.json');
  assert.equal(exportBundle(ui.state()).members[0].resource.definition.parameterDeclarations.length, 2);
  assert.equal(exportBundle(ui.state()).members[1].resource.definition.parameterDeclarations.length, 1);
});
