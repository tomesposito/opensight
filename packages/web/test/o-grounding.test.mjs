import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { interpretQuestion } from '@opensight/o-interpreter';
import { OEntry } from '../build/test/OEntry.js';
import { LiveAuthorVisual } from '../build/test/LiveAuthorVisual.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { activeSheet, authorReducer, dataFields, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { prepareOVisual } from '../build/test/o-authoring.js';

async function mount(t, initial = emptyDraft(), client) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft, dispatch;
  function Harness() {
    [draft, dispatch] = useReducer(authorReducer, initial);
    return createElement(OEntry, { draft, dispatch, client });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  const change = async (label, value) => { await act(() => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } })); };
  const click = async label => {
    const button = renderer.root.findAllByType('button').find(b => b.props['aria-label'] === label || b.props.children === label);
    assert.ok(button, label); await act(() => button.props.onClick());
  };
  return {
    renderer, change, click, draft: () => draft,
    text: () => JSON.stringify(renderer.toJSON()),
    preview: () => renderer.root.findByType(LiveAuthorVisual).props,
    card: () => renderer.root.findByType(VisualCard).props.visual,
    ask: async value => {
      await act(() => renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value } }));
      await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    },
  };
}

test('dataFields preserves declared dataset synonyms and leaves calculated aliases undefined', () => {
  assert.deepEqual(dataFields().find(f => f.name === 'revenue').synonyms, ['sales']);
  const fields = dataFields([{ name: 'doubled', role: 'measure', expression: '{amount} * 2' }], {
    id: 'custom', name: 'Custom', columns: [{ name: 'amount', type: 'DECIMAL', synonyms: ['turnover'] }],
  });
  assert.deepEqual(fields[0].synonyms, ['turnover']); assert.equal(fields[1].synonyms, undefined);
  assert.equal(interpretQuestion('sum turnover', fields).interpretations[0].measure, 'amount');
});

test('panel names grounded fields, metadata synonyms and unmatched question terms', async t => {
  const ui = await mount(t);
  await ui.ask('sum sales by region blargh');
  assert.match(ui.text(), /Grounded in:/); assert.match(ui.text(), /revenue, region/);
  assert.match(ui.text(), /‘sales’ → revenue/); assert.match(ui.text(), /UNRECOGNIZED_WORDS/);
  const grounding = ui.renderer.root.findAll(n => n.props.className === 'o-grounding').map(n => JSON.stringify(n.props.children)).join(' ');
  assert.match(grounding, /blargh/);
});

test('aggregation edits recompute fixture results and ADD TO ANALYSIS uses the edited, valid visual', async t => {
  const ui = await mount(t);
  await ui.ask('sum sales by region');
  assert.equal(ui.card().rows[0]['O sum revenue'], 500);
  await ui.change('Aggregation step', 'AVG');
  assert.equal(ui.card().rows[0]['O avg revenue'], 125);
  assert.equal(ui.preview().calculations[0].expression, 'avg({revenue})');
  assert.equal(ui.preview().visual.title, 'avg of revenue by region');
  await ui.click('ADD TO ANALYSIS');
  validateDraft(ui.draft());
  assert.equal(activeSheet(ui.draft()).visuals[0].measures[0], 'O avg revenue');
  assert.equal(ui.renderer.root.findAllByType(LiveAuthorVisual).length, 0);
});

test('filter removal changes prepared filters and results, and removes unused grounding fields', async t => {
  const ui = await mount(t);
  await ui.ask('sum sales for region West');
  assert.equal(ui.card().rows[0]['O sum revenue'], 400);
  assert.deepEqual(ui.preview().visual.filters, [{ columnName: 'region', values: ['West'] }]);
  await ui.click('Remove filter region');
  assert.deepEqual(ui.preview().visual.filters, []);
  assert.equal(ui.card().rows[0]['O sum revenue'], 900);
  assert.equal(ui.preview().visual.title, 'sum of revenue');
  assert.doesNotMatch(ui.renderer.root.findAllByProps({ className: 'o-grounding' }).map(n => JSON.stringify(n.props.children)).join(' '), /region/);
});

test('alternatives and new questions reset aggregation/filter edits', async t => {
  const ui = await mount(t);
  await ui.ask('sales by region for category Hardware');
  await ui.change('Aggregation step', 'MAX'); await ui.click('Remove filter category');
  const alternative = ui.renderer.root.findAllByType('button').find(b => String(b.props.children[0]).includes('Showing avg'));
  await act(() => alternative.props.onClick());
  assert.equal(ui.preview().calculations[0].expression, 'avg({revenue})');
  assert.equal(ui.preview().visual.filters.length, 1);
  await ui.ask('sum sales');
  assert.equal(ui.card().rows[0]['O sum revenue'], 900);
  assert.equal(ui.preview().visual.filters.length, 0);
});

test('non-numeric measures and row counts offer only COUNT', async t => {
  const ui = await mount(t);
  for (const question of ['count region', 'count rows']) {
    await ui.ask(question);
    const select = ui.renderer.root.findByProps({ 'aria-label': 'Aggregation step' });
    assert.deepEqual(select.findAllByType('option').map(o => o.props.value ?? o.props.children), ['COUNT']);
  }
});

