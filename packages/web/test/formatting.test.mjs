import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, validateDraft, loadDraft, saveDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { parseQsBundle } from '@opensight/bundle-parser';
import { compileVisual } from '../build/test/compiler.js';
import { formattingValid, matchingRule } from '../build/test/formatting.js';
import { rowSelection } from '../build/test/visual-selection.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { buildAuthorQuery } from '../build/test/author-query.js';

const add = (kind = 'table') => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const rule = { fieldId: 'revenue', operator: 'gte', threshold: 100, color: '#aa0000', background: '#ffeeee' };
const input = (v, rows = [{ region: 'East', revenue: 100 }, { region: 'West', revenue: null }]) => ({ ...buildAuthorVisual(v), rows });
const html = v => renderToStaticMarkup(createElement(VisualCard, { visual: v }));

test('formatting persists, exports and reimports without changing queries or interaction field identities', async () => {
  const before = add();
  const f = { names: { region: 'Territory', revenue: 'Sales' }, headerColor: '#112233', headerBackground: '#eeeeee', cellColor: '#123456', cellBackground: '#ffffff', fontSize: 16, decimalPlaces: 1, rules: [rule] };
  const draft = authorReducer(before, { type: 'formatting', formatting: f });
  f.rules[0] = { ...rule, threshold: 1000 }; // Reducer owns a copy.
  validateDraft(draft);
  assert.deepEqual(buildAuthorQuery(selected(draft)), buildAuthorQuery(selected(before)));
  const compiled = compileVisual(input(selected(draft)));
  assert.deepEqual(compiled.table.columns, ['Territory', 'Sales']);
  assert.deepEqual(rowSelection(compiled, 0), { values: { region: 'East' } });
  let saved; const store = { getItem: () => saved, setItem: (_, v) => { saved = v; } };
  saveDraft(draft, () => store); assert.deepEqual(loadDraft(() => store).draft, draft);
  const bundle = await parseQsBundle(await downloadBundleBytes(draft));
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).formatting, selected(draft).formatting);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
  const rendered = html(input(selected(restored)));
  assert.match(rendered, /font-size:16px;color:#123456;background:#ffffff/);
  assert.match(rendered, /color:#112233;background:#eeeeee/);
  assert.match(rendered, /color:#aa0000;background:#ffeeee">100.0/);
  assert.match(rendered, /\(null\)/);
  const reset = authorReducer(restored, { type: 'formatting', formatting: {} });
  assert.deepEqual(exportBundle(reset).members[0].resource.definition.sheets[0].visuals[0].tableVisual.opensightFormatting, {});
});

test('pivot names and visibility preserve values; rules apply by measure across columns, totals and subtotals', () => {
  const v = { ...selected(add('pivot')), rows: ['region', 'order_id'], columns: ['category'], measures: ['revenue', 'profit'], totals: true, subtotals: true,
    formatting: { names: { region: 'Territory', category: 'Product', revenue: 'Sales' }, rowNamesVisible: false, columnNamesVisible: false, valueNamesVisible: false, rules: [rule] } };
  const rows = [{ region: 'East', order_id: 1, category: 'Hardware', revenue: 60, profit: 150 }, { region: 'East', order_id: 2, category: 'Hardware', revenue: 70, profit: null }];
  const c = compileVisual(input(v, rows));
  assert.equal(c.table.columns[2], 'Product: Hardware · Sales');
  assert.deepEqual(c.table.visibleColumns, ['', '', 'Hardware', 'Hardware', 'Grand total', 'Grand total']);
  assert.deepEqual(c.table.rowKinds, ['detail', 'detail', 'subtotal', 'total']);
  const rendered = html(input(v, rows));
  assert.match(rendered, /class="sr-only">Territory/);
  assert.equal((rendered.match(/color:#aa0000;background:#ffeeee">130/g) ?? []).length, 4);
  assert.doesNotMatch(rendered, /background:#ffeeee">150/); // Profit must not inherit revenue's rule.
  const hidden = html(input({ ...v, formatting: { ...v.formatting, headersVisible: false } }, rows));
  assert.match(hidden, /<thead class="sr-only">/);
});

test('formatting validation rejects unsafe or malformed styles and finite comparison rules are ordered', () => {
  for (const invalid of [{ fontSize: 7 }, { decimalPlaces: 13 }, { fontSize: NaN }, { headerColor: 'url(x)' }, { headersVisible: 'false' }, { unknown: 1 }, { names: { revenue: '' } }, { rules: [{ ...rule, threshold: Infinity }] }, { rules: [{ ...rule, operator: 'eval' }] }, { rules: Array(21).fill(rule) }]) {
    assert.equal(formattingValid(invalid), false);
    assert.equal(selected(authorReducer(add(), { type: 'formatting', formatting: invalid })).formatting, undefined);
    assert.throws(() => validateDraft({ ...add(), sheets: [{ ...activeSheet(add()), visuals: [{ ...selected(add()), formatting: invalid }] }] }));
    assert.throws(() => compileVisual(input({ ...selected(add()), formatting: invalid })), /invalid visual formatting/);
  }
  for (const [operator, yes, no] of [['gt', 101, 100], ['gte', 100, 99], ['lt', 99, 100], ['lte', 100, 101], ['eq', 100, 101]]) {
    const r = { ...rule, operator };
    assert.equal(matchingRule([r], 'revenue', yes), r); assert.equal(matchingRule([r], 'revenue', no), undefined);
  }
  const rules = [rule, { ...rule, color: '#000000' }];
  assert.equal(matchingRule(rules, 'revenue', 100), rule);
  for (const value of [null, '100', NaN, Infinity]) assert.equal(matchingRule(rules, 'revenue', value), undefined);
});

test('chart mark rules use original values, keep null gaps and display names do not rename bindings', () => {
  for (const kind of ['bar', 'line', 'area', 'combo', 'bar100', 'scatter', 'funnel', 'pie']) {
    const v = { ...selected(add(kind)), dimension: 'region', formatting: { names: { revenue: 'Sales' }, rules: [rule] } };
    const c = compileVisual(input(v, [{ region: 'East', revenue: 120, profit: 30 }, { region: 'West', revenue: 50, profit: 20 }]));
    assert.equal(c.option.series[0].data[0].itemStyle.color, rule.color, kind);
    assert.equal(c.option.series[0].data[1]?.itemStyle, undefined, kind);
    if (kind === 'bar100') assert.equal(c.option.series[0].data[0].value, 80);
    assert.equal(c.model.measures[0].column, 'revenue');
  }
  const c = compileVisual(input({ ...selected(add('line')), dimension: 'region', formatting: { rules: [rule] } }));
  assert.equal(c.option.series[0].data[1], null);
});

test('unsupported native formatting and future extension data are reported, retained and never executed', () => {
  const resource = serializeDraft(add());
  const body = resource.definition.sheets[0].visuals[0].tableVisual;
  body.conditionalFormatting = { vendorRule: '<script>not executable</script>' };
  body.opensightFormatting = { futureColorScale: { mode: 'future' } };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const imported = importBundle(bundle);
  assert.equal(selected(imported).formatting, undefined);
  assert.match(JSON.stringify(imported.bundle.report), /conditionalFormatting/);
  assert.match(JSON.stringify(imported.bundle.report), /opensightFormatting/);
  assert.deepEqual(exportBundle(imported), bundle);
  const edited = authorReducer(imported, { type: 'title', title: 'Renamed' });
  assert.deepEqual(exportBundle(edited).members[0].resource.definition.sheets[0].visuals[0].tableVisual.conditionalFormatting, body.conditionalFormatting);
});

test('gauge ranges and histogram bins validate and round-trip as supported settings', () => {
  for (const [kind, action, property, expected] of [['gauge', { type: 'gauge', min: -50, max: 200 }, 'gauge', { min: -50, max: 200 }], ['histogram', { type: 'bins', bins: 4 }, 'bins', 4]]) {
    const draft = authorReducer(add(kind), action); validateDraft(draft);
    const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource: serializeDraft(draft) }] };
    const restored = importBundle(bundle); assert.deepEqual(selected(restored)[property], expected);
    assert.deepEqual(selected(restored).imported.issues, []); assert.deepEqual(exportBundle(restored), bundle);
    const c = compileVisual(input(selected(draft), kind === 'gauge' ? [{ revenue: 120 }] : [{ region: 'East', revenue: 1 }, { region: 'West', revenue: 9 }]));
    if (kind === 'gauge') { assert.equal(c.option.series[0].min, -50); assert.equal(c.option.series[0].max, 200); }
    else assert.equal(c.option.series[0].data.length, 4);
  }
  assert.equal(selected(authorReducer(add('gauge'), { type: 'gauge', min: 5, max: 4 })).gauge, undefined);
  assert.equal(selected(authorReducer(add('histogram'), { type: 'bins', bins: 101 })).bins, undefined);
});

test('scatter marks respect rule priority across X and Y measures', () => {
  const rules = [{ ...rule, fieldId: 'profit', threshold: 10, color: '#0000ff' }, rule];
  const v = { ...selected(add('scatter')), formatting: { rules } };
  const c = compileVisual(input(v, [{ region: 'East', revenue: 120, profit: 30 }]));
  assert.equal(c.option.series[0].data[0].itemStyle.color, '#0000ff');
});
