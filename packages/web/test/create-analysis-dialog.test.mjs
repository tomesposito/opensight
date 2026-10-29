import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateAnalysisDialog } from '../build/test/CreateAnalysisDialog.js';

const source = (id, extra = {}) => ({ id, ref: { dataset: id }, name: `Dataset ${id}`, connectorId: 'file', columns: [{ name: 'amount', type: 'INTEGER' }], available: true, execution: { mode: 'BLAZE' }, ...extra });
async function mount(t, props = {}) {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const selected = [], actions = [], created = [];
  const defaults = { onSelect: (dataset, draft) => { selected.push(dataset); created.push(draft); }, onClose: () => actions.push('close') };
  let renderer; await act(() => { renderer = create(createElement(CreateAnalysisDialog, { ...defaults, ...props })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const button = name => renderer.root.findAllByType('button').find(b => b.props.children === name || b.props['aria-label'] === name);
  return { selected, actions, created, button, get root() { return renderer.root; }, text: () => JSON.stringify(renderer.toJSON()),
    radios: () => renderer.root.findAllByType('input').filter(i => i.props.type === 'radio'),
    click: name => act(() => button(name).props.onClick()),
    search: value => act(() => renderer.root.findByProps({ type: 'search' }).props.onChange({ target: { value } })),
    submit: () => act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })),
    update: next => act(() => renderer.update(createElement(CreateAnalysisDialog, { ...defaults, ...props, ...next }))),
  };
}

test('dialog has named columns, disabled Topics explanation, pagination and empty-first actions', async t => {
  let creates = 0;
  const ui = await mount(t, { onCreateDataset: () => creates++ });
  assert.match(ui.text(), /Choose a dataset or topic to create an analysis/);
  for (const name of ['Dataset name', 'Type', 'Source', 'Owner', 'Last modified']) assert.ok(ui.root.findAllByType('th').some(th => th.props.children === name));
  assert.equal(ui.button('Topics').props.disabled, true); assert.match(ui.text(), /Topics need a hosted API/);
  assert.match(ui.text(), /No datasets yet/); assert.deepEqual(ui.radios(), []);
  assert.equal(ui.root.findByType('select').props.value, 25);
  for (const name of ['Select', 'Previous page', 'Next page']) assert.equal(ui.button(name).props.disabled, true);
  await ui.submit(); assert.deepEqual(ui.selected, []);
  await ui.click('Create dataset'); assert.equal(creates, 1);
  await ui.click('Cancel'); await ui.click('Close Create Analysis');
  let prevented = false;
  await act(() => ui.root.findByType('dialog').props.onCancel({ preventDefault() { prevented = true; } }));
  assert.ok(prevented); assert.deepEqual(ui.actions, ['close', 'close', 'close']);
});

test('prepared uploads and database datasets bind the exact schema; raw inputs cannot be selected', async t => {
  const sources = [source('upload'), source('database', { connectorId: 'postgresql', execution: { mode: 'DIRECT_QUERY' } }), { ...source('raw'), ref: 'raw' }];
  const ui = await mount(t, { client: { listPrepSources: async () => sources } });
  assert.equal(ui.radios().length, 2); assert.match(ui.text(), /BLAZE/); assert.match(ui.text(), /Direct query/);
  assert.match(ui.text(), /PostgreSQL/); assert.doesNotMatch(ui.text(), /Dataset raw/);
  assert.equal(ui.button('Select').props.disabled, true);
  await act(() => ui.radios()[1].props.onChange()); await ui.submit();
  assert.deepEqual(ui.selected, [{ id: 'database', name: 'Dataset database', columns: sources[1].columns }]);
  assert.match(ui.text(), /Owner is not supplied/); assert.match(ui.text(), /Modification date is not supplied/);
});

test('name search is case-insensitive, trims whitespace and clears hidden selections', async t => {
  const ui = await mount(t, { client: { listPrepSources: async () => [source('alpha'), source('beta')] } });
  await act(() => ui.radios()[0].props.onChange());
  await ui.search(' BETA '); assert.equal(ui.radios().length, 1); assert.match(ui.text(), /Dataset beta/);
  assert.equal(ui.button('Select').props.disabled, true); await ui.submit(); assert.deepEqual(ui.selected, []);
  await ui.search('postgresql'); assert.match(ui.text(), /No datasets match your search/);
  await ui.search(''); assert.equal(ui.radios().length, 2);
});

test('pagination shows 25 rows, changes page size and never submits a hidden row', async t => {
  const ui = await mount(t, { client: { listPrepSources: async () => Array.from({ length: 53 }, (_, i) => source(String(i))) } });
  assert.equal(ui.radios().length, 25);
  await act(() => ui.radios()[0].props.onChange()); await ui.click('Next page');
  assert.equal(ui.radios().length, 25); assert.equal(ui.button('Select').props.disabled, true);
  await ui.click('Next page'); assert.equal(ui.radios().length, 3); assert.equal(ui.button('Next page').props.disabled, true);
  await ui.click('Previous page'); assert.equal(ui.radios().length, 25);
  await act(() => ui.root.findByType('select').props.onChange({ target: { value: '50' } }));
  assert.equal(ui.radios().length, 50); assert.equal(ui.button('Previous page').props.disabled, true);
  await ui.click('Next page'); await ui.search('Dataset 0'); assert.equal(ui.radios().length, 1);
});

