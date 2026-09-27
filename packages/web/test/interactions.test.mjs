import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { withActionFilters, toggleSelection, targetProblem, dateBounds } from '../build/test/interactions.js';
import { ActionEditor } from '../build/test/ActionEditor.js';
import { brushSelection, rowSelection } from '../build/test/visual-selection.js';
import { compileVisual } from '../build/test/compiler.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
export function actionDraft(kind = 'bar') {
  let d = authorReducer(emptyDraft(), { type: 'add', kind });
  d = authorReducer(d, { type: 'filter-actions', actions: [{ id: 'action-1', name: 'Filter', sourceField: kind === 'line' ? 'order_date' : 'region', targets: 'all', mappings: {} }] });
  d = authorReducer(d, { type: 'add', kind: 'table' });
  if (kind === 'line') d = authorReducer(d, { type: 'assign', field: 'order_date' });
  return d;
}
test('action selection filters fixture rows, toggles off, stays on its sheet, and respects explicit mappings', () => {
  const d = actionDraft(), s = activeSheet(d), [source, target] = s.visuals;
  const selection = { values: { region: 'West' } }, state = toggleSelection({}, source.id, selection);
  const query = buildAuthorQuery(withActionFilters(s, target, state));
  assert.deepEqual(executeFixtureQuery(query).rows, [{ region: 'West', revenue: 400 }]);
  assert.deepEqual(toggleSelection(state, source.id, selection), {});
  assert.deepEqual(withActionFilters(s, source, state), source);
  assert.deepEqual(withActionFilters({ ...s, visuals: [target] }, target, state), target);
  source.filterActions[0].targets = [];
  assert.deepEqual(withActionFilters(s, target, state), target);
  source.filterActions[0].targets = [target.id]; source.filterActions[0].mappings[target.id] = 'category';
  target.rows = ['category']; target.dimension = 'category';
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(withActionFilters(s, target, { [source.id]: { values: { region: 'Hardware' } } }))).rows, [{ category: 'Hardware', revenue: 550 }]);
  validateDraft(d);
});
test('line brush translates inclusive month buckets to typed UTC date filters', () => {
  const d = actionDraft('line'), s = activeSheet(d), [source, target] = s.visuals;
  const compiled = compileVisual({ ...buildAuthorVisual(source), rows: executeFixtureQuery(buildAuthorQuery(source)).rows });
  const selection = brushSelection(compiled, [1, 2]);
  assert.deepEqual(selection.range, ['2025-03', '2025-04']);
  const filtered = executeFixtureQuery(buildAuthorQuery(withActionFilters(s, target, { [source.id]: selection })));
  assert.deepEqual(filtered.rows, [{ month: '2025-03', revenue: 50 }, { month: '2025-04', revenue: 250 }]);
  assert.equal(brushSelection(compiled, [NaN, 1]), undefined);
  assert.deepEqual(dateBounds('2024-02'), ['2024-02-01', '2024-02-29']);
  assert.deepEqual(rowSelection(compiled, 0).values, { order_date: '2025-01' });
});
test('honest action config retains nonparticipating visuals with reasons', () => {
  const d = authorReducer(actionDraft(), { type: 'add', kind: 'kpi' }), s = activeSheet(d), source = s.visuals[0], kpi = s.visuals[2];
  assert.match(targetProblem(source, kpi, source.filterActions[0]), /KPI has no grouped dimensions/);
  const html = renderToStaticMarkup(createElement(ActionEditor, { draft: d, visual: source, dispatch() {} }));
  assert.match(html, /visual-3/); assert.match(html, /Cannot receive: KPI has no grouped dimensions/);
  assert.match(renderToStaticMarkup(createElement(ActionEditor, { draft: d, visual: kpi, dispatch() {} })), /Cannot originate: KPI has no selectable dimension/);
});
