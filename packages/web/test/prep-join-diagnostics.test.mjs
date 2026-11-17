import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { PrepJoinDiagnostics } from '../build/test/PrepJoinDiagnostics.js';
import { PrepStepEditor } from '../build/test/PrepStepEditor.js';
import { createApiClient } from '../build/test/api-client.js';
const columns = [{ name: 'id', type: 'INTEGER' }], sources = ['a','b'].map(id => ({ id, columns, connectorId: 'file', available: true }));
const step = { id: 'j', kind: 'join', config: { source: 'b', joinType: 'inner', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } };
const pipeline = { version: 1, input: 'a', steps: [step] };
const result = { basis: 'bounded-preview', sampleLimit: 10000, timedOut: false, matchedRows: 6, unmatchedLeft: 2, unmatchedRight: 3,
  fanOut: true, maxLeftMultiplicity: 2, maxRightMultiplicity: 3, leftRowsSampled: 4, rightRowsSampled: 6, leftTruncated: true, rightTruncated: false };
const props = { pipeline, step, sources, datasetId: 'draft' };
const content = node => node === null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : content(node.children);
const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 320)); });
async function mount(t, extra = {}, Component = PrepJoinDiagnostics) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(Component, { ...props, ...extra })); });
  t.after(async () => { await act(async () => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  return ui;
}
test('diagnostics render loading, sample counts, fan-out multiplicities and inherited truncation', async t => {
  const calls = [], client = { async joinDiagnostics(...args) { calls.push(args); return result; } };
  const ui = await mount(t, { client }); assert.match(content(ui.toJSON()), /Loading bounded join diagnostics/);
  await wait(); const text = content(ui.toJSON());
  for (const expected of ['Preview-based', '4 left rows, 6 right rows', '10,000 rows per input', 'Matched output rows6', 'Unmatched left rows2', 'Unmatched right rows3', 'Fan-out warning', '2 left × 3 right', 'Truncated sample: left', 'not whole sources']) assert.ok(text.includes(expected), expected);
  assert.deepEqual(calls, [['draft', pipeline, 'j']]);
});
test('diagnostics do not warn for unique untruncated keys', async t => {
  const ui = await mount(t, { client: { async joinDiagnostics() { return { ...result, fanOut: false, leftTruncated: false }; } } });
  await wait(); assert.doesNotMatch(content(ui.toJSON()), /Fan-out warning|Truncated sample/);
});
test('static demo shows honest unavailable/schema-only diagnostics without fabricated counts', async t => {
  const ui = await mount(t); const text = content(ui.toJSON());
  assert.match(text, /Unavailable.*Needs local or hosted API.*sample schema only/);
  assert.doesNotMatch(text, /Matched output rows|Loading bounded|Fan-out warning/);
});
test('diagnostics display named errors and never turn unsupported sources into zero counts', async t => {
  const ui = await mount(t, { client: { async joinDiagnostics() { throw Object.assign(new Error('Bounded reader unavailable'), { code: 'UNSUPPORTED_PREP_STEP' }); } } });
  await wait(); assert.match(content(ui.toJSON()), /UNSUPPORTED_PREP_STEP: Bounded reader unavailable/);
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 1); assert.doesNotMatch(content(ui.toJSON()), /Matched output rows/);
});
test('invalid and type-incompatible keys show compiler errors without a request', async t => {
  let calls = 0; const client = { async joinDiagnostics() { calls++; return result; } };
  const ui = await mount(t, { client, step: { ...step, config: { ...step.config, keys: [] } } });
  await wait(); assert.match(content(ui.toJSON()), /INVALID_PREP_PIPELINE/); assert.equal(calls, 0);
  await act(async () => ui.update(createElement(PrepJoinDiagnostics, { ...props, client, sources: [sources[0], { ...sources[1], columns: [{ name: 'id', type: 'STRING' }] }] })));
  await wait(); assert.match(content(ui.toJSON()), /PREP_SCHEMA_MISMATCH/); assert.equal(calls, 0);
});
test('edited joins clear stale counts immediately and ignore an old in-flight response', async t => {
  let release; const client = { joinDiagnostics() { return new Promise(resolve => { release = resolve; }); } };
  const ui = await mount(t, { client }); await wait();
  const bad = { ...step, config: { ...step.config, keys: [] } };
  await act(async () => ui.update(createElement(PrepJoinDiagnostics, { ...props, client, step: bad })));
  await act(async () => release(result));
  assert.match(content(ui.toJSON()), /INVALID_PREP_PIPELINE/); assert.doesNotMatch(content(ui.toJSON()), /Matched output rows/);
});
test('join editor diagnostics use unapplied draft keys and compile only the selected prefix', async t => {
  const calls = [], diagnosticsClient = { async joinDiagnostics(...args) { calls.push(args); return result; } };
  const ui = await mount(t, { diagnosticsClient, columns, pipeline: { ...pipeline, steps: [...pipeline.steps, { id: 'later', kind: 'select', config: { columns: ['missing'] } }] }, apply() {}, cancel() {} }, PrepStepEditor);
  await wait(); assert.deepEqual(calls[0], ['draft', pipeline, 'j']);
  const remove = ui.root.findByProps({ 'aria-label': 'Remove key 1' });
  await act(async () => remove.props.onClick()); await wait();
  assert.equal(calls.length, 1); assert.doesNotMatch(content(ui.toJSON()), /Matched output rows/);
});
test('API client uses the same dedicated join-diagnostics operation and exact body', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { requests.push([url, init]); return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } }); });
  assert.deepEqual(await createApiClient().joinDiagnostics('draft', pipeline, 'j'), result);
  assert.match(String(requests[0][0]), /\/api\/datasets\/draft\/prep\/join-diagnostics$/);
  assert.equal(requests[0][1].method, 'POST'); assert.deepEqual(JSON.parse(requests[0][1].body), { pipeline, through: 'j' });
});
