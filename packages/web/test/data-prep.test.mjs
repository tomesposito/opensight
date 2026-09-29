import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataPrep } from '../build/test/DataPrep.js';
import { PrepStepEditor } from '../build/test/PrepStepEditor.js';
import { prepBundle, prepCatalog, newPrepStep, prepSchema } from '../build/test/data-prep.js';
import { createApiClient } from '../build/test/api-client.js';
import { assembleQsBundle, parseQsBundle } from '@opensight/bundle-parser/browser';
const source = { id: 'upload-source', connectorId: 'file', columns: [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }], available: true };
const pipeline = { version: 1, input: source.id, steps: [] };
const resource = { resourceType: 'dataset', dataSetId: 'prepared', name: 'Prepared', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
test('static prep canvas shows catalog, sample schema and honest hosted-only preview/save', () => {
  const html = renderToStaticMarkup(createElement(DataPrep));
  for (const c of prepCatalog) assert.ok(html.includes(c.label), c.label);
  assert.match(html, /Ordered transformation graph/); assert.match(html, /Needs hosted API/); assert.match(html, /<button disabled="">Save pipeline/);
  assert.doesNotMatch(html, /rows shown|output rows total|Loading step preview/);
});
test('every catalog transformation has an editable configuration form', () => {
  for (const c of prepCatalog) {
    const step = newPrepStep(c.kind, source.columns, [source], source.id);
    const html = renderToStaticMarkup(createElement(PrepStepEditor, { step, columns: source.columns, sources: [source], apply() {}, cancel() {} }));
    assert.match(html, /Apply step/); assert.match(html, /<select|<input|<textarea/);
  }
});
test('prep bundle editing preserves unrelated resources and opaque dataset properties', async () => {
  const original = { members: [{ path: 'dataset/prepared.json', resource: { ...resource, opaque: { keep: true } } }, { path: 'datasource/example.json', resource: { resourceType: 'datasource', dataSourceId: 'example', name: 'Example', type: 'POSTGRESQL' } }] };
  const next = { ...pipeline, steps: [{ id: 's', kind: 'rename', config: { column: 'region', name: 'area' } }] };
  const result = await parseQsBundle(await assembleQsBundle(prepBundle(resource, next, original)));
  assert.deepEqual(result.members[1], original.members[1]); assert.deepEqual(result.members[0].resource.opaque, { keep: true });
  assert.deepEqual(result.members[0].resource.opensightPrep, next); assert.deepEqual(original.members[0].resource.opensightPrep, pipeline);
  assert.equal(prepSchema(next, [source])[0].name, 'area');
});
async function mount(t, client) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; await act(async () => { renderer = create(createElement(DataPrep, { client })); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const button = name => renderer.root.findAllByType('button').find(b => (Array.isArray(b.props.children) ? b.props.children.join('') : b.props.children) === name);
  const click = async name => { const b = button(name); assert.ok(b, name); await act(async () => { await b.props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return { renderer, click, button };
}
test('offline step addition, configuration, reordering and removal change the graph/schema', async t => {
  const ui = await mount(t);
  await ui.click('＋ Rename column');
  const form = () => ui.renderer.root.findByType(PrepStepEditor);
  await act(async () => form().findByType('input').props.onChange({ target: { value: 'area' } }));
  await act(async () => form().findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(JSON.stringify(ui.renderer.toJSON()), /area/);
  await ui.click('＋ Select columns');
  await act(async () => form().findByType('form').props.onSubmit({ preventDefault() {} }));
  await ui.click('Move earlier');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Unknown column: area/);
  await ui.click('Move later');
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /Unknown column: area/);
  await ui.click('Remove step');
  assert.equal(ui.renderer.root.findAllByProps({ className: 'prep-node-wrap' }).length, 3);
});
test('hosted previews discard late responses after switching pipeline stage', async t => {
  const pending = [], calls = [];
  const client = { async listPrepSources() { return [source]; }, async listPrepDatasets() { return { datasets: [], persistence: 'file' }; }, previewPrep(id, p, through) { calls.push([id,p,through]); return new Promise(resolve => pending.push(resolve)); }, async savePrep(id, name, p) { calls.push(['save',id,name,p]); return { resource: { ...resource, dataSetId: id, opensightPrep: p }, persistence: 'file' }; } };
  const ui = await mount(t, client);
  await act(async () => new Promise(resolve => setTimeout(resolve, 340)));
  assert.equal(pending.length, 1);
  await ui.click('＋ Rename column');
  await act(async () => ui.renderer.root.findByType(PrepStepEditor).findByType('form').props.onSubmit({ preventDefault() {} }));
  await act(async () => new Promise(resolve => setTimeout(resolve, 340)));
  assert.equal(pending.length, 2);
  const result = { columns: source.columns, rows: [], returnedRows: 0, truncated: false, totalRows: 0, rowCountLowerBound: 0, limit: 100, dialect: 'duckdb', through: null };
  await act(async () => pending[1]({ ...result, rows: [{ region_renamed: 'LATEST', amount: 1 }], returnedRows: 1, totalRows: 1 }));
  await act(async () => pending[0]({ ...result, rows: [{ region: 'STALE', amount: 9 }], returnedRows: 1, totalRows: 1 }));
  const html = JSON.stringify(ui.renderer.toJSON()); assert.match(html, /LATEST/); assert.doesNotMatch(html, /STALE/);
  await ui.click('Save pipeline'); assert.equal(calls.at(-1)[0], 'save');
});
test('prep API client uses authenticated metadata-only transport and surfaces named errors', async () => {
  const calls = [], client = createApiClient('/api', async (url, options) => { calls.push([url, options]); return new Response(JSON.stringify({}), { status: 200 }); });
  await client.savePrep('prepared', 'Prepared', pipeline); await client.previewPrep('prepared', pipeline, null, 20); await client.deletePrep('prepared');
  assert.equal(calls[0][0], '/api/api/datasets/prepared/prep'); assert.equal(calls[1][0], '/api/api/datasets/prepared/prep/preview');
  assert.equal(calls[1][1].credentials, 'same-origin'); assert.deepEqual(JSON.parse(calls[1][1].body), { pipeline, through: null, limit: 20 });
  assert.equal(calls[2][1].method, 'DELETE');
  const failed = createApiClient('/api', async () => new Response(JSON.stringify({ errorCode: 'PREP_SOURCE_NOT_FOUND', Message: 'Missing source' }), { status: 404 }));
  await assert.rejects(failed.previewPrep('prepared', pipeline, null), /PREP_SOURCE_NOT_FOUND/);
});
test('numeric filter editing preserves partially typed negative values until Apply', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, applied;
  const step = { id: 'f', kind: 'filter', config: { filters: [{ columnName: 'amount', value: 0 }] } };
  await act(async () => { renderer = create(createElement(PrepStepEditor, { step, columns: source.columns, sources: [source], apply: s => { applied = s; }, cancel() {} })); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const field = () => renderer.root.findByType('input');
  await act(async () => field().props.onChange({ target: { value: '-' } })); assert.equal(field().props.value, '-');
  await act(async () => field().props.onChange({ target: { value: '-2.5' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(applied.config.filters[0].value, -2.5);
});

async function field(renderer, label, value) {
  const holder = renderer.root.findAllByType('label').find(l => typeof l.props.children[0] === 'string' && l.props.children[0].startsWith(label));
  assert.ok(holder, label);
  const input = holder.findAll(n => typeof n.type === 'string' && ['input', 'select', 'textarea'].includes(n.type))[0];
  await act(async () => input.props.onChange({ target: { value } }));
}
const submitStep = async renderer => act(async () => renderer.root.findByType(PrepStepEditor).findByType('form').props.onSubmit({ preventDefault() {} }));
test('join editor shows types, blocks mismatched keys and collisions, and renders one node per source instance', async t => {
  const ui = await mount(t);
  await ui.click('＋ Join');
  assert.ok(ui.renderer.root.findAllByType('option').some(o => Array.isArray(o.props.children) && o.props.children.join('') === 'region · STRING'));
  await field(ui.renderer, 'Left column', 'revenue');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /PREP_SCHEMA_MISMATCH.*DECIMAL.*STRING/);
  assert.equal(ui.button('Apply step').props.disabled, true);
  await submitStep(ui.renderer);
  assert.equal(ui.renderer.root.findAllByProps({ className: 'prep-node-wrap' }).length, 2);
  await field(ui.renderer, 'Left column', 'region');
  await field(ui.renderer, 'Right output mode', 'Explicit aliases');
  await field(ui.renderer, 'Output name', 'region');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /PREP_SCHEMA_MISMATCH.*Duplicate/);
  await field(ui.renderer, 'Output name', 'lookup_region');
  await submitStep(ui.renderer);
  assert.equal(ui.renderer.root.findAll(n => n.type === 'button' && n.props.className?.includes('input-node')).length, 2);
  await ui.click('＋ Join');
  const stepOption = ui.renderer.root.findAllByType('option').find(n => typeof n.props.value === 'string' && n.props.value.startsWith('{"step":'));
  assert.ok(stepOption);
  await field(ui.renderer, 'Right source', stepOption.props.value);
  await field(ui.renderer, 'Right column prefix', 'again_');
  await submitStep(ui.renderer);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /again_lookup_region/);
  assert.equal(ui.renderer.root.findAll(n => n.type === 'button' && n.props.className?.includes('input-node')).length, 2);
  await ui.click('Move earlier');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE.*earlier step/);
  await ui.click('Move later');
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE/);
});
test('self-join instances render distinct canvas nodes with (2), (3) counters', async t => {
  const ui = await mount(t);
  await ui.click('\uFF0B Join');
  await field(ui.renderer, 'Right source', JSON.stringify('demo-sales'));
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Right source \u00B7 demo-sales \(2\)/);
  await submitStep(ui.renderer);
  await ui.click('\uFF0B Join');
  await field(ui.renderer, 'Right source', JSON.stringify('demo-sales'));
  await field(ui.renderer, 'Right column prefix', 'again_');
  await submitStep(ui.renderer);
  const html = JSON.stringify(ui.renderer.toJSON());
  assert.match(html, /demo-sales \(2\)/); assert.match(html, /demo-sales \(3\)/);
  assert.match(html, /"Source ","2"/); assert.match(html, /"Source ","3"/);
});
test('hosted prepared joins preview before save and preserve refs and aliases in bundle exports', async t => {
  const lookup = { ...resource, dataSetId: 'lookup', name: 'Lookup', opensightPrep: pipeline };
  const sources = [source, { ...source, id: 'lookup', name: 'Lookup', ref: { dataset: 'lookup' } }];
  const calls = [], saves = [];
  const client = {
    async listPrepSources() { return sources; }, async listPrepDatasets() { return { datasets: [lookup], persistence: 'file' }; },
    async previewPrep(id, p, through) { calls.push([id, p, through]); return { columns: [], rows: through ? [{ region: 'East', amount: 2, joined_region: 'JOINED ROW', joined_amount: 5 }] : [], returnedRows: through ? 1 : 0, totalRows: through ? 1 : 0, truncated: false, rowCountLowerBound: 1, limit: 100, dialect: 'duckdb', through }; },
    async savePrep(id, name, p) { saves.push(p); return { resource: { ...resource, dataSetId: id, name, opensightPrep: p }, persistence: 'file' }; },
  };
  const ui = await mount(t, client);
  await ui.click('＋ Join');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Prepared dataset · Lookup/);
  await field(ui.renderer, 'Join type', 'full');
  await submitStep(ui.renderer);
  await act(async () => new Promise(resolve => setTimeout(resolve, 340)));
  assert.equal(saves.length, 0); assert.match(JSON.stringify(ui.renderer.toJSON()), /JOINED ROW/);
  const p = calls.at(-1)[1];
  assert.deepEqual(p.steps[0].config.source, { dataset: 'lookup' }); assert.equal(p.steps[0].config.joinType, 'full');
  assert.equal(calls.at(-1)[2], p.steps[0].id);
  const roundtrip = await parseQsBundle(await assembleQsBundle(prepBundle(resource, p)));
  assert.deepEqual(roundtrip.members[0].resource.opensightPrep, p);
  await ui.click('Save pipeline'); assert.deepEqual(saves[0], p);
  await ui.click('＋ Add data');
  await field(ui.renderer, 'Connected source', JSON.stringify({ dataset: 'lookup' }));
  await act(async () => new Promise(resolve => setTimeout(resolve, 340)));
  assert.deepEqual(calls.at(-1)[1].input, { dataset: 'lookup' });
});
test('raw and prepared references with the same ID remain distinct canvas inputs', async () => {
  const { prepInputNodes } = await import('../build/test/data-prep.js');
  const step = id => ({ id, kind: 'join', config: { source: { dataset: source.id }, joinType: 'left', keys: [{ left: 'region', right: 'region' }], prefix: `${id}_` } });
  const p = { ...pipeline, steps: [step('first'), step('second')] };
  const nodes = prepInputNodes(p); assert.equal(nodes.length, 3);
  assert.equal(nodes[0].ref, source.id); assert.equal(nodes[0].instance, 1); assert.deepEqual(nodes[0].consumers, ['Input']);
  assert.deepEqual(nodes[1].ref, { dataset: source.id }); assert.equal(nodes[1].instance, 1); assert.deepEqual(nodes[1].consumers, ['1. Join']);
  assert.deepEqual(nodes[2].ref, { dataset: source.id }); assert.equal(nodes[2].instance, 2); assert.deepEqual(nodes[2].consumers, ['2. Join']);
});
test('self-joins render distinct nodes with QuickSight-style instance counters', async () => {
  const { prepInputNodes, prepInstanceLabel, prepStepSourceInstance } = await import('../build/test/data-prep.js');
  const step = id => ({ id, kind: 'join', config: { source: source.id, joinType: 'left', keys: [{ left: 'region', right: 'region' }], prefix: `${id}_` } });
  const p = { ...pipeline, steps: [step('first'), step('second')] };
  const nodes = prepInputNodes(p); assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map(n => n.instance), [1, 2, 3]);
  assert.deepEqual(nodes.map(n => n.consumers), [['Input'], ['1. Join'], ['2. Join']]);
  assert.equal(prepInstanceLabel('Product', 1), 'Product');
  assert.equal(prepInstanceLabel('Product', 2), 'Product (2)');
  assert.equal(prepInstanceLabel('Product', 3), 'Product (3)');
  assert.equal(prepStepSourceInstance(p, p.steps[0]), 2);
  assert.equal(prepStepSourceInstance(p, p.steps[1]), 3);
  assert.equal(prepStepSourceInstance(p, step('third')), 4);
  assert.equal(prepStepSourceInstance(p, { id: 'x', kind: 'rename', config: { column: 'region', name: 'area' } }), 1);
});