test('unavailable datasets expose their named error and cannot bypass Select through a handler', async t => {
  const ui = await mount(t, { client: { listPrepSources: async () => [source('denied', { available: false, errorCode: 'PREP_SECURITY_REJECTED', connectorId: 'prepared' })] } });
  assert.equal(ui.radios()[0].props.disabled, true); assert.match(ui.text(), /PREP_SECURITY_REJECTED/);
  await act(() => ui.radios()[0].props.onChange()); await ui.submit(); assert.deepEqual(ui.selected, []);
});

test('loading and failed refresh discard stale selections; retry can recover', async t => {
  let finish, fail = false, pending = false;
  const listPrepSources = () => pending ? new Promise(resolve => { finish = resolve; }) : fail ? Promise.reject(Object.assign(new Error('Access denied'), { code: 'SECURITY_BUILD_REQUIRED' })) : Promise.resolve([source('one')]);
  const ui = await mount(t, { client: { listPrepSources } });
  await act(() => ui.radios()[0].props.onChange()); pending = true;
  await ui.click('Refresh datasets'); assert.match(ui.text(), /Loading datasets/); assert.equal(ui.button('Select').props.disabled, true);
  await ui.submit(); assert.deepEqual(ui.selected, []);
  await act(() => finish([source('one')])); assert.equal(ui.button('Select').props.disabled, true);
  pending = false; fail = true; await ui.click('Refresh datasets');
  assert.match(ui.text(), /SECURITY_BUILD_REQUIRED/); assert.equal(ui.radios().length, 0);
  fail = false; await ui.click('Refresh datasets'); assert.equal(ui.radios().length, 1);
});

test('late responses from a previous client do not replace the current catalog', async t => {
  let finish;
  const ui = await mount(t, { client: { listPrepSources: () => new Promise(resolve => { finish = resolve; }) } });
  await ui.update({ client: { listPrepSources: async () => [source('current')] } });
  await act(() => finish([source('old')])); assert.match(ui.text(), /Dataset current/); assert.doesNotMatch(ui.text(), /Dataset old/);
});

test('sample requires opt-in and uses the existing implicit sales binding without a prepared ID', async t => {
  const ui = await mount(t, { offline: true });
  assert.equal(ui.radios().length, 0); assert.equal(ui.button('Create dataset').props.disabled, true);
  await ui.update({ sampleAvailable: true }); assert.match(ui.text(), /Sample sales data/); assert.match(ui.text(), /Synthetic sample/);
  await act(() => ui.radios()[0].props.onChange()); await ui.submit(); assert.deepEqual(ui.selected, [undefined]);
  await ui.update({ sampleAvailable: false }); await ui.submit(); assert.deepEqual(ui.selected, [undefined]);
});

test('catalog failures never silently fall back to the sample', async t => {
  const ui = await mount(t, { sampleAvailable: true, client: { listPrepSources: async () => { throw new Error('Offline'); } } });
  assert.match(ui.text(), /Could not load datasets/); assert.equal(ui.radios()[0].props.disabled, true);
  await act(() => ui.radios()[0].props.onChange()); await ui.submit(); assert.deepEqual(ui.selected, []);
});

test('dataset-empty state uses the shared illustrated empty page with a working Create dataset CTA', async t => {
  let creates = 0;
  const ui = await mount(t, { onCreateDataset: () => creates++ });
  const empty = ui.root.findByProps({ className: 'dataset-picker-empty' });
  assert.equal(empty.props.role, 'status');
  const art = empty.findByProps({ className: 'empty-page-illustration' });
  assert.equal(art.type, 'svg'); assert.equal(art.props['aria-hidden'], 'true');
  assert.match(ui.text(), /No datasets yet\. Create a dataset to get started/);
  assert.deepEqual(ui.root.findAllByProps({ className: 'dataset-picker-status' }), []);
  const cta = empty.findByType('button');
  assert.equal(cta.props.children, 'Create dataset'); assert.equal(cta.props.className, 'primary-button');
  await act(() => cta.props.onClick()); assert.equal(creates, 1);
});

test('dataset-empty state renders guidance and artwork without a CTA when creating is unavailable', async t => {
  const ui = await mount(t);
  const empty = ui.root.findByProps({ className: 'dataset-picker-empty' });
  assert.match(ui.text(), /No datasets yet/);
  assert.equal(empty.findByProps({ className: 'empty-page-illustration' }).type, 'svg');
  assert.deepEqual(empty.findAllByType('button'), []);
});

