import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataPrep } from '../build/test/DataPrep.js';
import { PrepStepEditor } from '../build/test/PrepStepEditor.js';
import { prepBundle, prepCatalog, newPrepStep, prepSchema, prepStepIssue, prepStepLabel } from '../build/test/data-prep.js';
import { createApiClient } from '../build/test/api-client.js';
import { assembleQsBundle, parseQsBundle } from '@opensight/bundle-parser/browser';
const source = { id: 'upload-source', connectorId: 'file', columns: [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }], available: true };
const pipeline = { version: 1, input: source.id, steps: [] };
const resource = { resourceType: 'dataset', dataSetId: 'prepared', name: 'Prepared', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
test('static prep canvas shows catalog, sample schema and honest hosted-only preview/save', () => {
  const html = renderToStaticMarkup(createElement(DataPrep));
  for (const c of prepCatalog) assert.ok(html.includes(c.label), c.label);
  assert.match(html, /Transformation DAG/); assert.match(html, /Needs hosted API/); assert.match(html, /<button disabled="">Save pipeline/);
  assert.doesNotMatch(html, /rows shown|output rows total|Loading step preview/);
});
test('every catalog transformation has an editable configuration form', () => {
  for (const c of prepCatalog) {
    const step = newPrepStep(c.kind, source.columns, [source], source.id);
    const html = renderToStaticMarkup(createElement(PrepStepEditor, { step, columns: source.columns, sources: [source], apply() {}, cancel() {} }));
    assert.match(html, /Apply step/); assert.match(html, /<select|<input|<textarea/);
    assert.match(html, /Step name \(optional\)/);
  }
});
test('canvas step labels resolve an author name or the catalog fallback for every kind', () => {
  for (const { kind, label } of prepCatalog) {
    const step = newPrepStep(kind, source.columns, [source], source.id);
    assert.equal(Object.hasOwn(step, 'name'), false);
    assert.equal(prepStepLabel(step), label);
    assert.equal(prepStepLabel({ ...step, name: 'Customer cleanup' }), 'Customer cleanup');
    assert.equal(Object.hasOwn(step, 'name'), false);
  }
});
test('prep bundle editing preserves unrelated resources and opaque dataset properties', async () => {
  const original = { members: [{ path: 'dataset/prepared.json', resource: { ...resource, opaque: { keep: true } } }, { path: 'datasource/example.json', resource: { resourceType: 'datasource', dataSourceId: 'example', name: 'Example', type: 'POSTGRESQL' } }] };
  const next = { ...pipeline, steps: [
    { id: 's', name: 'Clean region', kind: 'rename', config: { column: 'region', name: 'area' } },
    { id: 'select', kind: 'select', config: { columns: ['area'] } },
  ] };
  const result = await parseQsBundle(await assembleQsBundle(prepBundle(resource, next, original)));
  assert.deepEqual(result.members[1], original.members[1]); assert.deepEqual(result.members[0].resource.opaque, { keep: true });
  assert.deepEqual(result.members[0].resource.opensightPrep, next); assert.deepEqual(original.members[0].resource.opensightPrep, pipeline);
  assert.equal(Object.hasOwn(result.members[0].resource.opensightPrep.steps[1], 'name'), false);
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
  await ui.click('＋ Rename columns');
  const form = () => ui.renderer.root.findByType(PrepStepEditor);
  await field(ui.renderer, 'New name', 'area');
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
  await ui.click('＋ Rename columns');
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
  const field = () => renderer.root.findAllByType('label').find(l => l.props.children[0] === 'Value').findByType('input');
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
test('step editor blocks invalid names and clearing a name omits it without changing configuration', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  const applied = [], step = { id: 'rename', name: 'Clean region', kind: 'rename', config: { column: 'region', name: 'area' } };
  await act(async () => { renderer = create(createElement(PrepStepEditor, { step, columns: source.columns, sources: [source], apply: s => applied.push(s), cancel() {} })); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const input = () => renderer.root.findByProps({ type: 'text' });
  const applyButton = () => renderer.root.findByProps({ type: 'submit' });
  assert.equal(input().props.value, 'Clean region'); assert.equal(input().props.maxLength, 128);
  for (const name of [' ', ' Leading', 'Trailing ', 'x'.repeat(129), 'Bad\0name', 'Bad\nname', 'Bad\tname']) {
    await field(renderer, 'Step name', name);
    assert.equal(applyButton().props.disabled, true);
    assert.match(JSON.stringify(renderer.toJSON()), /INVALID_PREP_PIPELINE.*Step name/);
    await submitStep(renderer); assert.equal(applied.length, 0);
  }
  for (const name of ['A', 'Calc – Clean Zip', 'x'.repeat(128)]) {
    await field(renderer, 'Step name', name);
    assert.equal(applyButton().props.disabled, false);
    await submitStep(renderer);
    assert.deepEqual(applied.at(-1), { ...step, name });
  }
  await field(renderer, 'Step name', '');
  await submitStep(renderer);
  assert.deepEqual(applied.at(-1), { id: step.id, kind: step.kind, config: step.config });
  assert.equal(Object.hasOwn(applied.at(-1), 'name'), false);
  assert.equal(step.name, 'Clean region');
});
test('renamed join renders on the canvas and input connections, and clearing restores the kind label', async t => {
  const ui = await mount(t);
  const node = () => ui.renderer.root.findAll(n => n.type === 'button' && n.props.className?.split(' ').includes('prep-node') && !n.props.className.includes('input-node'))[0];
  await ui.click('＋ Join');
  const id = ui.renderer.root.findByType(PrepStepEditor).props.step.id;
  await field(ui.renderer, 'Step name', 'Product Join');
  await submitStep(ui.renderer);
  assert.equal(node().findByType('strong').props.children, 'Product Join');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /1\. Product Join/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Product Join preview/);
  const rightSource = ui.renderer.root.findAll(n => n.type === 'button' && n.props.className === 'prep-node input-node').find(b => [].concat(b.findByType('strong').props.children).join('') === 'Source 2');
  assert.ok(rightSource);
  await act(async () => rightSource.props.onClick());
  const editor = ui.renderer.root.findByType(PrepStepEditor);
  assert.equal(editor.props.step.id, id); assert.equal(editor.props.step.name, 'Product Join');
  await field(ui.renderer, 'Step name', '');
  await submitStep(ui.renderer);
  assert.equal(node().findByType('strong').props.children, 'Join');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /1\. Join/);
  await ui.click('Configure step');
  const unnamed = ui.renderer.root.findByType(PrepStepEditor).props.step;
  assert.equal(unnamed.id, id); assert.equal(Object.hasOwn(unnamed, 'name'), false);
});
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
  const inputNode = ui.renderer.root.findAll(n => n.type === 'button' && n.props.className?.includes('input-node')).find(b => b.findAllByType('strong').some(s => (Array.isArray(s.props.children) ? s.props.children.join('') : s.props.children) === 'Input · Source 1'));
  assert.ok(inputNode, 'canvas Input node');
  await act(async () => { inputNode.props.onClick(); });
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
test('prepStepIssue flags only unconfigured join/append steps', () => {
  const join = keys => ({ id: 'j', kind: 'join', config: { source: 's', joinType: 'left', keys, prefix: 'x_' } });
  assert.equal(prepStepIssue(join([])), 'Join keys are not set');
  assert.equal(prepStepIssue(join([{ left: 'region', right: '' }])), 'Join keys are not set');
  assert.equal(prepStepIssue(join([{ left: '', right: 'region' }])), 'Join keys are not set');
  assert.equal(prepStepIssue(join([{ left: 'region', right: 'region' }])), '');
  assert.equal(prepStepIssue({ id: 'a', kind: 'append', config: { source: '' } }), 'Append source is not set');
  assert.equal(prepStepIssue({ id: 'a', kind: 'append', config: { source: 's' } }), '');
  assert.equal(prepStepIssue({ id: 'r', kind: 'rename', config: { column: 'region', name: 'area' } }), '');
});
test('Add data stages an input node and Join consumes it', async t => {
  const ui = await mount(t);
  await ui.click('＋ Add data');
  assert.ok(ui.button('Stage input'), 'staging form opens');
  await field(ui.renderer, 'Stage a source', JSON.stringify('demo-regions'));
  await ui.click('Stage input');
  const staged = JSON.stringify(ui.renderer.toJSON());
  assert.match(staged, /Source 2 · Staged/); assert.match(staged, /demo-regions/); assert.match(staged, /Not joined yet/);
  await ui.click('＋ Join');
  assert.equal(ui.renderer.root.findByType(PrepStepEditor).props.step.config.source, 'demo-regions');
  await submitStep(ui.renderer);
  const applied = JSON.stringify(ui.renderer.toJSON());
  assert.doesNotMatch(applied, /Not joined yet/);
  assert.match(applied, /"Source ","2"/); assert.match(applied, /demo-regions/);
});
test('join nodes flag stale keys on the canvas', async t => {
  const ui = await mount(t);
  await ui.click('＋ Join');
  await submitStep(ui.renderer);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /unconfigured/);
  await ui.click('＋ Rename columns');
  const form = () => ui.renderer.root.findByType(PrepStepEditor);
  await field(ui.renderer, 'New name', 'area');
  await act(async () => form().findByType('form').props.onSubmit({ preventDefault() {} }));
  await ui.click('Move earlier');
  const html = JSON.stringify(ui.renderer.toJSON());
  assert.match(html, /unconfigured/); assert.match(html, /Unknown column: region/);
});

import { PrepGraph } from '../build/test/PrepGraph.js';
import { removePrepStep } from '../build/test/data-prep.js';
const graphPipeline = ui => ui.renderer.root.findByType(PrepGraph).props.pipeline;
const stepNode = (ui, id) => ui.renderer.root.findByProps({ 'data-step-id': id });
const nodeAction = async (ui, id, label) => act(async () => stepNode(ui, id).findAllByType('button').find(b => b.props.children === label).props.onClick());
const selectNode = async (ui, id) => act(async () => stepNode(ui, id).findAllByType('button').find(b => b.props.className?.split(' ').includes('prep-node')).props.onClick());
test('branch creation renders resolved DAG edges, edits its own schema and moves output marker', async t => {
  const ui = await mount(t);
  await ui.click('＋ Select columns'); await submitStep(ui.renderer);
  const clean = graphPipeline(ui).steps[0].id;
  await ui.click('＋ Aggregate'); await submitStep(ui.renderer);
  const summary = graphPipeline(ui).steps[1].id;
  await nodeAction(ui, clean, 'Add branch');
  const detail = graphPipeline(ui).steps[2];
  assert.equal(detail.from, clean);
  assert.deepEqual(ui.renderer.root.findByType(PrepStepEditor).props.columns.map(c => c.name), ['region', 'category', 'revenue', 'order_date']);
  await field(ui.renderer, 'Step name', 'Detail branch'); await submitStep(ui.renderer);
  for (const target of [summary, detail.id]) assert.equal(ui.renderer.root.findByProps({ 'data-to': target }).props['data-from'], clean);
  assert.equal(stepNode(ui, detail.id).findByProps({ className: 'prep-output-marker' }).props.children, 'Output');
  await nodeAction(ui, summary, 'Set as output');
  assert.equal(graphPipeline(ui).output, summary);
  assert.equal(stepNode(ui, summary).findByProps({ className: 'prep-output-marker' }).props.children, 'Output');
  assert.equal(stepNode(ui, detail.id).findAllByProps({ className: 'prep-output-marker' }).length, 0);
  await selectNode(ui, summary); await ui.click('Remove step');
  assert.equal(graphPipeline(ui).output, detail.id);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Needs hosted API/);
  assert.equal(ui.button('Save pipeline').props.disabled, true);
});
test('deleting or moving referenced steps surfaces a named error and allows explicit left-input repair', async t => {
  const ui = await mount(t);
  await ui.click('＋ Select columns'); await submitStep(ui.renderer);
  const clean = graphPipeline(ui).steps[0].id;
  await ui.click('＋ Select columns'); await submitStep(ui.renderer);
  const other = graphPipeline(ui).steps[1].id;
  await nodeAction(ui, clean, 'Add branch'); await submitStep(ui.renderer);
  const branch = graphPipeline(ui).steps[2].id;
  await selectNode(ui, clean); await ui.click('Move later');
  await ui.click('Move later');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE.*earlier step/);
  await ui.click('Move earlier'); await ui.click('Move earlier');
  await ui.click('Remove step');
  assert.equal(graphPipeline(ui).steps[1].from, clean);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE.*earlier step/);
  assert.ok(ui.renderer.root.findByProps({ className: 'prep-detached' }));
  await selectNode(ui, branch); await ui.click('Configure step');
  assert.equal(ui.renderer.root.findByProps({ type: 'submit' }).props.disabled, true);
  await field(ui.renderer, 'Left input', other); await submitStep(ui.renderer);
  assert.equal(graphPipeline(ui).steps[1].from, other);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE/);
  const last = removePrepStep({ version: 1, input: 'source', output: 'only', steps: [{ id: 'only', kind: 'select', config: { columns: ['id'] } }] }, 'only');
  assert.equal(Object.hasOwn(last, 'output'), false);
});
test('canvas rejects a sixth consumer visibly without adding or saving an invalid branch', async t => {
  const ui = await mount(t);
  await ui.click('＋ Select columns'); await submitStep(ui.renderer);
  const base = graphPipeline(ui).steps[0].id;
  for (let i = 0; i < 5; i++) { await nodeAction(ui, base, 'Add branch'); await submitStep(ui.renderer); }
  assert.equal(graphPipeline(ui).steps.length, 6);
  await nodeAction(ui, base, 'Add branch');
  assert.equal(graphPipeline(ui).steps.length, 6);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /PREP_LIMIT_EXCEEDED/);
});
test('hosted branch selections preview each stage independently and output changes persist on save', async t => {
  const p = { ...pipeline, output: 'detail', steps: [
    { id: 'clean', kind: 'select', config: { columns: ['region', 'amount'] } },
    { id: 'summary', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } },
    { id: 'detail', from: 'clean', kind: 'select', config: { columns: ['region'] } },
  ] };
  const calls = [], saves = [];
  const client = { async listPrepSources() { return [source]; }, async listPrepDatasets() { return { datasets: [{ ...resource, opensightPrep: p }], persistence: 'file' }; }, async previewPrep(id, pipeline, through) {
    calls.push(through); return { columns: [], rows: [], returnedRows: 0, totalRows: 0, truncated: false, rowCountLowerBound: 0, limit: 100, dialect: 'duckdb', through };
  }, async savePrep(id, name, pipeline) { saves.push(pipeline); return { persistence: 'file' }; } };
  const ui = await mount(t, client); await field(ui.renderer, 'Saved datasets', 'prepared');
  for (const id of ['summary', 'detail', 'clean']) {
    await selectNode(ui, id); await act(async () => new Promise(resolve => setTimeout(resolve, 340)));
    assert.equal(calls.at(-1), id);
    const headers = ui.renderer.root.findAllByType('th').map(n => n.props.children[0]);
    assert.deepEqual(headers, id === 'summary' ? ['total'] : id === 'detail' ? ['region'] : ['region', 'amount']);
  }
  await nodeAction(ui, 'summary', 'Set as output'); await ui.click('Save pipeline');
  assert.equal(saves[0].output, 'summary'); assert.equal(saves[0].steps[2].from, 'clean');
  await selectNode(ui, 'clean'); await ui.click('Remove step');
  const count = calls.length;
  await act(async () => new Promise(resolve => setTimeout(resolve, 340)));
  assert.equal(calls.length, count); assert.equal(ui.button('Save pipeline').props.disabled, true);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE/);
});

