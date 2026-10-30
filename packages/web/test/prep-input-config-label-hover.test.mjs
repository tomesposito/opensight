import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 107: hover feedback for the data-prep
// input-config source-picker label (.prep-input-config > label in
// DataPrep.tsx — "Connected source" wrapping its PrepSourcePicker
// select in the configure panel's input view, the direct-child
// label of div.prep-input-config in section.prep-configure in
// section.data-prep). The .data-prep label rule lays it out as a
// column flex (text line, gap, field), so the label has real
// visible area, but it had zero hover feedback: every label :hover
// rule in the cascade is scoped elsewhere (author toggles,
// parameter/action editors, O-mode notice, admin dialog,
// connector/sign-in/collection labels, and the slice-103/104/105/
// 106 prep-columns, prep-key-column, prep-document-bar and
// prep-step-editor labels), so the label rested transparent and
// hovering its text or gap changed nothing, while only the select
// inside it tinted via the slice-31 select hover. This was the
// backup lead left by slice 106, probe-confirmed there with all
// five real stylesheets (1,364 rules) in the real ancestor
// contexts (standalone .data-prep and inside .app-shell). The
// label now takes #e8eefb, the data-prep surface's established
// hover tint (the slice-31 select hover, the slice-39 button and
// input/textarea hovers, and the slice-103/104/105/106 prep label
// hovers), so no new colour is introduced. The child-combinator
// scope keeps the staging picker's label and other prep labels
// out — the step-editor's source-picker label already takes the
// identical tint via slice 106. Background only, so resting
// geometry is identical and there is no animation. The data-prep
// surface is fixed light, so no dark variant.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.prep-input-config > label:hover\s*\{([^}]*)\}/m);

test('the prep-input-config label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-input-config > label :hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-prep select hover must remain #e8eefb');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#e8eefb/), 'the prep-columns label hover must remain #e8eefb');
});

test('the prep-input-config label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-input-config and data-prep label rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-step-editor > label, \.prep-input-config > label, \.prep-staging > label\s*\{[^}]*max-width:\s*360px/), 'the prep-input-config label resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the data-prep label resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-input-config/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

defineHoverCases('prep-input-config-label hover', {
  html: `<section class="data-prep"><div class="prep-workspace"><div class="prep-main"><section class="prep-configure">`
      + `<div class="prep-input-config"><h3>Input · Add data</h3>`
      + `<label id="pickerLabel">Connected source<select><option>Sales</option></select></label>`
      + `</div>`
      + `<div class="prep-staging"><label id="stagingLabel">Stage a source<select><option>Sales</option></select></label></div>`
      + `<form class="prep-step-editor"><label id="stepLabel">Step name (optional)<input type="text"></label></form>`
      + `</section></div></div></section>`
      + `<div class="prep-document-bar"><label id="docLabel">Dataset name<input type="text"></label></div>`,
  cases: [
    {
      target: '#pickerLabel',
      rule: '.prep-input-config > label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#stagingLabel', '#stepLabel', '#docLabel'],
    },
  ],
});
