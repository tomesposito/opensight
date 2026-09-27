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

import { hierarchyError, withDrill, drillDown, drillUp, drillBreadcrumbs } from '../build/test/drill.js';
const dateHierarchy = { id: 'dates', name: 'Order date', levels: ['YEAR', 'QUARTER', 'MONTH'].map(granularity => ({ columnName: 'order_date', granularity })) };
test('hierarchy definition validates unique ordered dimensions and survives reducer validation', () => {
  assert.equal(hierarchyError(dateHierarchy), undefined);
  assert.match(hierarchyError({ ...dateHierarchy, levels: [dateHierarchy.levels[1], dateHierarchy.levels[0]] }), /coarser/);
  assert.match(hierarchyError({ ...dateHierarchy, levels: [dateHierarchy.levels[0], dateHierarchy.levels[0]] }), /unique/);
  assert.match(hierarchyError({ ...dateHierarchy, levels: [{ columnName: 'revenue' }, { columnName: 'region' }] }), /dimension/);
  const d = authorReducer(actionDraft(), { type: 'hierarchy', hierarchy: dateHierarchy });
  validateDraft(d); assert.equal(activeSheet(d).visuals[1].dimension, 'order_date');
});
test('bar, line, pie and pivot drill through year, quarter and month with parent filters and breadcrumbs', () => {
  for (const kind of ['bar', 'line', 'pie', 'pivot']) {
    let d = authorReducer(emptyDraft(), { type: 'add', kind });
    d = authorReducer(d, { type: 'hierarchy', hierarchy: dateHierarchy });
    const v = activeSheet(d).visuals[0];
    const rows = path => executeFixtureQuery(buildAuthorQuery(withDrill(v, path))).rows;
    assert.deepEqual(rows([]), [{ year: '2025', revenue: 900 }]);
    const year = drillDown(v, [], { values: { order_date: '2025' } });
    assert.deepEqual(rows(year), [{ quarter: '2025-Q1', revenue: 650 }, { quarter: '2025-Q2', revenue: 250 }]);
    const quarter = drillDown(v, year, { values: { order_date: '2025-Q1' } });
    assert.deepEqual(rows(quarter), [{ month: '2025-01', revenue: 600 }, { month: '2025-03', revenue: 50 }]);
    assert.deepEqual(drillDown(v, quarter, { values: { order_date: '2025-01' } }), quarter);
    assert.deepEqual(drillUp(quarter), year); assert.deepEqual(drillUp(quarter, 0), []);
    assert.deepEqual(drillBreadcrumbs(v, quarter).map(c => c.depth), [0, 1, 2]);
    assert.match(drillBreadcrumbs(v, quarter)[2].label, /2025-Q1/);
    const projected = withDrill(v, quarter);
    assert.equal(compileVisual({ ...buildAuthorVisual(projected), rows: rows(quarter) }).state, 'ready');
  }
});
test('categorical hierarchy drill retains the selected parent and aggregates child rows', () => {
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' });
  d = authorReducer(d, { type: 'hierarchy', hierarchy: { id: 'geo', name: 'Region to category', levels: [{ columnName: 'region' }, { columnName: 'category' }] } });
  const v = activeSheet(d).visuals[0], path = drillDown(v, [], { values: { region: 'West' } });
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(withDrill(v, path))).rows, [{ category: 'Hardware', revenue: 350 }, { category: 'Software', revenue: 50 }]);
});
test('honest eligibility names missing dimensions, incompatible types and unresolved datasets', () => {
  const d = actionDraft(), [source, target] = activeSheet(d).visuals, action = source.filterActions[0];
  assert.match(targetProblem(source, { ...target, rows: ['category'], dimension: 'category' }, action), /does not group by region/);
  assert.match(targetProblem(source, { ...target, rows: ['order_date'], dimension: 'order_date' }, { ...action, mappings: { [target.id]: 'order_date' } }), /same supported type/);
  assert.match(targetProblem(source, { ...target, imported: { local: false, dataSets: [{ identifier: 'foreign' }] } }, action), /Unresolved dataset/);
  assert.match(targetProblem(source, { ...target, rows: ['order_id'], dimension: 'order_id' }, action), /Numeric grouping/);
  const html = renderToStaticMarkup(createElement(ActionEditor, { draft: d, visual: source, dispatch() {} }));
  assert.match(html, /source visual is not its own target/); assert.match(html, /Can receive this action/);
});
