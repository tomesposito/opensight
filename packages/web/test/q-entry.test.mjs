import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpretQuestion } from '@opensight/q-interpreter';
import { prepareQVisual } from '../build/test/q-authoring.js';
import { QEntry } from '../build/test/QEntry.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { activeSheet, authorReducer, dataFields, emptyDraft, serializeDraft, validateDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { compileVisual } from '../build/test/compiler.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
const prepare = (q, existing = []) => {
  const r = interpretQuestion(q, dataFields(existing)); assert.ok(r.interpretations.length, JSON.stringify(r));
  return prepareQVisual(r.interpretations[0], existing);
};
const execute = p => {
  const query = buildAuthorQuery(p.visual, p.calculatedFields); assert.ok(query);
  const result = executeFixtureQuery(query); assert.ok(result.rows, result.message);
  return { ...result, compiled: compileVisual({ ...buildAuthorVisual(p.visual, p.calculatedFields), rows: result.rows }) };
};
for (const [question, expected] of [['sum revenue', 900], ['average revenue', 900 / 7], ['min revenue', 0], ['max revenue', 300], ['count revenue', 7], ['count rows', 8], ['count region', 8]]) {
  test(`Q definition and compiler preserve ${question}`, () => {
    const p = prepare(question), result = execute(p);
    assert.equal(result.rows[0][p.visual.measures[0]], expected);
    assert.equal(result.compiled.model.kind, 'kpi'); assert.equal(result.compiled.state, 'ready');
  });
}
for (const type of ['bar', 'line', 'pie', 'table']) test(`Q ${type} uses the existing definition-to-compiler path`, () => {
  const p = prepare(`sum revenue by region ${type}`), result = execute(p);
  assert.equal(result.compiled.model.kind, type); assert.equal(result.compiled.table.rows.length, 2);
});
test('Q date granularity and conjunctive filters reach fixture queries', () => {
  const p = prepare('sum revenue per month in 2025 for region West');
  assert.deepEqual(execute(p).rows.map(r => [r.month, r[p.visual.measures[0]]]), [['2025-01', 200], ['2025-03', 50], ['2025-04', 150]]);
  assert.equal(execute(prepare('sum revenue by region in 2024')).compiled.state, 'empty');
  assert.equal(execute(prepare('sum revenue where profit is 20')).rows[0]['Q sum revenue'], 100);
  assert.equal(execute(prepare('sum revenue where order_date is 2025-01-01')).rows[0]['Q sum revenue'], 600);
});
test('Q top N ranks after aggregation and breaks ties with grouping keys', () => {
  assert.deepEqual(execute(prepare('sum revenue by region top 1')).rows, [{ region: 'East', 'Q sum revenue': 500 }]);
  const constants = [{ name: 'Constant', role: 'measure', expression: '1' }];
  const tied = prepare('min Constant by category top 1', constants);
  assert.deepEqual(execute({ ...tied, calculatedFields: [...constants, ...tied.calculatedFields] }).rows, [{ category: 'Hardware', 'Q min Constant': 1 }]);
  assert.equal(execute(prepare('count rows by region and category top 3')).rows.length, 3);
});
test('numeric grouping fields become typed string dimensions', () => {
  assert.equal(execute(prepare('sum revenue by order_id')).rows.length, 8);
});
test('Q add is atomic, targets the active sheet, reuses helpers and persists through export/import', () => {
  let d = authorReducer(emptyDraft(), { type: 'sheet-add' });
  const p = prepare('average revenue by region top 1 in 2025');
  d = authorReducer(d, { type: 'q-add', ...p }); validateDraft(d);
  assert.equal(d.sheets[0].visuals.length, 0); assert.equal(activeSheet(d).visuals.length, 1);
  assert.equal(activeSheet(d).selectedId, 'visual-1'); assert.equal(activeSheet(d).layout[0].i, 'visual-1');
  assert.ok(serializeDraft(d).definition.calculatedFields.length);
  const restored = importBundle(exportBundle(d));
  const v = restored.sheets.flatMap(s => s.visuals)[0];
  assert.deepEqual(v.imported.issues, []);
  assert.deepEqual(execute({ visual: v, calculatedFields: restored.calculatedFields }).rows, execute(p).rows);
  const next = prepare('average revenue by region top 1 in 2025', d.calculatedFields);
  assert.equal(next.calculatedFields.length, 0);
  d = authorReducer(d, { type: 'q-add', ...next }); assert.equal(activeSheet(d).visuals[1].id, 'visual-2');
  assert.equal(authorReducer(d, { type: 'q-add', visual: { ...p.visual, measures: ['unknown'] }, calculatedFields: [] }), d);
});
test('Q helper names never overwrite existing fields; aggregate inputs are named unsupported', () => {
  const existing = [{ name: 'Q sum revenue', role: 'measure', expression: '1' }];
  assert.equal(prepare('sum revenue', existing).visual.measures[0], 'Q sum revenue 2');
  assert.throws(() => prepare('sum "Total revenue"', [{ name: 'Total revenue', role: 'measure', expression: 'sum({revenue})' }]), /Q_UNSUPPORTED_CALCULATION/);
});
test('Q chrome labels the local interpreter and no-result diagnostics honestly', () => {
  const html = renderToStaticMarkup(createElement(QEntry, { draft: emptyDraft(), dispatch() {} }));
  assert.match(html, /Ask a question/); assert.match(html, /Local deterministic interpreter · No AI/);
});
test('Q submit, alternative selection and ADD TO ANALYSIS use the chosen rendered interpretation', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft;
  function Harness() { const [d, dispatch] = useReducer(authorReducer, emptyDraft()); draft = d; return createElement(QEntry, { draft: d, dispatch }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  await act(() => renderer.root.findByType('input').props.onChange({ target: { value: 'revenue by region' } }));
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  const card = () => renderer.root.findByType(VisualCard).props.visual;
  assert.equal(card().rows[0]['Q sum revenue'], 500);
  const alternative = renderer.root.findAllByType('button').find(b => String(b.props.children[0]).includes('Showing avg'));
  assert.ok(alternative); await act(() => alternative.props.onClick());
  assert.equal(card().rows[0]['Q avg revenue'], 125);
  const button = renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS');
  await act(() => button.props.onClick());
  assert.equal(activeSheet(draft).visuals[0].measures[0], 'Q avg revenue');
  assert.equal(renderer.root.findAllByType(VisualCard).length, 0);
  validateDraft(draft);
});
