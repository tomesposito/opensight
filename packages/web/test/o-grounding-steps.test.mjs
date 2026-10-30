import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { interpretQuestion } from '@opensight/o-interpreter';
import { OEntry } from '../build/test/OEntry.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { activeSheet, authorReducer, dataFields, emptyDraft } from '../build/test/authoring.js';

test('dataset field metadata synonyms ground the interpreter (sales -> revenue)', () => {
  const r = interpretQuestion('sum sales by region', dataFields());
  assert.ok(r.interpretations.length, JSON.stringify(r));
  const i = r.interpretations[0];
  assert.equal(i.measure, 'revenue');
  assert.deepEqual(i.grounding.fieldsUsed, ['revenue', 'region']);
  assert.deepEqual(i.grounding.synonymsMatched, [{ term: 'sales', field: 'revenue' }]);
  assert.deepEqual(i.grounding.unmatchedTerms, []);
});

async function harness(t) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft;
  function Harness() { const [d, dispatch] = useReducer(authorReducer, emptyDraft()); draft = d; return createElement(OEntry, { draft: d, dispatch }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const ask = async q => {
    await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: q } }));
    await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  };
  const texts = () => renderer.root.findAllByType('p').map(p => [p.props.children].flat(Infinity).filter(x => typeof x === 'string').join(''));
  const card = () => renderer.root.findByType(VisualCard).props.visual;
  return { renderer, ask, texts, card, draft: () => draft };
}

test('panel shows grounding and synonyms, and the aggregation step edit re-runs the preview', async t => {
  const { renderer, ask, texts, card } = await harness(t);
  await ask('sum sales by region');
  assert.ok(texts().some(x => x.includes('Grounded in: revenue, region')), texts().join(' | '));
  assert.ok(texts().some(x => x.includes('‘sales’ → revenue')), texts().join(' | '));
  assert.equal(card().rows[0]['O sum revenue'], 500);
  const select = renderer.root.findByProps({ 'aria-label': 'Aggregation step' });
  await act(() => select.props.onChange({ target: { value: 'AVG' } }));
  assert.equal(card().rows[0]['O avg revenue'], 125);
});

test('unmatched terms are named in the panel, never silently dropped', async t => {
  const { ask, texts } = await harness(t);
  await ask('sum revenue by region blargh');
  assert.ok(texts().some(x => x.includes('Not understood: blargh')), texts().join(' | '));
});

test('removing a filter step removes it from the prepared visual', async t => {
  const { renderer, ask, draft } = await harness(t);
  const add = async () => {
    const button = renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS');
    assert.ok(button);
    await act(() => button.props.onClick());
  };
  await ask('sum revenue by region for category Hardware');
  await add();
  assert.equal(activeSheet(draft()).visuals[0].filters.length, 1);
  await ask('sum revenue by region for category Hardware');
  const remove = renderer.root.findByProps({ 'aria-label': 'Remove filter category' });
  await act(() => remove.props.onClick());
  await add();
  assert.equal(activeSheet(draft()).visuals[1].filters.length, 0);
});

test('removing the last group-by step clears Top N and requires an appropriate visual', async t => {
  const { renderer, ask, draft, texts } = await harness(t);
  await ask('sum revenue by region top 2');
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Top N step' }).length, 1);
  const remove = renderer.root.findByProps({ 'aria-label': 'Remove group-by region' });
  await act(() => remove.props.onClick());
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Top N step' }).length, 0);
  // The bar still needs grouping; its visual type is not silently changed.
  assert.ok(texts().some(x => x.includes('O_MISSING_DIMENSION')), texts().join(' | '));
  const visualSelect = renderer.root.findByProps({ 'aria-label': 'Visual step' });
  await act(() => visualSelect.props.onChange({ target: { value: 'kpi' } }));
  const button = renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS');
  assert.ok(button);
  await act(() => button.props.onClick());
  const visual = activeSheet(draft()).visuals[0];
  assert.equal(visual.kind, 'kpi');
  assert.equal(visual.dimension, null);
});

test('an edited interpretation still adds to the analysis through the existing path', async t => {
  const { renderer, ask, draft } = await harness(t);
  await ask('sum revenue by region');
  const select = renderer.root.findByProps({ 'aria-label': 'Visual step' });
  await act(() => select.props.onChange({ target: { value: 'pie' } }));
  const button = renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS');
  assert.ok(button);
  await act(() => button.props.onClick());
  assert.equal(activeSheet(draft()).visuals[0].kind, 'pie');
});
