import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { withActionFilters, toggleSelection, targetProblem, dateBounds, actionActivation, validFilterActions, urlActionDefinitionsValid, navigationActionDefinitionsValid } from '../build/test/interactions.js';
import { ActionPanel } from '../build/test/ActionEditor.js';
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
test('activation defaults to select, validates, and survives the reducer', () => {
  const d = actionDraft(), [source] = activeSheet(d).visuals, action = source.filterActions[0];
  assert.equal(actionActivation(action), 'select');
  assert.equal(actionActivation({ ...action, activation: 'menu' }), 'menu');
  assert.equal(validFilterActions([{ ...action, activation: 'menu', scopeFields: ['region'] }]), true);
  assert.equal(validFilterActions([{ ...action, activation: 'bogus' }]), false);
  assert.equal(validFilterActions([{ ...action, scopeFields: 'region' }]), false);
  assert.equal(urlActionDefinitionsValid([{ id: 'u', name: 'U', sourceField: 'region', urlTemplate: 'https://example.com', activation: 'menu' }]), true);
  assert.equal(urlActionDefinitionsValid([{ id: 'u', name: 'U', sourceField: 'region', urlTemplate: 'https://example.com', activation: 'bogus' }]), false);
  assert.equal(navigationActionDefinitionsValid([{ id: 'n', name: 'N', sourceField: 'region', targetSheetId: 's', parameterMappings: {}, activation: 'menu' }]), true);
  assert.equal(navigationActionDefinitionsValid([{ id: 'n', name: 'N', sourceField: 'region', targetSheetId: 's', parameterMappings: {}, activation: 'bogus' }]), false);
  const onSource = authorReducer(d, { type: 'select', id: source.id });
  const next = authorReducer(onSource, { type: 'filter-actions', actions: [{ ...action, activation: 'menu' }] });
  assert.equal(activeSheet(next).visuals[0].filterActions[0].activation, 'menu');
  validateDraft(next);
});
test('menu-option filter actions ignore click selections and apply only from menu selections', () => {
  const d = actionDraft(), s = activeSheet(d), [source, target] = s.visuals;
  source.filterActions[0].activation = 'menu';
  const state = toggleSelection({}, source.id, { values: { region: 'West' } });
  assert.deepEqual(withActionFilters(s, target, state), target);
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(withActionFilters(s, target, {}, [], undefined, state))).rows, [{ region: 'West', revenue: 400 }]);
  validateDraft(d);
});
test('filter scope restricts application to the selected fields', () => {
  const d = actionDraft(), s = activeSheet(d), [source, target] = s.visuals, action = source.filterActions[0];
  action.scopeFields = ['category'];
  const regionOnly = toggleSelection({}, source.id, { values: { region: 'West' } });
  assert.deepEqual(withActionFilters(s, target, regionOnly), target);
  const both = toggleSelection({}, source.id, { values: { region: 'West', category: 'Hardware' } });
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(withActionFilters(s, target, both))).rows, [{ region: 'West', revenue: 400 }]);
  action.scopeFields = undefined;
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(withActionFilters(s, target, regionOnly))).rows, [{ region: 'West', revenue: 400 }]);
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
  const panel = (visual, actionId) => renderToStaticMarkup(createElement(ActionPanel, { draft: d, visual, actionId, onClose() {}, dispatch() {} }));
  source.filterActions[0].targets = [];
  const html = panel(source, 'action-1');
  assert.match(html, /visual-3/); assert.match(html, /Cannot receive: KPI has no grouped dimensions/);
  assert.match(panel(kpi), /Cannot originate: KPI has no selectable dimension/);
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
  action.targets = [];
  const html = renderToStaticMarkup(createElement(ActionPanel, { draft: d, visual: source, actionId: action.id, onClose() {}, dispatch() {} }));
  assert.match(html, /source visual is not its own target/); assert.match(html, /Can receive this action/);
});
test('field edits clear conflicting hierarchies, deleting targets prunes action mappings, and invalid date buckets are rejected', () => {
  let d = authorReducer(actionDraft(), { type: 'hierarchy', hierarchy: dateHierarchy });
  d = authorReducer(d, { type: 'assign', field: 'category' });
  assert.equal(activeSheet(d).visuals[1].hierarchy, undefined);
  assert.equal(activeSheet(d).visuals[1].dimension, 'category');
  const source = activeSheet(d).visuals[0]; source.filterActions[0].targets = ['visual-2']; source.filterActions[0].mappings['visual-2'] = 'category';
  d = authorReducer(d, { type: 'remove', id: 'visual-2' });
  assert.deepEqual(activeSheet(d).visuals[0].filterActions[0].targets, []);
  assert.deepEqual(activeSheet(d).visuals[0].filterActions[0].mappings, {});
  for (const value of ['2025-13', '2025-02-30', '2025-Q0', '2025-Q1-02', 'bad']) assert.equal(dateBounds(value), undefined);
});
test('actions remain effective on hierarchy dimensions after the target drills to a child level', () => {
  let d = actionDraft();
  d = authorReducer(d, { type: 'hierarchy', hierarchy: { id: 'h', name: 'Region → category', levels: [{ columnName: 'region' }, { columnName: 'category' }] } });
  const s = activeSheet(d), target = s.visuals[1], drilled = withDrill(target, drillDown(target, [], { values: { region: 'West' } }));
  const projected = withActionFilters(s, drilled, { 'visual-1': { values: { region: 'East' } } });
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(projected)).rows, []);
  assert.match(targetProblem(s.visuals[0], { ...target, measures: [] }, s.visuals[0].filterActions[0]), /Assign a measure/);
});
