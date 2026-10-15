import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { parseQsBundle } from '@opensight/bundle-parser';
import { formattingValid, cardStyleValid, cardLayoutValid, cardSwatchValid, cardBorderValid, cleanCardStyle, cleanCardLayout, cardChromeStyle, cardLoadingAnimation, CARD_DEFAULTS } from '../build/test/formatting.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { VisualSkeleton } from '../build/test/VisualSkeleton.js';

const add = (kind = 'bar') => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const input = (v, rows = [{ region: 'East', revenue: 100 }, { region: 'West', revenue: 40 }]) => ({ ...buildAuthorVisual({ ...v, dimension: 'region', measures: ['revenue'] }), rows });
const html = v => renderToStaticMarkup(createElement(VisualCard, { visual: v }));

test('card validators are fail-closed: hex-only colors, bounded opacity/width/padding', () => {
  assert.ok(cardStyleValid({ background: { color: '#1a2b3c', opacityPct: 50 } }));
  assert.ok(cardStyleValid({ border: { color: '#000000', opacityPct: 0, widthPx: 0 }, loadingAnimation: false }));
  assert.ok(cardStyleValid({ selection: { color: '#ffffff' }, loadingAnimation: true }));
  assert.ok(cardStyleValid({}));
  assert.ok(cardLayoutValid({ paddingPx: 0 }));
  assert.ok(cardLayoutValid({ paddingPx: 64 }));
  assert.ok(cardLayoutValid({}));
  for (const bad of [
    { background: { color: 'red' } },                    // named colors rejected
    { background: { color: '#fff' } },                   // short hex rejected
    { background: { color: 'rgba(0,0,0,0.5)' } },        // rgba strings rejected
    { background: { color: '#1a2b3c', opacityPct: 101 } },
    { background: { color: '#1a2b3c', opacityPct: -1 } },
    { background: { color: '#1a2b3c', opacityPct: 50.5 } },
    { background: { opacityPct: 50 } },                  // color is required
    { border: { color: '#000000', widthPx: 9 } },
    { border: { color: '#000000', widthPx: -1 } },
    { border: { color: '#000000', widthPx: 1.5 } },
    { selection: { color: '#gggggg' } },
    { loadingAnimation: 'yes' },
    { background: { color: '#1a2b3c' }, unknown: true },  // unknown keys rejected
    'nope', null, [],
  ]) assert.equal(cardStyleValid(bad), false, `cardStyleValid should reject ${JSON.stringify(bad)}`);
  for (const bad of [{ paddingPx: 65 }, { paddingPx: -1 }, { paddingPx: 12.5 }, { paddingPx: '8' }, { unknown: 1 }])
    assert.equal(cardLayoutValid(bad), false, `cardLayoutValid should reject ${JSON.stringify(bad)}`);
  assert.equal(cardSwatchValid({ color: '#1a2b3c', extra: 1 }), false);
  assert.equal(cardBorderValid({ color: '#1a2b3c', extra: 1 }), false);
  // formattingValid wires both keys in and rejects invalid values fail-closed.
  assert.ok(formattingValid({ cardStyle: { background: { color: '#1a2b3c' } }, cardLayout: { paddingPx: 8 } }));
  assert.equal(formattingValid({ cardStyle: { background: { color: 'red' } } }), false);
  assert.equal(formattingValid({ cardLayout: { paddingPx: 99 } }), false);
  assert.equal(formattingValid({ cardstyle: {} }), false);
});

