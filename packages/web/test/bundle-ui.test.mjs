import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { assembleQsBundle, parseQsBundle } from '@opensight/bundle-parser/browser';
import { createDraftStore } from '../build/test/local-drafts.js';
import { Author } from '../build/test/Author.js';
import { authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';

async function mount(t) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  let downloaded, renderer, clicks = 0;
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { localStorage: storage, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.document = { body: { append() {} }, createElement: () => ({ click() { clicks++; }, remove() {} }) };
  URL.createObjectURL = blob => { downloaded = blob; return 'blob:local-test'; };
  URL.revokeObjectURL = () => {};
  await act(() => { renderer = create(createElement(Author)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; });
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  return { renderer, find, saved: () => createDraftStore(() => storage, { mode: 'demo' }).restore()?.draft, download: () => downloaded, clicks: () => clicks,
    text: () => JSON.stringify(renderer.toJSON()),
    button: label => find('button', p => p.children === label),
  };
}
const makeBundle = () => {
  const resource = serializeDraft(authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }));
  resource.definition.dataSetIdentifierDeclarations[0].dataSetArn = 'arn:aws:quicksight:us-east-1:123456789012:dataset/remote';
  resource.definition.sheets[0].visuals.push({ futureVisual: { visualId: 'future', opaque: true } });
  return { members: [{ path: 'analysis/authored-analysis.json', resource }] };
};
const file = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

test('file picker opens the per-resource report, displays unresolved cards and downloads a real ZIP without a server', async t => {
  const ui = await mount(t), bundle = makeBundle();
  const input = ui.find('input', p => p.type === 'file');
  assert.ok(input.props.accept.includes('.qs'));
  await act(async () => { input.props.onChange({ currentTarget: { files: [file('import.qs', await assembleQsBundle(bundle))], value: 'import.qs' } }); });
  assert.ok(ui.find('dialog', p => p['aria-labelledby'] === 'import-report-title'));
  assert.match(ui.text(), /Unsupported visual type: futureVisual/);
  assert.match(ui.text(), /analysis\/authored-analysis.json/);
  assert.match(ui.text(), /Unresolved dataset/);
  await act(() => ui.button('Close import report').props.onClick());
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  await act(async () => ui.button('Download .qs').props.onClick());
  assert.equal(ui.clicks(), 1); assert.ok(ui.download() instanceof Blob);
  assert.deepEqual(await parseQsBundle(new Uint8Array(await ui.download().arrayBuffer())), bundle);
  assert.match(ui.text(), /Export downloaded: opensight-analysis.qs/);
});

test('drag/drop handles JSON members and malformed imports leave the previous draft untouched', async t => {
  const ui = await mount(t), drop = ui.find('div', p => p['aria-label'] === 'Bundle drop zone');
  const bundle = makeBundle(), bytes = new TextEncoder().encode(JSON.stringify(bundle.members[0].resource));
  let prevented = false;
  await act(async () => drop.props.onDrop({ preventDefault() { prevented = true; }, dataTransfer: { files: [file('member.json', bytes)] } }));
  assert.equal(prevented, true);
  await act(() => ui.button('Save draft').props.onClick());
  const saved = ui.saved();
  await act(() => ui.button('Close import report').props.onClick());
  await act(async () => drop.props.onDrop({ preventDefault() {}, dataTransfer: { files: [file('bad.qs', new TextEncoder().encode('broken'))] } }));
  assert.match(ui.text(), /Import failed:.*invalid ZIP/);
  assert.deepEqual(ui.saved(), saved);
  await act(async () => drop.props.onDrop({ preventDefault() {}, dataTransfer: { files: [file('a.json', bytes), file('b.json', bytes)] } }));
  assert.match(ui.text(), /Drop one/); assert.deepEqual(ui.saved(), saved);
});

test('per-card remap action updates the stored binding and leaves unmatched assignments explicit', async t => {
  const ui = await mount(t), bundle = makeBundle();
  const wells = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells;
  wells.category[0].categoricalDimensionField.column.columnName = 'remote_region';
  const bytes = await assembleQsBundle(bundle);
  await act(async () => ui.find('input', p => p.type === 'file').props.onChange({ currentTarget: { files: [file('import.qs', bytes)], value: '' } }));
  await act(() => ui.button('Close import report').props.onClick());
  await act(() => ui.button('Remap to local dataset').props.onClick({ stopPropagation() {} }));
  await act(() => ui.button('Save draft').props.onClick());
  const visual = ui.saved().sheets[0].visuals[0];
  assert.equal(visual.imported.local, true); assert.equal(visual.dimension, null);
  assert.deepEqual(visual.imported.unmappedFields, ['remote_region']);
  assert.match(ui.text(), /Fields requiring manual assignment/);
});

test('sheet remap button updates every unresolved card in that sheet', async t => {
  const ui = await mount(t), bundle = makeBundle();
  const bytes = await assembleQsBundle(bundle);
  await act(async () => ui.find('input', p => p.type === 'file').props.onChange({ currentTarget: { files: [file('import.qs', bytes)], value: '' } }));
  await act(() => ui.button('Close import report').props.onClick());
  await act(() => ui.button('Remap sheet to local dataset').props.onClick());
  await act(() => ui.button('Save draft').props.onClick());
  assert.ok(ui.saved().sheets[0].visuals.every(v => v.imported.local));
  assert.match(ui.text(), /Unsupported visual type: futureVisual/);
});
