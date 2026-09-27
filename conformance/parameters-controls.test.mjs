import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { createApiServer } from '../packages/api/dist/index.js';
import { createApiClient } from '../packages/web/build/test/api-client.js';
import { AuthorCanvas } from '../packages/web/build/test/Author.js';
import { VisualCard } from '../packages/web/build/test/VisualCard.js';
import { authorReducer as reduce, emptyDraft } from '../packages/web/build/test/authoring.js';

function initialDraft() {
  let d = reduce(emptyDraft(), { type: 'add', kind: 'table' });
  d = reduce(d, { type: 'parameter-add', parameter: { name: 'Region', type: 'string', multiple: false, defaultValues: ['East'], values: ['East'] } });
  d = reduce(d, { type: 'control-add', control: { label: 'Choose region', parameterId: 'parameter-1', kind: 'dropdown', options: ['East', 'West'] } });
  d = reduce(d, { type: 'filter-parameter', columnName: 'region', parameterName: 'Region' });
  return reduce(d, { type: 'add', kind: 'kpi' });
}
for (const live of [false, true]) test(`control → parameter → filter → ${live ? 'HTTP API / DuckDB requery' : 'fixture recomputation'} updates only the affected visual`, { timeout: 15000 }, async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, state, client; const requests = [];
  if (live) {
    const server = await createApiServer({ dataRoot: new URL('../fixtures/', import.meta.url).pathname });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
    const api = createApiClient(`http://127.0.0.1:${server.address().port}`);
    client = { queryDataset: (...args) => { requests.push(args[1]); return api.queryDataset(...args); } };
  }
  function Harness() { const [draft, dispatch] = useReducer(reduce, undefined, initialDraft); state = draft; return createElement(AuthorCanvas, { draft, dispatch, client }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const cards = () => renderer.root.findAllByType(VisualCard).map(c => c.props);
  const ready = async () => {
    const deadline = Date.now() + 10000;
    while (cards().some(c => c.loading)) { assert.ok(Date.now() < deadline, 'query completion deadline'); await act(() => new Promise(resolve => setTimeout(resolve, 20))); }
  };
  await ready();
  assert.deepEqual(cards()[0].visual.rows, [{ region: 'East', revenue: 500 }]);
  assert.deepEqual(cards()[1].visual.rows, [{ revenue: 900 }]);
  const previous = requests.length;
  const select = renderer.root.findAllByType('select').find(n => n.props['aria-label'] === 'Choose region');
  await act(() => select.props.onChange({ target: { value: 'West' } }));
  assert.deepEqual(state.parameters[0].values, ['West']);
  if (live) { assert.equal(cards()[0].loading, true); assert.equal(cards()[0].visual.rows, null); assert.equal(requests.length, previous); }
  assert.deepEqual(cards()[1].visual.rows, [{ revenue: 900 }]);
  await ready();
  assert.deepEqual(cards()[0].visual.rows, [{ region: 'West', revenue: 400 }]);
  if (live) {
    assert.equal(requests.length, previous + 1);
    assert.deepEqual(requests.at(-1).parameterBindings, { Region: ['West'] });
    assert.deepEqual(requests.at(-1).filters, [{ columnName: 'region', parameterName: 'Region', operator: 'EQUALS' }]);
  }
});