test('cleanCardStyle / cleanCardLayout strip reference defaults and no-op values', () => {
  assert.equal(cleanCardStyle(undefined), undefined);
  assert.equal(cleanCardStyle({}), undefined);
  // Exactly the reference defaults → nothing saved.
  assert.equal(cleanCardStyle({ background: { color: CARD_DEFAULTS.backgroundColor, opacityPct: CARD_DEFAULTS.backgroundOpacityPct } }), undefined);
  assert.equal(cleanCardStyle({ border: { color: CARD_DEFAULTS.borderColor, opacityPct: CARD_DEFAULTS.borderOpacityPct, widthPx: CARD_DEFAULTS.borderWidthPx } }), undefined);
  assert.equal(cleanCardStyle({ selection: { color: CARD_DEFAULTS.selectionColor, opacityPct: CARD_DEFAULTS.selectionOpacityPct } }), undefined);
  assert.equal(cleanCardStyle({ loadingAnimation: true }), undefined);
  assert.equal(cleanCardLayout({ paddingPx: CARD_DEFAULTS.paddingPx }), undefined);
  assert.equal(cleanCardLayout({}), undefined);
  // No-op values drop out of otherwise real settings.
  assert.deepEqual(cleanCardStyle({ background: { color: '#1a2b3c', opacityPct: 100 } }), { background: { color: '#1a2b3c' } });
  assert.deepEqual(cleanCardStyle({ border: { color: '#111111', opacityPct: 100, widthPx: 1 } }), { border: { color: '#111111' } });
  // Real deviations survive, including an explicit "no border".
  assert.deepEqual(cleanCardStyle({ border: { color: '#cccccc', widthPx: 0 } }), { border: { color: '#cccccc', widthPx: 0 } });
  assert.deepEqual(cleanCardStyle({ loadingAnimation: false }), { loadingAnimation: false });
  assert.deepEqual(cleanCardLayout({ paddingPx: 0 }), { paddingPx: 0 });
});

test('card-style and card-layout reducer actions validate and strip back to undefined', () => {
  const style = { background: { color: '#1a2b3c', opacityPct: 50 }, border: { color: '#000000', widthPx: 3 }, loadingAnimation: false };
  let draft = authorReducer(add(), { type: 'card-style', style });
  assert.deepEqual(selected(draft).formatting.cardStyle, style);
  const styleRef = selected(draft).formatting.cardStyle;
  style.background.color = '#ffffff'; // Reducer owns a copy.
  assert.equal(styleRef.background.color, '#1a2b3c');
  validateDraft(draft);
  // Invalid payloads are rejected without touching the visual.
  const before = structuredClone(selected(draft));
  draft = authorReducer(draft, { type: 'card-style', style: { background: { color: 'red' } } });
  assert.deepEqual(selected(draft), before);
  draft = authorReducer(draft, { type: 'card-layout', layout: { paddingPx: 99 } });
  assert.deepEqual(selected(draft), before);
  // Valid layout saves; clearing either key strips it, and an empty formatting object is dropped.
  draft = authorReducer(draft, { type: 'card-layout', layout: { paddingPx: 8 } });
  assert.deepEqual(selected(draft).formatting.cardLayout, { paddingPx: 8 });
  draft = authorReducer(draft, { type: 'card-layout', layout: undefined });
  assert.equal(selected(draft).formatting.cardLayout, undefined);
  assert.deepEqual(selected(draft).formatting.cardStyle, style);
  draft = authorReducer(draft, { type: 'card-style', style: undefined });
  assert.equal(selected(draft).formatting, undefined);
  assert.ok(!('formatting' in selected(draft)));
});

test('card style and layout export, reimport, and round-trip byte-identically', async () => {
  const style = { background: { color: '#1a2b3c', opacityPct: 50 }, border: { color: '#000000', widthPx: 3 }, selection: { color: '#112233' }, loadingAnimation: false };
  let draft = authorReducer(add(), { type: 'card-style', style });
  draft = authorReducer(draft, { type: 'card-layout', layout: { paddingPx: 8 } });
  const bundle = await parseQsBundle(await downloadBundleBytes(draft));
  const exported = bundle.members[0].resource.definition.sheets[0].visuals[0].barVisual.opensightFormatting;
  assert.deepEqual(exported.cardStyle, style);
  assert.deepEqual(exported.cardLayout, { paddingPx: 8 });
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).formatting.cardStyle, style);
  assert.deepEqual(selected(restored).formatting.cardLayout, { paddingPx: 8 });
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
  // A tampered bundle with invalid card settings imports fail-closed: the whole formatting is dropped.
  const tampered = structuredClone(bundle);
  tampered.members[0].resource.definition.sheets[0].visuals[0].barVisual.opensightFormatting.cardStyle.background.color = 'red';
  const recovered = importBundle(tampered);
  assert.equal(selected(recovered).formatting, undefined);
});

