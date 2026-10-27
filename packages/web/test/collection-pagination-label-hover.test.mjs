import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 124: hover feedback for the drafts
// collection's pagination label (.collection-pagination label —
// "Items per page" in LocalDrafts.tsx's expanded collection, wrapping
// the page-size select in the pagination row on the Analyses home
// page). The resting rule (.collection-pagination label { display:
// flex; align-items: center; gap: 8px; }) makes the label a visible
// surface (text, gap, select), but the label had zero hover feedback:
// slice 23 hovered the select inside this label, slice 64 the
// collection card's fields, slice 96 the neighbouring favorites-filter
// label, and every other label :hover rule in the cascade is scoped
// elsewhere (author labels, calculation/analysis-file/data dialogs,
// prep labels, connector/sign-in labels, admin labels, embed labels,
// the dialog pagination label). A CSSOM probe with all five real
// stylesheets (1,393 rules) in the real ancestor context (app-shell >
// main > .analyses-home > section.collection-page > .collection-card >
// section.local-drafts.draft-collection > .collection-pagination >
// label) confirmed zero matching :hover rules for the label and a
// transparent rest, while the select inside it matched the slice-23
// pagination select hover. The label now takes #eaf3f7, the collection
// surface's established hover tint (the pagination select inside it
// and the collection-card field hover), so no new colour is
// introduced — and because the label and the select inside it take
// the same tint, hovering either reads as one surface, not two steps.
// Background only, so resting geometry is identical and there is no
// animation; the collection surface is fixed light, so no dark
// variant.
const appChromeCss = styles['app-chrome.css'];

const labelRule = appChromeCss.match(/^\.collection-pagination label:hover\s*\{([^}]*)\}/m);

test('the collection pagination label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the collection-pagination label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the pagination select and collection-card field hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.collection-pagination select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the pagination select hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.favorites-filter:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the favorites-filter label hover must remain #eaf3f7');
});

test('the collection pagination label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the collection-pagination label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting collection pagination rules are preserved', () => {
  assert.ok(appChromeCss.match(/\.collection-pagination\s*\{[^}]*display:\s*flex/), 'the resting pagination row rule must remain');
  assert.ok(appChromeCss.match(/\.collection-pagination label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/), 'the resting pagination label rule must remain');
  assert.ok(appChromeCss.match(/\.collection-pagination button\s*\{[^}]*min-width:\s*28px/), 'the resting pagination button rule must remain');
});

defineHoverCases('collection-pagination-label hover', {
  html: `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><div class="collection-pagination"><span>3 analyses</span><label id="pagLabel">Items per page<select><option>25</option><option>50</option></select></label><button type="button">‹</button><span>Page 1 of 1</span></div></section></div></section></div></main></div>`
      + `<div class="app-shell"><main><div class="collection-card"><label id="cardLabel">Outside pagination<select><option>Other</option></select></label></div></main></div>`
      + `<label id="outsideLabel">Outside<select><option>Other</option></select></label>`,
  cases: [
    {
      target: '#pagLabel',
      rule: '.collection-pagination label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#cardLabel', '#outsideLabel'],
    },
  ],
});
