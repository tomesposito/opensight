import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, validateDraft, serializeDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { parseQsBundle } from '@opensight/bundle-parser';
import { formattingValid, altTextValid, cleanAltText, ALT_TEXT_MAX_LENGTH } from '../build/test/formatting.js';
import { VisualCard } from '../build/test/VisualCard.js';

const add = (kind = 'bar') => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const input = (v, rows = [{ region: 'East', revenue: 100 }, { region: 'West', revenue: 40 }]) => ({ ...buildAuthorVisual({ ...v, dimension: 'region', measures: ['revenue'] }), rows });
const html = v => renderToStaticMarkup(createElement(VisualCard, { visual: v }));

test('altTextValid / cleanAltText: plain text, trimmed, length-capped, blank clears', () => {
  assert.ok(altTextValid('Revenue by region'));
  assert.ok(altTextValid('x'.repeat(ALT_TEXT_MAX_LENGTH)));
  assert.ok(altTextValid('  padded  ')); // validated on the trimmed value
  for (const bad of ['', '   ', '\n\t ', 'x'.repeat(ALT_TEXT_MAX_LENGTH + 1), 42, null, {}, ['a']]) {
    assert.equal(altTextValid(bad), false, `altTextValid should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(cleanAltText(undefined), undefined);
  assert.equal(cleanAltText(''), undefined);
  assert.equal(cleanAltText('   '), undefined);
  assert.equal(cleanAltText('  Bars per region  '), 'Bars per region');
  // formattingValid wires the key in and rejects invalid values fail-closed.
  assert.ok(formattingValid({ altText: 'Revenue by region' }));
  assert.equal(formattingValid({ altText: '   ' }), false);
  assert.equal(formattingValid({ altText: 'x'.repeat(ALT_TEXT_MAX_LENGTH + 1) }), false);
  assert.equal(formattingValid({ altText: 42 }), false);
});

test("reducer 'alt-text' sets, trims, clears the key, and rejects over-length", () => {
  let draft = authorReducer(add(), { type: 'alt-text', altText: '  Bars per region  ' });
  assert.equal(selected(draft).formatting.altText, 'Bars per region');
  // Blank clears the key; the whole formatting object is dropped when nothing remains.
  draft = authorReducer(draft, { type: 'alt-text', altText: '   ' });
  assert.equal(selected(draft).formatting, undefined);
  // The key strips without disturbing sibling formatting keys.
  draft = authorReducer(add(), { type: 'card-layout', layout: { paddingPx: 8 } });
  draft = authorReducer(draft, { type: 'alt-text', altText: 'text' });
  draft = authorReducer(draft, { type: 'alt-text', altText: undefined });
  assert.deepEqual(selected(draft).formatting, { cardLayout: { paddingPx: 8 } });
  // Over-length input keeps the last valid value (fail-closed editing).
  draft = authorReducer(add(), { type: 'alt-text', altText: 'keep' });
  const over = authorReducer(draft, { type: 'alt-text', altText: 'x'.repeat(ALT_TEXT_MAX_LENGTH + 1) });
  assert.equal(selected(over).formatting.altText, 'keep');
  validateDraft(over);
});

test('alt text exports, reimports, and round-trips byte-identically; tampered imports drop formatting', async () => {
  const draft = authorReducer(add(), { type: 'alt-text', altText: 'Bars per region' });
  const bundle = await parseQsBundle(await downloadBundleBytes(draft));
  const exported = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.opensightFormatting;
  assert.deepEqual(exported, { altText: 'Bars per region' });
  const restored = importBundle(bundle);
  assert.equal(selected(restored).formatting.altText, 'Bars per region');
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
  // A tampered bundle with invalid alt text imports fail-closed: the whole formatting is dropped.
  const tampered = structuredClone(bundle);
  tampered.members[0].resource.definition.sheets[0].visuals[0].barChartVisual.opensightFormatting.altText = 'x'.repeat(ALT_TEXT_MAX_LENGTH + 1);
  const recovered = importBundle(tampered);
  assert.equal(selected(recovered).formatting, undefined);
});

test('chart aria-label and table caption honor altText; title remains the fallback', () => {
  const titled = authorReducer(add(), { type: 'title', title: 'Sales overview' });
  const withAlt = html(input({ ...selected(titled), formatting: { altText: 'Bars show East at 100, West at 40' } }));
  assert.ok(withAlt.includes('role="img" aria-label="Bars show East at 100, West at 40"'));
  const withoutAlt = html(input(selected(titled)));
  assert.ok(withoutAlt.includes('role="img" aria-label="Sales overview"'));
  const tableAlt = html(input({ ...selected(authorReducer(add('table'), { type: 'alt-text', altText: 'Tabular breakdown' })) }, [{ region: 'East', revenue: 100 }]));
  assert.ok(tableAlt.includes('<caption class="sr-only">Tabular breakdown — result data</caption>'));
});