test('editor export preserves branch/output metadata and imports cannot confer source access', async () => {
  const p = { ...pipeline, output: 'summary', steps: [
    { id: 'clean', kind: 'select', config: { columns: ['region', 'amount'] } },
    { id: 'summary', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } },
    { id: 'detail', from: 'clean', kind: 'select', config: { columns: ['region'] } },
  ] };
  const original = { members: [{ path: 'dataset/prepared.json', resource: { ...resource, opaque: { keep: true } } }] };
  const imported = await parseQsBundle(await assembleQsBundle(prepBundle(resource, p, original)));
  const parsed = imported.members[0].resource.opensightPrep;
  assert.deepEqual(parsed, p); assert.deepEqual(imported.members[0].resource.opaque, { keep: true });
  assert.throws(() => prepSchema(parsed, []), e => e.code === 'PREP_SOURCE_NOT_FOUND');
  assert.throws(() => prepSchema(parsed, [{ ...source, available: false }]), e => e.code === 'PREP_SECURITY_REJECTED');
  assert.deepEqual(prepSchema(parsed, [source]).map(c => c.name), ['total']);
});

test('multiple dangling branches can be repaired in order while the entire draft stays fail closed', async t => {
  const ui = await mount(t);
  await ui.click('＋ Select columns'); await submitStep(ui.renderer);
  const base = graphPipeline(ui).steps[0].id;
  await nodeAction(ui, base, 'Add branch'); await submitStep(ui.renderer);
  const first = graphPipeline(ui).steps[1].id;
  await nodeAction(ui, base, 'Add branch'); await submitStep(ui.renderer);
  const second = graphPipeline(ui).steps[2].id;
  await selectNode(ui, base); await ui.click('Remove step');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE/);
  await selectNode(ui, first); await ui.click('Configure step');
  await field(ui.renderer, 'Left input', '');
  assert.equal(ui.renderer.root.findByProps({ type: 'submit' }).props.disabled, false);
  assert.equal(ui.renderer.root.findByType(PrepStepEditor).findAllByProps({ type: 'checkbox' }).length, 4);
  await submitStep(ui.renderer);
  assert.equal(Object.hasOwn(graphPipeline(ui).steps[0], 'from'), false);
  assert.equal(graphPipeline(ui).steps[1].from, base);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE/);
  assert.equal(ui.button('Save pipeline').props.disabled, true);
  await selectNode(ui, second); await ui.click('Configure step');
  await field(ui.renderer, 'Left input', first); await submitStep(ui.renderer);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()), /INVALID_PREP_PIPELINE/);
  assert.equal(graphPipeline(ui).steps[1].from, first);
});

