import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 126: hover feedback for the draft-rename form's
// label (.draft-rename label — "Draft name" in LocalDrafts.tsx, wrapping
// the rename input in the expanded drafts collection on the Analyses home
// page and again in the author sidebar's local-drafts panel). The label
// had zero hover feedback: slice 64 hovered the rename field inside it in
// the collection context and slices 96/124/125 hovered the neighbouring
// collection labels, but every other label :hover rule in the cascade is
// scoped elsewhere (author labels, calculation/analysis-file/data
// dialogs, prep labels, connector/sign-in labels, admin labels, embed
// labels, the collection tools/pagination labels), so the label rested
// transparent and hovering its text or gap changed nothing. A CSSOM probe
// with all five real stylesheets (1,395 rules) in the real ancestor
// contexts (app-shell > main > .analyses-home > section.collection-page >
// .collection-card > section.local-drafts.draft-collection >
// form.draft-rename > label, and the author sidebar's
// .author-workspace > .author-tools > details.local-drafts >
// form.draft-rename > label in light and dark chrome) confirmed zero
// matching :hover rules for the label and a transparent rest in all
// three, while the input inside it matched the slice-64 collection-card
// field hover in the collection context only. The label now takes
// #eaf3f7, the collection surface's established hover tint (the rename
// field inside it and the neighbouring labels), so no new colour is
// introduced — and because the label and the field inside it take the
// same tint in the collection context, hovering either reads as one
// surface, not two steps. The same light rule reaches the author sidebar
// in light chrome, following the slice-96 favorites-filter precedent for
// this same component; the author dark-chrome variant takes the author
// dark hover tint #334c62. Background only, so resting geometry is
// identical and there is no animation.
const appChromeCss = styles['app-chrome.css'];
const styleCss = styles['style.css'];

const labelRule = appChromeCss.match(/^\.draft-rename label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.draft-rename label:hover\s*\{([^}]*)\}/m);

test('the draft-rename label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the draft-rename label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the collection field and neighbouring label hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.favorites-filter:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the favorites-filter label hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.draft-collection-tools label:hover:not\(\.favorites-filter\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection search label hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.collection-pagination label:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the collection pagination label hover must remain #eaf3f7');
});

test('the draft-rename label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the draft-rename label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename label hover variant');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(darkRule[1]), 'dark hover must change background only');
});

test('the resting draft-rename rules are preserved and the dark variant uses the author dark hover tint', () => {
  assert.ok(appChromeCss.match(/\.collection-card \.draft-rename\s*\{[^}]*border-top:\s*1px solid #d1e0e5/), 'the resting collection draft-rename rule must remain');
  assert.ok(appChromeCss.match(/\.collection-card \.draft-rename label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting collection draft-rename label rule must remain');
  assert.ok(styleCss.match(/\.local-drafts form\s*\{[^}]*display:\s*flex/), 'the resting local-drafts form rule must remain');
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.favorites-filter:hover\s*\{[^}]*background:\s*#334c62/), 'the favorites-filter dark hover must remain #334c62');
});

defineHoverCases('draft-rename-label hover', {
  html: `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><form class="draft-rename"><label id="collLabel">Draft name<input id="collInput" value="Q3 sales"></label><button type="submit">Save draft name</button></form></section></div></section></div></main></div>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label id="authLabel">Draft name<input value="Q3 sales"></label></form></details></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label id="darkLabel">Draft name<input value="Q3 sales"></label></form></details></div></div>`
      + `<form class="other-form"><label id="outsideLabel">Other name<input value="x"></label></form>`,
  cases: [
    {
      target: '#collLabel',
      rule: '.draft-rename label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#collInput', '#outsideLabel'],
    },
    {
      target: '#authLabel',
      rule: '.draft-rename label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#darkLabel',
      rule: '.author-workspace[data-chrome="dark"] .draft-rename label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
