import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '@opensight/api';
import { createApiClient } from '../packages/web/build/test/api-client.js';
import { activeSheet, authorReducer, emptyDraft } from '../packages/web/build/test/authoring.js';
import { buildAuthorQuery } from '../packages/web/build/test/author-query.js';
import { withActionFilters, toggleSelection } from '../packages/web/build/test/interactions.js';
import { withDrill, drillDown, drillUp } from '../packages/web/build/test/drill.js';
import { executeFixtureQuery } from '../packages/web/build/test/fixture-query.js';

test('Phase 2b actions, brush, drill and reset requery the real API with fixture parity', async t => {
  const server = await createApiServer({ dataRoot: fileURLToPath(new URL('../fixtures/', import.meta.url)) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
  const base = `http://127.0.0.1:${server.address().port}`, client = createApiClient(base);
  const check = async (visual, expected) => {
    const query = buildAuthorQuery(visual), result = await client.queryDataset('sales', query);
    assert.deepEqual(result.rows, expected); assert.deepEqual(executeFixtureQuery(query).rows, expected);
  };
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  d = authorReducer(d, { type: 'filter-actions', actions: [{ id: 'filter', name: 'Filter', sourceField: 'region', targets: 'all', mappings: {} }] });
  d = authorReducer(d, { type: 'add', kind: 'table' });
  const s = activeSheet(d), [source, target] = s.visuals;
  let selections = toggleSelection({}, source.id, { values: { region: 'East' } });
  await check(withActionFilters(s, target, selections), [{ region: 'East', revenue: 500 }]);
  selections = toggleSelection(selections, source.id, { values: { region: 'West' } });
  await check(withActionFilters(s, target, selections), [{ region: 'West', revenue: 400 }]);
  await check(withActionFilters(s, target, {}), [{ region: 'East', revenue: 500 }, { region: 'West', revenue: 400 }]);
  await check(withActionFilters(s, target, { [source.id]: { values: { region: "East' OR TRUE --" } } }), []);
  d = authorReducer(d, { type: 'hierarchy', hierarchy: { id: 'date', name: 'Date', levels: ['YEAR','QUARTER','MONTH','DAY'].map(granularity => ({ columnName: 'order_date', granularity })) } });
  const v = activeSheet(d).visuals[1];
  await check(withDrill(v, []), [{ year: '2025', revenue: 900 }]);
  let path = drillDown(v, [], { values: { order_date: '2025' } });
  await check(withDrill(v, path), [{ quarter: '2025-Q1', revenue: 650 }, { quarter: '2025-Q2', revenue: 250 }]);
  path = drillDown(v, path, { values: { order_date: '2025-Q1' } });
  await check(withDrill(v, path), [{ month: '2025-01', revenue: 600 }, { month: '2025-03', revenue: 50 }]);
  path = drillDown(v, path, { values: { order_date: '2025-03' } });
  await check(withDrill(v, path), [{ day: '2025-03-01', revenue: 50 }]);
  await check(withDrill(v, drillUp(path, 0)), [{ year: '2025', revenue: 900 }]);
  const line = { ...source, kind: 'line', dimension: 'order_date', filterActions: [{ ...source.filterActions[0], sourceField: 'order_date' }] };
  const dateTarget = { ...target, dimension: 'order_date', rows: ['order_date'] };
  await check(withActionFilters({ ...s, visuals: [line, dateTarget] }, dateTarget, { [line.id]: { values: { order_date: '2025-03' }, range: ['2025-03', '2025-04'] } }), [{ month: '2025-03', revenue: 50 }, { month: '2025-04', revenue: 250 }]);
  for (const bad of [
    { ...buildAuthorQuery(withDrill(v, [])), sql: 'select 1' },
    { ...buildAuthorQuery(withDrill(v, path)), parameterBindings: { OSInteraction0: ['2025-02-30'] } },
  ]) {
    const response = await fetch(`${base}/api/datasets/sales/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad) });
    assert.equal(response.status, 400);
  }
});
