import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateAnalysisDialog } from '../build/test/CreateAnalysisDialog.js';

const source = (id, extra = {}) => ({ id, ref: { dataset: id }, name: `Dataset ${id}`, connectorId: 'file', columns: [{ name: 'amount', type: 'INTEGER' }], available: true, execution: { mode: 'BLAZE' }, ...extra });
async function mount(t, props = {}) {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const selected = [], actions = [];
  const defaults = { onSelect: dataset => selected.push(dataset), onClose: () => actions.push('close') };
  let renderer; await act(() => { renderer = create(createElement(CreateAnalysisDialog, { ...defaults, ...props })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const button = name => renderer.root.findAllByType('button').find(b => b.props.children === name || b.props['aria-label'] === name);
  return { selected, actions, button, get root() { return renderer.root; }, text: () => JSON.stringify(renderer.toJSON()),
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

test('static dialog renders the public sample honestly without fetching or invented dates', () => {
  const html = renderToStaticMarkup(createElement(CreateAnalysisDialog, { sampleAvailable: true, offline: true, onClose() {}, onSelect() {} }));
  assert.match(html, /BLAZE/); assert.doesNotMatch(html, /SPICE|<time|SNOWFLAKE/);
  assert.match(html, /Creating datasets needs a local or hosted API/);
});
