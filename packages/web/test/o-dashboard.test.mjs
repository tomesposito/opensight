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

test('#196 replace preserves presentation and placement, advances auto title/stamp and undoes exactly', () => {
  let draft = authorReducer(emptyDraft(), { type: 'o-add', ...prepareOVisual(interpretQuestion('sum revenue by region', dataFields([])).interpretations[0]) });
  const old = activeSheet(draft).visuals[0];
  Object.assign(old, { subtitle: 'A caption', subtitleVisible: true, palette: ['#112233', '#445566'], referenceLines: [{ id: 'refline-1', value: 5, label: 'Target', color: '#112233' }], tooltipVisible: false, labels: true, formatting: { legendPosition: 'LEFT' } });
  validateDraft(draft);
  const before = structuredClone(draft), p = prepareOVisual(interpretQuestion('sum revenue by order_date per month', dataFields(draft.calculatedFields)).interpretations[0], draft.calculatedFields);
  const history = authorHistoryReducer(createAuthorHistory(draft), { type: 'o-replace', id: old.id, ...p });
  const next = activeSheet(history.draft).visuals[0];
  for (const key of ['id', 'subtitle', 'subtitleVisible', 'palette', 'referenceLines', 'tooltipVisible', 'labels', 'formatting']) assert.deepEqual(next[key], old[key], key);
  for (const key of ['kind', 'dimension', 'rows', 'columns', 'measures', 'filters', 'dateGrain', 'donut']) assert.deepEqual(next[key], p.visual[key], key);
  assert.equal(next.title, p.visual.title); assert.deepEqual(next.o, p.visual.o); assert.deepEqual(activeSheet(history.draft).layout, activeSheet(before).layout);
  assert.deepEqual(authorHistoryReducer(history, { type: 'undo' }).draft, before);
  const second = prepareOVisual(interpretQuestion('avg revenue by region', dataFields(history.draft.calculatedFields)).interpretations[0], history.draft.calculatedFields);
  const chained = authorReducer(history.draft, { type: 'o-replace', id: next.id, ...second }); assert.equal(activeSheet(chained).visuals[0].o.question, second.visual.o.question);
  draft = structuredClone(before); activeSheet(draft).visuals[0].title = 'My custom title';
  assert.equal(activeSheet(authorReducer(draft, { type: 'o-replace', id: old.id, ...p })).visuals[0].title, 'My custom title');
  delete activeSheet(draft).visuals[0].o;
  assert.equal(authorReducer(draft, { type: 'o-replace', id: old.id, ...p }), draft);
});
