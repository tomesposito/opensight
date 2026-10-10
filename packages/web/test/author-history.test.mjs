import test from 'node:test';
import assert from 'node:assert/strict';
import { authorReducer, activeSheet, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { authorHistoryReducer as reduce, createAuthorHistory, AUTHOR_HISTORY_LIMIT } from '../build/test/author-history.js';

const visual = state => activeSheet(state.draft).visuals.find(v => v.id === activeSheet(state.draft).selectedId);
const content = draft => { const { chrome, activeSheetId, ...rest } = draft; return { ...rest, sheets: rest.sheets.map(({ selectedId, ...sheet }) => sheet) }; };

test('commands reverse field creation/assignment/removal, properties and complete visual deletion', () => {
  let state = createAuthorHistory(emptyDraft());
  const steps = [
    { type: 'assign-with-no-selection', field: 'region' },
    { type: 'assign', field: 'revenue', well: 'values' },
    { type: 'assign', field: 'category', well: 'smallMultiples' },
    { type: 'unassign', field: 'region', well: 'dimension' },
    { type: 'title', title: 'Revenue' },
    { type: 'display', property: 'legend', value: false },
    { type: 'add', kind: 'table' },
    { type: 'layout', sheetId: 'sheet-1', layout: [{ i: 'visual-1', x: 0, y: 0, w: 6, h: 8 }, { i: 'visual-2', x: 6, y: 0, w: 6, h: 8 }] },
    { type: 'remove', id: 'visual-1' },
  ];
  const snapshots = [state.draft];
  for (const action of steps) { state = reduce(state, action); validateDraft(state.draft); snapshots.push(state.draft); }
  for (let i = steps.length - 1; i >= 0; i--) { state = reduce(state, { type: 'undo' }); assert.deepEqual(state.draft, snapshots[i]); validateDraft(state.draft); }
  assert.equal(reduce(state, { type: 'undo' }), state);
  for (let i = 1; i < snapshots.length; i++) { state = reduce(state, { type: 'redo' }); assert.deepEqual(state.draft, snapshots[i]); validateDraft(state.draft); }
  assert.equal(reduce(state, { type: 'redo' }), state);
});

test('visual deletion restores action targets/mappings, selection and layout in its inverse', () => {
  let draft = authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }), { type: 'add', kind: 'bar' });
  const sheet = activeSheet(draft);
  sheet.visuals[0].filterActions = [{ id: 'filter', name: 'Filter', sourceField: 'region', targets: ['visual-2'], mappings: { 'visual-2': 'region' } }];
  validateDraft(draft);
  let state = createAuthorHistory(draft);
  state = reduce(state, { type: 'remove', id: 'visual-2' });
  assert.deepEqual(activeSheet(state.draft).visuals[0].filterActions[0].targets, []);
  state = reduce(state, { type: 'undo' }); assert.deepEqual(state.draft, draft);
  state = reduce(state, { type: 'redo' }); assert.equal(activeSheet(state.draft).visuals.length, 1);
});

test('history ignores no-op edits and selection, restores command context, and preserves chrome preference', () => {
  let state = createAuthorHistory(emptyDraft());
  state = reduce(state, { type: 'add', kind: 'bar' });
  state = reduce(state, { type: 'sheet-add' });
  state = reduce(state, { type: 'add', kind: 'pie' });
  state = reduce(state, { type: 'undo' });
  const redo = state.redo;
  state = reduce(state, { type: 'sheet-select', id: 'sheet-1' });
  state = reduce(state, { type: 'select', id: 'visual-1' });
  state = reduce(state, { type: 'chrome', mode: 'dark' });
  for (const action of [{ type: 'assign', field: 'revenue' }, { type: 'remove', id: 'missing' }, { type: 'theme', theme: {} }]) state = reduce(state, action);
  assert.equal(state.redo, redo); assert.equal(state.undo.length, 2);
  state = reduce(state, { type: 'redo' });
  assert.equal(state.draft.activeSheetId, 'sheet-2'); assert.equal(visual(state).kind, 'pie'); assert.equal(state.draft.chrome, 'dark');
  state = reduce(state, { type: 'undo' });
  state = reduce(state, { type: 'analysis-title', title: 'New branch' });
  assert.equal(state.redo.length, 0);
});

test('depth limit holds on both stacks and imports reset even with equal content', () => {
  let state = createAuthorHistory(emptyDraft());
  for (let i = 1; i <= 80; i++) state = reduce(state, { type: 'analysis-title', title: `Edit ${i}` });
  assert.equal(state.undo.length, AUTHOR_HISTORY_LIMIT);
  for (let i = 0; i < 70; i++) state = reduce(state, { type: 'undo' });
  assert.equal(state.draft.title, 'Edit 30'); assert.equal(state.redo.length, AUTHOR_HISTORY_LIMIT);
  for (let i = 0; i < 70; i++) state = reduce(state, { type: 'redo' });
  assert.equal(state.draft.title, 'Edit 80'); assert.equal(state.undo.length, AUTHOR_HISTORY_LIMIT);
  state = reduce(state, { type: 'undo' });
  state = reduce(state, { type: 'import', draft: state.draft });
  assert.equal(state.undo.length + state.redo.length, 0);
});

// A cursor-based timeline is the independent oracle (not the command stacks).
// Seeded mixed authoring/undo/redo/navigation sequences make failures repeatable.
for (const seed of [1, 17, 97, 2026, 65537]) test(`property interleavings: seed ${seed}, 800 operations`, () => {
  let random = seed;
  const pick = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
  let state = createAuthorHistory(emptyDraft()), timeline = [state.draft], cursor = 0;
  for (let i = 0; i < 800; i++) {
    const kind = pick(13), sheet = activeSheet(state.draft);
    const action = kind < 3 ? { type: 'undo' } : kind < 5 ? { type: 'redo' }
      : kind === 5 ? { type: 'add', kind: ['bar', 'pie', 'table'][pick(3)] }
      : kind === 6 ? { type: 'remove', id: sheet.selectedId ?? 'missing' }
      : kind === 7 ? { type: 'assign', field: ['region', 'category', 'revenue', 'profit'][pick(4)] }
      : kind === 8 ? { type: 'unassign', field: ['region', 'revenue'][pick(2)] }
      : kind === 9 ? { type: 'display', property: 'labels', value: !!pick(2) }
      : kind === 10 ? { type: 'title', title: `Title ${i}` }
      : kind === 11 ? { type: 'select', id: sheet.visuals[pick(sheet.visuals.length)]?.id ?? 'missing' }
      : { type: 'analysis-title', title: `Analysis ${i}` };
    if (action.type === 'undo') cursor = Math.max(0, cursor - 1);
    else if (action.type === 'redo') cursor = Math.min(timeline.length - 1, cursor + 1);
    else {
      const next = authorReducer(state.draft, action);
      if (JSON.stringify(content(next)) !== JSON.stringify(content(state.draft))) {
        timeline = [...timeline.slice(0, cursor + 1), next];
        if (timeline.length > AUTHOR_HISTORY_LIMIT + 1) timeline.shift();
        cursor = timeline.length - 1;
      }
    }
    state = reduce(state, action);
    assert.deepEqual(content(state.draft), content(timeline[cursor]), `operation ${i}: ${JSON.stringify(action)}`);
    assert.equal(state.undo.length, cursor); assert.equal(state.redo.length, timeline.length - cursor - 1);
    validateDraft(state.draft);
  }
});