test('search with no matches keeps the text status and shows no illustration', async t => {
  const ui = await mount(t, { client: { listPrepSources: async () => [source('alpha')] } });
  await ui.search('zzz');
  assert.match(ui.text(), /No datasets match your search/);
  assert.deepEqual(ui.root.findAllByProps({ className: 'empty-page-illustration' }), []);
});

test('dialog empty state is compacted inside the skeleton reserved height (no loading->loaded shift)', async t => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.create-analysis-dialog\s+\.empty-page-state\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.create-analysis-dialog\s+\.empty-page-illustration\s*\{[^}]*width:\s*96px/);
});

test('static dialog renders the public sample honestly without fetching or invented dates', () => {
  const html = renderToStaticMarkup(createElement(CreateAnalysisDialog, { sampleAvailable: true, offline: true, onClose() {}, onSelect() {} }));
  assert.match(html, /BLAZE/); assert.doesNotMatch(html, /SPICE|<time|SNOWFLAKE/);
  assert.match(html, /Creating datasets needs a local or hosted API/);
});

test('field search picks close matches with keyboard/pointer and blocks unresolved tokens from submission', async t => {
  const ui = await mount(t, { sampleAvailable: true });
  await act(() => ui.radios()[0].props.onChange());
  const input = () => ui.root.findByProps({ role: 'combobox' });
  const query = value => act(() => input().props.onChange({ target: { value } }));
  await query('revenu');
  assert.match(ui.text(), /Unknown field.*revenu/); assert.match(ui.text(), /Closest measure fields/);
  assert.equal(ui.button('Create analysis').props.disabled, true); await ui.submit(); assert.deepEqual(ui.selected, []);
  const key = (key, extra = {}) => act(() => input().props.onKeyDown({ key, preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...extra }));
  await key('Enter', { nativeEvent: { isComposing: true } }); assert.equal(input().props.value, 'revenu');
  await key('Enter'); assert.equal(input().props.value, '[revenue]'); assert.equal(input().props['aria-expanded'], false);
  await ui.click('Add by dimension');
  await query('[revenue] by regon');
  assert.match(ui.text(), /Unknown field.*regon/); await ui.submit(); assert.deepEqual(ui.selected, []);
  const options = () => ui.root.findAllByProps({ role: 'option' });
  assert.equal(options()[0].findByProps({ className: 'search-name' }).props.children, 'region');
  await key('ArrowDown'); assert.equal(options()[1].props['aria-selected'], true);
  await key('ArrowUp'); assert.equal(options()[0].props['aria-selected'], true);
  await key('Escape'); assert.equal(input().props['aria-expanded'], false);
  await act(() => input().props.onFocus()); await act(() => options()[0].props.onClick());
  await ui.submit(); assert.equal(ui.created.length, 1);
  assert.equal(ui.created[0].sheets[0].visuals[0].kind, 'bar');
  assert.deepEqual(ui.created[0].sheets[0].visuals[0].measures, ['revenue']);
  assert.equal(ui.created[0].sheets[0].visuals[0].dimension, 'region');
});

test('typed KPI search creates a normal dataset-bound draft and dataset switches/refresh discard stale tokens', async t => {
  const ui = await mount(t, { client: { listPrepSources: async () => [source('one'), source('two', { columns: [{ name: 'total', type: 'DECIMAL' }] })] } });
  await act(() => ui.radios()[0].props.onChange());
  const input = () => ui.root.findByProps({ role: 'combobox' });
  await act(() => input().props.onChange({ target: { value: 'amount' } })); await ui.submit();
  assert.equal(ui.created[0].dataset.id, 'one'); assert.equal(ui.created[0].sheets[0].visuals[0].kind, 'kpi');
  await act(() => ui.radios()[1].props.onChange()); assert.equal(input().props.value, '');
  await act(() => input().props.onChange({ target: { value: 'amount' } }));
  assert.match(ui.text(), /Unknown field.*amount/); assert.match(ui.text(), /total/); await ui.submit(); assert.equal(ui.created.length, 1);
  await ui.click('Refresh datasets'); await ui.submit(); assert.equal(ui.created.length, 1);
  await act(() => ui.radios()[0].props.onChange()); assert.equal(input().props.value, '');
});

test('ambiguous fields do not create analyses through the dialog submit handler', async t => {
  const ui = await mount(t, { client: { listPrepSources: async () => [source('ambiguous', { columns: [{ name: 'Amount', type: 'INTEGER' }, { name: 'amount', type: 'INTEGER' }] })] } });
  await act(() => ui.radios()[0].props.onChange());
  await act(() => ui.root.findByProps({ role: 'combobox' }).props.onChange({ target: { value: 'amount' } }));
  assert.match(ui.text(), /Ambiguous field/); await ui.submit(); assert.deepEqual(ui.created, []);
});