test('Steps stays grouped while Configure and Preview switch without losing edits', async t => {
  const ui = await mount(t);
  const sidebar = ui.renderer.root.findByProps({ 'aria-label': 'Steps' });
  assert.deepEqual(sidebar.findAllByType('h3').map(n => n.props.children), ['Input', 'Column transformations', 'Combine transformations', 'Other']);
  assert.deepEqual(prepCatalog.map(c => c.label), ['Add calculated columns', 'Change data type', 'Rename columns', 'Select columns', 'Append', 'Join', 'Aggregate', 'Filter', 'Pivot', 'Unpivot']);
  await ui.click('＋ Rename columns');
  await field(ui.renderer, 'New name', 'territory');
  await ui.click('Preview');
  assert.equal(ui.renderer.root.findByProps({ id: 'prep-configure-panel' }).props.hidden, true);
  assert.equal(ui.renderer.root.findByProps({ id: 'prep-preview-tab' }).props['aria-selected'], true);
  await ui.click('Configure');
  assert.equal(ui.renderer.root.findByProps({ id: 'prep-preview-panel' }).props.hidden, true);
  assert.equal(ui.renderer.root.findByType(PrepStepEditor).findAllByType('input').some(n => n.props.value === 'territory'), true);
  assert.equal(sidebar.findAllByType(PrepStepEditor).length, 0);
  await submitStep(ui.renderer);
  assert.equal(graphPipeline(ui).steps[0].config.name, 'territory');
});