test('Top N edits, clear and final-dimension removal never retain an invalid grouping', async t => {
  const ui = await mount(t);
  await ui.ask('sum revenue by region top 1');
  assert.equal(ui.card().rows.length, 1);
  await ui.change('Top N step', '2'); assert.equal(ui.card().rows.length, 2);
  await ui.change('Top N step', '1.5');
  assert.match(ui.text(), /O_INVALID_TOP_N/);
  await ui.change('Top N step', '0');
  assert.match(ui.text(), /O_INVALID_TOP_N/);
  assert.equal(ui.renderer.root.findAllByType(LiveAuthorVisual).length, 0);
  assert.equal(ui.renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS').props.disabled, true);
  await ui.click('Clear top N');
  assert.equal(ui.preview().visual.filters.length, 0);
  await ui.ask('sum revenue by region top 1');
  await ui.click('Remove group-by region');
  assert.equal(ui.renderer.root.findAllByProps({ 'aria-label': 'Top N step' }).length, 0);
  assert.match(ui.text(), /O_MISSING_DIMENSION/);
  await ui.change('Visual step', 'kpi');
  assert.equal(ui.preview().visual.filters.length, 0);
  assert.equal(ui.card().rows[0]['O sum revenue'], 900);
  await ui.click('ADD TO ANALYSIS'); validateDraft(ui.draft());
});

test('date granularity edits recompute the existing date query and disappear after date removal', async t => {
  const ui = await mount(t);
  await ui.ask('sum revenue by region and order_date');
  await ui.change('Granularity step', 'YEAR');
  assert.equal(ui.preview().visual.dateGrain, 'YEAR');
  assert.equal(ui.card().rows.length, 2);
  assert.match(ui.preview().visual.title, /\(year\)/);
  await ui.click('Remove group-by order_date');
  assert.equal(ui.renderer.root.findAllByProps({ 'aria-label': 'Granularity step' }).length, 0);
  assert.equal(ui.preview().visual.dateGrain, undefined);
  assert.doesNotMatch(ui.preview().visual.title, /\(year\)/);
});

test('visual edits fail closed for incompatible groupings rather than dropping fields', async t => {
  const ui = await mount(t);
  await ui.ask('sum revenue by region and category');
  await ui.change('Visual step', 'bar');
  assert.match(ui.text(), /O_UNSUPPORTED_INTERPRETATION/);
  assert.equal(ui.renderer.root.findAllByType(LiveAuthorVisual).length, 0);
  await ui.click('Remove group-by category');
  assert.equal(ui.preview().visual.kind, 'bar');
  await ui.change('Visual step', 'pie'); assert.equal(ui.preview().visual.kind, 'pie');
  await ui.change('Visual step', 'kpi'); assert.match(ui.text(), /O_UNSUPPORTED_INTERPRETATION/);
});

test('existing unsupported-calculation errors remain visible through edits and prevent addition', async t => {
  const initial = { ...emptyDraft(), calculatedFields: [{ name: 'Total', role: 'measure', expression: 'sum({revenue})' }] };
  const ui = await mount(t, initial);
  await ui.ask('sum "Total" by region');
  assert.match(ui.text(), /O_UNSUPPORTED_CALCULATION/);
  await ui.change('Aggregation step', 'AVG');
  assert.match(ui.text(), /O_UNSUPPORTED_CALCULATION/);
  assert.equal(ui.renderer.root.findAllByType('button').find(b => b.props.children === 'ADD TO ANALYSIS').props.disabled, true);
});

test('edited API previews use the same client query path without fixture fallback', async t => {
  const calls = [];
  const ui = await mount(t, emptyDraft(), { async queryDataset(id, query) { calls.push({ id, query }); return { rows: [] }; } });
  await ui.ask('sum revenue by region'); await ui.change('Aggregation step', 'AVG');
  assert.equal(calls.length, 2); assert.equal(calls[1].id, 'sales');
  assert.equal(calls[1].query.calculatedFields[0].expression, 'avg({revenue})');
  assert.deepEqual(ui.card().rows, []);
});

test('preparation rejects invalid edited values and never silently coerces their meaning', () => {
  const i = interpretQuestion('sum sales by region', dataFields()).interpretations[0];
  for (const topN of [0, 1.5, 10001, NaN]) assert.throws(() => prepareOVisual({ ...i, topN }), /O_INVALID_TOP_N/);
  assert.throws(() => prepareOVisual({ ...i, dimensions: [], topN: 1 }), /O_MISSING_DIMENSION/);
  assert.throws(() => prepareOVisual({ ...i, measure: 'region' }), /O_UNSUPPORTED_INTERPRETATION/);
  assert.throws(() => prepareOVisual({ ...i, measure: 'unknown' }), /O_UNKNOWN_FIELD/);
  assert.throws(() => prepareOVisual({ ...i, granularity: 'YEAR' }), /O_UNSUPPORTED_INTERPRETATION/);
});
