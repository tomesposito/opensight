import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 127: hover feedback for the draft-rename form's
// input (.draft-rename input in LocalDrafts.tsx, the rename field in the
// author sidebar's local-drafts panel). Slice 126's backup lead, re-verified
// this run: the input's collection-context instance already hovers via
// slice 64 (.collection-card input:hover, #e8eefb), but in the author
// sidebar LocalDrafts renders inside .author-workspace > .author-tools >
// details.local-drafts — outside .collection-card and outside
// .author-layout (the author field hover's scope) — and the
// workspace-wide input hovers cover only color and search inputs, so the
// field matched no :hover rule in either author chrome while the label
// around it (slice 126), the panel summary and the form's buttons do step.
// A CSSOM probe with all five real stylesheets (1,397 rules) in the real
// ancestor contexts confirmed zero matching :hover rules for the input in
// both author contexts (rests rgb(255,255,255) light, rgb(32,46,64) dark),
// while the collection input matched the slice-64 rule alone. The input
// now takes the author surface's established field hover tints — #eef3fd
// light (the author-layout field hover and the rename-sheet input hover,
// the precedent for a rename input outside .author-layout) and #36486a in
// dark chrome (the author dark field hover) — so no new colour is
// introduced. Both rules are scoped to .author-workspace, so the
// collection instance keeps its slice-64 hover untouched. Background
// only, so resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];
const appChromeCss = styles['app-chrome.css'];

const inputRule = styleCss.match(/^\.author-workspace \.draft-rename input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.draft-rename input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the draft-rename input hover rules exist for the author sidebar and use the established author field tints', () => {
  assert.ok(inputRule, 'expected the author draft-rename input :hover rule');
  assert.match(inputRule[1], /background:\s*#eef3fd/);
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename input hover variant');
  assert.match(darkRule[1], /background:\s*#36486a/);
});

test('the hover tints match the author field hovers, so no new colour is introduced, and the collection hover is preserved', () => {
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#eef3fd/), 'the author-layout field hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.rename-sheet input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the rename-sheet input hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.author-layout input:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#36486a/), 'the author-layout dark field hover must remain #36486a');
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#e8eefb/), 'the collection-card field hover must remain #e8eefb');
});

test('the draft-rename input hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(inputRule, 'expected the author draft-rename input :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(inputRule[1]), 'hover must change background only');
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename input hover variant');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(darkRule[1]), 'dark hover must change background only');
});

test('the resting draft-rename and local-drafts rules are preserved', () => {
  assert.ok(styleCss.match(/\.local-drafts form\s*\{[^}]*display:\s*flex/), 'the resting local-drafts form rule must remain');
  assert.ok(appChromeCss.match(/\.collection-card \.draft-rename label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting collection draft-rename label rule must remain');
  assert.ok(appChromeCss.match(/\.draft-rename label:hover\s*\{[^}]*background:\s*#e8eefb/), 'the slice-126 draft-rename label hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.draft-rename label:hover\s*\{[^}]*background:\s*#36486a/), 'the slice-126 dark label hover must remain');
});

defineHoverCases('draft-rename-input hover', {
  html: `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><form class="draft-rename"><label>Draft name<input id="collInput" value="Q3 sales"></label></form></section></div></section></div></main></div>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label>Draft name<input id="authInput" value="Q3 sales"></label></form><form class="draft-rename"><label>Draft name<input id="disabledInput" value="Old" disabled></label></form></details></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label>Draft name<input id="darkInput" value="Q3 sales"></label></form></details></div></div>`
      + `<div class="author-workspace" data-chrome="light"><form class="other-form"><label>Other name<input id="outsideInput" value="x"></label></form></div>`,
  cases: [
    {
      target: '#authInput',
      rule: '.author-workspace .draft-rename input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#disabledInput', '#outsideInput'],
    },
    {
      target: '#darkInput',
      rule: '.author-workspace[data-chrome="dark"] .draft-rename input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(32, 46, 64)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#collInput',
      rule: '.collection-card input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"])',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