test('cardChromeStyle renders chrome only when options are set', () => {
  assert.deepEqual(cardChromeStyle(undefined), {});
  assert.deepEqual(cardChromeStyle({}), {});
  assert.deepEqual(cardChromeStyle({ cardStyle: { background: { color: '#1a2b3c' } } }), { background: '#1a2b3c' });
  assert.deepEqual(cardChromeStyle({ cardStyle: { background: { color: '#1a2b3c', opacityPct: 50 } } }), { background: 'rgba(26, 43, 60, 0.5)' });
  assert.deepEqual(cardChromeStyle({ cardStyle: { background: { color: '#1a2b3c', opacityPct: 0 } } }), { background: 'rgba(26, 43, 60, 0)' });
  assert.deepEqual(cardChromeStyle({ cardStyle: { border: { color: '#000000', widthPx: 3 } } }), { border: '3px solid #000000' });
  assert.deepEqual(cardChromeStyle({ cardStyle: { border: { color: '#000000', opacityPct: 25, widthPx: 2 } } }), { border: '2px solid rgba(0, 0, 0, 0.25)' });
  assert.deepEqual(cardChromeStyle({ cardStyle: { border: { color: '#000000', widthPx: 0 } } }), { borderWidth: 0, borderStyle: 'none' });
  assert.deepEqual(cardChromeStyle({ cardLayout: { paddingPx: 8 } }), { padding: '8px' });
  assert.equal(cardLoadingAnimation(undefined), true);
  assert.equal(cardLoadingAnimation({ cardStyle: {} }), true);
  assert.equal(cardLoadingAnimation({ cardStyle: { loadingAnimation: false } }), false);
});

test('VisualCard applies card chrome; untouched cards render byte-identically', () => {
  const plain = html(input(selected(add())));
  assert.doesNotMatch(plain, /rgba\(/);
  assert.doesNotMatch(plain, /skeleton-static/);
  const styled = html(input({ ...selected(add()), formatting: {
    cardStyle: { background: { color: '#1a2b3c', opacityPct: 50 }, border: { color: '#000000', widthPx: 3 }, selection: { color: '#112233' }, loadingAnimation: false },
    cardLayout: { paddingPx: 8 },
  } }));
  assert.match(styled, /background:rgba\(26, 43, 60, 0\.5\)/);
  assert.match(styled, /border:3px solid #000000/);
  assert.match(styled, /padding:8px/);
  // Selection color is saved but never rendered: no trace in the markup.
  assert.doesNotMatch(styled, /#112233/);
  // The loading toggle off does not remove the loading state, only its animation.
  const loading = renderToStaticMarkup(createElement(VisualCard, { visual: input({ ...selected(add()), formatting: { cardStyle: { loadingAnimation: false } } }, null), loading: true }));
  assert.match(loading, /skeleton-static/);
  assert.match(loading, /Loading data/);
  const loadingAnimated = renderToStaticMarkup(createElement(VisualCard, { visual: input(selected(add()), null), loading: true }));
  assert.doesNotMatch(loadingAnimated, /skeleton-static/);
});

test('VisualSkeleton honors the animated flag', () => {
  const on = renderToStaticMarkup(createElement(VisualSkeleton, { kind: 'bar' }));
  const off = renderToStaticMarkup(createElement(VisualSkeleton, { kind: 'bar', animated: false }));
  assert.doesNotMatch(on, /skeleton-static/);
  assert.match(off, /skeleton-static/);
  assert.match(off, /Loading data/);
});
