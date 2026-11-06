import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretQuestion } from '@opensight/o-interpreter';
import { activeSheet, authorReducer, dataFields, emptyDraft, validLayout, validateDraft, remapVisual } from '../build/test/authoring.js';
import { prepareOPlan, oPlanItems, packOTiles, editOInterpretation } from '../build/test/o-dashboard.js';
import { prepareOVisual } from '../build/test/o-authoring.js';
import { createAuthorHistory, authorHistoryReducer } from '../build/test/author-history.js';
import { exportBundle, importBundle } from '../build/test/bundle-authoring.js';
const plan = questions => ({ sheetTitle: 'Sales', delivered: questions.length, tiles: questions.map(question => ({ question, status: 'ok', result: interpretQuestion(question, dataFields([])) })) });
test('#196 layout packs four KPIs, mixed chart pairs and table last; current bottom is respected', () => {
  const kinds = ['bar', 'kpi', 'line', 'kpi', 'table', 'kpi', 'pie', 'kpi'];
  const visuals = kinds.map((kind, i) => ({ id: `visual-${i+1}`, kind }));
  const layout = packOTiles(visuals);
  assert.deepEqual(layout, [
    { i: 'visual-2', x: 0, y: 0, w: 3, h: 4 }, { i: 'visual-4', x: 3, y: 0, w: 3, h: 4 },
    { i: 'visual-6', x: 6, y: 0, w: 3, h: 4 }, { i: 'visual-8', x: 9, y: 0, w: 3, h: 4 },
    { i: 'visual-1', x: 0, y: 4, w: 6, h: 8 }, { i: 'visual-3', x: 6, y: 4, w: 6, h: 8 },
    { i: 'visual-7', x: 0, y: 12, w: 6, h: 8 }, { i: 'visual-5', x: 0, y: 20, w: 12, h: 8 },
  ]);
  assert.equal(validLayout(layout, visuals), true);
  assert.deepEqual(packOTiles(visuals, 17), layout.map(p => ({ ...p, y: p.y + 17 })));
});
test('#196 preparation threads shared helpers, including after their first owner is removed', () => {
  const draft = emptyDraft(), p = prepareOPlan(plan(['sum revenue', 'sum revenue by region']), draft);
  assert.equal(p.tiles[0].prepared.calculatedFields.length, 1); assert.equal(p.tiles[1].prepared.calculatedFields.length, 0);
  p.tiles[0].kept = false;
  const items = oPlanItems(p, draft); assert.equal(items.length, 1); assert.equal(items[0].calculatedFields.length, 1);
  const d = authorReducer(draft, { type: 'o-add-many', target: { kind: 'new-sheet', name: p.sheetTitle }, items }); validateDraft(d); assert.equal(d.calculatedFields.length, 1);
});
test('#196 batch commit is one undo command; invalid batches and empty batches are byte-identical no-ops', () => {
  const draft = emptyDraft(), items = oPlanItems(prepareOPlan(plan(['sum revenue', 'sum revenue by region']), draft), draft);
  const action = { type: 'o-add-many', target: { kind: 'new-sheet', name: 'Sales' }, items };
  const history = authorHistoryReducer(createAuthorHistory(draft), action);
  assert.equal(history.undo.length, 1); assert.equal(history.draft.sheets.length, 2); assert.equal(activeSheet(history.draft).visuals.length, 2);
  assert.deepEqual(authorHistoryReducer(history, { type: 'undo' }).draft, draft);
  const before = JSON.stringify(draft);
  for (const bad of [{ ...action, items: [] }, { ...action, items: [...items, { ...items[0], placement: { ...items[0].placement, w: 1 } }] }, { ...action, items: [{ ...items[0], calculatedFields: [{ name: 'broken', role: 'measure', expression: 'invalid(' }] }] }]) assert.equal(authorReducer(draft, bad), draft);
  assert.equal(JSON.stringify(draft), before);
});
test('#196 final edited interpretation stamps single adds and round-trips bundle/remap untouched', () => {
  const initial = interpretQuestion('sum revenue by region', dataFields([])).interpretations[0];
  const interpretation = editOInterpretation(initial, { aggregation: 'AVG' }), prepared = prepareOVisual(interpretation);
  const draft = authorReducer(emptyDraft(), { type: 'o-add', ...prepared }), stamp = activeSheet(draft).visuals[0].o;
  assert.deepEqual(stamp.interpretation, interpretation); assert.match(stamp.question, /^avg /);
  assert.deepEqual(importBundle(exportBundle(draft)).sheets[0].visuals[0].o, stamp);
  assert.deepEqual(remapVisual(activeSheet(draft).visuals[0]).o, stamp);
  for (const o of [{}, { question: 'q', interpretation: {} }, { ...stamp, interpretation: { ...interpretation, confidence: 'high' } }]) {
    const broken = structuredClone(draft); broken.sheets[0].visuals[0].o = o; assert.throws(() => validateDraft(broken));
  }
});
test('#196 preparation failures stay explicit and never alter the draft', () => {
  const draft = emptyDraft(), before = JSON.stringify(draft), p = prepareOPlan(plan(['sum revenue']), draft);
  p.tiles[0].interpretation = editOInterpretation(p.tiles[0].interpretation, { suggestedVisualType: 'bar' });
  const failed = prepareOPlan(p, draft); assert.equal(failed.tiles[0].status, 'failed'); assert.match(failed.tiles[0].message, /O_MISSING_DIMENSION/); assert.deepEqual(oPlanItems(failed, draft), []); assert.equal(JSON.stringify(draft), before);
});
