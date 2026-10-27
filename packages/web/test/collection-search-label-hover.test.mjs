import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 125: hover feedback for the drafts collection
// tools row's plain search label (.draft-collection-tools label —
// "Search analyses" in LocalDrafts.tsx's expanded collection, wrapping
// the search input in the tools row on the Analyses home page). The
// resting rule (.draft-collection-tools label { display: grid; gap: 4px;
// }) makes the label a visible surface (text, gap, field), but the label
// had zero hover feedback: slice 64 hovered the search field inside this
// label, slice 96 the favorites-filter label beside it, slice 124 the
// pagination label below it, and every other label :hover rule in the
// cascade is scoped elsewhere (author labels, calculation/analysis-file/
// data dialogs, prep labels, connector/sign-in labels, admin labels,
// embed labels, the collection pagination label). A CSSOM probe with all
// five real stylesheets (1,394 rules) in the real ancestor context
// (app-shell > main > .analyses-home > section.collection-page >
// .collection-card > section.local-drafts.draft-collection >
// .draft-collection-tools > label) confirmed zero matching :hover rules
// for the label and a transparent rest, while the search input inside it
// matched the slice-64 collection-card field hover and the
// favorites-filter label beside it matched the slice-96 hover. The label
// now takes #eaf3f7, the collection surface's established hover tint
// (the search field inside it and the favorites-filter label beside it),
// so no new colour is introduced — and because the label and the field
// inside it take the same tint, hovering either reads as one surface,
// not two steps. The favorites-filter label is excluded from the new
// rule: slice 96 already owns its hover (same tint, plus its author
// dark-chrome variant). This label exists only in the expanded
// collection — the author sidebar renders LocalDrafts without the tools
// row — and that surface is fixed light, so no dark variant. Background
// only, so resting geometry is identical and there is no animation.
const appChromeCss = styles['app-chrome.css'];

const labelRule = appChromeCss.match(/^\.draft-collection-tools label:hover:not\(\.favorites-filter\)\s*\{([^}]*)\}/m);

test('the collection search label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the draft-collection-tools label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the search field and favorites-filter hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.favorites-filter:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the favorites-filter label hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.collection-pagination label:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the collection pagination label hover must remain #eaf3f7');
});

test('the collection search label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the draft-collection-tools label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting draft-collection tools rules are preserved', () => {
  assert.ok(appChromeCss.match(/\.draft-collection-tools\s*\{[^}]*display:\s*flex/), 'the resting tools row rule must remain');
  assert.ok(appChromeCss.match(/\.draft-collection-tools label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting tools label rule must remain');
  assert.ok(appChromeCss.match(/\.draft-collection-tools label\.favorites-filter\s*\{[^}]*display:\s*inline-flex/), 'the resting favorites-filter label rule must remain');
});

defineHoverCases('collection-search-label hover', {
  html: `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><div class="draft-collection-tools"><label class="favorites-filter" id="favLabel"><input type="checkbox">Favorites only</label><label id="searchLabel">Search analyses<input type="search"></label><button type="button">Refresh drafts</button></div></section></div></section></div></main></div>`
      + `<label id="outsideLabel">Outside<input type="search"></label>`,
  cases: [
    {
      target: '#searchLabel',
      rule: '.draft-collection-tools label:hover:not(.favorites-filter)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#favLabel', '#outsideLabel'],
    },
  ],
});
