import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 75: hover feedback for the global search
// modal's pressed type filter chip (.global-search .search-types
// button[aria-pressed=true] in GlobalSearch.tsx). Slice 47 gave the
// unpressed chips the dialog's selected tint on hover
// (var(--palette-selected), #e2f2fa) and deliberately excluded the
// pressed chip because it already rests at that exact tint — so
// hovering the pressed chip changed nothing, while every plain chip
// steps transparent -> #e2f2fa. Following the slices 28/29/73/74
// selected-control language, the pressed chip now takes a dedicated
// hover step one visible step deeper: #c8eafa, already the codebase's
// selected-hover step for this resting tint (--header-selected-hover,
// the author menu's pressed-button hover at line ~772). The dialog's
// resting colors are fixed light (the dialog carries no dark chrome
// variant), so a literal is correct. Background only, so the pressed
// border (#187199) and text are unchanged and resting geometry is
// identical.
const styleCss = styles['style.css'];

const rule = styleCss.match(/\.global-search \.search-types button\[aria-pressed=true\]:hover\s*\{([^}]*)\}/);

test('the pressed search-type chip has a hover state one step deeper than its selected tint', () => {
  assert.ok(rule, 'expected the .global-search .search-types button[aria-pressed=true]:hover rule');
  assert.match(rule[1], /background:\s*#c8eafa/);
});

test('the hover tint is the existing selected-hover step for the resting tint', () => {
  assert.ok(styleCss.match(/--header-selected-bg:\s*#e2f2fa;\s*--header-selected-text:\s*#103e56;\s*--header-selected-hover:\s*#c8eafa/), 'the header selected-hover precedent must remain #c8eafa over #e2f2fa');
  assert.ok(styleCss.match(/\.global-search \{[^}]*--palette-selected:\s*#e2f2fa/), 'the dialog selected tint must remain #e2f2fa');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome\] \.author-menu > button\[aria-pressed=true\]:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-selected-hover\)/), 'the author menu pressed-button hover must still use the selected-hover var');
});

test('the pressed-chip hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting pressed-chip rule is preserved', () => {
  assert.ok(styleCss.match(/\.global-search \.search-types button\[aria-pressed=true\]\s*\{\s*background:\s*var\(--palette-selected\);\s*border-color:\s*#187199/), 'the resting pressed rule must remain');
  assert.ok(styleCss.match(/\.global-search \.search-types button\s*\{[^}]*background:\s*transparent/), 'the resting chip rule must remain');
});

test('the neighbouring dialog hovers are untouched', () => {
  assert.ok(styleCss.match(/\.global-search \.search-types button:hover:not\(\[aria-pressed=true\]\)\s*\{\s*background:\s*var\(--palette-selected\)/), 'the slice 47 unpressed chip hover must remain');
  assert.ok(styleCss.match(/\.command-palette header button:hover, \.global-search header button:hover\s*\{\s*background:\s*#365764/), 'the slice 47 Close button hover must remain');
  assert.ok(styleCss.match(/\.command-palette input:hover:not\(:disabled\), \.global-search > input:hover:not\(:disabled\)\s*\{\s*background-color:\s*var\(--palette-selected\)/), 'the slice 47 input hover must remain');
  assert.ok(styleCss.match(/\.global-search li:hover\s*\{\s*background:\s*var\(--palette-selected\)/), 'the slice 52 row hover must remain');
});

defineHoverCases('search-type-pressed-chip hover', {
  html: `<dialog class="global-search" open><header><h2>Search</h2><button type="button">Close</button></header>`
      + `<input type="text" placeholder="Find anything">`
      + `<div class="search-types" role="group" aria-label="Filter by type"><span aria-hidden="true">Type</span>`
      + `<button type="button" id="pressed" aria-pressed="true">☆ Favorites</button>`
      + `<button type="button" id="plain" aria-pressed="false">Analyses</button></div></dialog>`
      + `<p><button type="button" id="outside" aria-pressed="true">Outside the dialog</button></p>`,
  cases: [
    {
      target: '#pressed',
      rule: '.global-search .search-types button[aria-pressed="true"]:hover',
      resting: { backgroundColor: 'rgb(226, 242, 250)' },
      hovered: { backgroundColor: 'rgb(200, 234, 250)' },
      paintOnly: true,
      unchanged: ['color', 'borderTopColor'],
      excluded: ['#plain', '#outside'],
    },
  ],
});
